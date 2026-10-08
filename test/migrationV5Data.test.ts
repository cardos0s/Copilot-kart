/**
 * Migração v5b (T43) em SQL real (sql.js), sobre um banco v4 de referência:
 * TF-17 (voltas em frames), TF-18 (tempos, `started_at` e PB intactos), TF-19
 * (traçados com a mesma linha de chegada) e TF-20 AC 7 (uma transação por item:
 * a falha desfaz só aquele, que continua legível no formato antigo, e a próxima
 * execução retoma dele sem refazer os outros).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineFromLayout } from '../src/lib/startLine';
import { summarize } from '../src/recording/recovery';
import { loadLaps } from '../src/storage/lapRepo';
import { getLayout, getTrackReference, layoutGps } from '../src/storage/layoutRepo';
import { migrateV5Data, migrateV5Schema, migrationExecutorFrom } from '../src/storage/migrations';
import type { SqlConn } from '../src/storage/sqlConn';
import { sqlJournalStore } from '../src/storage/sqlJournalStore';
import type { GpsFrame } from '../src/telemetry/frame';
import { G } from '../src/telemetry/frame';
import { analysisGps, sliceLapWindows } from '../src/telemetry/laps';
import type { SqlJsConn } from './helpers/sqlJsConn';
import { trackFrames } from './helpers/sessionOnDb';
import {
  insertOldLayout,
  insertOldSession,
  oldLaps,
  oldPoint,
  openV4Database,
  type OldImu,
  type OldLap,
  type OldPoint,
} from './helpers/v4Database';
import { rowsOf } from './helpers/v5Database';

const T0 = 1_790_000_000_000;
const DAY = 86_400_000;

/** Frames com `t` absoluto (epoch ms), como a captura antiga entregava. */
function absolute(laps: number, t0: number, lapMs = 37_699): GpsFrame[] {
  return trackFrames(laps, lapMs, t0).map((f) => ({ ...f, t: t0 + f.t }));
}

/** IMU antiga a 50 Hz, em g, do primeiro ao último ponto. */
function oldImuOf(frames: GpsFrame[]): OldImu[] {
  const out: OldImu[] = [];
  for (let t = frames[0].t; t <= frames[frames.length - 1].t; t += 20) {
    out.push({ t, accel: { x: 0.02, y: -0.01, z: 1 }, gyro: { x: 0, y: 0, z: ((t / 1000) % 7) / 10 } });
  }
  return out;
}

/** O ponto antigo como frame, só para a função de linha (que lê lat/lng). */
const asFrame = (p: OldPoint): GpsFrame => ({ kind: 'gps', source: 'PHONE', fix: 'unknown', t: p.t, lat: p.lat, lng: p.lng, speed: p.speed, accuracy: p.accuracy });

type Fixture = {
  conn: SqlJsConn;
  sessions: Array<{ id: string; laps: OldLap[] }>;
  layouts: Array<{ id: string; samples: OldPoint[]; durationMs: number }>;
  reference: OldPoint[];
  journal: { recordingId: string; startedAt: number; gps: OldPoint[]; imu: OldImu[] };
  corrupt: string;
};

/**
 * O banco v4 de referência: 3 sessões (feature 1 sem sintéticos e com IMU, feature 2
 * com sintéticos e sem IMU, feature 2 com IMU e uma volta corrompida), 2 traçados (com
 * e sem sintéticos), uma referência, um PB e um diário pendente. Depois, a v5a.
 */
