/**
 * Invariantes estáticas das telas de traçado e de pista (TF-13, T41), lendo o fonte:
 * `track-layouts-picker`, `new-session`, `at-track`, `onboarding/track` e
 * `onboarding/track-confirm` não usam os tipos antigos nem o JSON de amostras, e as que
 * desenham o traçado leem os frames dele por `layoutGps`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = [
  'track-layouts-picker.tsx',
  'new-session.tsx',
  'at-track.tsx',
  'onboarding/track.tsx',
  'onboarding/track-confirm.tsx',
];

const source = (path: string) => readFileSync(join(__dirname, '..', 'app', path), 'utf8');

test('telas de pista (T41): nenhuma das cinco importa GpsSample nem lê samples_json ou .samples', () => {
  for (const path of SCREENS) {
    const src = source(path);
    assert.equal(/\bGpsSample\b/.test(src), false, `${path}: GpsSample`);
    assert.equal(/samples_json/.test(src), false, `${path}: samples_json`);
    assert.equal(/\.samples\b/.test(src), false, `${path}: .samples`);
  }
});

test('telas de pista (T41): o seletor e a nova sessão desenham e contam curvas pelos frames do traçado (layoutGps)', () => {
  const picker = source('track-layouts-picker.tsx');
  assert.ok(picker.includes("import { layoutGps } from '../src/storage/layoutRepo';"));
  // Substitui `countCorners(l.samples)` e `samples={l.samples}`.
  assert.ok(picker.includes('corners: countCorners(layoutGps(l)),'));
  assert.ok(picker.includes('samples={layoutGps(l)}'));

  const newSession = source('new-session.tsx');
  assert.ok(newSession.includes("import { layoutGps } from '../src/storage/layoutRepo';"));
  // Substitui `row.defaultLayout.samples.length > 2` e `samples={row.defaultLayout.samples}`.
  assert.ok(newSession.includes('row.defaultLayout && layoutGps(row.defaultLayout).length > 2'));
  assert.ok(newSession.includes('samples={layoutGps(row.defaultLayout)}'));
});
