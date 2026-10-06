/**
 * Monta séries a partir dos arrays de um adaptador de fonte (celular, MyChron,
 * Alfano, GoPro). A unidade do canal é conferida contra o catálogo (TF-21), e cada
 * série guarda a própria taxa, sem reamostragem.
 */
import {
  assertUnit,
  type ChannelSeries,
  type FixState,
  type GpsFrame,
  type GpsSeries,
  type ImuFrame,
  type ImuSeries,
  type SeriesMeta,
} from './frame';

/** Código `u8` do estado do fix na coluna `fix`. O 0 é `unknown`. */
const FIX_STATES: readonly FixState[] = ['unknown', 'none', '2d', '3d'];

export function fixCode(state: FixState): number {
  return FIX_STATES.indexOf(state);
}

export function fixState(code: number): FixState {
  return FIX_STATES[code] ?? 'unknown';
}

/** Metadados de canal como o adaptador entrega: a unidade ainda não foi conferida. */
export type AdapterChannelMeta = Omit<SeriesMeta, 'kind' | 'channel' | 'unit'> & {
  channel: string;
  unit: string;
};

/** Série de um canal. Lança `UnitError` se a unidade estiver fora do catálogo. */
export function channelSeries(
  meta: AdapterChannelMeta,
  t: ArrayLike<number>,
  v: ArrayLike<number>
): ChannelSeries {
  const unit = assertUnit(meta.channel, meta.unit);
  return {
    meta: { ...meta, kind: 'channel', unit },
    n: t.length,
    t: Float64Array.from(t),
    v: Float64Array.from(v),
  };
}

/** Colunas de GPS do adaptador. NaN, ou a coluna opcional ausente, é valor ausente. */
export type GpsColumns = {
  t: ArrayLike<number>;
  lat: ArrayLike<number>;
  lng: ArrayLike<number>;
  speed: ArrayLike<number>;
  heading?: ArrayLike<number>;
  altitude?: ArrayLike<number>;
  accuracy?: ArrayLike<number>;
  altitudeAccuracy?: ArrayLike<number>;
  gnssTime?: ArrayLike<number>;
  fix: ArrayLike<FixState>;
};

/** Série de GPS de um adaptador. As marcas por ponto (`flags`) começam zeradas. */
export function gpsSeriesFrom(meta: Omit<SeriesMeta, 'kind'>, cols: GpsColumns): GpsSeries {
  const n = cols.t.length;
  const opt = (a?: ArrayLike<number>) => (a ? Float64Array.from(a) : new Float64Array(n).fill(NaN));
  return {
    meta: { ...meta, kind: 'gps' },
    n,
    t: Float64Array.from(cols.t),
    lat: Float64Array.from(cols.lat),
    lng: Float64Array.from(cols.lng),
    speed: Float64Array.from(cols.speed),
    heading: opt(cols.heading),
    altitude: opt(cols.altitude),
    accuracy: opt(cols.accuracy),
    altitudeAccuracy: opt(cols.altitudeAccuracy),
    gnssTime: opt(cols.gnssTime),
    fix: Uint8Array.from(cols.fix, fixCode),
    flags: new Uint8Array(n),
  };
}

// ---------------------------------------------------------------------------
// Frames ↔ série: o diário grava frames como série, e a leitura devolve frames.
// ---------------------------------------------------------------------------

/** Bits da coluna `flags` da série de GPS. */
const TIME_REPAIRED = 1;
const LEGACY = 2;

const num = (v: number | undefined) => (v === undefined ? NaN : v);

