/**
 * "ATUALIZAR REFERÊNCIA" (Assumptions de 30/09 e 03/10; TF-19) em SQL real
 * (sql.js): o traçado novo é gravado com a série própria, vira o padrão da pista
 * e herda o PB, numa transação só.
 *
 * Reescrito na T23: substitui a invariante estática que lia `db.ts` por regex
 * (`saveLayoutOn(txn, layout)`, `setDefaultLayoutOn(txn, …)` e
 * `savePbRecordOn(txn, pb)` dentro de `withExclusiveTransactionAsync`). As mesmas
 * três escritas agora são conferidas pelo resultado no banco, e a transação única
 * por uma falha na última delas, que desfaz as outras duas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inheritedPb, nextReferenceLayout } from '../src/lib/referenceLayout';
import { loadLaps } from '../src/storage/lapRepo';
import { getLayout, promoteReferenceLayout, insertPbRecord, type TrackLayout } from '../src/storage/layoutRepo';
import type { PbRecord } from '../src/storage/db';
import { imuFrames, sessionOnDb, trackFrames } from './helpers/sessionOnDb';
import { insertOldLayout } from './helpers/v4Database';
import { openV5Database, rowsOf } from './helpers/v5Database';

const T0 = 1_790_000_000_000;
const NOW = T0 + 3_600_000;

const PB_RECORDS = `CREATE TABLE pb_records (
  id TEXT PRIMARY KEY, track_id TEXT NOT NULL, layout_id TEXT, session_id TEXT NOT NULL, lap_id TEXT NOT NULL,
  duration_ms INTEGER NOT NULL, celebrated INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
)`;

/** A pista com o traçado padrão antigo e o PB dele, e uma sessão nova com uma volta mais rápida. */
async function scenario() {
  const db = await openV5Database();
  await db.conn.execAsync(PB_RECORDS);
  const reference: TrackLayout = {
    id: 'layout_antigo',
    trackId: 'track_1',
    name: 'Layout principal',
    window: { kind: 'none' },
    gps: [{ kind: 'gps', source: 'PHONE', fix: 'unknown', t: T0 - 90_000, lat: -14.86, lng: -40.84, speed: 10, accuracy: 4, synthetic: true }],
    durationMs: 40_000,
    lengthM: 750,
    recordedAt: T0 - 86_400_000,
    isDefault: true,
  };
  // O traçado antigo como o formato v4 o guardava (JSON, sem janela). Antes da T44 ele
  // era gravado pelo `saveLayout` em JSON; esse caminho saiu, e o traçado antigo é a
  // linha que a v5b ainda não converteu.
  await insertOldLayout(db.conn, {
    id: reference.id,
    trackId: reference.trackId,
    name: reference.name,
    samples: [{ t: T0 - 90_000, lat: -14.86, lng: -40.84, speed: 10, accuracy: 4, synthetic: true }],
    durationMs: reference.durationMs,
    lengthM: reference.lengthM,
    recordedAt: reference.recordedAt,
  });
  const previousPb: PbRecord = {
    id: 'pb_antigo',
    trackId: 'track_1',
    layoutId: 'layout_antigo',
    sessionId: 'session_antiga',
    lapId: 'session_antiga_lap_3',
    durationMs: 38_500,
    celebrated: true,
    createdAt: T0 - 86_400_000,
  };
  await insertPbRecord(db.conn, previousPb);

  const gps = trackFrames(4);
  const s = await sessionOnDb(db.conn, { recordingId: 'rec_1', gps, imu: imuFrames(gps), t0Utc: T0 });
  const laps = await loadLaps(db.conn, s.sessionId);
  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  const next = nextReferenceLayout(reference, best, s.sessionId, NOW);
  const pb = inheritedPb(previousPb, next, NOW)!;
  return { ...db, reference, previousPb, best, next, pb };
}

const defaults = (conn: Awaited<ReturnType<typeof openV5Database>>['conn']) =>
  rowsOf(conn, 'SELECT id, is_default FROM track_layouts ORDER BY id');

test('promoteReferenceLayout (sql.js): grava o traçado novo com série própria, torna-o o único padrão da pista e grava o PB herdado', async () => {
  const r = await scenario();
  await promoteReferenceLayout(r.conn, r.next, r.pb);

  // 1. O traçado novo, com os frames da volta numa série do dono layout:<id>.
  const saved = (await getLayout(r.conn, r.next.id))!;
  assert.deepEqual(saved.gps, r.best.gps);
  assert.equal(saved.gps![0].synthetic, true);
  assert.deepEqual(rowsOf(r.conn, "SELECT owner_id FROM telemetry_series WHERE owner_kind = 'layout'"), [{ owner_id: r.next.id }]);
  // 2. O padrão é o traçado novo, e só ele.
  assert.deepEqual(defaults(r.conn), [
    { id: 'layout_antigo', is_default: 0 },
    { id: r.next.id, is_default: 1 },
  ]);
  // 3. O PB herdado aponta para o traçado novo, com o tempo do anterior.
  assert.deepEqual(rowsOf(r.conn, 'SELECT layout_id, lap_id, duration_ms FROM pb_records WHERE id = ?', [r.pb.id]), [
    { layout_id: r.next.id, lap_id: 'session_antiga_lap_3', duration_ms: 38_500 },
  ]);
});

test('promoteReferenceLayout (sql.js): uma falha ao gravar o PB desfaz o traçado novo, a série dele e a troca do padrão', async () => {
  const r = await scenario();
  await r.conn.execAsync(
    "CREATE TRIGGER pb_falha BEFORE INSERT ON pb_records BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"
  );

  await assert.rejects(promoteReferenceLayout(r.conn, r.next, r.pb), /disk is full/);
  assert.equal(await getLayout(r.conn, r.next.id), null);
  assert.deepEqual(rowsOf(r.conn, "SELECT owner_id FROM telemetry_series WHERE owner_kind = 'layout'"), []);
  assert.deepEqual(defaults(r.conn), [{ id: 'layout_antigo', is_default: 1 }]);
  assert.deepEqual(rowsOf(r.conn, 'SELECT id FROM pb_records'), [{ id: 'pb_antigo' }]);
});
