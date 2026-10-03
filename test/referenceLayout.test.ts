/**
 * "ATUALIZAR REFERÊNCIA" cria um traçado novo (Assumption de 30/09 na spec,
 * AD-006): o anterior fica intacto para as sessões gravadas com ele. O
 * traçado novo herda o PB do anterior (Assumption de 03/10).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inheritedPb, nextReferenceLayout } from '../src/lib/referenceLayout';
import { polylineLength, type GpsSample } from '../src/lib/geometry';
import type { LapRecord } from '../src/lib/analysis';
import type { PbRecord, TrackLayout } from '../src/storage/db';

// `gamification.ts` importa o banco (expo-sqlite, nativo). Para usar a regra
// real de PB em Node, o banco entra vazio no cache antes do require.
const dbPath = require.resolve('../src/storage/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} } as NodeJS.Module;
const { processSessionMilestones } =
  require('../src/lib/gamification') as typeof import('../src/lib/gamification');

const pt = (t: number, lat: number, lng: number, synthetic?: true): GpsSample => ({
  t,
  lat,
  lng,
  speed: 15,
  accuracy: 3,
  ...(synthetic ? { synthetic } : {}),
});

// Um traçado novo para cada teste: um teste não enxerga o que outro fez com a
// entrada, e o "não altera a entrada" vale também dentro da suíte.
const makeReference = (): TrackLayout => ({
  id: 'layout_rec_antigo',
  trackId: 'kartodromo-x',
  name: 'Layout principal',
  samples: [pt(1_000, -12.9, -38.4, true), pt(1_100, -12.9001, -38.4), pt(39_000, -12.9, -38.4, true)],
  durationMs: 38_000,
  lengthM: 820,
  recordedAt: 1_700_000_000_000,
  sourceSessionId: 'sess_antiga',
  sourceLapId: 'sess_antiga_lap_2',
  isDefault: true,
});

const best: LapRecord = {
  id: 'sess_nova_lap_3',
  sessionId: 'sess_nova',
  startedAt: 100_000,
  durationMs: 37_699,
  samples: [
    pt(100_000, -12.9, -38.4, true),
    pt(100_050, -12.90005, -38.40002),
    pt(110_000, -12.9012, -38.4011),
    pt(125_000, -12.9003, -38.4019),
    pt(137_699, -12.9, -38.4, true),
  ],
};

// 30/09 ao meio-dia, no fuso local: o nome usa a data local de `now`.
const NOW = new Date(2026, 8, 30, 12, 0, 0).getTime();

test('nextReferenceLayout: id novo, mesmo trackId, nome com a data, padrão, e a volta com as fronteiras sintéticas', () => {
  const reference = makeReference();
  const next = nextReferenceLayout(reference, best, 'sess_nova', NOW);

  assert.notEqual(next.id, reference.id);
  assert.equal(next.trackId, 'kartodromo-x');
  assert.equal(next.name, 'Layout principal · 30/09');
  assert.equal(next.isDefault, true);

  assert.deepEqual(next.samples, best.samples);
  assert.equal(next.samples[0].synthetic, true);
  assert.equal(next.samples[next.samples.length - 1].synthetic, true);
  assert.equal(next.durationMs, 37_699);
  assert.equal(next.lengthM, polylineLength(best.samples));
  assert.equal(next.recordedAt, NOW);
  assert.equal(next.sourceSessionId, 'sess_nova');
  assert.equal(next.sourceLapId, 'sess_nova_lap_3');
});

test('nextReferenceLayout: nome que já termina em " · dd/mm" troca a data em vez de empilhar', () => {
  const prev = { ...makeReference(), name: 'Layout principal · 12/08' };
  const next = nextReferenceLayout(prev, best, 'sess_nova', new Date(2026, 9, 3, 9, 0, 0).getTime());
  assert.equal(next.name, 'Layout principal · 03/10');
});

test('nextReferenceLayout: o traçado anterior não é alterado', () => {
  // Nome com data: uma escrita do nome sem a data na entrada também aparece.
  const reference = { ...makeReference(), name: 'Layout principal · 12/08' };
  const snapshot = structuredClone(reference);
  const next = nextReferenceLayout(reference, best, 'sess_nova', NOW);
  assert.deepEqual(reference, snapshot);

  // Mexer no traçado novo não alcança o anterior.
  next.samples.push(pt(200_000, 0, 0));
  assert.deepEqual(reference, snapshot);
});

const previousPb = (): PbRecord => ({
  id: 'pb_1700000000000_ab12',
  trackId: 'kartodromo-x',
  layoutId: 'layout_rec_antigo',
  sessionId: 'sess_do_pb',
  lapId: 'sess_do_pb_lap_4',
  durationMs: 49_776,
  celebrated: true,
  createdAt: 1_700_000_000_000,
});

test('inheritedPb: o traçado novo recebe o PB do anterior, já celebrado', () => {
  const next = nextReferenceLayout(makeReference(), best, 'sess_nova', NOW);
  const prev = previousPb();
  const pb = inheritedPb(prev, next, NOW);

  assert.ok(pb);
  assert.notEqual(pb.id, prev.id);
  assert.equal(pb.layoutId, next.id);
  assert.equal(pb.trackId, 'kartodromo-x');
  assert.equal(pb.durationMs, 49_776);
  assert.equal(pb.sessionId, 'sess_do_pb');
  assert.equal(pb.lapId, 'sess_do_pb_lap_4');
  assert.equal(pb.celebrated, true);
  assert.equal(pb.createdAt, NOW);
  // O PB anterior não muda.
  assert.deepEqual(prev, previousPb());
});

test('inheritedPb: sem PB anterior, não há o que herdar', () => {
  const next = nextReferenceLayout(makeReference(), best, 'sess_nova', NOW);
  assert.equal(inheritedPb(null, next, NOW), null);
});

test('inheritedPb: com o PB herdado, uma volta de 49.900 ms não é PB nova', () => {
  const next = nextReferenceLayout(makeReference(), best, 'sess_nova', NOW);
  const pb = inheritedPb(previousPb(), next, NOW);
  assert.ok(pb);

  const milestones = (previousPbMs: number | null) =>
    processSessionMilestones({
      trackId: next.trackId,
      layoutId: next.id,
      sessionId: 'sess_seguinte',
      bestLapMs: 49_900,
      bestLapId: 'sess_seguinte_lap_2',
      previousPbMs,
      previousStreakCount: 0,
      currentXp: 0,
    });

  const withInherited = milestones(pb.durationMs);
  assert.equal(withInherited.isNewPb, false);
  assert.equal(withInherited.milestones.some((m) => m.kind === 'pb'), false);
  // Sem a herança, a mesma volta mais lenta virava uma "nova PB" falsa.
  assert.equal(milestones(null).isNewPb, true);
});
