/**
 * Conversão do formato antigo (JSON de amostras, até a v4) para frames e janelas
 * (TF-17, TF-19, TF-20; design §8). Puro: a migração v5b grava o resultado, e quem
 * ainda lê um dado não convertido usa a mesma conversão em memória.
 *
 * Regras:
 * - os pontos `synthetic` das pontas de uma volta viram os cruzamentos `start`/`end`
 *   da janela, e não frames (AD-006, AD-007);
 * - a volta sem ponto sintético (anterior à AD-006) vira uma janela por índice: os
 *   timestamps antigos podem ser degenerados (todos iguais), e uma janela por tempo
 *   seria ambígua;
 * - a 1ª amostra de uma volta que é idêntica (`t`, `lat` e `lng`) à última já
 *   convertida vira um frame só; com qualquer diferença, as duas ficam;
 * - todo frame convertido tem `legacy` e `fix: 'unknown'`, com a precisão que existia;
 * - o acelerômetro antigo está em g (era o que o sensor entregava) e sai em m/s²;
 * - um JSON ilegível não derruba nada: a volta fica com a janela `none` e entra em
 *   `skipped`, e a conversão segue com as outras.
 *
 * Uma sessão é gravada por uma versão só do app, então as voltas dela ou têm todas os
 * pontos sintéticos ou nenhuma. A janela por cruzamento procura os frames pelo tempo e
 * supõe a série crescente, o que vale para as voltas com ponto sintético.
 */
import { G, type BoundaryCross, type GpsFrame, type ImuFrame, type LapWindow, type Vec3 } from './frame';

/** A volta como `laps` a guardava até a v4. */
export type LegacyLapRow = {
  id: string;
  started_at: number;
  samples_json: string | null | undefined;
  imu_samples_json?: string | null;
};

/** Um pedaço do diário v4 (`recording_chunks`), em ordem de `seq`. */
export type LegacyChunk = { gps_json: string; imu_json: string };

/** Ponto de GPS do formato antigo: `t` em epoch ms. */
type LegacyPoint = {
  t: number;
  lat: number;
  lng: number;
  speed: number;
  accuracy?: number;
  heading?: number;
  altitude?: number;
  altitudeAccuracy?: number;
  synthetic?: boolean;
};

/** Leitura da IMU do formato antigo: `t` em epoch ms, accel em g, gyro em rad/s. */
type LegacyImuPoint = { t: number; accel?: Vec3; gyro?: Vec3 };

export type ConvertedSession = {
  /** O menor `t` da sessão (epoch ms); `null` sem nenhum ponto legível. */
  t0Utc: number | null;
  /** A série GPS da sessão, com `t` desde o `t0Utc`. */
  gps: GpsFrame[];
  imu: ImuFrame[];
  /** A janela de cada volta, pelo id. */
  windows: Map<string, LapWindow>;
  /** Voltas com o JSON de GPS ilegível: ficam com a janela `none`. */
  skipped: string[];
  /** Voltas com o JSON da IMU ilegível: convertem sem IMU. */
  imuSkipped: string[];
};

export type ConvertedLayout = { gps: GpsFrame[]; window: LapWindow; skipped: boolean };
export type ConvertedReference = { gps: GpsFrame[]; skipped: boolean };
export type ConvertedJournal = { t0Utc: number; gps: GpsFrame[]; imu: ImuFrame[]; skipped: number };

const isNum = (v: unknown): v is number => typeof v === 'number';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Os pontos do JSON, ou `null` se ele não é um array de pontos com `t`, `lat`, `lng` e `speed`. */
function parseGps(json: string | null | undefined): LegacyPoint[] | null {
  if (typeof json !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  for (const p of raw) {
    if (!isObj(p) || !isNum(p.t) || !isNum(p.lat) || !isNum(p.lng) || !isNum(p.speed)) return null;
  }
  return raw as LegacyPoint[];
}

const isVec = (v: unknown): v is Vec3 => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.z);

/** As leituras da IMU, ou `null` se o JSON é ilegível. Sem JSON (volta sem IMU), nenhuma. */
function parseImu(json: string | null | undefined): LegacyImuPoint[] | null {
  if (json === null || json === undefined) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  for (const p of raw) {
    if (!isObj(p) || !isNum(p.t) || (p.accel !== undefined && !isVec(p.accel)) || (p.gyro !== undefined && !isVec(p.gyro))) {
      return null;
    }
  }
  return raw as LegacyImuPoint[];
}

function gpsFrame(p: LegacyPoint, t0: number): GpsFrame {
  const f: GpsFrame = { kind: 'gps', source: 'PHONE', t: p.t - t0, lat: p.lat, lng: p.lng, speed: p.speed, fix: 'unknown', legacy: true };
  if (isNum(p.heading)) f.heading = p.heading;
  if (isNum(p.altitude)) f.altitude = p.altitude;
  if (isNum(p.accuracy)) f.accuracy = p.accuracy;
  if (isNum(p.altitudeAccuracy)) f.altitudeAccuracy = p.altitudeAccuracy;
  return f;
}

function imuFrame(p: LegacyImuPoint, t0: number): ImuFrame {
  const f: ImuFrame = { kind: 'imu', source: 'PHONE', t: p.t - t0, legacy: true };
  if (p.accel) f.accel = { x: p.accel.x * G, y: p.accel.y * G, z: p.accel.z * G };
  if (p.gyro) f.gyro = { x: p.gyro.x, y: p.gyro.y, z: p.gyro.z };
  return f;
}

function cross(p: LegacyPoint, t0: number): BoundaryCross {
  return { t: p.t - t0, lat: p.lat, lng: p.lng, speed: p.speed, accuracy: isNum(p.accuracy) ? p.accuracy : NaN };
}

