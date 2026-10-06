/**
 * Volta = janela sobre o bruto da sessão (TF-11, TF-12; AD-006, AD-007).
 *
 * - `analysisGps`: os frames que a análise lê, com precisão definida e ≤ 30 m.
 *   É o corte que a captura fazia antes desta feature, agora na leitura.
 * - `sliceLapWindows`: as voltas do `detectLaps` sobre esses frames, guardadas
 *   como os cruzamentos que as abrem e fecham. O cruzamento leva a precisão do
 *   ponto de fronteira: a pior do par interpolado (a regra do `boundaryPoint`).
 * - `lapFrames`: os frames de uma janela, com os pontos de fronteira gerados na
 *   leitura a partir dos cruzamentos. O ponto de fronteira nunca é gravado.
 */
import { detectLaps } from '../lib/lapDetector';
import type { CrossPoint, StartLine } from '../lib/startLine';
import type { BoundaryCross, GpsFrame, GpsSeries, ImuFrame, ImuSeries, LapWindow } from './frame';
import { gpsFramesOf, imuFramesOf } from './series';

/** Precisão máxima (m) de uma fix para a análise (TF-12). */
export const ANALYSIS_MAX_ACCURACY_M = 30;

/** Frame que a análise aceita: a precisão existe. */
export type AnalysisGpsFrame = GpsFrame & { accuracy: number };

export type CrossWindow = Extract<LapWindow, { kind: 'cross' }>;

/** Volta detectada: a janela, a duração e o início no relógio da sessão. */
export type LapWindowRecord = {
  window: CrossWindow;
  /** round(end.t − start.t), como o `detectLaps`. */
  durationMs: number;
  /** round(start.t), no relógio da sessão (ms desde o t0Utc da série). */
  startT: number;
};

const usable = (accuracy: number | undefined): accuracy is number =>
  accuracy !== undefined && accuracy === accuracy && accuracy <= ANALYSIS_MAX_ACCURACY_M;

/** Os frames com precisão definida e ≤ 30 m, na ordem. */
export function analysisGps(frames: readonly GpsFrame[]): AnalysisGpsFrame[] {
  return frames.filter((f): f is AnalysisGpsFrame => usable(f.accuracy));
}

/** Cruzamento guardado: `idx` é o 1º frame depois dele; a precisão é a pior do par interpolado. */
function boundaryCross(cross: CrossPoint, frames: AnalysisGpsFrame[], idx: number): BoundaryCross {
  const b = frames[idx];
  const a = frames[idx - 1];
  const accuracy = a && cross.t < b.t ? Math.max(a.accuracy, b.accuracy) : b.accuracy;
  return { t: cross.t, lat: cross.lat, lng: cross.lng, speed: cross.speed, accuracy };
}

/** As voltas fechadas sobre os frames de análise, como janelas por cruzamento. */
export function sliceLapWindows(gps: readonly GpsFrame[], line?: StartLine | null): LapWindowRecord[] {
  const frames = analysisGps(gps);
  return detectLaps(frames, { line }).laps.map((lap) => ({
    window: {
      kind: 'cross',
      start: boundaryCross(lap.startCross, frames, lap.startIdx),
      end: boundaryCross(lap.endCross, frames, lap.endIdx),
    },
    durationMs: lap.durationMs,
    startT: lap.startedAt,
  }));
}

/** Primeiro índice com `t[i] >= x` (ou `> x` com `strict`), numa coluna crescente. */
function lowerBound(t: Float64Array, n: number, x: number, strict: boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (strict ? t[mid] <= x : t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** IMU com `from ≤ t ≤ to`. */
function imuBetween(imu: ImuSeries | undefined, from: number, to: number): ImuFrame[] {
  if (!imu) return [];
  return imuFramesOf(imu, lowerBound(imu.t, imu.n, from, false), lowerBound(imu.t, imu.n, to, true));
}

function boundaryFrame(c: BoundaryCross, source: GpsFrame['source']): GpsFrame {
  return { kind: 'gps', source, t: c.t, lat: c.lat, lng: c.lng, speed: c.speed, accuracy: c.accuracy, fix: 'unknown', synthetic: true };
}

/**
 * Frames da janela:
 * - por cruzamento: `[fronteira(start), frames com ≤ 30 m e start.t < t < end.t, fronteira(end)]`,
 *   e a IMU em `start.t ≤ t ≤ end.t`;
 * - por índice (legado sem ponto sintético): os frames `from..to` (os dois inclusive) como estão,
 *   e a IMU entre o primeiro e o último `t` deles;
 * - `none` (legado ilegível): nada.
 */
export function lapFrames(window: LapWindow, gps: GpsSeries, imu?: ImuSeries): { gps: GpsFrame[]; imu: ImuFrame[] } {
  if (window.kind === 'none') return { gps: [], imu: [] };
  if (window.kind === 'index') {
    const frames = gpsFramesOf(gps, window.from, Math.min(window.to + 1, gps.n));
    if (frames.length === 0) return { gps: [], imu: [] };
    return { gps: frames, imu: imuBetween(imu, frames[0].t, frames[frames.length - 1].t) };
  }
  const { start, end } = window;
  const inner = gpsFramesOf(gps, lowerBound(gps.t, gps.n, start.t, true), lowerBound(gps.t, gps.n, end.t, false));
  return {
    gps: [
      boundaryFrame(start, gps.meta.source),
      ...inner.filter((f) => usable(f.accuracy)),
      boundaryFrame(end, gps.meta.source),
    ],
    imu: imuBetween(imu, start.t, end.t),
  };
}
