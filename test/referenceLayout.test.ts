/**
 * "ATUALIZAR REFERÊNCIA" cria um traçado novo (Assumption de 30/09 na spec,
 * AD-006): o anterior fica intacto para as sessões gravadas com ele.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReferenceLayout } from '../src/lib/referenceLayout';
import { polylineLength, type GpsSample } from '../src/lib/geometry';
import type { LapRecord } from '../src/lib/analysis';
import type { TrackLayout } from '../src/storage/db';

const pt = (t: number, lat: number, lng: number, synthetic?: true): GpsSample => ({
  t,
  lat,
  lng,
  speed: 15,
  accuracy: 3,
  ...(synthetic ? { synthetic } : {}),
});

const reference: TrackLayout = {
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
};

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
  const prev = { ...reference, name: 'Layout principal · 12/08' };
  const next = nextReferenceLayout(prev, best, 'sess_nova', new Date(2026, 9, 3, 9, 0, 0).getTime());
  assert.equal(next.name, 'Layout principal · 03/10');
});

test('nextReferenceLayout: o traçado anterior não é alterado', () => {
  const snapshot = structuredClone(reference);
  const next = nextReferenceLayout(reference, best, 'sess_nova', NOW);
  assert.deepEqual(reference, snapshot);

  // Mexer no traçado novo não alcança o anterior.
  next.samples.push(pt(200_000, 0, 0));
  assert.deepEqual(reference, snapshot);
});
