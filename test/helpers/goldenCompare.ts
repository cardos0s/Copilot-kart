/**
 * Comparação de referência pela regra de tolerância da spec ("Mesmos números",
 * TF-14):
 * - inteiros, textos, booleanos e null: iguais;
 * - grandezas de tempo (chave `t`, `tMs`, terminada em `Ms`, `_ms` ou `At`): até 0,001;
 * - os demais números reais: até max(1e-9, 1e-5 × |esperado|) (parte relativa aprovada em 08/10).
 *
 * Elemento de array herda a chave do array (`lapsMs[2]` é tempo). Devolve a
 * primeira diferença, com o caminho exato (`laps[2].durationMs`), ou `null`.
 */

export const TIME_TOLERANCE = 0.001;
/** Piso absoluto dos reais que não são tempo. */
export const REAL_TOLERANCE = 1e-9;
/** Parte relativa dos reais que não são tempo, sobre o valor esperado. */
export const REAL_RELATIVE_TOLERANCE = 1e-5;

/** A tolerância de um real que não é tempo: max(1e-9, 1e-5 × |esperado|). */
export function realTolerance(expected: number): number {
  return Math.max(REAL_TOLERANCE, REAL_RELATIVE_TOLERANCE * Math.abs(expected));
}

export type GoldenDiff = { path: string; reason: string };

export function isTimeKey(key: string | null): boolean {
  if (key === null) return false;
  return key === 't' || key === 'tMs' || key.endsWith('Ms') || key.endsWith('_ms') || key.endsWith('At');
}

function describe(v: unknown): string {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v === null) return 'null';
  return typeof v === 'object' ? 'object' : `${typeof v} ${String(v)}`;
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function compareAt(expected: unknown, actual: unknown, path: string, key: string | null): GoldenDiff | null {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Number.isNaN(expected) || Number.isNaN(actual)) {
      return Number.isNaN(expected) && Number.isNaN(actual)
        ? null
        : { path, reason: `esperado ${expected}, veio ${actual}` };
    }
    if (expected === actual) return null;
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
      return { path, reason: `esperado ${expected}, veio ${actual}` };
    }
    const diff = Math.abs(expected - actual);
    if (isTimeKey(key)) {
      return diff <= TIME_TOLERANCE ? null : { path, reason: `tempo: esperado ${expected}, veio ${actual} (diferença ${diff})` };
    }
    if (Number.isInteger(expected) && Number.isInteger(actual)) {
      return { path, reason: `inteiro: esperado ${expected}, veio ${actual}` };
    }
    return diff <= realTolerance(expected)
      ? null
      : { path, reason: `real: esperado ${expected}, veio ${actual} (diferença ${diff}, relativa ${diff / Math.abs(expected)})` };
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, reason: `esperado ${describe(expected)}, veio ${describe(actual)}` };
    }
    if (expected.length !== actual.length) {
      return { path, reason: `tamanho: esperado ${expected.length}, veio ${actual.length}` };
    }
    for (let i = 0; i < expected.length; i++) {
      const d = compareAt(expected[i], actual[i], `${path}[${i}]`, key);
      if (d) return d;
    }
    return null;
  }

  if (expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object') {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    for (const k of Object.keys(e)) {
      if (!(k in a)) return { path: join(path, k), reason: 'chave ausente' };
      const d = compareAt(e[k], a[k], join(path, k), k);
      if (d) return d;
    }
    for (const k of Object.keys(a)) {
      if (!(k in e)) return { path: join(path, k), reason: 'chave a mais' };
    }
    return null;
  }

  return expected === actual ? null : { path, reason: `esperado ${describe(expected)}, veio ${describe(actual)}` };
}

export function goldenCompare(expected: unknown, actual: unknown, path = ''): GoldenDiff | null {
  const lastKey = path.replace(/(\[\d+\])+$/, '').split('.').pop() ?? '';
  return compareAt(expected, actual, path, lastKey === '' ? null : lastKey);
}