/** Série de GPS com os frames dados, em ordem. `synthetic` nunca é gravado (AD-006). */
export function gpsSeriesOf(meta: SeriesMeta, frames: readonly GpsFrame[]): GpsSeries {
  const n = frames.length;
  const s: GpsSeries = {
    meta: { ...meta, kind: 'gps' },
    n,
    t: new Float64Array(n),
    lat: new Float64Array(n),
    lng: new Float64Array(n),
    speed: new Float64Array(n),
    heading: new Float64Array(n),
    altitude: new Float64Array(n),
    accuracy: new Float64Array(n),
    altitudeAccuracy: new Float64Array(n),
    gnssTime: new Float64Array(n),
    fix: new Uint8Array(n),
    flags: new Uint8Array(n),
  };
  frames.forEach((f, i) => {
    s.t[i] = f.t;
    s.lat[i] = f.lat;
    s.lng[i] = f.lng;
    s.speed[i] = f.speed;
    s.heading[i] = num(f.heading);
    s.altitude[i] = num(f.altitude);
    s.accuracy[i] = num(f.accuracy);
    s.altitudeAccuracy[i] = num(f.altitudeAccuracy);
    s.gnssTime[i] = num(f.gnssTime);
    s.fix[i] = fixCode(f.fix);
    s.flags[i] = (f.timeRepaired ? TIME_REPAIRED : 0) | (f.legacy ? LEGACY : 0);
  });
  return s;
}

/** Série de IMU com os frames dados. O canal ausente do frame vira NaN. */
export function imuSeriesOf(meta: SeriesMeta, frames: readonly ImuFrame[]): ImuSeries {
  const n = frames.length;
  const col = () => new Float64Array(n);
  const s: ImuSeries = { meta: { ...meta, kind: 'imu' }, n, t: col(), ax: col(), ay: col(), az: col(), gx: col(), gy: col(), gz: col() };
  frames.forEach((f, i) => {
    s.t[i] = f.t;
    s.ax[i] = f.accel ? f.accel.x : NaN;
    s.ay[i] = f.accel ? f.accel.y : NaN;
    s.az[i] = f.accel ? f.accel.z : NaN;
    s.gx[i] = f.gyro ? f.gyro.x : NaN;
    s.gy[i] = f.gyro ? f.gyro.y : NaN;
    s.gz[i] = f.gyro ? f.gyro.z : NaN;
  });
  return s;
}

/** Frames das amostras `[from, to)` da série. Valor ausente (NaN) vira chave ausente. */
export function gpsFramesOf(s: GpsSeries, from = 0, to = s.n): GpsFrame[] {
  const out: GpsFrame[] = [];
  for (let i = from; i < to; i++) {
    const f: GpsFrame = {
      kind: 'gps',
      source: s.meta.source,
      t: s.t[i],
      lat: s.lat[i],
      lng: s.lng[i],
      speed: s.speed[i],
      fix: fixState(s.fix[i]),
    };
    if (s.heading[i] === s.heading[i]) f.heading = s.heading[i];
    if (s.altitude[i] === s.altitude[i]) f.altitude = s.altitude[i];
    if (s.accuracy[i] === s.accuracy[i]) f.accuracy = s.accuracy[i];
    if (s.altitudeAccuracy[i] === s.altitudeAccuracy[i]) f.altitudeAccuracy = s.altitudeAccuracy[i];
    if (s.gnssTime[i] === s.gnssTime[i]) f.gnssTime = s.gnssTime[i];
    if (s.flags[i] & TIME_REPAIRED) f.timeRepaired = true;
    if (s.flags[i] & LEGACY) f.legacy = true;
    out.push(f);
  }
  return out;
}

/** Frames de IMU das amostras `[from, to)`. Um canal só com NaN fica ausente no frame. */
export function imuFramesOf(s: ImuSeries, from = 0, to = s.n): ImuFrame[] {
  const out: ImuFrame[] = [];
  for (let i = from; i < to; i++) {
    const f: ImuFrame = { kind: 'imu', source: s.meta.source, t: s.t[i] };
    if (s.ax[i] === s.ax[i]) f.accel = { x: s.ax[i], y: s.ay[i], z: s.az[i] };
    if (s.gx[i] === s.gx[i]) f.gyro = { x: s.gx[i], y: s.gy[i], z: s.gz[i] };
    if (s.meta.legacy) f.legacy = true;
    out.push(f);
  }
  return out;
}
