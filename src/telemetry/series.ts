/**
 * Monta séries a partir dos arrays de um adaptador de fonte (celular, MyChron,
 * Alfano, GoPro). A unidade do canal é conferida contra o catálogo (TF-21), e cada
 * série guarda a própria taxa, sem reamostragem.
 */
import { assertUnit, type ChannelSeries, type FixState, type GpsSeries, type SeriesMeta } from './frame';

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