async function v4Reference(): Promise<Fixture> {
  const conn = await openV4Database();

  const aFrames = absolute(3, T0);
  const a = { id: 'session_a', laps: oldLaps('session_a', aFrames, { synthetic: false, imu: oldImuOf(aFrames) }) };
  const bFrames = absolute(4, T0 + DAY, 36_900);
  const b = { id: 'session_b', laps: oldLaps('session_b', bFrames, { synthetic: true }) };
  const cFrames = absolute(3, T0 + 2 * DAY, 38_100);
  const c = { id: 'session_c', laps: oldLaps('session_c', cFrames, { synthetic: true, imu: oldImuOf(cFrames) }) };
  const corrupt = c.laps[1].id;
  await insertOldSession(conn, { id: a.id, startedAt: T0, trackId: 'cwb', laps: a.laps });
  await insertOldSession(conn, { id: b.id, startedAt: T0 + DAY, trackId: 'cwb', laps: b.laps });
  await insertOldSession(conn, { id: c.id, startedAt: T0 + 2 * DAY, trackId: 'cwb', laps: c.laps, corrupt: [corrupt] });

  const bestB = b.laps.reduce((x, l) => (l.durationMs < x.durationMs ? l : x));
  const layouts = [
    { id: 'layout_b', samples: bestB.samples, durationMs: bestB.durationMs },
    { id: 'layout_a', samples: a.laps[1].samples, durationMs: a.laps[1].durationMs },
  ];
  await insertOldLayout(conn, { ...layouts[0], trackId: 'cwb', recordedAt: T0 + DAY, sourceSessionId: b.id, sourceLapId: bestB.id });
  await insertOldLayout(conn, { ...layouts[1], trackId: 'cwb', recordedAt: T0, isDefault: false });
  await conn.runAsync(
    `INSERT INTO track_references VALUES ('cwb', 'Kart CWB', ?, ?, 812.5, ?, ?, ?)`,
    JSON.stringify(bestB.samples),
    bestB.durationMs,
    T0 + DAY,
    b.id,
    bestB.id
  );
  await conn.runAsync(
    "INSERT INTO pb_records VALUES ('pb_1', 'cwb', 'layout_b', ?, ?, ?, 1, ?)",
    b.id,
    bestB.id,
    bestB.durationMs,
    T0 + DAY
  );

  // Diário v4 pendente: uma corrida interrompida, em 3 pedaços.
  const startedAt = T0 + 3 * DAY;
  const jFrames = analysisGps(absolute(3, startedAt + 1500));
  const jGps = jFrames.map((f) => oldPoint(f, 0));
  const jImu = oldImuOf(jFrames);
  const recordingId = `rec_${startedAt}_abc123`;
  await conn.runAsync(
    'INSERT INTO recording_active VALUES (?, ?, ?)',
    recordingId,
    JSON.stringify({ version: 1, recordingId, mode: 'race', startedAt, trackId: 'cwb', trackName: 'Kart CWB', layoutId: null, layoutName: null, kartSetupId: null }),
    startedAt
  );
  const third = Math.ceil(jGps.length / 3);
  for (let k = 0; k < 3; k++) {
    const g = jGps.slice(k * third, (k + 1) * third);
    const i = jImu.filter((s) => s.t >= g[0].t && (k === 2 || s.t < jGps[(k + 1) * third].t));
    await conn.runAsync('INSERT INTO recording_chunks VALUES (?, ?, ?, ?)', recordingId, k, JSON.stringify(g), JSON.stringify(i));
  }

  await migrateV5Schema(migrationExecutorFrom(conn));
  return { conn, sessions: [a, b, c], layouts, reference: bestB.samples, journal: { recordingId, startedAt, gps: jGps, imu: jImu }, corrupt };
}

const lapRows = (conn: SqlJsConn) =>
  rowsOf(conn, 'SELECT id, session_id, started_at, duration_ms FROM laps ORDER BY id');
const pbRows = (conn: SqlJsConn) => rowsOf(conn, 'SELECT * FROM pb_records');
const bestPerTrack = (conn: SqlJsConn) =>
  rowsOf(conn, 'SELECT s.track_id, MIN(l.duration_ms) AS best FROM laps l JOIN sessions s ON s.id = l.session_id GROUP BY s.track_id');
const noWarn = () => {};

/** A volta lida, na forma antiga: posição e velocidade de cada ponto. */
const track = (gps: Array<{ lat: number; lng: number; speed: number }>) => gps.map((p) => [p.lat, p.lng, p.speed]);

