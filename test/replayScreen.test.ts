/**
 * Invariantes estáticas de `app/replay/[id].tsx`, lendo o fonte (TF-13, TF-14, T38): o
 * replay lê as voltas pelo `loadLaps` com a IMU (o trompo sai dela) e mantém o caminho
 * de limpeza de hoje, que só descarta pontos não finitos (sem `cleanSamples`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', 'replay', '[id].tsx'), 'utf8');

test('replay: lê as voltas por loadLaps com imu: true, e o trompo sai dos frames de GPS e de IMU', () => {
  assert.ok(SRC.includes("import { loadLaps } from '../../src/storage/lapRepo';"));
  assert.ok(/loadLaps\(conn, id, \{ imu: true \}\)/.test(SRC));
  assert.equal(SRC.includes('getLapsForSession('), false);
  assert.ok(/detectSpins\(lap\.gps, lap\.imu\)/.test(SRC), 'detectSpins(lap.gps, lap.imu)');
});

test('replay: não chama cleanSamples; só descarta pontos com lat, lng ou t não finitos', () => {
  assert.equal(SRC.includes('cleanSamples('), false);
  assert.ok(
    /gps: l\.gps\.filter\(\s*\(s\) =>\s*Number\.isFinite\(s\.lat\) &&\s*Number\.isFinite\(s\.lng\) &&\s*Number\.isFinite\(s\.t\)\s*\)/.test(SRC),
    'o filtro de não finitos sobre lap.gps',
  );
});

test('replay: recebe frames — nenhum GpsSample/ImuSample e nenhuma leitura de .samples/.imuSamples', () => {
  assert.equal(/\b(GpsSample|ImuSample)\b/.test(SRC), false);
  assert.equal(/\.(samples|imuSamples)\b/.test(SRC), false);
  assert.ok(/gps: GpsFrame\[\];\s*imu\?: ImuFrame\[\];/.test(SRC));
});
