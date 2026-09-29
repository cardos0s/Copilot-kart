/**
 * Invariantes estáticas de `app/session/[id].tsx`, lendo o fonte:
 * TMP-07 AC 3 e TMP-09 (S1/S2/S3 pela régua única, contra o traçado ou a
 * melhor volta) e TMP-11 AC 3/4 (pico p99, "—" quando não há ponto bom).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'app', 'session', '[id].tsx'), 'utf8');

function importsFrom(module: string): string[] {
  const m = SRC.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${module.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`));
  return m ? m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '')) : [];
}

test('sessão: não define groupThirds e importa sectorSplits', () => {
  assert.equal(/function\s+groupThirds\b/.test(SRC), false);
  assert.equal(SRC.includes('groupThirds('), false);
  assert.ok(importsFrom('../../src/lib/sectors').includes('sectorSplits'));
});

test('sessão: a régua vem do traçado da sessão e, sem ele, da melhor volta', () => {
  const sectors = importsFrom('../../src/lib/sectors');
  assert.ok(sectors.includes('referenceFromLayout'));
  assert.ok(sectors.includes('referenceFromLap'));
  assert.ok(SRC.includes('getLayout(ses.layoutId)'));
});

test('sessão: o pico não sai mais de laço de máximo bruto nem vira 0 quando é null', () => {
  // O laço antigo do marcador do mapa: `if (x.speed > peakSpeed) peakSpeed = x.speed`.
  assert.equal(/\.speed\s*>\s*peakSpeed\b/.test(SRC), false);
  assert.equal(/peakSpeed\s*=\s*selected\.samples\[i\]\.speed/.test(SRC), false);
  // Nenhuma ponte `?? 0` sobre o pico: null chega à UI como "—".
  assert.equal(/peakSpeed(Ms|Kmh)\([^)]*\)\s*\?\?\s*0/.test(SRC), false);
  assert.ok(/km\/h máx/.test(SRC));
  assert.ok(/PeakKmh\s*!==\s*null\s*\?[^:]*:\s*'—'/.test(SRC), 'o pico null vira "—" no painel');
});
