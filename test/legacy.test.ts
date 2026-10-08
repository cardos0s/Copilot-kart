/**
 * Conversão do formato antigo (T42): TF-17 (voltas em frames `legacy` com fix
 * `unknown`, sintéticos viram cruzamentos, ponto compartilhado vira um frame só),
 * TF-19 (traçado) e TF-20 AC 9 (JSON ilegível não derruba a sessão). As voltas são
 * conferidas pela leitura (`lapFrames`) contra as amostras antigas, na visão antiga
 * (`t` absoluto e só as chaves de antes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { G, type GpsFrame, type ImuFrame, type SeriesMeta } from '../src/telemetry/frame';
import { lapFrames } from '../src/telemetry/laps';
import {
  convertJournal,
  convertLayout,
  convertReference,
  convertSessionLaps,
  type LegacyLapRow,
} from '../src/telemetry/legacy';
import { gpsSeriesOf, imuSeriesOf } from '../src/telemetry/series';

const T0 = 1_790_000_000_000;

type OldPoint = {
  t: number;
  lat: number;
  lng: number;
  speed: number;
  accuracy: number;
  heading?: number;
  altitude?: number;
  synthetic?: true;
};
type OldImu = { t: number; accel: { x: number; y: number; z: number }; gyro: { x: number; y: number; z: number } };

const point = (t: number, i: number, extra: Partial<OldPoint> = {}): OldPoint => ({
  t,
  lat: -25.4 + i * 1e-5,
  lng: -49.2 - i * 1e-5,
  speed: 10 + (i % 7),
  accuracy: 3 + (i % 4),
  heading: (i * 13) % 360,
  ...extra,
});

const imuAt = (t: number): OldImu => ({ t, accel: { x: 0.1, y: -0.2, z: 1 }, gyro: { x: 0, y: 0.01, z: t / 1e9 } });

/** A volta com pontos sintéticos nas pontas (AD-006): `[sintético, 8 crus, sintético]`. */
function syntheticLap(startT: number, firstIdx: number): OldPoint[] {
  const inner = Array.from({ length: 8 }, (_, k) => point(startT + 50 + k * 100, firstIdx + k));
  // O ponto de fronteira do `boundaryPoint` antigo: só t, lat, lng, speed e accuracy.
  const edge = (t: number, i: number): OldPoint => {
    const { lat, lng, speed, accuracy } = point(t, i);
    return { t, lat, lng, speed, accuracy, synthetic: true };
  };
  return [edge(startT, firstIdx - 0.5), ...inner, edge(startT + 850, firstIdx + 7.5)];
}

function lapRow(id: string, startedAt: number, samples: unknown, imu?: unknown): LegacyLapRow {
  return {
    id,
    started_at: startedAt,
    samples_json: typeof samples === 'string' ? samples : JSON.stringify(samples),
    imu_samples_json: imu === undefined ? null : JSON.stringify(imu),
  };
}

/** Visão antiga de um frame: `t` absoluto, sem `kind`/`source`/`fix`/`legacy`. */
function oldView(f: GpsFrame, t0: number): OldPoint {
  const p: OldPoint = { t: t0 + f.t, lat: f.lat, lng: f.lng, speed: f.speed, accuracy: f.accuracy! };
  if (f.heading !== undefined) p.heading = f.heading;
  if (f.altitude !== undefined) p.altitude = f.altitude;
  if (f.synthetic) p.synthetic = true;
  return p;
}

const meta = (kind: 'gps' | 'imu', t0Utc: number | null): SeriesMeta => ({
  id: `s_${kind}`,
  owner: { kind: 'session', id: 's' },
  source: 'PHONE',
  kind,
  t0Utc,
  legacy: true,
});

function read(conv: { gps: GpsFrame[]; imu?: ImuFrame[] }, t0Utc: number | null) {
  const gps = gpsSeriesOf(meta('gps', t0Utc), conv.gps);
  const imu = imuSeriesOf(meta('imu', t0Utc), conv.imu ?? []);
  return (window: Parameters<typeof lapFrames>[0]) => lapFrames(window, gps, imu);
}

