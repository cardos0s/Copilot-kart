/**
 * Selo de fonte e qualidade (T26): TF-23 (fonte "Celular" ou "MyChron") e TF-24
 * (mediana da precisão dos frames das voltas, sem as fronteiras: boa ≤ 5 m,
 * média ≤ 10 m, ruim > 10 m, "desconhecida" sem precisão; sem volta, todos os
 * frames da sessão).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { badgeText, sessionBadge } from '../src/telemetry/badge';
import type { GpsFrame } from '../src/telemetry/frame';

let t = 0;
const fix = (accuracy?: number, synthetic?: true): GpsFrame => ({
  kind: 'gps',
  source: 'PHONE',
  t: (t += 100),
  lat: -14.86,
  lng: -40.84,
  speed: 12,
  fix: 'unknown',
  ...(accuracy === undefined ? {} : { accuracy }),
  ...(synthetic ? { synthetic } : {}),
});

/** Uma volta com fronteiras e frames internos com mediana `m` (m − 1, m, m + 2). */
const lapWithMedian = (m: number): GpsFrame[] => [fix(m, true), fix(m - 1), fix(m), fix(m + 2), fix(m, true)];

test('sessionBadge: medianas de 3 m, 5 m, 8 m, 10 m e 15 m dão boa, boa, média, média e ruim', () => {
  const out = [3, 5, 8, 10, 15].map((m) => sessionBadge('PHONE', [lapWithMedian(m)], []));
  assert.deepEqual(out.map((b) => b.quality), ['boa', 'boa', 'média', 'média', 'ruim']);
  assert.deepEqual(out.map((b) => b.medianAccuracyM), [3, 5, 8, 10, 15]);
  // Logo acima das fronteiras de faixa.
  assert.equal(sessionBadge('PHONE', [lapWithMedian(5.01)], []).quality, 'média');
  assert.equal(sessionBadge('PHONE', [lapWithMedian(10.01)], []).quality, 'ruim');
});

test('sessionBadge: os pontos synthetic (fronteiras) não entram na mediana', () => {
  // Internos 4, 4 e 8 (mediana 4); com as fronteiras de 20 m, a mediana seria 8.
  const lap = [fix(20, true), fix(4), fix(4), fix(8), fix(20, true)];
  const b = sessionBadge('PHONE', [lap], []);
  assert.equal(b.medianAccuracyM, 4);
  assert.equal(b.quality, 'boa');
});

test('sessionBadge: sem nenhuma precisão nas voltas, a qualidade é "desconhecida", sem metros', () => {
  // Os frames da sessão têm precisão, mas a sessão tem voltas: vale o que está nelas.
  const b = sessionBadge('PHONE', [[fix(4, true), fix(), fix(), fix(4, true)]], [fix(3), fix(3)]);
  assert.deepEqual(b, { sourceLabel: 'Celular', quality: 'desconhecida', medianAccuracyM: null });
  assert.equal(badgeText(b), 'Celular · GPS desconhecida');
});

test('sessionBadge: sem volta, a mediana usa todos os frames de GPS da sessão', () => {
  const b = sessionBadge('PHONE', [], [fix(14), fix(), fix(15), fix(30)]);
  assert.equal(b.medianAccuracyM, 15);
  assert.equal(b.quality, 'ruim');
});

test('sessionBadge/badgeText: PHONE dá "Celular", MYCHRON dá "MyChron", e o texto é "Celular · GPS boa (4 m)"', () => {
  const lap = [fix(4, true), fix(3), fix(4), fix(6), fix(4, true)];
  const phone = sessionBadge('PHONE', [lap], []);
  assert.equal(phone.sourceLabel, 'Celular');
  assert.equal(sessionBadge('MYCHRON', [lap], []).sourceLabel, 'MyChron');
  assert.equal(badgeText(phone), 'Celular · GPS boa (4 m)');
  assert.equal(badgeText(sessionBadge('MYCHRON', [[fix(8.4)]], [])), 'MyChron · GPS média (8 m)');
});
