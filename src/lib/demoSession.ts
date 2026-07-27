/**
 * Sessão demo pro modo pitch: semeia no banco as 3 voltas reais do
 * DEMO_LAP (GPX bench, Leandro Merlo) como se tivessem sido gravadas.
 * Com ela, TODAS as telas de análise (setores, curvas, mapa, replay 3D)
 * funcionam sem GPS ao vivo — essencial pra demonstrar o app em ambiente
 * fechado ou sem sinal.
 *
 * Idempotente: se a sessão demo já existe, retorna o id existente.
 */

import { DEMO_LAP } from '../data/demoLap';
import { GpsSample, haversine } from './geometry';
import {
  createSession,
  deleteSession,
  listSessions,
  saveLap,
} from '../storage/db';

/** Marcador em notes que identifica a sessão demo (não mostrar duas). */
const DEMO_NOTES_MARKER = '[demo-pitch]';

export async function findDemoSession(): Promise<string | null> {
  const sessions = await listSessions();
  return sessions.find((s) => s.notes?.includes(DEMO_NOTES_MARKER))?.id ?? null;
}

export async function removeDemoSession(): Promise<boolean> {
  const id = await findDemoSession();
  if (!id) return false;
  await deleteSession(id);
  return true;
}

/** Divide o replay contínuo em voltas por proximidade da largada. */
function splitIntoLaps(samples: GpsSample[]): GpsSample[][] {
  const start = samples[0];
  const laps: GpsSample[][] = [];
  let cur: GpsSample[] = [];
  let dist = 0;
  for (const s of samples) {
    if (cur.length > 0) dist += haversine(cur[cur.length - 1], s);
    cur.push(s);
    if (dist > 300 && haversine(s, start) < 12) {
      laps.push(cur);
      cur = [s];
      dist = 0;
    }
  }
  // Sobra que não fechou volta (recorte do GPX) é descartada — volta
  // parcial quebraria análise de setores e replay.
  return laps;
}

/**
 * Cria (ou reaproveita) a sessão demo. Retorna o id da sessão pra navegar
 * direto pra tela de análise.
 */
export async function seedDemoSession(): Promise<string> {
  const existing = await findDemoSession();
  if (existing) return existing;

  const raw: GpsSample[] = DEMO_LAP.map((p) => ({
    t: p.t,
    lat: p.lat,
    lng: p.lng,
    speed: p.speed,
    accuracy: 5,
  }));

  const lapsRel = splitIntoLaps(raw);
  if (lapsRel.length === 0) {
    throw new Error('DEMO_LAP não fechou nenhuma volta — dado corrompido?');
  }

  const session = await createSession({
    trackName: 'Leandro Merlo',
    trackId: 'leandro-melo',
    kart: 'Rental 13cv',
    notes: `Sessão de demonstração com dados reais de GPS. ${DEMO_NOTES_MARKER}`,
    weather: 'Seco',
    mode: 'reference',
    layoutId: null,
    kartSetupId: null,
  });

  // Timestamps: reancora o replay pra terminar "agora" — telas de histórico
  // mostram a sessão como recente e os deltas internos (diffs de t) não mudam.
  const totalMs = raw[raw.length - 1].t - raw[0].t;
  const base = Date.now() - totalMs;

  for (let i = 0; i < lapsRel.length; i++) {
    const rel = lapsRel[i];
    const samples = rel.map((s) => ({ ...s, t: base + s.t }));
    const startedAt = samples[0].t;
    const durationMs = samples[samples.length - 1].t - samples[0].t;
    await saveLap({
      id: `demo-lap-${session.id}-${i + 1}`,
      sessionId: session.id,
      startedAt,
      durationMs,
      samples,
    });
  }

  return session.id;
}
