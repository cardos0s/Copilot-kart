/**
 * Sessão salva no banco do app (sql.js) como o "Encerrar" deixa: as séries `gps`
 * e `imu` do dono `session:session_<recordingId>` em blocos de 5 s (a cadência do
 * diário), e as voltas como janelas pelo `saveRecordedSession`.
 */
import { recordedLaps, saveRecordedSession, type SavedSession } from '../../src/recording/finishSession';
import { recordingSeries } from '../../src/recording/journal';
import type { StartLine } from '../../src/lib/startLine';
import { sqlSessionRepo } from '../../src/storage/sqlSessionRepo';
import type { SqlConn } from '../../src/storage/sqlConn';
import { encodeBlock } from '../../src/telemetry/blockCodec';
import type { GpsFrame, ImuFrame, Series } from '../../src/telemetry/frame';
import { sliceLapWindows, type LapWindowRecord } from '../../src/telemetry/laps';
import { gpsSeriesOf, imuSeriesOf } from '../../src/telemetry/series';
import { appendBlocks, createSeries, type BlockRow } from '../../src/telemetry/telemetryStore';
import { generateTimedLaps } from './syntheticTrack';

export const BLOCK_MS = 5_000;

/** Um bloco por fatia de `BLOCK_MS` da série, com a faixa `[t_first, t_last]`. */
function blocksOf(series: Series): BlockRow[] {
  const out: BlockRow[] = [];
  let from = 0;
  while (from < series.n) {
    const slot = Math.floor(series.t[from] / BLOCK_MS);
    let to = from + 1;
    while (to < series.n && Math.floor(series.t[to] / BLOCK_MS) === slot) to++;
    out.push({
      seriesId: series.meta.id,
      seq: out.length,
      n: to - from,
      tFirst: series.t[from],
      tLast: series.t[to - 1],
      payload: encodeBlock(series, from, to),
    });
    from = to;
  }
  return out;
}

export type SessionOnDb = { sessionId: string; windows: LapWindowRecord[]; saved: SavedSession; gpsSeriesId: string; imuSeriesId: string };

export async function sessionOnDb(
  conn: SqlConn,
  opts: { recordingId: string; gps: GpsFrame[]; imu: ImuFrame[]; t0Utc: number; line?: StartLine | null }
): Promise<SessionOnDb> {
  const metas = recordingSeries(opts.recordingId, opts.t0Utc);
  const gps = gpsSeriesOf(metas.gps, opts.gps);
  const imu = imuSeriesOf(metas.imu, opts.imu);
  await conn.withExclusiveTransactionAsync(async (tx) => {
    await createSeries(tx, metas.gps);
    await createSeries(tx, metas.imu);
  });
  await appendBlocks(conn, [...blocksOf(gps), ...blocksOf(imu)]);

  const windows = sliceLapWindows(opts.gps, opts.line ?? null);
  const saved = await saveRecordedSession(
    {
      recordingId: opts.recordingId,
      trackName: 'Kartódromo',
      trackId: 'track_1',
      layoutId: null,
      kartSetupId: null,
      mode: 'race',
      startedAt: opts.t0Utc,
      laps: recordedLaps(windows, gps, imu, opts.t0Utc),
    },
    sqlSessionRepo(async () => conn)
  );
  return { sessionId: saved.session.id, windows, saved, gpsSeriesId: metas.gps.id, imuSeriesId: metas.imu.id };
}

/**
 * Pista sintética em frames (t desde t0Utc), GPS a 10 Hz: fixes boas de 3 a 7 m, uma
 * a cada 9 com 45 m (deslocada 40 m) e uma a cada 13 sem precisão.
 */
export function trackFrames(laps: number, lapDurationMs = 37_699, t0Utc = 1_790_000_000_000): GpsFrame[] {
  const { samples } = generateTimedLaps({ lapDurationMs, sampleRateHz: 10, startPhase: 0.37, laps, warmupS: 3, t0: t0Utc });
  return samples.map((s, i) => {
    const f: GpsFrame = { kind: 'gps', source: 'PHONE', t: s.t - t0Utc, lat: s.lat, lng: s.lng, speed: s.speed, fix: 'unknown' };
    if (i % 9 === 4) {
      f.accuracy = 45;
      f.lat += 0.00036;
    } else if (i % 13 !== 6) {
      f.accuracy = 3 + (i % 5);
    }
    return f;
  });
}

/** IMU a 50 Hz do primeiro ao último instante do GPS. */
export function imuFrames(gps: GpsFrame[]): ImuFrame[] {
  const out: ImuFrame[] = [];
  for (let t = 0; t <= gps[gps.length - 1].t; t += 20) {
    out.push({ kind: 'imu', source: 'PHONE', t, accel: { x: 0.1, y: -0.2, z: 9.8 }, gyro: { x: 0, y: 0, z: t / 1e6 } });
  }
  return out;
}
