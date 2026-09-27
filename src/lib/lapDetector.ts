/**
 * Detector de voltas — fonte única de verdade do projeto.
 *
 * Função pura, sem dependência de React, GPS ou async. Recebe samples,
 * retorna índices de voltas fechadas. Usada tanto pelo hook (em tempo real,
 * a cada poll de 500ms) quanto pela tela de reconhecimento/corrida (no
 * momento de salvar). Mesma entrada → mesma saída, sem divergências.
 *
 * Algoritmo em três fases:
 *
 *   1. "Entrou em ritmo?" — acha o primeiro sample onde o piloto manteve
 *      velocidade acima de um limiar por N samples consecutivos. Antes
 *      disso é paddock: jitter de GPS parado, piloto arrumando macacão.
 *
 *   2. "Linha de largada" — com traçado de referência, é a linha do traçado
 *      (`lineFromLayout`, passada em `options.line`). Sem traçado, é o ponto
 *      onde o ritmo começou, com o rumo do movimento (`lineFromMotion`).
 *      A linha é um segmento perpendicular ao rumo, com sentido.
 *
 *   3. "Voltas" — a volta fecha no instante interpolado em que a trajetória
 *      atravessa a linha no sentido dela (`crossing`), desde que o piloto
 *      tenha andado uma distância mínima e a duração fique entre o mínimo
 *      e o máximo. Cruzamento que não fecha volta (parado na linha, jitter)
 *      é ignorado e não reinicia a contagem.
 *
 * Performance: O(n) com n = número de samples. Uma sessão de 10min a 10Hz
 * tem 6000 samples; algoritmo roda em <5ms em JS. Pode ser chamado a cada
 * 500ms sem custo perceptível.
 */

import { GpsSample, haversine } from './geometry';
import { crossing, lineFromMotion, type CrossPoint, type StartLine } from './startLine';

export type DetectLapsOptions = {
  /** Meia-largura da linha de chegada, em metros, para cada lado do ponto. Default: 15 */
  lineRadius?: number;
  /** Distância mínima percorrida para fechar uma volta. Default: 300m */
  minLapDistance?: number;
  /** Duração mínima aceita pra uma volta. Default: 25000ms */
  minLapDuration?: number;
  /** Duração máxima aceita antes de considerar "saiu da pista". Default: 180000ms */
  maxLapDuration?: number;
  /** Velocidade (m/s) que marca "entrou em ritmo". Default: 5 (18 km/h) */
  ritmoSpeedMs?: number;
  /** Velocidade mínima (m/s) pra considerar ritmo sustentado. Default: 3 (11 km/h) */
  ritmoMinSustainedMs?: number;
  /** Quantos samples consecutivos acima do limiar confirmam ritmo. Default: 3 */
  ritmoConfirmSamples?: number;
};

const DEFAULTS: Required<DetectLapsOptions> = {
  lineRadius: 15,
  minLapDistance: 300,
  minLapDuration: 25_000,
  maxLapDuration: 180_000,
  ritmoSpeedMs: 5,
  ritmoMinSustainedMs: 3,
  ritmoConfirmSamples: 3,
};

export type DetectedLap = {
  /** Índice do 1º ponto cru depois do cruzamento que abre a volta (o próprio ponto de ritmo, na 1ª volta sem traçado). */
  startIdx: number;
  /** Índice do 1º ponto cru depois do cruzamento que fecha a volta. */
  endIdx: number;
  /** Cruzamento interpolado que abre a volta. */
  startCross: CrossPoint;
  /** Cruzamento interpolado que fecha a volta. */
  endCross: CrossPoint;
  /** Duração em ms: round(endCross.t − startCross.t). */
  durationMs: number;
  /** Timestamp absoluto de início da volta: round(startCross.t). */
  startedAt: number;
};

export type DetectLapsResult = {
  /** Índice do primeiro sample "em ritmo". -1 se piloto nunca saiu do paddock. */
  movingStartIdx: number;
  /** Linha de largada/chegada usada (ponto e rumo). null se movingStartIdx === -1. */
  startFinishLine: StartLine | null;
  /** Voltas fechadas, em ordem cronológica. */
  laps: DetectedLap[];
};

