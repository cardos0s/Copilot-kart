/**
 * Captura do golden da telemetry-frame (TF-14, TF-15; design §10).
 *
 * Roda o pipeline ATUAL sobre as sessões de referência (`test/golden/sessions.ts`)
 * pelo harness (`test/golden/harness.ts`) e grava `test/golden/expected.json`.
 * Roda uma vez, antes da reescrita; depois disso nenhuma tarefa muda o arquivo.
 *
 *   node --import tsx scripts/golden-capture.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGolden, toJson } from '../test/golden/harness';

(async () => {
  const out = toJson(await runGolden());
  const file = join(__dirname, '..', 'test', 'golden', 'expected.json');
  writeFileSync(file, JSON.stringify(out) + '\n');
  console.log(`golden gravado em ${file}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
