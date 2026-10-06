/**
 * Série colunar ↔ BLOB, sem perda (TF-10, TF-22).
 *
 * Formato, little-endian:
 * - cabeçalho de 8 bytes: `version u8 = 1`, `kind u8`, `n u32`, `mask u16`;
 * - as colunas Float64 presentes, na ordem fixa de `F64[kind]` (bit i da máscara = coluna i);
 * - as colunas `u8` (`fix`, `flags`), sempre gravadas.
 *
 * Uma coluna Float64 só com NaN não é gravada; NaN dentro de uma coluna presente é o valor ausente.
 * Os bytes são copiados como estão, então a ida e volta é bit a bit (inclusive o NaN).
 * Os alvos do app (ARM64, x86-64) são little-endian, e os arrays tipados usam a ordem do host.
 */
import type { Series, SeriesKind, SeriesMeta } from './frame';

export class BlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockError';
  }
}

const VERSION = 1;
const HEADER = 8;
const KIND_CODE: Record<SeriesKind, number> = { gps: 1, imu: 2, channel: 3 };
const F64: Record<SeriesKind, readonly string[]> = {
  gps: ['t', 'lat', 'lng', 'speed', 'heading', 'altitude', 'accuracy', 'altitudeAccuracy', 'gnssTime'],
  imu: ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'],
  channel: ['t', 'v'],
};
const U8: Record<SeriesKind, readonly string[]> = { gps: ['fix', 'flags'], imu: [], channel: [] };

if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw new Error('blockCodec: o formato exige um host little-endian');
}

type Columns = Record<string, Float64Array | Uint8Array>;
const cols = (s: Series) => s as unknown as Columns;

/** Série vazia com as colunas do tipo de `meta`. */
export function emptySeries(meta: SeriesMeta, n = 0): Series {
  const out: Columns = {};
  for (const c of F64[meta.kind]) out[c] = new Float64Array(n);
  for (const c of U8[meta.kind]) out[c] = new Uint8Array(n);
  return { meta, n, ...out } as unknown as Series;
}

function hasValue(a: Float64Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (a[i] === a[i]) return true;
  return false;
}

/** Codifica as amostras `[from, to)` da série num bloco. */
export function encodeBlock(series: Series, from: number, to: number): Uint8Array {
  const kind = series.meta.kind;
  const n = to - from;
  const c = cols(series);
  const f64 = F64[kind];
  let mask = 0;
  f64.forEach((name, i) => {
    if (hasValue(c[name] as Float64Array, from, to)) mask |= 1 << i;
  });
  const present = f64.filter((_, i) => mask & (1 << i));
  const size = HEADER + present.length * 8 * n + U8[kind].length * n;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, KIND_CODE[kind]);
  view.setUint32(2, n, true);
  view.setUint16(6, mask, true);
  let off = HEADER;
  for (const name of present) {
    const a = c[name] as Float64Array;
    out.set(new Uint8Array(a.buffer, a.byteOffset + from * 8, n * 8), off);
    off += n * 8;
  }
  for (const name of U8[kind]) {
    out.set((c[name] as Uint8Array).subarray(from, to), off);
    off += n;
  }
  return out;
}

/**
 * Decodifica um bloco da série `meta`. O BLOB do SQLite pode vir desalinhado,
 * então cada coluna é copiada (`slice`) antes de virar `Float64Array`.
 */
// SPEC_DEVIATION: a design tem `decodeBlock(kind, payload)`; aqui o primeiro argumento é a `SeriesMeta`.
// Reason: a `Series` devolvida carrega a `meta`, que não está no bloco; o `kind` vem de `meta.kind`
// e é conferido contra o cabeçalho.
export function decodeBlock(meta: SeriesMeta, payload: Uint8Array): Series {
  if (payload.length < HEADER) throw new BlockError(`bloco com ${payload.length} bytes, menor que o cabeçalho`);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = view.getUint8(0);
  if (version !== VERSION) throw new BlockError(`versão de bloco desconhecida: ${version}`);
  const kind = meta.kind;
  if (view.getUint8(1) !== KIND_CODE[kind]) throw new BlockError(`bloco não é do tipo ${kind}`);
  const n = view.getUint32(2, true);
  const mask = view.getUint16(6, true);
  const f64 = F64[kind];
  if (mask >> f64.length !== 0) throw new BlockError(`máscara inválida para ${kind}: ${mask}`);
  const present = f64.filter((_, i) => mask & (1 << i));
  const expected = HEADER + present.length * 8 * n + U8[kind].length * n;
  if (payload.length !== expected) {
    throw new BlockError(`tamanho inconsistente: ${payload.length} bytes, esperado ${expected}`);
  }

  const out: Columns = {};
  let off = HEADER;
  for (const name of f64) {
    if (present.includes(name)) {
      out[name] = new Float64Array(payload.slice(off, off + n * 8).buffer);
      off += n * 8;
    } else {
      out[name] = new Float64Array(n).fill(NaN);
    }
  }
  for (const name of U8[kind]) {
    out[name] = payload.slice(off, off + n);
    off += n;
  }
  return { meta, n, ...out } as unknown as Series;
}

/** Junta partes da mesma série, na ordem dada. A `meta` é a da primeira parte. */
export function concatSeries(parts: Series[]): Series {
  if (parts.length === 0) throw new Error('concatSeries: nenhuma parte');
  const meta = parts[0].meta;
  const n = parts.reduce((sum, p) => sum + p.n, 0);
  const out = emptySeries(meta, n);
  const o = cols(out);
  for (const name of [...F64[meta.kind], ...U8[meta.kind]]) {
    let off = 0;
    for (const p of parts) {
      o[name].set(cols(p)[name], off);
      off += p.n;
    }
  }
  return out;
}
