/**
 * Modelo de frames: catálogo de unidades e recusa de unidade fora dele
 * (TF-21 AC 2 e AC 3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertUnit, UnitError } from '../src/telemetry/frame';

test("assertUnit('RPM', 'rpm') devolve 'rpm'", () => {
  assert.equal(assertUnit('RPM', 'rpm'), 'rpm');
});

test("assertUnit('BRK', 'bar') lança UnitError que nomeia o canal e a unidade", () => {
  let caught: unknown;
  try {
    assertUnit('BRK', 'bar');
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof UnitError, 'esperava UnitError');
  assert.equal(caught.channel, 'BRK');
  assert.equal(caught.unit, 'bar');
  assert.match(caught.message, /BRK/);
  assert.match(caught.message, /bar/);
});

test('cada unidade do catálogo é aceita', () => {
  const catalog = ['deg', 'm', 'm/s', 'm/s²', 'rad/s', 'Pa', 'V', 'A', '°C', 'rpm', '%', 'ms', '1'];
  for (const unit of catalog) assert.equal(assertUnit('CH', unit), unit);
});

test('unidades do logger fora do catálogo são recusadas (g, deg/s, km/h, mV)', () => {
  for (const unit of ['g', 'deg/s', 'km/h', 'mV']) {
    assert.throws(() => assertUnit('CH', unit), UnitError);
  }
});
