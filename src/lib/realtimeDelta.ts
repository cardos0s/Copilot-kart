/**
 * Delta em tempo real, estilo MyChron.
 *
 * Durante a volta atual, o piloto não sabe o tempo final ainda — então
 * comparar tempo total contra tempo total não dá feedback enquanto ele
 * está andando. O delta ao vivo responde:
 *
 *   "Neste ponto da pista, estou mais rápido ou mais lento que minha
 *    referência?"
 *
 * Como funciona:
 *   1. Recebe uma volta de referência (samples + duração).
 *   2. Pré-computa o mapping (s, t) da referência usando o pipeline
 *      existente — buildReferenceLap + matchLapToReference. Isso resolve
 *      ambiguidade da linha de chegada e timestamps degenerados.
 *   3. A cada novo sample do piloto, faz map matching pra obter `s` atual
 *      (posição na polyline da pista), interpola o tempo que a referência
 *      tinha naquele `s` e calcula:
 *
 *          delta = elapsedDaVoltaAtual - tempoDaReferenciaNoMesmoS
 *
 *      Negativo = mais rápido que a referência no mesmo ponto.
 *      Positivo = mais lento.
 *
 * Stateful por design: mantém `hintIdx` entre chamadas pra que o map matching
 * seja O(janela) em vez de O(n). A pista é contínua — o piloto não
 * teletransporta — então a busca local converge rápido.
 *
 * Reset() é chamado quando uma volta nova começa (cruzou a linha) pra
 * limpar o hint e voltar a buscar do começo.
 */

import {
  GpsSample,
  ReferenceLap,
  buildReferenceLap,
  makeLocalProjector,
  matchToReference,
} from './geometry';
import {
  LapRecord,
  MatchedLap,
  interpolateTimeAtS,
  matchLapToReference,
} from './analysis';

export type DeltaReading = {
  /** delta em ms (negativo = mais rápido, positivo = mais lento). null
   *  quando não há referência ou o sample não pôde ser matched. */
  deltaMs: number | null;
  /** Posição na pista (metros desde linha de largada), null se sem ref. */
  sCurrent: number | null;
  /** sCurrent / totalLength, em [0, 1]. Útil pra barra de progresso. */
  sNormalized: number | null;
  /** Distância perpendicular ao traçado de referência (m). Quando alta,
   *  delta fica menos confiável — piloto cortou ou saiu da pista. */
  matchDistanceM: number | null;
};

const EMPTY: DeltaReading = {
  deltaMs: null,
  sCurrent: null,
  sNormalized: null,
  matchDistanceM: null,
};

/**
 * Tracker de delta em tempo real. Stateful por instância.
 *
 * Uso típico:
 *
 *   const tracker = new DeltaTracker();
 *   // quando uma volta fecha e vira referência:
 *   tracker.setReference(refSamples, refDurationMs);
 *   // a cada novo sample durante a volta atual:
 *   const { deltaMs } = tracker.compute(sample, lapElapsedMs);
 *   // quando uma volta nova começa:
 *   tracker.resetLap();
 */
export class DeltaTracker {
  private ref: ReferenceLap | null = null;
  private matchedRef: MatchedLap | null = null;
  private hintIdx: number | undefined = undefined;
  /** Marca s do sample anterior pra detectar cruzamento da linha (wrap). */
  private lastS: number | null = null;

  /**
   * Substitui a volta de referência. Refaz todo o pré-processamento
   * (projeção local, polyline cumulativa, map matching da própria ref).
   *
   * Custo: O(n) onde n = samples da referência (tipicamente 200-600).
   * Roda em <5ms num device médio.
   */
  setReference(samples: GpsSample[], durationMs: number): void {
    if (samples.length < 5 || durationMs <= 0) {
      this.clear();
      return;
    }
    const origin = { lat: samples[0].lat, lng: samples[0].lng };
    const ref = buildReferenceLap(samples, origin);
    if (ref.totalLength <= 0) {
      this.clear();
      return;
    }
    const lapRecord: LapRecord = {
      id: '__ref__',
      sessionId: '__ref__',
      samples,
      startedAt: samples[0].t,
      durationMs,
    };
    const matched = matchLapToReference(lapRecord, ref);
    if (matched.points.length < 2) {
      this.clear();
      return;
    }
    this.ref = ref;
    this.matchedRef = matched;
    this.hintIdx = undefined;
    this.lastS = null;
  }

