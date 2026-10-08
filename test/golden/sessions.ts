/**
 * Sessões de referência da comparação de referência (TF-14, design §10), como
 * entradas BRUTAS: o que o GPS e a IMU entregam, e o que o banco antigo guarda.
 * Nada aqui roda o pipeline do app. Tudo é determinístico: o ruído sai de um
 * gerador com semente, e não há Date.now nem Math.random.
 *
 * 1. `session1()`: pista sintética a 10 Hz, base epoch 1,79e12. Paddock, volta de
 *    saída com espera na fila (passa de 180 s e não conta), 6 voltas e box.
 *    Fixes acima de 30 m, um trecho com timestamp quantizado (e alguns zerados),
 *    e IMU a 50 Hz (acelerômetro e giroscópio em eventos separados) com um
 *    trompo na volta 4.
 * 2. `session2()`: o `DEMO_LAP` (5 Hz, 3 voltas) em lotes de fix, com precisão
 *    variando entre 3 e 12 m.
 * 3. `session3()`: o traçado salvo a partir da melhor volta da sessão 1.
 * 4. `session4()`: uma volta legada, com todos os timestamps zerados.
 *
 * SPEC_DEVIATION: a design pede "pista circular". A sessão 1 usa um retângulo de
 * cantos arredondados (4 curvas de 90°, raio 15 m).
 * Reason: o círculo de 120 m do `syntheticTrack.ts` tem curvatura de 0,008 rad/m,
 * abaixo do limiar de 0,04 rad/m do `detectCorners`. Com ele, nenhuma curva seria
 * detectada e a análise de curvas, o insight da volta e o Pilot DNA sairiam vazios
 * no golden.
 */
import type { LapRecord } from '../../src/lib/analysis';
import { polylineLength } from '../../src/lib/geometry';
import type { GpsFrame } from '../../src/telemetry/frame';
import type { LocationLike } from '../../src/recording/locationHandler';
import type { TrackLayout } from '../../src/storage/db';
import { DEMO_LAP } from '../../src/data/demoLap';

/** Base epoch das sessões gravadas (≈ 2026-09). */
export const T0 = 1_790_000_000_000;

export type LocationBatch = {
  /** Instante em que o lote chega à tarefa de localização (`deps.now()`). */
  arrivalAt: number;
  locations: LocationLike[];
};

/** Um evento do expo-sensors, como chega ao listener, com o instante de chegada. */
export type ImuEvent = {
  kind: 'accel' | 'gyro';
  at: number;
  x: number;
  y: number;
  z: number;
};

export type RecordedSessionInput = {
  /** Instante do início da gravação. */
  t0: number;
  batches: LocationBatch[];
  imuEvents: ImuEvent[];
};

export type Session1 = RecordedSessionInput & {
  /** Fronteiras das fases, em epoch ms (tempo real, não o timestamp entregue). */
  phases: {
    paddockEnd: number;
    queueStart: number;
    queueEnd: number;
    boxStart: number;
    end: number;
  };
  /** Ponto em que o kart fica parado no box. */
  boxPoint: { lat: number; lng: number };
};

// ---------------------------------------------------------------------------
// Ruído determinístico
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Pista: retângulo 130 × 50 m de retas, cantos de raio 15 m, sentido anti-horário.
// s = 0 no meio da reta de baixo, apontando para leste.
// ---------------------------------------------------------------------------

const BASE_LAT = -14.8619;
const BASE_LNG = -40.8444;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((BASE_LAT * Math.PI) / 180);
const R = 15;
const ARC = (Math.PI / 2) * R;

type Seg =
  | { kind: 'line'; len: number; x0: number; y0: number; hx: number; hy: number }
  | { kind: 'arc'; len: number; cx: number; cy: number; a0: number };

const SEGS: Seg[] = [
  { kind: 'line', len: 65, x0: 0, y0: 0, hx: 1, hy: 0 },
  { kind: 'arc', len: ARC, cx: 65, cy: 15, a0: -Math.PI / 2 },
  { kind: 'line', len: 50, x0: 80, y0: 15, hx: 0, hy: 1 },
  { kind: 'arc', len: ARC, cx: 65, cy: 65, a0: 0 },
  { kind: 'line', len: 130, x0: 65, y0: 80, hx: -1, hy: 0 },
  { kind: 'arc', len: ARC, cx: -65, cy: 65, a0: Math.PI / 2 },
  { kind: 'line', len: 50, x0: -80, y0: 65, hx: 0, hy: -1 },
  { kind: 'arc', len: ARC, cx: -65, cy: 15, a0: Math.PI },
  { kind: 'line', len: 65, x0: -65, y0: 0, hx: 1, hy: 0 },
];

