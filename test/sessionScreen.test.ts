/**
 * Invariantes estáticas de `app/session/[id].tsx`, lendo o fonte:
 * TMP-07 AC 3 e TMP-09 (S1/S2/S3 pela régua única, contra o traçado ou a
 * melhor volta) e TMP-11 AC 3/4 (pico p99, "—" quando não há ponto bom).
 * Desde a T36 (TF-13, TF-23, TF-24): a tela lê `LapRecord.gps` e os frames do traçado
 * por `layoutGps`, e mostra o selo de fonte e qualidade no cabeçalho.
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

test('sessão: os setores são medidos sobre os pontos salvos (sectorLapSamples), sem cleanSamples', () => {
  assert.ok(importsFrom('../../src/lib/sectors').includes('sectorLapSamples'));
  // Os pontos dos setores são os salvos, só com o reparo de timestamp.
  assert.ok(
    /savedSamples\[l\.id\]\s*=\s*sectorLapSamples\(\s*l\s*\)\s*;/.test(SRC),
    'savedSamples[l.id] = sectorLapSamples(l)',
  );
  assert.equal(/sectorLapSamples\([^;]*cleanSamples/.test(SRC), false, 'nenhum cleanSamples no argumento');
  // E o laço percorre as voltas como vieram do banco (lapsRaw), não as já
  // limpas por cleanSamples (cleanedLaps).
  assert.ok(
    /for\s*\(\s*const\s+l\s+of\s+lapsRaw\s*\)\s*\{\s*savedSamples\[l\.id\]\s*=\s*sectorLapSamples\(\s*l\s*\)\s*;\s*\}/.test(SRC),
    'for (const l of lapsRaw) { savedSamples[l.id] = sectorLapSamples(l); }',
  );
  assert.ok(/setSectorSamples\(\s*savedSamples\s*\)/.test(SRC));
  // T36: a linha `savedSamples[l.id] = sectorLapSamples(l);` não mudou (o
  // `sectorLapSamples` lê `lap.gps` desde a T28); o que mudou é o tipo dos pontos.
  assert.ok(/const savedSamples: Record<string, GpsFrame\[\]> = \{\};/.test(SRC));
  assert.ok(/useState<Record<string, GpsFrame\[\]>>\(\{\}\)/.test(SRC));
  // É sobre esses pontos que sectorSplits mede a volta selecionada.
  assert.ok(/sectorSplits\(\s*sectorSamples\[selected\.id\]/.test(SRC));
});

test('sessão: o pico não sai mais de laço de máximo bruto nem vira 0 quando é null', () => {
  // O laço antigo do marcador do mapa: `if (x.speed > peakSpeed) peakSpeed = x.speed`.
  assert.equal(/\.speed\s*>\s*peakSpeed\b/.test(SRC), false);
  // T36: substitui `peakSpeed = selected.samples[i].speed`, valendo também para `.gps`.
  assert.equal(/peakSpeed\s*=\s*selected\.(samples|gps)\[i\]\.speed/.test(SRC), false);
  // Nenhuma ponte `?? 0` sobre o pico: null chega à UI como "—".
  assert.equal(/peakSpeed(Ms|Kmh)\([^)]*\)\s*\?\?\s*0/.test(SRC), false);
  assert.ok(/km\/h máx/.test(SRC));
  assert.ok(/PeakKmh\s*!==\s*null\s*\?[^:]*:\s*'—'/.test(SRC), 'o pico null vira "—" no painel');
});

test('sessão: o ponto de frenagem B sai de hardestBraking, sem o laço inline (TF-14, T1)', () => {
  assert.ok(importsFrom('../../src/lib/brakingPoint').includes('hardestBraking'));
  // T36: substitui `hardestBraking(selected.samples)`.
  assert.ok(/hardestBraking\(\s*selected\.gps\s*\)/.test(SRC));
  // O laço antigo: `let maxDecel`, `const decel = -dv / dt` e o `brakeIdx`.
  assert.equal(/\bmaxDecel\b/.test(SRC), false);
  assert.equal(/-dv\s*\/\s*dt/.test(SRC), false);
  assert.equal(/\bbrakeIdx\b/.test(SRC), false);
});

test('sessão: a faixa de cor por velocidade sai de speedColorRange, sem percentil local (TF-14, T3)', () => {
  assert.ok(importsFrom('../../src/lib/speedRange').includes('speedColorRange'));
  // T36: substitui `speedColorRange(selected.samples)`.
  assert.ok(/const\s*\{\s*minS,\s*maxS\s*\}\s*=\s*speedColorRange\(\s*selected\.gps\s*\)/.test(SRC));
  assert.equal(/function\s+percentile\b/.test(SRC), false);
  assert.equal(SRC.includes('percentile('), false);
});

test('sessão (T36): lê frames — nenhum GpsSample e nenhuma leitura de .samples da volta ou do traçado', () => {
  assert.equal(/\bGpsSample\b/.test(SRC), false);
  assert.equal(/\b(l|lap|selected|sessionBest|ref|reference!?)\??\.samples\b/.test(SRC), false);
  assert.ok(importsFrom('../../src/storage/layoutRepo').includes('layoutGps'));
});

test('sessão (T36): mantém os caminhos de limpeza — cleanSamples + reparo na análise, só reparo no traçado', () => {
  // Análise (era a linha 238): cada volta passa pelo cleanSamples de 10 m e depois pelo reparo.
  assert.ok(
    /const cleaned = cleanSamples\(l\.gps, 10\);\s*const \{ samples: repairedSamples, repaired \} = repairDegenerateTimestamps\(\s*cleaned,\s*l\.durationMs,\s*l\.startedAt,?\s*\)/.test(SRC),
    'cleanSamples(l.gps, 10) e repairDegenerateTimestamps(cleaned, …)',
  );
  // Traçado (era a linha 248): só o reparo, sobre os frames do traçado, sem cleanSamples.
  assert.ok(/repairDegenerateTimestamps\(\s*layoutGps\(ref\),\s*ref\.durationMs,?\s*\)/.test(SRC));
  assert.equal(/cleanSamples\(\s*layoutGps\(/.test(SRC), false, 'o traçado não passa por cleanSamples');
  assert.equal(SRC.match(/cleanSamples\(/g)?.length, 1, 'um único cleanSamples, o da análise');
  // O traçado reparado troca os frames que layoutGps devolve.
  assert.ok(SRC.includes('ref = { ...ref, gps: repairedRefSamples, samples: repairedRefSamples };'));
});

test('sessão (T36): o selo sai de sessionBadge/badgeText sobre as voltas do banco e, sem volta, sobre a série GPS da sessão', () => {
  const badge = importsFrom('../../src/telemetry/badge');
  for (const name of ['sessionBadge', 'badgeText', 'badgeSource']) assert.ok(badge.includes(name), name);
  // As voltas como vieram do banco (lapsRaw), não as limpas pela análise.
  assert.ok(/const lapsGps = lapsRaw\.map\(\(l\) => l\.gps\);/.test(SRC));
  // TF-24 AC 4: sem volta, todos os frames de GPS da sessão.
  assert.ok(/const allGps = lapsRaw\.length > 0 \? \[\] : await loadSessionGps\(await appSqlConn\(\), id\);/.test(SRC));
  assert.ok(/const source = badgeSource\(lapsRaw\.length > 0 \? lapsGps\.flat\(\) : allGps\);/.test(SRC));
  assert.ok(/const badge = source \? sessionBadge\(source, lapsGps, allGps\) : null;/.test(SRC));
  assert.ok(/setBadgeLabel\(badge \? badgeText\(badge\) : null\);/.test(SRC));
});

test('sessão (T36): o selo é uma linha de texto secundário do tema sob o cabeçalho, em todas as telas da sessão', () => {
  const line = '{badgeLabel && <Text style={s.badgeLine}>{badgeLabel}</Text>}';
  // Sem volta, poucos pontos, erro e a análise: as quatro saídas com cabeçalho da sessão.
  assert.equal(SRC.split(line).length - 1, 4);
  const style = SRC.match(/badgeLine: \{([^}]*)\}/);
  assert.ok(style, 'estilo badgeLine');
  assert.ok(style[1].includes('color: colors.textSecondary'));
});
