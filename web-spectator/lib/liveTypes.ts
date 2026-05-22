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
  // Setores — null quando o app não tem layout reference carregada
  currentSectorIdx?: 0 | 1 | 2 | null;
  currentSectorElapsedMs?: number | null;
  s1Ms?: number | null;
  s2Ms?: number | null;
  s3Ms?: number | null;
};

export type LiveLap = {
  lapNumber: number;
  durationMs: number;
  finishedAt: number;
  s1Ms?: number | null;
  s2Ms?: number | null;
  s3Ms?: number | null;
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

export type MessageSeverity = 'info' | 'warning' | 'critical';

export type LiveMessage = {
  id: number;
  severity: MessageSeverity;
  text: string;
  sentAt: number;
  ackedAt: number | null;
  sentBy: string | null;
};