export const TRACK_LENGTH_M = SEGS.reduce((a, s) => a + s.len, 0);

/** [início, fim] de cada curva, em metros desde a linha. */
const CORNERS: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  let s = 0;
  for (const seg of SEGS) {
    if (seg.kind === 'arc') out.push([s, s + seg.len]);
    s += seg.len;
  }
  return out;
})();

type TrackPoint = { x: number; y: number; headingDeg: number; curvature: number };

function trackAt(sAbs: number): TrackPoint {
  let s = ((sAbs % TRACK_LENGTH_M) + TRACK_LENGTH_M) % TRACK_LENGTH_M;
  for (const seg of SEGS) {
    if (s <= seg.len) {
      if (seg.kind === 'line') {
        return {
          x: seg.x0 + seg.hx * s,
          y: seg.y0 + seg.hy * s,
          headingDeg: (((Math.atan2(seg.hx, seg.hy) * 180) / Math.PI) + 360) % 360,
          curvature: 0,
        };
      }
      const a = seg.a0 + s / R;
      // Anti-horário: a direção do movimento é a tangente a +90° do raio.
      const hx = -Math.sin(a);
      const hy = Math.cos(a);
      return {
        x: seg.cx + R * Math.cos(a),
        y: seg.cy + R * Math.sin(a),
        headingDeg: (((Math.atan2(hx, hy) * 180) / Math.PI) + 360) % 360,
        curvature: 1 / R,
      };
    }
    s -= seg.len;
  }
  return trackAt(0);
}

function toLatLng(x: number, y: number): { lat: number; lng: number } {
  return { lat: BASE_LAT + y / M_PER_DEG_LAT, lng: BASE_LNG + x / M_PER_DEG_LNG };
}

// ---------------------------------------------------------------------------
// Dinâmica: perfil de velocidade por posição e integração a 10 ms.
// ---------------------------------------------------------------------------

type Profile = {
  vmax: number;
  /** Velocidade em cada uma das 4 curvas. */
  corners: number[];
  brake: number;
  accel: number;
};

const OUT_PROFILE: Profile = { vmax: 11, corners: [7, 7, 7, 7], brake: 5, accel: 2 };
const IN_PROFILE: Profile = { vmax: 9, corners: [6, 6, 6, 6], brake: 4, accel: 2 };

/** Perfil de cada volta lançada (k = 0 é o resto da volta de saída). */
function raceProfile(k: number): Profile {
  return {
    vmax: 19 * (1 + 0.012 * Math.cos(k * 1.3)),
    corners: [0, 1, 2, 3].map((c) => 8.5 * (1 + 0.05 * Math.sin(k * 1.7 + c * 2.3))),
    brake: 8,
    accel: 3,
  };
}

/** Velocidade-alvo em `sAbs` pelo perfil (curvas, frenagem antes e retomada depois). */
function profileSpeed(sAbs: number, p: Profile): number {
  const s = ((sAbs % TRACK_LENGTH_M) + TRACK_LENGTH_M) % TRACK_LENGTH_M;
  let v = p.vmax;
  CORNERS.forEach(([c0, c1], i) => {
    const vc = p.corners[i];
    if (s >= c0 && s <= c1) v = Math.min(v, vc);
    const before = (((c0 - s) % TRACK_LENGTH_M) + TRACK_LENGTH_M) % TRACK_LENGTH_M;
    const after = (((s - c1) % TRACK_LENGTH_M) + TRACK_LENGTH_M) % TRACK_LENGTH_M;
    v = Math.min(v, Math.sqrt(vc * vc + 2 * p.brake * before), Math.sqrt(vc * vc + 2 * p.accel * after));
  });
  return v;
}

/** Estado amostrado a cada 10 ms. */
type State = { t: number; S: number; v: number; a: number; yawExtra: number };

const STEP_MS = 10;

const L = TRACK_LENGTH_M;
const S_START = -6;
const S_QUEUE = 0.45 * L;
const LAPS = 6;
const S_RACE_END = (LAPS + 1) * L;
const S_BOX = S_RACE_END + 0.6 * L;
const SPIN_LAP = 4;
const S_SPIN = SPIN_LAP * L + 200;
const SPIN_MS = 800;
const SPIN_YAW = 5.5; // rad/s ≈ 315°/s
const PADDOCK_MS = 20_000;
const QUEUE_MS = 170_000;
const BOX_MS = 15_000;

