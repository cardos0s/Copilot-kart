/**
 * Invariante estática de `src/storage/db.ts`, lendo o fonte: "ATUALIZAR
 * REFERÊNCIA" grava o traçado novo, torna-o padrão e grava o PB herdado numa
 * transação só (Assumptions de 30/09 e 03/10).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'src', 'storage', 'db.ts'), 'utf8');

/** O corpo de `promoteReferenceLayout`, até a próxima declaração de topo. */
function promoteBody(): string {
  const m = /export async function promoteReferenceLayout\(([\s\S]*?)\n\}\n/.exec(SRC);
  assert.ok(m, 'db.ts exporta promoteReferenceLayout');
  return m[1];
}

test('promoteReferenceLayout: traçado, padrão e PB dentro de withExclusiveTransactionAsync, todos pelo txn', () => {
  const body = promoteBody();
  assert.ok(/^\s*layout:\s*TrackLayout,\s*pb:\s*PbRecord\s*\|\s*null\s*\)/.test(body), '(layout: TrackLayout, pb: PbRecord | null)');

  const tx = /\.withExclusiveTransactionAsync\(\s*async\s*\(txn\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/.exec(body);
  assert.ok(tx, 'usa withExclusiveTransactionAsync');
  const inside = tx[1];
  assert.ok(inside.includes('await saveLayoutOn(txn, layout);'));
  // O padrão é o traçado novo, não outro.
  assert.ok(inside.includes('await setDefaultLayoutOn(txn, layout.trackId, layout.id);'));
  assert.ok(/if\s*\(pb\)\s*await savePbRecordOn\(txn, pb\);/.test(inside));
  // Nenhuma escrita pela conexão principal, que ficaria fora da transação.
  assert.equal(/await (saveLayout|setDefaultLayout|savePbRecord)\(/.test(body), false);
});
