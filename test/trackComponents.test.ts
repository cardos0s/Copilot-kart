/**
 * Invariantes estáticas dos componentes de mapa e silhueta (TF-13, T35), lendo o fonte:
 * `TrackSilhouette`, `ColoredTrackPath`, `ui/TrackShape` e `analysis/parts` recebem
 * `GpsFrame`, e a silhueta lê traçados e referências pelo `layoutRepo`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutGps } from '../src/storage/layoutRepo';
import type { GpsFrame } from '../src/telemetry/frame';

const COMPONENTS = [
  'src/components/TrackSilhouette.tsx',
  'src/components/ColoredTrackPath.tsx',
  'src/components/ui/TrackShape.tsx',
  'src/components/analysis/parts.tsx',
];

function source(path: string): string {
  return readFileSync(join(__dirname, '..', path), 'utf8');
}

test('componentes de mapa: nenhum importa GpsSample nem chama listTrackReferences( fora do layoutRepo', () => {
  for (const path of COMPONENTS) {
    const src = source(path);
    assert.equal(/\bGpsSample\b/.test(src), false, `${path} não usa GpsSample`);
    assert.equal(/(?<!layoutRepo\.)\blistTrackReferences\(/.test(src), false, `${path} não chama o listTrackReferences do db`);
  }
});

test('componentes de mapa: os pontos são GpsFrame', () => {
  const frameImport = /import type \{ GpsFrame \} from '[./]+\/telemetry\/frame';/;
  // Na T46 o campo do segmento de cor (`ColoredSegment.samples`) virou `frames`: o mesmo
  // GpsFrame[], com outro nome, para nenhum objeto do app ter mais um campo `samples` lido.
  for (const [path, field] of [['src/components/TrackSilhouette.tsx', 'samples'], ['src/components/ColoredTrackPath.tsx', 'frames']]) {
    const src = source(path);
    assert.ok(frameImport.test(src), `${path} importa GpsFrame`);
    assert.ok(new RegExp(`${field}: GpsFrame\\[\\];`).test(src), `${path} recebe GpsFrame[]`);
  }
  // PaintedLap recebia um tipo estrutural `{ lat; lng; speed }[]`.
  const parts = source('src/components/analysis/parts.tsx');
  assert.ok(frameImport.test(parts));
  assert.ok(/export function PaintedLap\([\s\S]*?samples: GpsFrame\[\];/.test(parts), 'PaintedLap recebe GpsFrame[]');
});

test('TrackShape: traçados e referências vêm do layoutRepo, pelos frames', () => {
  const src = source('src/components/ui/TrackShape.tsx');
  assert.ok(src.includes("import * as layoutRepo from '../../storage/layoutRepo';"));
  assert.ok(src.includes('await layoutRepo.listAllLayoutsGrouped(conn)'));
  assert.ok(src.includes('await layoutRepo.listTrackReferences(conn)'));
  // Substitui `samplesToSilhouette(preferred.samples)` e `samplesToSilhouette(ref.samples)`.
  assert.ok(src.includes('samplesToSilhouette(layoutRepo.layoutGps(preferred))'));
  assert.ok(src.includes('samplesToSilhouette(layoutRepo.layoutGps(ref))'));
  assert.equal(/\.samples\b/.test(src), false, 'nenhuma leitura de .samples');
});

/**
 * Migrado na T46: substitui "com série devolve os frames dela; o traçado ainda em JSON
 * devolve os pontos do JSON". O traçado não tem mais `samples` (o que a v5b não converteu
 * já sai em frames pela conversão), e `layoutGps` devolve os frames dele.
 */
test('layoutGps: devolve os frames do traçado', () => {
  const frame = (t: number): GpsFrame => ({ kind: 'gps', source: 'PHONE', fix: 'unknown', t, lat: -14.86, lng: -40.84, speed: 10, accuracy: 4 });
  const gps = [frame(0), frame(100)];
  assert.equal(layoutGps({ gps }), gps);
});
