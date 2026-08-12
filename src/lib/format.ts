/** Formatação compartilhada pelas telas de kartódromo. */

/** "2,4 km" perto, "512 km" longe — decimal só onde ele informa alguma coisa. */
export function formatDistanceKm(km: number | null | undefined): string {
  if (km === null || km === undefined || !isFinite(km)) return '—';
  if (km < 100) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/** Volta em forma curta: "38.21" abaixo de um minuto, "1:02.45" acima. */
export function formatLapShort(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !isFinite(ms)) return '—';
  const totalS = ms / 1000;
  if (totalS < 60) return totalS.toFixed(2);
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Número que pode não existir ainda no catálogo. */
export function orDash(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return `${v}${suffix}`;
}