test('v5b (sql.js): o banco v4 de referência converte, e tempos, started_at, PB e a linha de chegada dos traçados ficam os de antes', async () => {
  const fx = await v4Reference();
  const { conn } = fx;
  const laps = lapRows(conn);
  const pbs = pbRows(conn);
  const best = bestPerTrack(conn);
  const warnings: string[] = [];

  const report = await migrateV5Data(conn, (m) => warnings.push(m));

  assert.deepEqual(report, { sessions: 3, layouts: 2, references: 1, journals: 1, skippedLaps: 1, failed: [] });
  assert.ok(warnings.some((w) => /1 volta/.test(w)), 'a contagem das voltas puladas vai para o aviso');
  assert.deepEqual(rowsOf(conn, 'SELECT id, frames_version FROM sessions ORDER BY id'), [
    { id: 'session_a', frames_version: 5 },
    { id: 'session_b', frames_version: 5 },
    { id: 'session_c', frames_version: 5 },
  ]);
  // TF-18: tempos, started_at e PB intactos.
  assert.deepEqual(lapRows(conn), laps);
  assert.deepEqual(pbRows(conn), pbs);
  assert.deepEqual(bestPerTrack(conn), best);

  // TF-17: cada sessão vira uma série (legado, fonte PHONE), e as voltas são lidas das janelas.
  const kinds = rowsOf<{ owner_id: string; kind: string; source: string; legacy: number }>(
    conn,
    "SELECT owner_id, kind, source, legacy FROM telemetry_series WHERE owner_kind = 'session' ORDER BY owner_id, kind"
  );
  assert.deepEqual(kinds.filter((k) => k.owner_id.startsWith('session_') && !k.owner_id.startsWith('session_rec')), [
    { owner_id: 'session_a', kind: 'gps', source: 'PHONE', legacy: 1 },
    { owner_id: 'session_a', kind: 'imu', source: 'PHONE', legacy: 1 },
    { owner_id: 'session_b', kind: 'gps', source: 'PHONE', legacy: 1 },
    { owner_id: 'session_c', kind: 'gps', source: 'PHONE', legacy: 1 },
    { owner_id: 'session_c', kind: 'imu', source: 'PHONE', legacy: 1 },
  ]);
  for (const s of fx.sessions) {
    const read = await loadLaps(conn, s.id, { imu: true });
    assert.deepEqual(read.map((l) => [l.id, l.startedAt, l.durationMs]), s.laps.map((l) => [l.id, l.startedAt, l.durationMs]), s.id);
    for (const [k, l] of read.entries()) {
      const old = s.laps[k];
      if (old.id === fx.corrupt) {
        // TF-20 AC 9: a volta corrompida fica com o tempo e sem trajetória.
        assert.deepEqual(l.window, { kind: 'none' });
        assert.deepEqual(l.gps, []);
        continue;
      }
      assert.equal(l.window!.kind, s.id === 'session_a' ? 'index' : 'cross', old.id);
      const t0 = rowsOf<{ t0_utc: number }>(conn, "SELECT t0_utc FROM telemetry_series WHERE owner_id = ? AND kind = 'gps'", [s.id])[0].t0_utc;
      assert.deepEqual(l.gps.map((f) => oldPoint(f, t0)), old.samples, old.id);
      assert.ok(l.gps.every((f) => f.fix === 'unknown' && (f.synthetic || f.legacy)), old.id);
      if (old.imu) {
        assert.deepEqual(
          l.imu!.map((f) => ({ t: t0 + f.t, gyro: f.gyro, az: f.accel!.z })),
          old.imu.map((i) => ({ t: i.t, gyro: i.gyro, az: i.accel.z * G })),
          `IMU de ${old.id}`
        );
      } else {
        assert.equal(l.imu, undefined, old.id);
      }
    }
  }

  // TF-19: os traçados têm séries próprias e a mesma linha de chegada.
  for (const old of fx.layouts) {
    const read = (await getLayout(conn, old.id))!;
    assert.ok(read.window && read.window.kind !== 'none', old.id);
    assert.equal(read.durationMs, old.durationMs);
    assert.deepEqual(read.gps!.map((f) => oldPoint(f, 0)), old.samples, old.id);
    assert.deepEqual(lineFromLayout(layoutGps(read)), lineFromLayout(old.samples.map(asFrame)), old.id);
    assert.ok(lineFromLayout(layoutGps(read)), old.id);
  }
  const ref = (await getTrackReference(conn, 'cwb'))!;
  assert.deepEqual(ref.gps!.map((f) => oldPoint(f, 0)), fx.reference.filter((p) => !p.synthetic));

  // O diário pendente vira as séries da gravação, e a recuperação acha as mesmas voltas.
  assert.deepEqual(rowsOf(conn, 'SELECT COUNT(*) AS c FROM recording_chunks'), [{ c: 0 }]);
  const store = sqlJournalStore(async () => conn);
  const active = (await store.readActive())!;
  const series = await store.readSeries(fx.journal.recordingId);
  const summary = summarize(active, series);
  const oldWindows = sliceLapWindows(fx.journal.gps.map(asFrame));
  assert.ok(summary !== 'unreadable');
  assert.equal(summary.laps, oldWindows.length);
  assert.ok(summary.laps >= 2);
  const gps = series.series.find((x) => x.meta.kind === 'gps')!;
  assert.equal(gps.n, fx.journal.gps.length);
  assert.equal(gps.meta.t0Utc, fx.journal.startedAt);
  assert.equal(series.series.find((x) => x.meta.kind === 'imu')!.n, fx.journal.imu.length);
});

