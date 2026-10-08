/**
 * Repositório de voltas (TF-11, TF-16; design §6): a volta é uma janela sobre o
 * bruto da sessão.
 *
 * - `loadLaps`: um `readSeries` por sessão, na janela de tempo que cobre todas as
 *   voltas, e `lapFrames` por volta. Os pontos de fronteira saem na leitura, a
 *   partir dos cruzamentos guardados (AD-006). A IMU só é lida quando pedida.
 * - `loadLapSummaries`: id, início e duração, sem tocar no bruto.
 *
 * Sobre um `SqlTx`: no aparelho é o expo-sqlite (`db.ts`), nos testes o sql.js.
 */
import type { LapRecord } from '../lib/analysis';
import type { GpsSample, ImuSample } from '../lib/geometry';
import type { BoundaryCross, GpsFrame, GpsSeries, ImuSeries, LapWindow, Owner, SeriesKind } from '../telemetry/frame';
import { lapFrames } from '../telemetry/laps';
import { gpsFramesOf } from '../telemetry/series';
import { readSeries } from '../telemetry/telemetryStore';
import type { SqlTx } from './sqlConn';

export type LapSummary = { id: string; startedAt: number; durationMs: number };

export type LoadLapsOptions = { imu?: boolean };

/** As colunas de janela, como `laps` e `track_layouts` guardam. */
export type WindowRow = {
  window_kind: 'cross' | 'index' | 'none' | null;
  from_idx: number | null;
  to_idx: number | null;
  start_t: number | null;
  start_lat: number | null;
  start_lng: number | null;
  start_speed: number | null;
  start_acc: number | null;
  end_t: number | null;
  end_lat: number | null;
  end_lng: number | null;
  end_speed: number | null;
  end_acc: number | null;
};

type LapRow = WindowRow & {
  id: string;
  session_id: string;
  started_at: number;
  duration_ms: number;
  samples_json: string;
  imu_samples_json: string | null;
};

/** As séries da sessão são do dono `session:<id>` (o diário grava em `session_<recordingId>`). */
export function sessionOwner(sessionId: string): Owner {
  return { kind: 'session', id: sessionId };
}

function cross(t: number | null, lat: number | null, lng: number | null, speed: number | null, acc: number | null): BoundaryCross {
  return { t: t!, lat: lat!, lng: lng!, speed: speed!, accuracy: acc! };
}

/** A janela guardada na linha; `null` quando ainda não há janela (formato antigo, até a v5b). */
export function windowOf(r: WindowRow): LapWindow | null {
  switch (r.window_kind) {
    case 'cross':
      return {
        kind: 'cross',
        start: cross(r.start_t, r.start_lat, r.start_lng, r.start_speed, r.start_acc),
        end: cross(r.end_t, r.end_lat, r.end_lng, r.end_speed, r.end_acc),
      };
    case 'index':
      return { kind: 'index', from: r.from_idx!, to: r.to_idx! };
    case 'none':
      return { kind: 'none' };
    default:
      return null;
  }
}

/**
 * Transição (até a v5b/v5c, T43/T44): a volta ainda não convertida não tem janela
 * (`window_kind` nulo) e sai do JSON, exatamente como o `getLapsForSession` de antes.
 */
function legacyLap(r: LapRow, imu: boolean): LapRecord {
  // O JSON antigo vai como está (t em epoch ms, accel em g); a conversão em frames é a da v5b.
  const samples = JSON.parse(r.samples_json) as GpsSample[];
  const imuSamples: ImuSample[] | undefined =
    imu && r.imu_samples_json ? JSON.parse(r.imu_samples_json) : undefined;
  return {
    id: r.id,
    sessionId: r.session_id,
    startedAt: r.started_at,
    durationMs: r.duration_ms,
    gps: samples,
    samples,
    imu: imuSamples,
    imuSamples,
  };
}

/** A janela de tempo que cobre todas as voltas; `null` quando é preciso a série inteira (janela por índice). */
function coveringRange(windows: LapWindow[]): { tFrom?: number; tTo?: number } | null {
  let tFrom = Infinity;
  let tTo = -Infinity;
  for (const w of windows) {
    if (w.kind === 'index') return null;
    if (w.kind === 'cross') {
      tFrom = Math.min(tFrom, w.start.t);
      tTo = Math.max(tTo, w.end.t);
    }
  }
  return { tFrom, tTo };
}

/**
 * As voltas da sessão, em ordem de início, com `gps`/`imu`/`window`. Transição (até a
 * T46): `samples`/`imuSamples` apontam para os mesmos arrays de `gps`/`imu`.
 */
export async function loadLaps(conn: SqlTx, sessionId: string, opts: LoadLapsOptions = {}): Promise<LapRecord[]> {
  const imu = opts.imu === true;
  const rows = await conn.getAllAsync<LapRow>(
    'SELECT * FROM laps WHERE session_id = ? ORDER BY started_at ASC',
    sessionId
  );
  const windows = new Map<string, LapWindow>();
  for (const r of rows) {
    const w = windowOf(r);
    if (w) windows.set(r.id, w);
  }

  let gps: GpsSeries | undefined;
  let imuSeries: ImuSeries | undefined;
  const readable = [...windows.values()].filter((w) => w.kind !== 'none');
  if (readable.length > 0) {
    const kinds: SeriesKind[] = imu ? ['gps', 'imu'] : ['gps'];
    const range = coveringRange(readable) ?? {};
    const { series } = await readSeries(conn, sessionOwner(sessionId), { kinds, ...range });
    gps = series.find((s) => s.meta.kind === 'gps') as GpsSeries | undefined;
    imuSeries = series.find((s) => s.meta.kind === 'imu') as ImuSeries | undefined;
  }

  return rows.map((r) => {
    const window = windows.get(r.id);
    if (!window) return legacyLap(r, imu);
    const frames = gps ? lapFrames(window, gps, imuSeries) : { gps: [], imu: [] };
    const lap: LapRecord = {
      id: r.id,
      sessionId: r.session_id,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      window,
      gps: frames.gps,
      samples: frames.gps as GpsSample[],
    };
    if (imu && frames.imu.length > 0) {
      lap.imu = frames.imu;
      lap.imuSamples = frames.imu as unknown as ImuSample[];
    }
    return lap;
  });
}

/** Id, início e duração de cada volta, em ordem de início, sem ler o bruto. */
export async function loadLapSummaries(conn: SqlTx, sessionId: string): Promise<LapSummary[]> {
  return conn.getAllAsync<LapSummary>(
    `SELECT id, started_at AS startedAt, duration_ms AS durationMs
     FROM laps WHERE session_id = ? ORDER BY started_at ASC`,
    sessionId
  );
}

/**
 * Todos os frames da série GPS da sessão, do primeiro ao "Encerrar", sem ler a IMU. É o
 * que o selo usa quando a sessão não tem volta (TF-24 AC 4). Sem série (sessão ainda em
 * JSON, até a v5b), não há frames.
 */
export async function loadSessionGps(conn: SqlTx, sessionId: string): Promise<GpsFrame[]> {
  const { series } = await readSeries(conn, sessionOwner(sessionId), { kinds: ['gps'] });
  const gps = series[0] as GpsSeries | undefined;
  return gps ? gpsFramesOf(gps) : [];
}
