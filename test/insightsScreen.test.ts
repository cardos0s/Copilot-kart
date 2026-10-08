/**
 * Invariantes estáticas de `app/(tabs)/insights.tsx`, lendo o fonte:
 * TMP-13 (o "Sua volta" usa só voltas do mesmo traçado da sessão âncora).
 * Desde a T39 (TF-13, TF-16): as voltas vêm do `loadLaps`, sem a IMU, e a volta
 * pintada recebe os frames (`insight.best.gps`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'insights.tsx'), 'utf8');

test('insights: monta o conjunto com lapsForInsight, sem o filtro só por trackId', () => {
  const m = SRC.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/src\/lib\/lapInsight'/);
  assert.ok(m && m[1].split(',').map((s) => s.trim()).includes('lapsForInsight'));
  assert.ok(/lapsForInsight\(sessions,\s*anchor\)/.test(SRC));
  assert.equal(/x\.trackId\s*===\s*anchor\.trackId/.test(SRC), false);
  assert.equal(/x\.trackName\s*===\s*anchor\.trackName/.test(SRC), false);
});

test('insights (T39): as voltas do mesmo traçado vêm do loadLaps, sem IMU, e a volta pintada recebe os frames', () => {
  // Substitui `sameTrack.map((x) => getLapsForSession(x.id))`.
  assert.ok(/const laps = \(await Promise\.all\(sameTrack\.map\(\(x\) => loadLaps\(conn, x\.id\)\)\)\)\.flat\(\);/.test(SRC));
  assert.ok(/setInsight\(buildLapInsight\(laps\)\);/.test(SRC));
  // Substitui `samples={insight.best.samples}`.
  assert.ok(SRC.includes('samples={insight.best.gps}'));
  assert.equal(SRC.includes('getLapsForSession('), false);
  assert.equal(/\.samples\b/.test(SRC), false);
});
