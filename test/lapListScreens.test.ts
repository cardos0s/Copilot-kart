/**
 * Invariantes estáticas da lista de sessões, do Pilot DNA, do perfil e do coach (TF-13,
 * TF-16, T39), lendo o fonte: as voltas vêm do `loadLaps` sem a IMU, que nenhuma dessas
 * telas usa, e nenhuma lê `.samples` nem os tipos antigos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (...path: string[]) => readFileSync(join(__dirname, '..', 'app', ...path), 'utf8');

test('sessões (T39): a melhor volta e a contagem vêm do loadLaps, sem IMU, e a silhueta recebe best.gps', () => {
  const src = source('(tabs)', 'sessions.tsx');
  // Substitui `getLapsForSession(sess.id)` e `bestSamples: best?.samples ?? null`.
  assert.ok(/const laps = await loadLaps\(conn, sess\.id\);/.test(src));
  assert.ok(/lapCount: laps\.length,\s*bestSamples: best\?\.gps \?\? null,/.test(src));
  assert.ok(/bestSamples: GpsFrame\[\] \| null;/.test(src));
  assert.equal(src.includes('getLapsForSession('), false);
});

test('Pilot DNA (T39): as voltas de cada sessão vêm do loadLaps, sem IMU', () => {
  const src = source('pilot-dna.tsx');
  // Substitui `getLapsForSession(s.id)`.
  assert.ok(/const laps = await loadLaps\(conn, s\.id\);\s*if \(laps\.length > 0\) \{\s*inputs\.push\(\{ trackName: s\.trackName, startedAt: s\.startedAt, laps \}\);/.test(src));
  assert.equal(src.includes('getLapsForSession('), false);
});

test('abas, Pilot DNA e coach (T39): nenhuma lê .samples/.imuSamples nem importa os tipos antigos', () => {
  for (const path of [
    ['(tabs)', 'index.tsx'],
    ['(tabs)', 'sessions.tsx'],
    ['(tabs)', 'insights.tsx'],
    ['(tabs)', 'profile.tsx'],
    ['pilot-dna.tsx'],
    ['coach.tsx'],
  ]) {
    const src = source(...path);
    const name = path.join('/');
    assert.equal(/\b(GpsSample|ImuSample|LocalSample)\b/.test(src), false, `${name}: tipos antigos`);
    assert.equal(/\.(samples|imuSamples)\b/.test(src), false, `${name}: .samples/.imuSamples`);
    assert.equal(/loadLaps\([^)]*imu: true/.test(src), false, `${name}: sem IMU`);
  }
});