type Sim = {
  states: State[];
  phases: Session1['phases'];
};

let simCache: Sim | null = null;

/** Integra a sessão 1 inteira. Puro: o mesmo resultado em toda chamada. */
function simulate(): Sim {
  const states: State[] = [];
  let t = 0;
  let S = S_START;
  let v = 0;
  let spinStartT: number | null = null;
  const push = (a: number) => {
    let yawExtra = 0;
    if (spinStartT !== null && t >= spinStartT && t <= spinStartT + SPIN_MS) {
      const u = t - spinStartT;
      const ramp = Math.min(1, u / 100, (SPIN_MS - u) / 100);
      yawExtra = SPIN_YAW * Math.max(0, ramp);
    }
    states.push({ t, S, v, a, yawExtra });
  };

  const hold = (ms: number) => {
    const until = t + ms;
    while (t < until) {
      push(0);
      t += STEP_MS;
    }
  };

  /** Anda até `sStop` (parando lá, se `stop`), com o perfil de cada trecho. */
  const drive = (sEnd: number, profileFor: (S: number) => Profile, stop: boolean) => {
    while (S < sEnd - 0.02) {
      const p = profileFor(S);
      let target = profileSpeed(S, p);
      if (stop) target = Math.min(target, Math.sqrt(2 * p.brake * Math.max(0, sEnd - S)));
      // Trompo: o kart cai para 4 m/s no ponto do trompo e retoma dali.
      if (S < S_SPIN) target = Math.min(target, Math.sqrt(16 + 2 * 14 * (S_SPIN - S)));
      else if (S < S_SPIN + 3) target = Math.min(target, 4);
      if (spinStartT === null && S >= S_SPIN) spinStartT = t;
      const nv = target < v ? target : Math.min(target, v + (p.accel * STEP_MS) / 1000);
      const a = ((nv - v) * 1000) / STEP_MS;
      v = Math.max(0, nv);
      push(a);
      S += (v * STEP_MS) / 1000;
      t += STEP_MS;
      if (stop && sEnd - S < 0.05) break;
    }
    if (stop) {
      S = sEnd;
      v = 0;
    }
  };

  hold(PADDOCK_MS);
  const paddockEnd = t;
  drive(S_QUEUE, () => OUT_PROFILE, true);
  const queueStart = t;
  hold(QUEUE_MS);
  const queueEnd = t;
  drive(S_RACE_END, (s) => raceProfile(Math.floor(s / L)), false);
  drive(S_BOX, () => IN_PROFILE, true);
  const boxStart = t;
  hold(BOX_MS);
  const end = t;
  return { states, phases: { paddockEnd, queueStart, queueEnd, boxStart, end } };
}

function sim(): Sim {
  simCache ??= simulate();
  return simCache;
}

// ---------------------------------------------------------------------------
// Fixes do GPS da sessão 1
// ---------------------------------------------------------------------------

/** Fix como o sensor mediu: `at` é o instante real (epoch ms). */
type TrueFix = {
  at: number;
  lat: number;
  lng: number;
  speed: number | null;
  accuracy: number;
  heading: number | null;
  altitude: number;
  altitudeAccuracy: number;
};

const FIX_OFFSET_MS = 37; // os fixes caem em .037, .137, …: nunca em segundo cheio
const QUANTIZED_FIXES = 250;
const ZERO_TS_FIXES = [40, 41, 42, 43, 44];
/** Fixes com precisão acima de 30 m: 5 na partida fria e 2 na volta 2. */
const BAD_ACCURACY: Record<number, number> = { 3: 35, 7: 48, 11: 60, 15: 41, 19: 33 };
const NO_SPEED_FIXES = [25, 26];