test('legado (TF-17): 3 voltas com pontos sintéticos viram uma série só e 3 janelas por cruzamento, e cada janela devolve as amostras antigas', () => {
  const laps = [syntheticLap(T0 + 1000, 10), syntheticLap(T0 + 1850, 20), syntheticLap(T0 + 2700, 30)];
  // A fronteira é a mesma linha: o fim de uma volta é o início da seguinte.
  laps[1][0] = { ...laps[0][laps[0].length - 1] };
  laps[2][0] = { ...laps[1][laps[1].length - 1] };
  // IMU com a leitura do instante da fronteira nas duas voltas, como o recorte antigo fazia.
  const imu = laps.map((l) => {
    const out: OldImu[] = [];
    for (let t = l[0].t; t <= l[l.length - 1].t; t += 25) out.push(imuAt(t));
    return out;
  });
  const rows = [lapRow('lap_3', T0 + 2700, laps[2], imu[2]), lapRow('lap_1', T0 + 1000, laps[0], imu[0]), lapRow('lap_2', T0 + 1850, laps[1], imu[1])];

  const conv = convertSessionLaps(rows);

  assert.equal(conv.t0Utc, T0 + 1000);
  assert.deepEqual(conv.skipped, []);
  // Uma série: só os pontos crus (8 por volta); os sintéticos são os cruzamentos.
  assert.equal(conv.gps.length, 24);
  assert.ok(conv.gps.every((f) => f.legacy === true && f.fix === 'unknown' && f.synthetic === undefined && f.source === 'PHONE'));
  assert.deepEqual([...conv.windows.keys()], ['lap_1', 'lap_2', 'lap_3']);
  const at = read(conv, conv.t0Utc);
  laps.forEach((old, k) => {
    const w = conv.windows.get(`lap_${k + 1}`)!;
    assert.equal(w.kind, 'cross');
    if (w.kind !== 'cross') return;
    assert.deepEqual(w.start, { t: old[0].t - T0 - 1000, lat: old[0].lat, lng: old[0].lng, speed: old[0].speed, accuracy: old[0].accuracy });
    const frames = at(w);
    assert.deepEqual(frames.gps.map((f) => oldView(f, conv.t0Utc!)), old, `volta ${k + 1}`);
    // A IMU da janela é a antiga, com o acelerômetro de g para m/s².
    assert.deepEqual(
      frames.imu.map((f) => ({ t: conv.t0Utc! + f.t, accel: f.accel, gyro: f.gyro })),
      imu[k].map((s) => ({ t: s.t, accel: { x: s.accel.x * G, y: s.accel.y * G, z: s.accel.z * G }, gyro: s.gyro })),
      `IMU da volta ${k + 1}`
    );
  });
  // A leitura da fronteira, repetida nas duas voltas, é um frame só na série.
  const imuTotal = imu.reduce((n, l) => n + l.length, 0);
  assert.equal(conv.imu.length, imuTotal - 2);
  assert.ok(conv.imu.every((f) => f.legacy === true));
});

test('legado (TF-17 AC 3): voltas sem ponto sintético com um ponto compartilhado na fronteira geram um frame só para ele, e as janelas por índice devolvem as amostras antigas', () => {
  const pts = Array.from({ length: 11 }, (_, i) => point(T0 + 5000 + i * 100, i));
  const lap1 = pts.slice(0, 6);
  const lap2 = pts.slice(5).map((p) => ({ ...p }));
  // Mesmo `t` da fronteira, posição diferente: não é duplicata.
  const lap3 = [{ ...pts[10], lat: pts[10].lat + 1e-5 }, point(T0 + 6100, 11), point(T0 + 6200, 12)];

  const conv = convertSessionLaps([lapRow('a', 1, lap1), lapRow('b', 2, lap2), lapRow('c', 3, lap3)]);

  assert.equal(conv.t0Utc, T0 + 5000);
  assert.equal(conv.gps.length, 11 + 3);
  assert.deepEqual(conv.windows.get('a'), { kind: 'index', from: 0, to: 5 });
  assert.deepEqual(conv.windows.get('b'), { kind: 'index', from: 5, to: 10 });
  assert.deepEqual(conv.windows.get('c'), { kind: 'index', from: 11, to: 13 });
  const at = read(conv, conv.t0Utc);
  for (const [id, old] of [['a', lap1], ['b', lap2], ['c', lap3]] as const) {
    assert.deepEqual(at(conv.windows.get(id)!).gps.map((f) => oldView(f, conv.t0Utc!)), old, id);
  }
});

test('legado: uma volta com todos os t iguais (degenerada) mantém todos os pontos, inclusive os repetidos', () => {
  const lap = Array.from({ length: 6 }, (_, i) => point(0, i));
  lap[3] = { ...lap[2] }; // dois pontos idênticos dentro da volta
  const conv = convertSessionLaps([lapRow('deg', T0, lap)]);

  assert.equal(conv.t0Utc, 0);
  assert.equal(conv.gps.length, 6);
  assert.deepEqual(conv.windows.get('deg'), { kind: 'index', from: 0, to: 5 });
  assert.deepEqual(read(conv, 0)(conv.windows.get('deg')!).gps.map((f) => oldView(f, 0)), lap);
});

