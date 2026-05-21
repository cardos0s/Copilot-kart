export function fmtLap(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00.000';
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${Math.abs(ms / 1000).toFixed(3)}s`;
}

export function fmtKmh(ms: number): string {
  return `${(ms * 3.6).toFixed(0)}`;
}