function session1Fixes(): TrueFix[] {
  const { states } = sim();
  const rnd = mulberry32(219);
  const fixes: TrueFix[] = [];
  for (let k = 0; k * 10 < states.length; k++) {
    const st = states[k * 10];
    const tp = trackAt(st.S);
    const jx = (rnd() - 0.5) * 0.6;
    const jy = (rnd() - 0.5) * 0.6;
    const { lat, lng } = toLatLng(tp.x + jx, tp.y + jy);
    const moving = st.v > 1;
    let accuracy = 3 + rnd() * 2;
    const speedNoise = (rnd() - 0.5) * 0.3;
    const altNoise = (rnd() - 0.5) * 0.4;
    const speed = moving ? Math.max(0, st.v + speedNoise) : 0.2 + rnd() * 0.4;
    if (BAD_ACCURACY[k] !== undefined) accuracy = BAD_ACCURACY[k];
    fixes.push({
      at: T0 + FIX_OFFSET_MS + k * 100,
      lat,
      lng,
      speed: NO_SPEED_FIXES.includes(k) ? null : speed,
      accuracy,
      heading: moving ? tp.headingDeg : null,
      altitude: 870 + 2 * Math.sin((st.S / L) * 2 * Math.PI) + altNoise,
      altitudeAccuracy: 3,
    });
  }
  // Na volta 2, dois fixes acima de 30 m; nas voltas 3 e 5, trechos entre 12 e
  // 25 m (passam na captura e saem no corte de 10 m da análise).
  const lapStartFix = (lapS: number) => {
    const idx = states.findIndex((s) => s.S >= lapS);
    return Math.ceil(idx / 10);
  };
  const l2 = lapStartFix(2 * L + 100);
  fixes[l2].accuracy = 38;
  fixes[l2 + 7].accuracy = 52;
  for (const lapS of [3 * L + 300, 5 * L + 120]) {
    const i0 = lapStartFix(lapS);
    for (let j = 0; j < 6; j++) fixes[i0 + j].accuracy = 12 + j * 2.5;
  }
  return fixes;
}

/** O que a tarefa de localização recebe: timestamp quantizado (ou zero) no início. */
function deliveredTimestamp(k: number, at: number): number {
  if (ZERO_TS_FIXES.includes(k)) return 0;
  if (k < QUANTIZED_FIXES) return Math.floor(at / 1000) * 1000;
  return at;
}

function toBatches(fixes: TrueFix[], size: number, latencyMs: number, ts: (k: number, at: number) => number): LocationBatch[] {
  const batches: LocationBatch[] = [];
  for (let i = 0; i < fixes.length; i += size) {
    const chunk = fixes.slice(i, i + size);
    batches.push({
      arrivalAt: chunk[chunk.length - 1].at + latencyMs,
      locations: chunk.map((f, j) => ({
        timestamp: ts(i + j, f.at),
        coords: {
          latitude: f.lat,
          longitude: f.lng,
          speed: f.speed,
          accuracy: f.accuracy,
          heading: f.heading,
          altitude: f.altitude,
          altitudeAccuracy: f.altitudeAccuracy,
        },
      })),
    });
  }
  return batches;
}

function session1Imu(): ImuEvent[] {
  const { states } = sim();
  const rnd = mulberry32(5021);
  const out: ImuEvent[] = [];
  for (let k = 0; k * 2 < states.length; k++) {
    const st = states[k * 2];
    const tp = trackAt(st.S);
    const n = () => (rnd() - 0.5) * 0.04;
    const at = T0 + st.t;
    out.push({ kind: 'accel', at: at + 3, x: st.v * st.v * tp.curvature + n(), y: st.a + n(), z: 9.81 + n() });
    out.push({ kind: 'gyro', at: at + 7, x: n(), y: n(), z: st.v * tp.curvature + st.yawExtra + n() });
  }
  return out;
}

export function session1(): Session1 {
  const fixes = session1Fixes();
  const { phases } = sim();
  const box = trackAt(S_BOX);
  return {
    t0: T0,
    batches: toBatches(fixes, 5, 45, deliveredTimestamp),
    imuEvents: session1Imu(),
    phases: {
      paddockEnd: T0 + phases.paddockEnd,
      queueStart: T0 + phases.queueStart,
      queueEnd: T0 + phases.queueEnd,
      boxStart: T0 + phases.boxStart,
      end: T0 + phases.end,
    },
    boxPoint: toLatLng(box.x, box.y),
  };
}

// ---------------------------------------------------------------------------
// Sessão 2: DEMO_LAP em lotes de fix
// ---------------------------------------------------------------------------

const T0_DEMO = T0 + 10_000_000;
const DEMO_OFFSET_MS = 41;