  /** Sinaliza que uma volta nova começou — reseta o hint pra buscar do começo. */
  resetLap(): void {
    this.hintIdx = undefined;
    this.lastS = null;
  }

  /** Remove referência atual. compute() volta a devolver EMPTY. */
  clear(): void {
    this.ref = null;
    this.matchedRef = null;
    this.hintIdx = undefined;
    this.lastS = null;
  }

  hasReference(): boolean {
    return this.ref !== null && this.matchedRef !== null;
  }

  /**
   * Calcula o delta no ponto atual. `lapElapsedMs` é o tempo que se passou
   * desde que a volta ATUAL começou (não desde o start da sessão).
   *
   * Retorna {deltaMs: null} se:
   *   - Não há referência configurada
   *   - O sample tá longe demais do traçado (>40m → provavelmente sem GPS,
   *     piloto fora da pista, ou referência incompatível)
   *   - Map matching falhou
   */
  compute(sample: GpsSample, lapElapsedMs: number): DeltaReading {
    if (!this.ref || !this.matchedRef) return EMPTY;
    const proj = makeLocalProjector(this.ref.origin);
    const xy = proj.toXY(sample);
    const match = matchToReference(xy, this.ref, this.hintIdx);

    // Match suspeito — não atualiza hint pra próxima chamada tentar de novo
    // com a janela ampla, mas devolve null pra UI não confundir o piloto.
    if (match.dist > 40) {
      return {
        deltaMs: null,
        sCurrent: match.s,
        sNormalized: this.ref.totalLength > 0 ? match.s / this.ref.totalLength : null,
        matchDistanceM: match.dist,
      };
    }

    // Detecta wrap (cruzou linha de chegada): s caiu drasticamente.
    // Não é fim do mundo se acontecer, mas é sinal de que o caller esqueceu
    // de chamar resetLap(). Apenas reseta o hint defensivamente.
    if (this.lastS !== null) {
      const dropped = this.lastS - match.s;
      if (dropped > this.ref.totalLength * 0.5) {
        this.hintIdx = undefined;
      } else {
        this.hintIdx = match.segmentIdx;
      }
    } else {
      this.hintIdx = match.segmentIdx;
    }
    this.lastS = match.s;

    const tRefAtS = interpolateTimeAtS(this.matchedRef, match.s);
    if (tRefAtS === null) {
      return {
        deltaMs: null,
        sCurrent: match.s,
        sNormalized: match.s / this.ref.totalLength,
        matchDistanceM: match.dist,
      };
    }

    const delta = lapElapsedMs - tRefAtS;
    // Sanity clamp — deltas absurdos (>30s) acontecem em transições de
    // volta (linha de chegada ambígua, 1 sample matched no lugar errado).
    // Em vez de mostrar "+58.000" e voltar pra "-0.200" 500ms depois,
    // suprime e deixa a UI cair no cronômetro. Pista de kart tem volta
    // ~1min — delta legítimo nunca chega perto de 30s.
    if (Math.abs(delta) > 30_000) {
      return {
        deltaMs: null,
        sCurrent: match.s,
        sNormalized: match.s / this.ref.totalLength,
        matchDistanceM: match.dist,
      };
    }
    return {
      deltaMs: delta,
      sCurrent: match.s,
      sNormalized: match.s / this.ref.totalLength,
      matchDistanceM: match.dist,
    };
  }
}
