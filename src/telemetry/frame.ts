/**
 * Modelo de telemetria (AD-007): frames para a janela pedida, séries colunares
 * para o bruto e o catálogo fechado de unidades.
 */
import type { CrossPoint } from '../lib/startLine';

export type Source = 'PHONE' | 'MYCHRON' | 'ALFANO' | 'GOPRO';
export type FixState = 'none' | '2d' | '3d' | 'unknown';

/**
 * Catálogo fechado. Usa SI, mais rpm e °C. Há duas exceções: `deg`, porque lat/lng, rumo e
 * direção são graus em todo o app, e `%`, para pedal e borboleta.
 */
export type Unit =
  | 'deg'
  | 'm'
  | 'm/s'
  | 'm/s²'
  | 'rad/s'
  | 'Pa'
  | 'V'
  | 'A'
  | '°C'
  | 'rpm'
  | '%'
  | 'ms'
  | '1';

const UNITS: ReadonlySet<string> = new Set<Unit>([
  'deg', 'm', 'm/s', 'm/s²', 'rad/s', 'Pa', 'V', 'A', '°C', 'rpm', '%', 'ms', '1',
]);

/** Conversão do acelerômetro, que entrega em g, para m/s². */
export const G = 9.80665;

export class UnitError extends Error {
  constructor(
    readonly channel: string,
    readonly unit: string
  ) {
    super(`canal ${channel}: unidade "${unit}" fora do catálogo`);
    this.name = 'UnitError';
  }
}

/** Devolve a unidade do catálogo ou lança `UnitError` com o canal e a unidade (TF-21). */
export function assertUnit(channel: string, unit: string): Unit {
  if (!UNITS.has(unit)) throw new UnitError(channel, unit);
  return unit as Unit;
}

export type GpsFrame = {
  kind: 'gps';
  source: Source;
  /** ms desde o t0Utc da série */
  t: number;
  lat: number; // deg
  lng: number; // deg
  speed: number; // m/s
  heading?: number; // deg, 0 = norte
  altitude?: number; // m
  accuracy?: number; // m (horizontal)
  altitudeAccuracy?: number; // m
  fix: FixState;
  /** epoch ms da fix, como o sistema entregou */
  gnssTime?: number;
  timeRepaired?: true;
  legacy?: true;
  /** Só nos pontos de fronteira gerados na leitura (AD-006); nunca gravado. */
  synthetic?: true;
};
export type LocalGpsFrame = GpsFrame & { x: number; y: number };

export type Vec3 = { x: number; y: number; z: number };
/**
 * Uma leitura da IMU. Eixos do expo-sensors: x para a direita do celular, y para cima em
 * retrato, z saindo da tela; o yaw da cabine é o giroscópio z. Um dos dois sensores pode
 * faltar (par incompleto).
 *
 * O acelerômetro é **m/s²**, com a gravidade (sem subtrair). O expo-sensors entrega em g:
 * a captura (`imuCapture`) multiplica por `G`. Antes da v5 o tipo antigo dizia m/s², mas
 * guardava o valor do sensor em g; a migração (`legacy.ts`) converte o histórico, então
 * todo frame, novo ou convertido, está em m/s². O giroscópio é rad/s nos dois.
 */
export type ImuFrame = {
  kind: 'imu';
  source: Source;
  t: number;
  accel?: Vec3; // m/s²
  gyro?: Vec3; // rad/s
  legacy?: true;
};

export type ChannelFrame = {
  kind: 'channel';
  source: Source;
  channel: string;
  unit: Unit;
  t: number;
  value: number;
};
export type TelemetryFrame = GpsFrame | ImuFrame | ChannelFrame;

// Séries colunares: NaN = ausente
export type SeriesKind = 'gps' | 'imu' | 'channel';
export type Owner = { kind: 'session' | 'layout' | 'reference'; id: string };
export type SeriesMeta = {
  id: string;
  owner: Owner;
  source: Source;
  kind: SeriesKind;
  channel?: string;
  unit?: Unit;
  t0Utc: number | null;
  legacy: boolean;
};
export type GpsSeries = {
  meta: SeriesMeta;
  n: number;
  t: Float64Array;
  lat: Float64Array;
  lng: Float64Array;
  speed: Float64Array;
  heading: Float64Array;
  altitude: Float64Array;
  accuracy: Float64Array;
  altitudeAccuracy: Float64Array;
  gnssTime: Float64Array;
  fix: Uint8Array;
  /** bit0 timeRepaired, bit1 legacy */
  flags: Uint8Array;
};
export type ImuSeries = {
  meta: SeriesMeta;
  n: number;
  t: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
  az: Float64Array;
  gx: Float64Array;
  gy: Float64Array;
  gz: Float64Array;
};
export type ChannelSeries = { meta: SeriesMeta; n: number; t: Float64Array; v: Float64Array };
export type Series = GpsSeries | ImuSeries | ChannelSeries;

// Volta
export type BoundaryCross = CrossPoint & { accuracy: number };
export type LapWindow =
  | { kind: 'cross'; start: BoundaryCross; end: BoundaryCross }
  /** legado sem ponto sintético */
  | { kind: 'index'; from: number; to: number }
  /** legado ilegível (TF-20) */
  | { kind: 'none' };
