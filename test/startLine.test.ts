/**
 * Linha de chegada: TMP-01 AC 1 (instante interpolado), TMP-03 AC 5 e 6
 * (passar perto e contramão), TMP-04 (de onde vem a linha) e os edge cases
 * do traçado curto e do buraco de 2 s.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeLocalProjector } from '../src/lib/geometry';
import type { GpsFrame } from '../src/telemetry/frame';
import { crossing, lineFromLayout, lineFromMotion, type StartLine } from '../src/lib/startLine';

const LINE: StartLine = { lat: -14.8619, lng: -40.8444, headingDeg: 0 };
const proj = makeLocalProjector(LINE);

/** Ponto a `x` m a leste e `y` m ao norte do ponto da linha. */
function at(x: number, y: number, t: number, speed = 10): GpsFrame {
  return { kind: 'gps', source: 'PHONE', fix: 'unknown', ...proj.toLatLng({ x, y }), t, speed, accuracy: 4 };
}

/** Rumo inicial ortodrômico, em graus, independente do plano local. */
function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x =
    Math.cos(a.lat * r) * Math.sin(b.lat * r) -
    Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

test('crossing: par que atravessa no sentido da linha dá t = t_a + f·(t_b − t_a) com f = 0,25', () => {
  // 3 m antes da linha e 9 m depois: f = 3 / 12 = 0,25.
  const a = at(0, -3, 10_000, 10);
  const b = at(0, 9, 10_100, 14);
  const c = crossing(a, b, LINE);
  assert.ok(c, 'devia cruzar');
  assert.ok(Math.abs(c.f - 0.25) < 1e-9, `f = ${c.f}`);
  assert.ok(Math.abs(c.t - 10_025) < 1e-6, `t = ${c.t}`);
  assert.ok(Math.abs(c.speed - 11) < 1e-9, `speed = ${c.speed}`);
  // O ponto interpolado fica na linha.
  const onLine = proj.toXY(c);
  assert.ok(Math.abs(onLine.y) < 1e-6 && Math.abs(onLine.x) < 1e-6);
});

test('crossing: o mesmo par na contramão devolve null', () => {
  const a = at(0, -3, 10_000);
  const b = at(0, 9, 10_100);
  assert.equal(crossing({ ...b, t: 10_000 }, { ...a, t: 10_100 }, LINE), null);
});

test('crossing: passar a 16 m do ponto (fora da meia-largura de 15 m) devolve null; a 14 m cruza', () => {
  assert.equal(crossing(at(16, -3, 0), at(16, 9, 100), LINE), null);
  assert.equal(crossing(at(-16, -3, 0), at(-16, 9, 100), LINE), null);
  const c = crossing(at(14, -3, 0), at(14, 9, 100), LINE);
  assert.ok(c, 'a 14 m devia cruzar');
  assert.ok(Math.abs(c.t - 25) < 1e-6);
});

test('crossing: chegar perto sem atravessar (os dois do mesmo lado) devolve null', () => {
  assert.equal(crossing(at(0, -6, 0), at(0, -0.5, 100), LINE), null);
  assert.equal(crossing(at(0, 0.5, 0), at(0, 6, 100), LINE), null);
});

test('crossing: buraco de 2001 ms entre os dois pontos devolve null; 2000 ms cruza', () => {
  assert.equal(crossing(at(0, -3, 0), at(0, 9, 2001), LINE), null);
  const c = crossing(at(0, -3, 0), at(0, 9, 2000), LINE);
  assert.ok(c, 'com 2000 ms devia cruzar');
  assert.ok(Math.abs(c.t - 500) < 1e-6);
});

test('lineFromLayout: 4 pontos ou comprimento zero devolve null', () => {
  const four = [at(0, 0, 0), at(0, 10, 1), at(0, 20, 2), at(0, 30, 3)];
  assert.equal(lineFromLayout(four), null);
  const still = Array.from({ length: 8 }, (_, i) => at(0, 0, i));
  assert.equal(lineFromLayout(still), null);
});

test('lineFromLayout: o ponto é o 1º do traçado e o rumo aponta para o 1º ponto a 5 m ou mais (± 1°)', () => {
  // Os dois primeiros ficam a menos de 5 m e apontam para 45°; o 1º a 5 m ou
  // mais aponta para ~80,5°.
  const layout = [at(0, 0, 0), at(1, 1, 1), at(3, 3, 2), at(6, 1, 3), at(20, 20, 4), at(40, 20, 5)];
  const line = lineFromLayout(layout);
  assert.ok(line);
  assert.equal(line.lat, layout[0].lat);
  assert.equal(line.lng, layout[0].lng);
  const expected = bearing(layout[0], layout[3]);
  assert.ok(Math.abs(line.headingDeg - expected) <= 1, `rumo ${line.headingDeg}, esperado ${expected}`);
});

test('lineFromMotion: o ponto é onde o ritmo começou e o rumo aponta para o 1º ponto a 5 m ou mais', () => {
  const samples = [at(0, -40, 0), at(0, -20, 1), at(0, 0, 2), at(-2, 2, 3), at(-4, 5, 4), at(-10, 10, 5)];
  const line = lineFromMotion(samples, 2);
  assert.equal(line.lat, samples[2].lat);
  assert.equal(line.lng, samples[2].lng);
  const expected = bearing(samples[2], samples[4]);
  assert.ok(Math.abs(line.headingDeg - expected) <= 1, `rumo ${line.headingDeg}, esperado ${expected}`);
});