test('v5b (sql.js): rodar de novo não converte nem grava nada', async () => {
  const fx = await v4Reference();
  await migrateV5Data(fx.conn, noWarn);
  const series = rowsOf(fx.conn, 'SELECT * FROM telemetry_series ORDER BY id');
  const blocks = rowsOf(fx.conn, 'SELECT series_id, seq, n FROM telemetry_blocks ORDER BY series_id, seq');

  const again = await migrateV5Data(fx.conn, noWarn);

  assert.deepEqual(again, { sessions: 0, layouts: 0, references: 0, journals: 0, skippedLaps: 0, failed: [] });
  assert.deepEqual(rowsOf(fx.conn, 'SELECT * FROM telemetry_series ORDER BY id'), series);
  assert.deepEqual(rowsOf(fx.conn, 'SELECT series_id, seq, n FROM telemetry_blocks ORDER BY series_id, seq'), blocks);
});

/** A conexão com uma falha no fim da conversão de uma sessão (depois de gravar as séries dela). */
function failingOn(conn: SqlJsConn, sessionId: string): SqlConn {
  return {
    ...conn,
    withExclusiveTransactionAsync: (fn) =>
      conn.withExclusiveTransactionAsync((tx) =>
        fn({
          ...tx,
          runAsync: async (sql, ...params) => {
            if (sql.startsWith('UPDATE sessions SET frames_version') && params[1] === sessionId) throw new Error('falha injetada');
            await tx.runAsync(sql, ...params);
          },
        })
      ),
  };
}

test('v5b (sql.js, TF-20 AC 7): com falha na 2ª sessão, a 1ª fica convertida, a 2ª continua legível no formato antigo, e a próxima execução termina sem duplicar a 1ª', async () => {
  const fx = await v4Reference();
  const { conn } = fx;
  const [a, b] = fx.sessions;
  const bJson = rowsOf(conn, 'SELECT id, samples_json, imu_samples_json FROM laps WHERE session_id = ? ORDER BY id', [b.id]);
  const warnings: string[] = [];

  const first = await migrateV5Data(failingOn(conn, b.id), (m) => warnings.push(m));

  assert.deepEqual(first.failed, ['session:session_b']);
  assert.equal(first.sessions, 2);
  assert.ok(warnings.some((w) => w.includes('session_b') && w.includes('falha injetada')));
  assert.deepEqual(rowsOf(conn, 'SELECT id, frames_version FROM sessions ORDER BY id'), [
    { id: 'session_a', frames_version: 5 },
    { id: 'session_b', frames_version: 0 },
    { id: 'session_c', frames_version: 5 },
  ]);
  // A 2ª foi desfeita inteira: nenhuma série, nenhuma janela, o JSON como estava.
  assert.deepEqual(rowsOf(conn, "SELECT id FROM telemetry_series WHERE owner_id = 'session_b'"), []);
  assert.deepEqual(rowsOf(conn, 'SELECT COUNT(*) AS c FROM laps WHERE session_id = ? AND window_kind IS NOT NULL', [b.id]), [{ c: 0 }]);
  assert.deepEqual(rowsOf(conn, 'SELECT id, samples_json, imu_samples_json FROM laps WHERE session_id = ? ORDER BY id', [b.id]), bJson);
  // E continua legível: as voltas abrem com os tempos e a trajetória de antes.
  const legible = await loadLaps(conn, b.id, { imu: true });
  assert.deepEqual(legible.map((l) => [l.id, l.startedAt, l.durationMs]), b.laps.map((l) => [l.id, l.startedAt, l.durationMs]));
  assert.deepEqual(legible.map((l) => track(l.gps)), b.laps.map((l) => track(l.samples)));

  const aSeries = rowsOf(conn, "SELECT * FROM telemetry_series WHERE owner_id = 'session_a' ORDER BY id");
  const aBlocks = rowsOf(conn, "SELECT series_id, seq, n, t_first, t_last FROM telemetry_blocks WHERE series_id LIKE 'session_a_%' ORDER BY series_id, seq");

  const second = await migrateV5Data(conn, noWarn);

  assert.deepEqual(second, { sessions: 1, layouts: 0, references: 0, journals: 0, skippedLaps: 0, failed: [] });
  assert.deepEqual(rowsOf(conn, 'SELECT COUNT(*) AS c FROM sessions WHERE frames_version <> 5'), [{ c: 0 }]);
  assert.deepEqual(rowsOf(conn, "SELECT * FROM telemetry_series WHERE owner_id = 'session_a' ORDER BY id"), aSeries);
  assert.deepEqual(
    rowsOf(conn, "SELECT series_id, seq, n, t_first, t_last FROM telemetry_blocks WHERE series_id LIKE 'session_a_%' ORDER BY series_id, seq"),
    aBlocks
  );
  const converted = await loadLaps(conn, b.id);
  assert.ok(converted.every((l) => l.window?.kind === 'cross'));
  assert.deepEqual(converted.map((l) => track(l.gps)), b.laps.map((l) => track(l.samples)));
});
