/**
 * Invariantes estáticas de `app/(tabs)/index.tsx`, lendo o fonte:
 * TMP-11 AC 3 e 4 (a home usa o pico p99 e mostra "—" quando ele é null).
 * Desde a T39 (TF-13, TF-16): as voltas vêm do `loadLaps`, sem a IMU, e a silhueta
 * da melhor volta é desenhada pelos frames (`best.gps`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const SRC = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');

/** Compila e devolve a função `name` do fonte da tela, para chamá-la de verdade. */
function loadFunction(name: string): (...args: unknown[]) => unknown {
  const m = SRC.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `a tela define ${name}`);
  const js = ts.transpileModule(m[0], { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(`${js}; return ${name};`)() as (...args: unknown[]) => unknown;
}

test('home: o pico sai de peakSpeedMsOfLaps sem ponte para 0, e null chega à UI como "—"', () => {
  assert.ok(/peakSpeedMsOfLaps\(laps\)/.test(SRC));
  assert.equal(/peakSpeedMsOfLaps\([^)]*\)\s*\?\?\s*0/.test(SRC), false);
  assert.ok(/peakSpeedKmh:\s*number\s*\|\s*null/.test(SRC), 'o pico da sessão pode ser null');
  assert.ok(SRC.includes('{fmtKmh(lastSession.peakSpeedKmh)}'), 'o card mostra o pico por fmtKmh');

  const fmtKmh = loadFunction('fmtKmh');
  assert.equal(fmtKmh(null), '—');
  assert.equal(fmtKmh(80.26), '80,3');
});

test('home (T39): o pico e a silhueta saem das voltas do loadLaps, sem IMU e sem .samples', () => {
  assert.ok(SRC.includes("import { loadLaps } from '../../src/storage/lapRepo';"));
  // Substitui `getLapsForSession(sess.id)`: a mesma leitura, sem a IMU que a home não usa.
  assert.ok(/const laps = await loadLaps\(conn, sess\.id\);[\s\S]*?const peakMs = peakSpeedMsOfLaps\(laps\);/.test(SRC));
  // Substitui `getLapsForSession(sessionId)` e `setBestSamples(best.samples)` da silhueta.
  assert.ok(/const laps = await loadLaps\(await appSqlConn\(\), sessionId\);/.test(SRC));
  assert.ok(SRC.includes('setBestSamples(best.gps);'));
  assert.equal(SRC.includes('getLapsForSession('), false);
  assert.equal(/loadLaps\([^)]*imu/.test(SRC), false, 'sem imu: true');
  assert.equal(/\.samples\b/.test(SRC), false);
});
