/**
 * Formato padrão de tempo de volta/cronômetro: MM:SS.SSS
 *   - Minutos sempre com 2 dígitos (zero à esquerda)
 *   - Segundos com 2 dígitos
 *   - Milésimos com 3 dígitos (inclui centésimo embutido nos 2 primeiros)
 *
 * Exemplos:
 *   34872ms  → "00:34.872"
 *   83456ms  → "01:23.456"
 *   125000ms → "02:05.000"
 *
 * Padrão de telemetria de motorsport (AiM MyChron, Mylaps Speedhive, etc).
 */
export function fmtLap(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00.000';
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${Math.abs(ms / 1000).toFixed(3)}s`;
}

export function fmtKmh(ms: number): string {
  return `${(ms * 3.6).toFixed(0)}`;
}
