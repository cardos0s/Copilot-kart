/**
 * Tipos compartilhados com o app (src/lib/liveSession.ts). Copiados pra cá
 * pra evitar dependência cruzada entre projetos. Se mudar lá, espelhar aqui.
 */

export type LiveSample = {
  t: number; // epoch ms
  lat: number;
  lng: number;
  speed: number; // m/s
  heading?: number;
  accuracy?: number;
  lapNumber?: number;
  lapElapsedMs?: number;
  bestLapMs?: number | null;
  deltaVsRefMs?: number | null;
};

export type LiveLap = {
  lapNumber: number;
  durationMs: number;
  finishedAt: number;
};

export type LiveSessionInfo = {
  id: string;
  code: string;
  pilotId: string | null;
  pilotName?: string | null;
  pilotKartNumber?: string | null;
  trackName: string | null;
  trackId: string | null;
  referenceLapMs: number | null;
  startedAt: number;
  endedAt: number | null;
};