export function session2(): RecordedSessionInput {
  const fixes: TrueFix[] = DEMO_LAP.map((p, i) => ({
    at: T0_DEMO + DEMO_OFFSET_MS + p.t,
    lat: p.lat,
    lng: p.lng,
    speed: p.speed,
    accuracy: 3 + ((i * 7) % 10),
    heading: null,
    altitude: 0,
    altitudeAccuracy: 0,
  }));
  const batches = toBatches(fixes, 5, 30, (_k, at) => at).map((b) => ({
    ...b,
    locations: b.locations.map((l) => ({ ...l, coords: { ...l.coords, altitude: null, altitudeAccuracy: null } })),
  }));
  return { t0: T0_DEMO, batches, imuEvents: [] };
}

// ---------------------------------------------------------------------------
// Sessão 3: traçado salvo a partir da melhor volta da sessão 1
// ---------------------------------------------------------------------------

/** Instante real (epoch) em que o kart passa pela posição absoluta `S`. */
function crossingAt(S: number): { t: number; v: number } {
  const { states } = sim();
  for (let i = 1; i < states.length; i++) {
    const a = states[i - 1];
    const b = states[i];
    if (a.S < S && b.S >= S) {
      const f = (S - a.S) / (b.S - a.S);
      return { t: T0 + a.t + f * (b.t - a.t), v: a.v + f * (b.v - a.v) };
    }
  }
  throw new Error(`a sessão 1 não passa por S = ${S}`);
}

export function session3(): TrackLayout {
  // Voltas lançadas pela linha em s = 0: a volta n vai de n·L a (n+1)·L.
  const crossings = Array.from({ length: LAPS + 1 }, (_, i) => crossingAt((i + 1) * L));
  let best = 0;
  for (let n = 1; n < LAPS; n++) {
    if (crossings[n + 1].t - crossings[n].t < crossings[best + 1].t - crossings[best].t) best = n;
  }
  const c0 = crossings[best];
  const c1 = crossings[best + 1];
  const fixes = session1Fixes().filter((f) => f.accuracy <= 30 && f.at > c0.t && f.at < c1.t);
  const line = toLatLng(0, 0);
  // O traçado guarda os frames com o `t` como foi gravado (epoch ms; t0Utc nulo).
  const inner: GpsFrame[] = fixes.map((f) => ({
    kind: 'gps',
    source: 'PHONE',
    fix: 'unknown',
    t: f.at,
    lat: f.lat,
    lng: f.lng,
    speed: f.speed ?? 0,
    accuracy: f.accuracy,
    heading: f.heading ?? undefined,
    altitude: f.altitude,
    altitudeAccuracy: f.altitudeAccuracy,
  }));
  const boundary = (c: { t: number; v: number }, acc: number): GpsFrame => ({
    kind: 'gps',
    source: 'PHONE',
    fix: 'unknown',
    t: c.t,
    lat: line.lat,
    lng: line.lng,
    speed: c.v,
    accuracy: acc,
    synthetic: true,
  });
  const samples = [boundary(c0, inner[0].accuracy), ...inner, boundary(c1, inner[inner.length - 1].accuracy)];
  return {
    id: 'layout_golden_s1',
    trackId: 'golden-track',
    name: 'Layout principal',
    samples,
    durationMs: Math.round(c1.t - c0.t),
    lengthM: polylineLength(samples),
    recordedAt: T0 + sim().phases.end,
    sourceSessionId: 'session_golden_s1',
    sourceLapId: `session_golden_s1_lap_${best + 1}`,
    isDefault: true,
  };
}

// ---------------------------------------------------------------------------
// Sessão 4: volta legada com timestamps degenerados
// ---------------------------------------------------------------------------

export function session4(): LapRecord {
  // A volta 2 lançada da sessão 1, gravada por um build que entregava
  // `loc.timestamp = 0`: posição e velocidade certas, todo `t` zerado, sem IMU
  // e sem os pontos de fronteira (anterior à AD-006).
  const c0 = crossingAt(2 * L);
  const c1 = crossingAt(3 * L);
  const samples: GpsFrame[] = session1Fixes()
    .filter((f) => f.accuracy <= 30 && f.at >= c0.t && f.at <= c1.t)
    .map((f) => ({
      kind: 'gps',
      source: 'PHONE',
      fix: 'unknown',
      t: 0,
      lat: f.lat,
      lng: f.lng,
      speed: f.speed ?? 0,
      accuracy: f.accuracy,
      heading: f.heading ?? undefined,
    }));
  return {
    id: 'session_golden_legacy_lap_1',
    sessionId: 'session_golden_legacy',
    gps: samples,
    samples,
    startedAt: Math.round(c0.t) - 86_400_000,
    durationMs: Math.round(c1.t - c0.t),
  };
}