const sameGps = (a: LegacyPoint, b: LegacyPoint) => a.t === b.t && a.lat === b.lat && a.lng === b.lng;

const sameVec = (a: Vec3 | undefined, b: Vec3 | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.z === b.z);

/** A leitura repetida na fronteira (a mesma em duas voltas): `t`, accel e gyro iguais. */
const sameImu = (a: LegacyImuPoint, b: LegacyImuPoint) => a.t === b.t && sameVec(a.accel, b.accel) && sameVec(a.gyro, b.gyro);

/** Acumula as voltas numa série só, com as regras do topo do arquivo. */
class SeriesBuilder {
  readonly gps: GpsFrame[] = [];
  readonly imu: ImuFrame[] = [];
  private lastGps: LegacyPoint | null = null;
  private lastImu: LegacyImuPoint | null = null;

  constructor(private readonly t0: number) {}

  /** Acrescenta os pontos (a 1ª idêntica à última vira um frame só) e devolve o índice da 1ª. */
  private appendGps(points: LegacyPoint[]): number {
    let from = this.gps.length;
    let rest = points;
    if (this.lastGps && points.length > 0 && sameGps(this.lastGps, points[0])) {
      from = this.gps.length - 1;
      rest = points.slice(1);
    }
    for (const p of rest) this.gps.push(gpsFrame(p, this.t0));
    if (points.length > 0) this.lastGps = points[points.length - 1];
    return from;
  }

  /** A janela da volta, depois de acrescentar os pontos dela. */
  lap(points: LegacyPoint[]): LapWindow {
    if (points.length === 0) return { kind: 'none' };
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length >= 2 && first.synthetic && last.synthetic) {
      this.appendGps(points.slice(1, -1));
      return { kind: 'cross', start: cross(first, this.t0), end: cross(last, this.t0) };
    }
    const from = this.appendGps(points);
    return { kind: 'index', from, to: this.gps.length - 1 };
  }

  lapImu(points: LegacyImuPoint[]): void {
    let rest = points;
    if (this.lastImu && points.length > 0 && sameImu(this.lastImu, points[0])) rest = points.slice(1);
    for (const p of rest) this.imu.push(imuFrame(p, this.t0));
    if (points.length > 0) this.lastImu = points[points.length - 1];
  }
}

function minT(...lists: Array<Array<{ t: number }>>): number | null {
  let min = Infinity;
  for (const list of lists) for (const p of list) if (p.t < min) min = p.t;
  return min === Infinity ? null : min;
}

/**
 * As voltas de uma sessão numa série única: ordena por `started_at`, `t0Utc` = o
 * menor `t` da sessão, e uma janela por volta.
 */
export function convertSessionLaps(laps: readonly LegacyLapRow[]): ConvertedSession {
  const ordered = [...laps].sort((a, b) => a.started_at - b.started_at);
  const parsed = ordered.map((l) => ({ id: l.id, gps: parseGps(l.samples_json), imu: parseImu(l.imu_samples_json) }));
  const t0Utc = minT(...parsed.flatMap((p) => [p.gps ?? [], p.imu ?? []]));
  const out = new SeriesBuilder(t0Utc ?? 0);
  const windows = new Map<string, LapWindow>();
  const skipped: string[] = [];
  const imuSkipped: string[] = [];
  for (const p of parsed) {
    if (p.gps === null) {
      windows.set(p.id, { kind: 'none' });
      skipped.push(p.id);
      continue;
    }
    windows.set(p.id, out.lap(p.gps));
    if (p.imu === null) imuSkipped.push(p.id);
    else out.lapImu(p.imu);
  }
  return { t0Utc, gps: out.gps, imu: out.imu, windows, skipped, imuSkipped };
}

/**
 * Um traçado: a mesma regra sobre uma volta só. O `t` fica como foi gravado (epoch ms):
 * a série do traçado não tem início de sessão (`t0Utc` nulo).
 */
export function convertLayout(samplesJson: string | null | undefined): ConvertedLayout {
  const points = parseGps(samplesJson);
  if (points === null) return { gps: [], window: { kind: 'none' }, skipped: true };
  const out = new SeriesBuilder(0);
  const window = out.lap(points);
  return { gps: out.gps, window, skipped: false };
}

/**
 * Uma referência de `track_references` (sem colunas de janela): os pontos na ordem,
 * sem os pontos sintéticos, que nunca entram no bruto (AD-007). O `t` fica como foi
 * gravado (`t0Utc` nulo).
 */
export function convertReference(samplesJson: string | null | undefined): ConvertedReference {
  const points = parseGps(samplesJson);
  if (points === null) return { gps: [], skipped: true };
  return { gps: points.filter((p) => !p.synthetic).map((p) => gpsFrame(p, 0)), skipped: false };
}

/**
 * Um diário v4 pendente: os pedaços, em ordem, viram as séries da gravação, no
 * relógio que começa no início dela (`startedAt`, o `t0Utc` do diário novo). Um
 * pedaço ilegível é pulado e contado.
 */
export function convertJournal(startedAt: number, chunks: readonly LegacyChunk[]): ConvertedJournal {
  const gps: GpsFrame[] = [];
  const imu: ImuFrame[] = [];
  let skipped = 0;
  for (const c of chunks) {
    const g = parseGps(c.gps_json);
    const i = parseImu(c.imu_json);
    if (g === null || i === null) {
      skipped++;
      continue;
    }
    for (const p of g) gps.push(gpsFrame(p, startedAt));
    for (const p of i) imu.push(imuFrame(p, startedAt));
  }
  return { t0Utc: startedAt, gps, imu, skipped };
}
