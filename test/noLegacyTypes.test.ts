/**
 * Fim dos tipos antigos (T46, TF-13): nenhum arquivo do app fala do formato de
 * antes desta feature. Varre `src/` e `app/` inteiros. Só a migração e a conversão
 * (`src/storage/migrations.ts`, `src/telemetry/legacy.ts`) leem o formato antigo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const LEGACY_READERS = ['src/storage/migrations.ts', 'src/telemetry/legacy.ts'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'app'))].map((p) => ({
  path: relative(ROOT, p).split('\\').join('/'),
  src: readFileSync(p, 'utf8'),
}));

const LEGACY_NAMES = /\b(GpsSample|ImuSample|LocalSample|samples_json|imu_samples_json)\b/;

test('TF-13: nenhum arquivo de src/ e app/ contém GpsSample, ImuSample, LocalSample, samples_json ou imu_samples_json, fora da migração e da conversão', () => {
  assert.ok(FILES.length > 100, `${FILES.length} arquivos varridos`);
  const found = FILES.filter((f) => !LEGACY_READERS.includes(f.path) && LEGACY_NAMES.test(f.src)).map(
    (f) => `${f.path}: ${LEGACY_NAMES.exec(f.src)![0]}`
  );
  assert.deepEqual(found, []);
  // As duas exceções existem e são as que leem o formato antigo.
  for (const path of LEGACY_READERS) {
    const file = FILES.find((f) => f.path === path);
    assert.ok(file && /\bsamples_json\b/.test(file.src), `${path} lê o formato antigo`);
  }
});

/**
 * Acesso a uma propriedade `samples` ou `imuSamples` (`x.samples`, `x?.samples`,
 * `x[i].samples`). O espalhamento (`...samples`) não é acesso. O buffer da captura e os
 * segmentos de cor, que tinham um campo `samples` sem ser volta, passaram a `gps` e `frames`,
 * então não há exceção: nenhum objeto do app tem mais esse campo.
 */
const SAMPLES_ACCESS = /[\w$)\]]\??\.(samples|imuSamples)\b/;

test('TF-13: nenhum acesso a .samples nem a .imuSamples em src/ e app/', () => {
  const found = FILES.flatMap((f) =>
    f.src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => SAMPLES_ACCESS.test(line))
      .map(({ line, n }) => `${f.path}:${n}: ${line.trim()}`)
  );
  assert.deepEqual(found, []);
});

test('TF-13: LapRecord, RecordedLap, TrackLayout e TrackReference não declaram samples nem imuSamples', () => {
  const decl = (path: string, type: string) => {
    const src = FILES.find((f) => f.path === path)!.src;
    const m = new RegExp(`export type ${type} = (?:[\\w&\\s]+)?\\{([\\s\\S]*?)\\n\\};`).exec(src);
    assert.ok(m, `${path}: ${type}`);
    return m[1];
  };
  for (const [path, type] of [
    ['src/lib/analysis.ts', 'LapRecord'],
    ['src/recording/finishSession.ts', 'SlicedLap'],
    ['src/storage/layoutRepo.ts', 'TrackLayout'],
    ['src/storage/db.ts', 'TrackReference'],
  ]) {
    const body = decl(path, type);
    assert.equal(/^\s*(samples|imuSamples)\??:/m.test(body), false, `${type} declara samples/imuSamples`);
    assert.ok(/^\s*gps\??:/m.test(body), `${type} tem gps`);
  }
});