/**
 * Acha o índice do primeiro sample em que o piloto confirma ter entrado em ritmo.
 *
 * Não basta "velocidade > X em um sample", porque GPS parado flutua e
 * pode cuspir 6 m/s por um instante (ruído). Exigimos N samples
 * consecutivos acima do limiar pra dar como confirmado.
 *
 * Retorna o índice do PRIMEIRO sample do período sustentado, não o último.
 * Isso é importante: a linha de largada fica onde o ritmo começou, não
 * onde ele foi confirmado.
 */
function findRitmoStart(
  samples: GpsSample[],
  opts: Required<DetectLapsOptions>
): number {
  const { ritmoSpeedMs, ritmoMinSustainedMs, ritmoConfirmSamples } = opts;

  for (let i = 0; i <= samples.length - ritmoConfirmSamples; i++) {
    if (samples[i].speed < ritmoSpeedMs) continue;

    // Olha os próximos (ritmoConfirmSamples - 1) samples. Todos precisam
    // ter velocidade >= ritmoMinSustainedMs (um limiar mais baixo que o
    // gatilho, pra tolerar pequenas oscilações).
    let sustained = true;
    for (let j = 1; j < ritmoConfirmSamples; j++) {
      if (samples[i + j].speed < ritmoMinSustainedMs) {
        sustained = false;
        break;
      }
    }
    if (!sustained) continue;

    return i;
  }
  return -1;
}

export function detectLaps(
  samples: GpsSample[],
  options?: DetectLapsOptions & { line?: StartLine | null }
): DetectLapsResult {
  const { line: layoutLine, ...rest } = options ?? {};
  const opts: Required<DetectLapsOptions> = { ...DEFAULTS, ...rest };

  if (samples.length < 10) {
    return { movingStartIdx: -1, startFinishLine: null, laps: [] };
  }

  const movingStartIdx = findRitmoStart(samples, opts);
  if (movingStartIdx < 0) {
    return { movingStartIdx: -1, startFinishLine: null, laps: [] };
  }

  const line = layoutLine ?? lineFromMotion(samples, movingStartIdx);

  // Cruzamento que abriu a volta em curso. Sem traçado, a linha passa pelo
  // ponto em que o ritmo começou, e esse ponto é o primeiro cruzamento
  // (f = 0). Com traçado, o trecho até o primeiro cruzamento não é volta.
  let open: { cross: CrossPoint; idx: number } | null = null;
  if (!layoutLine) {
    const p = samples[movingStartIdx];
    open = { cross: { t: p.t, lat: p.lat, lng: p.lng, speed: p.speed }, idx: movingStartIdx };
  }
  let distSinceOpen = 0;

  const laps: DetectedLap[] = [];
  const firstPair = layoutLine ? Math.max(1, movingStartIdx) : movingStartIdx + 1;
  for (let i = firstPair; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (open) distSinceOpen += haversine(a, b);

    const c = crossing(a, b, line, opts.lineRadius);
    if (!c) continue;
    const cross: CrossPoint = { t: c.t, lat: c.lat, lng: c.lng, speed: c.speed };

    if (!open) {
      open = { cross, idx: i };
      distSinceOpen = 0;
      continue;
    }

    const elapsed = cross.t - open.cross.t;
    // Piloto parado na linha, jitter, volta curta demais: o cruzamento é
    // ignorado e não reinicia a contagem.
    if (distSinceOpen < opts.minLapDistance || elapsed < opts.minLapDuration) continue;

    // Volta anormalmente longa (parou no meio, foi ao box): não é volta, mas
    // a próxima conta a partir deste cruzamento.
    if (elapsed <= opts.maxLapDuration) {
      laps.push({
        startIdx: open.idx,
        endIdx: i,
        startCross: open.cross,
        endCross: cross,
        durationMs: Math.round(cross.t - open.cross.t),
        startedAt: Math.round(open.cross.t),
      });
    }
    open = { cross, idx: i };
    distSinceOpen = 0;
  }

  return { movingStartIdx, startFinishLine: line, laps };
}
