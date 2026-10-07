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
import { haversine } from './geometry';
import { appSqlConn, createSession, deleteSession, listSessions } from '../storage/db';
import { sessionOwner } from '../storage/lapRepo';
import { FRAMES_VERSION, insertLapOn } from '../storage/sqlSessionRepo';
import { encodeBlock } from '../telemetry/blockCodec';
import type { GpsFrame, SeriesMeta } from '../telemetry/frame';
import { gpsSeriesOf } from '../telemetry/series';
import { createSeries, insertBlocks } from '../telemetry/telemetryStore';

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

/**
 * Divide o replay contínuo em voltas por proximidade da largada. Cada volta é a
 * janela por índice `from..to` (os dois inclusive) sobre o replay: a volta começa
 * no ponto em que a anterior fechou.
 */
function splitIntoLaps(samples: GpsFrame[]): Array<{ from: number; to: number }> {
  const start = samples[0];
  const laps: Array<{ from: number; to: number }> = [];
  let from = 0;
  let dist = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) dist += haversine(samples[i - 1], samples[i]);
    if (dist > 300 && haversine(samples[i], start) < 12) {
      laps.push({ from, to: i });
      from = i;
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
 *
 * Gravada em frames (AD-007): o replay inteiro vira a série GPS da sessão, e cada
 * volta é uma janela por índice sobre ela, sem JSON de amostra. A sessão sai com
 * `frames_version = 5`, e a migração v5b a pula.
 */
export async function seedDemoSession(): Promise<string> {
  const existing = await findDemoSession();
  if (existing) return existing;

  // `t` em ms desde o início do replay; o relógio da série começa em `base`.
  const raw: GpsFrame[] = DEMO_LAP.map((p) => ({
    kind: 'gps',
    source: 'PHONE',
    t: p.t,
    lat: p.lat,
    lng: p.lng,
    speed: p.speed,
    accuracy: 5,
    fix: 'unknown',
  }));

  const laps = splitIntoLaps(raw);
  if (laps.length === 0) {
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

  const meta: SeriesMeta = {
    id: `${session.id}_gps`,
    owner: sessionOwner(session.id),
    source: 'PHONE',
    kind: 'gps',
    t0Utc: base,
    legacy: false,
  };
  const series = gpsSeriesOf(meta, raw);
  const conn = await appSqlConn();
  await conn.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE sessions SET frames_version = ? WHERE id = ?', FRAMES_VERSION, session.id);
    await createSeries(tx, meta);
    await insertBlocks(tx, [
      { seriesId: meta.id, seq: 0, n: series.n, tFirst: series.t[0], tLast: series.t[series.n - 1], payload: encodeBlock(series, 0, series.n) },
    ]);
    for (let i = 0; i < laps.length; i++) {
      const { from, to } = laps[i];
      const startedAt = base + raw[from].t;
      await insertLapOn(tx, {
        id: `demo-lap-${session.id}-${i + 1}`,
        sessionId: session.id,
        startedAt,
        durationMs: base + raw[to].t - startedAt,
        window: { kind: 'index', from, to },
      });
    }
  });

  return session.id;
}
