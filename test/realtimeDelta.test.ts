/**
 * Delta ao vivo: TMP-10 (setores, AC 6). Quando uma volta começa, o primeiro
 * ponto casa no início do traçado (s perto de 0), nunca no fim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DeltaTracker } from '../src/lib/realtimeDelta';
import { sliceLaps } from '../src/recording/finishSession';
import { generateTimedLaps } from './helpers/syntheticTrack';

test('DeltaTracker: depois de resetLap(), o 1º ponto em cima da linha (que é também o fim da polilinha) casa com s < 5 % do comprimento', () => {
  // Referência como o app a salva: uma volta com os pontos de fronteira na
  // linha, então a polilinha começa e termina no mesmo lugar.
  const { samples } = generateTimedLaps({ lapDurationMs: 37_699, sampleRateHz: 10, laps: 2, warmupS: 3 });
  const [ref, next] = sliceLaps(samples, []);
  const tracker = new DeltaTracker();
  tracker.setReference(ref.gps, ref.durationMs);
  assert.ok(tracker.hasReference());

  // A volta anterior andou até o fim do traçado; a nova começa na linha.
  const refEnd = ref.gps[ref.gps.length - 1];
  tracker.compute(ref.gps[ref.gps.length - 5], ref.durationMs - 400);
  tracker.resetLap();

  // O 1º ponto da volta nova fica na linha, no mesmo lugar do fim da polilinha.
  const first = { ...next.gps[0], lat: refEnd.lat, lng: refEnd.lng };
  const reading = tracker.compute(first, 0);
  assert.ok(reading.sCurrent !== null && reading.sNormalized !== null);
  assert.ok(reading.sNormalized < 0.05, `s = ${reading.sCurrent} m (${(reading.sNormalized * 100).toFixed(1)} % da volta)`);
});