test('legado (TF-20 AC 9): um JSON ilegível vai para skipped com a janela none, e as outras voltas convertem', () => {
  const good = syntheticLap(T0, 0);
  const rows = [
    lapRow('ok_1', 1, good),
    lapRow('broken', 2, '[{"t":1790000000900,"lat":-25.4,'),
    lapRow('not_points', 3, '{"t":1}'),
    lapRow('ok_2', 4, syntheticLap(T0 + 850, 10)),
  ];
  const conv = convertSessionLaps(rows);

  assert.deepEqual(conv.skipped, ['broken', 'not_points']);
  assert.deepEqual(conv.windows.get('broken'), { kind: 'none' });
  assert.deepEqual(conv.windows.get('not_points'), { kind: 'none' });
  assert.equal(conv.windows.get('ok_1')!.kind, 'cross');
  assert.equal(conv.windows.get('ok_2')!.kind, 'cross');
  assert.equal(conv.gps.length, 16);
  const at = read(conv, conv.t0Utc);
  assert.deepEqual(at(conv.windows.get('ok_1')!).gps.map((f) => oldView(f, conv.t0Utc!)), good);
  assert.deepEqual(at({ kind: 'none' }), { gps: [], imu: [] });

  // A IMU ilegível não leva a volta junto: ela converte sem IMU.
  const imuBroken = convertSessionLaps([{ ...lapRow('x', 1, good), imu_samples_json: 'nada' }]);
  assert.deepEqual(imuBroken.imuSkipped, ['x']);
  assert.deepEqual(imuBroken.skipped, []);
  assert.equal(imuBroken.windows.get('x')!.kind, 'cross');
  assert.deepEqual(imuBroken.imu, []);
});

test('legado: um diário v4 pendente vira séries com os mesmos pontos, no relógio do início da gravação', () => {
  const startedAt = T0 + 10_000;
  const gps = Array.from({ length: 30 }, (_, i) => point(startedAt + 200 + i * 100, i));
  const imu = Array.from({ length: 60 }, (_, i) => imuAt(startedAt + 210 + i * 50));
  const chunks = [
    { gps_json: JSON.stringify(gps.slice(0, 12)), imu_json: JSON.stringify(imu.slice(0, 25)) },
    { gps_json: JSON.stringify(gps.slice(12)), imu_json: JSON.stringify(imu.slice(25)) },
  ];

  const conv = convertJournal(startedAt, chunks);

  assert.equal(conv.t0Utc, startedAt);
  assert.equal(conv.skipped, 0);
  assert.deepEqual(conv.gps.map((f) => oldView(f, startedAt)), gps);
  assert.ok(conv.gps.every((f) => f.legacy === true && f.fix === 'unknown'));
  assert.deepEqual(
    conv.imu.map((f) => ({ t: startedAt + f.t, accel: f.accel, gyro: f.gyro })),
    imu.map((s) => ({ t: s.t, accel: { x: s.accel.x * G, y: s.accel.y * G, z: s.accel.z * G }, gyro: s.gyro }))
  );

  const broken = convertJournal(startedAt, [chunks[0], { gps_json: '[', imu_json: '[]' }]);
  assert.equal(broken.skipped, 1);
  assert.equal(broken.gps.length, 12);
});

test('legado (TF-19): o traçado vira frames com o t como foi gravado e a janela da volta de origem; a referência perde só os sintéticos', () => {
  const old = syntheticLap(T0 + 3000, 40);
  const layout = convertLayout(JSON.stringify(old));
  assert.equal(layout.skipped, false);
  assert.equal(layout.window.kind, 'cross');
  assert.equal(layout.gps.length, 8);
  assert.deepEqual(read(layout, null)(layout.window).gps.map((f) => oldView(f, 0)), old);

  const pre = Array.from({ length: 5 }, (_, i) => point(T0 + i * 100, i));
  const layoutPre = convertLayout(JSON.stringify(pre));
  assert.deepEqual(layoutPre.window, { kind: 'index', from: 0, to: 4 });
  assert.deepEqual(read(layoutPre, null)(layoutPre.window).gps.map((f) => oldView(f, 0)), pre);

  assert.deepEqual(convertLayout('xx'), { gps: [], window: { kind: 'none' }, skipped: true });

  const ref = convertReference(JSON.stringify(old));
  assert.equal(ref.skipped, false);
  assert.deepEqual(ref.gps.map((f) => oldView(f, 0)), old.slice(1, -1));
});
