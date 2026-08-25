/**
 * "Sua volta": a melhor volta do piloto numa pista, pintada pela velocidade,
 * e onde o tempo vai embora ao longo de TODAS as voltas dele ali.
 *
 * A diferença pra análise de sessão é o recorte. Lá a pergunta é "esta volta
 * contra a sua melhor"; aqui é "o que se repete". Uma curva que custou 0,11 s
 * numa volta pode ter sido distração; a mesma curva custando 0,11 s em média
 * ao longo de 47 voltas é hábito — e é isso que vale treinar.
 */

import { analyzeCorners } from './cornerAnalysis';
import { detectCorners } from './corners';
import { buildReferenceLap, GpsSample } from './geometry';
import { LapRecord, matchLapToReference } from './analysis';

export type CornerLoss = {
  /** Número da curva na volta, começando em 1. */
  number: number;
  /** Perda média por volta, em ms. Sempre >= 0 — ganho vira zero. */
  lossMs: number;
  /** Menor velocidade média do piloto ali, km/h. */
  apexKmh: number | null;
  /** Em quantas voltas ele perdeu tempo nesta curva. */
  lapsLosing: number;
};

export type LapInsight = {
  best: LapRecord;
  /** Faixa de velocidade da melhor volta, pra escala do mapa. */
  minKmh: number;
  maxKmh: number;
  /** Curvas ordenadas como aparecem na volta. */
  corners: CornerLoss[];
  /** Soma das perdas médias — quanto a volta média custa a mais que a melhor. */
  totalLossMs: number;
  /** Quantas voltas entraram na conta (sem contar a melhor). */
  lapsUsed: number;
  /** Curva que mais custa. */
  worst: CornerLoss | null;
};

const MAX_LAPS = 60;

export function buildLapInsight(laps: LapRecord[]): LapInsight | null {
  const usable = laps.filter((l) => l.samples && l.samples.length > 20);
  if (usable.length === 0) return null;

  const best = usable.reduce((b, l) => (l.durationMs < b.durationMs ? l : b));

  const speeds = best.samples.map((p: GpsSample) => p.speed * 3.6).filter((v) => isFinite(v));
  const minKmh = speeds.length ? Math.min(...speeds) : 0;
  const maxKmh = speeds.length ? Math.max(...speeds) : 0;

  const empty: LapInsight = {
    best, minKmh, maxKmh, corners: [], totalLossMs: 0, lapsUsed: 0, worst: null,
  };

  try {
    const ref = buildReferenceLap(best.samples, {
      lat: best.samples[0].lat,
      lng: best.samples[0].lng,
    });
    const corners = detectCorners(ref);
    if (corners.length === 0) return empty;

    const matchedBest = matchLapToReference(best, ref);
    // Volta demais trava a tela: o casamento com a referência é O(n) por volta
    // e o ganho estatístico depois de algumas dezenas é pequeno.
    const others = usable.filter((l) => l.id !== best.id).slice(0, MAX_LAPS);

    const sums = new Map<number, { loss: number; losing: number; apex: number[] }>();
    for (const lap of others) {
      const metrics = analyzeCorners(corners, ref, matchLapToReference(lap, ref), matchedBest);
      metrics.forEach((m, i) => {
        if (!m.valid || m.deltaMs == null) return;
        const acc = sums.get(i) ?? { loss: 0, losing: 0, apex: [] };
        // Ganho não abate perda: a pergunta é onde o tempo VAI, e uma volta
        // excepcional numa curva não desfaz o custo médio dela.
        if (m.deltaMs > 0) { acc.loss += m.deltaMs; acc.losing += 1; }
        if (m.minSpeedKmh != null) acc.apex.push(m.minSpeedKmh);
        sums.set(i, acc);
      });
    }

    const list: CornerLoss[] = corners.map((_, i) => {
      const acc = sums.get(i);
      const apex = acc?.apex ?? [];
      return {
        number: i + 1,
        lossMs: acc && others.length ? acc.loss / others.length : 0,
        apexKmh: apex.length ? apex.reduce((a, b) => a + b, 0) / apex.length : null,
        lapsLosing: acc?.losing ?? 0,
      };
    });

    const worst = list.reduce<CornerLoss | null>(
      (a, b) => (a == null || b.lossMs > a.lossMs ? b : a),
      null
    );

    return {
      best,
      minKmh,
      maxKmh,
      corners: list,
      totalLossMs: list.reduce((a, c) => a + c.lossMs, 0),
      lapsUsed: others.length,
      worst: worst && worst.lossMs > 0 ? worst : null,
    };
  } catch {
    // GPS ruim na melhor volta — mostra o mapa, sem a conta das curvas.
    return empty;
  }
}

/**
 * Rampa de velocidade: azul escuro no lento, branco no rápido. Mantém o acento
 * único do sistema — verde e vermelho aqui competiriam com o vermelho que
 * significa perda de tempo logo abaixo no mesmo scroll.
 */
export function speedPaint(kmh: number, minKmh: number, maxKmh: number): string {
  if (maxKmh <= minKmh) return '#2563FF';
  const t = Math.max(0, Math.min(1, (kmh - minKmh) / (maxKmh - minKmh)));
  const r = Math.round(37 + (255 - 37) * t);
  const g = Math.round(99 + (255 - 99) * t);
  const b = 255;
  return `rgb(${r}, ${g}, ${b})`;
}
