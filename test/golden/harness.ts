/**
 * Harness da comparação de referência (TF-14, TF-15; design §10).
 *
 * Roda o pipeline ATUAL sobre as sessões brutas de `sessions.ts`, das entradas
 * do sensor até cada consumidor puro, e devolve um objeto por consumidor e por
 * sessão. `scripts/golden-capture.ts` grava o resultado em `expected.json`;
 * `test/golden.test.ts` roda o mesmo harness e compara pelo `goldenCompare`.
 *
 * Determinístico: sem Date.now (o da demo é congelado) e sem Math.random.
 * Guarda saídas derivadas, não o bruto. Séries longas viram uma subamostra
 * (um a cada `k`, com `len`) mais somas; nada é arredondado.
 *
 * Os módulos que importam o banco, o perfil, o Supabase e o id do aparelho
 * (nativos) entram como stubs no `require.cache` antes do `require`: assim o
 * `loadCoachContext`, o `seedDemoSession` e o `publishSample` reais rodam em
 * Node. Tudo passa pelo código do app: a captura (`handleLocations` com o relógio
 * da sessão e `createImuCapture`), as voltas (`sliceLapWindows` e `lapFrames`) e
 * o poll de 500 ms do ao vivo (`createLivePoll`, o mesmo do hook de gravação).
 * O traçado novo do "Encerrar" de um reconhecimento passa pelo banco (sql.js): é
 * gravado e lido de volta da série dele pelo `layoutRepo`. A sessão demo também: o
 * `seedDemoSession` grava série e janelas, e o `loadLaps` lê as voltas.
 */
import {
  analyzeLap,
  cleanSamples,
  matchLapToReference,
  repairDegenerateTimestamps,
  type LapRecord,
  type MatchedLap,
} from '../../src/lib/analysis';
import { hardestBraking } from '../../src/lib/brakingPoint';
import { analyzeCorners } from '../../src/lib/cornerAnalysis';
import { detectCorners, type Corner } from '../../src/lib/corners';
import { minSpeedPerCorner } from '../../src/lib/cornerSpeed';
import {
  buildReferenceLap,
  polylineLength,
  type GpsSample,
  type ImuSample,
  type ReferenceLap,
} from '../../src/lib/geometry';
import { compareLaps, type CompareResult, type LapTrace } from '../../src/lib/lapCompare';
import { detectLaps, type OpenCross } from '../../src/lib/lapDetector';
import { buildLapInsight } from '../../src/lib/lapInsight';
import { buildPilotDna, type DnaSessionInput } from '../../src/lib/pilotDna';
import { DeltaTracker } from '../../src/lib/realtimeDelta';
import {
  referenceFromLap,
  referenceFromLayout,
  sectorLapSamples,
  sectorSplits,
  type SectorSplits,
} from '../../src/lib/sectors';
import { msToKmh, peakSpeedInSectorMs, peakSpeedKmh, peakSpeedMs, peakSpeedMsOfLaps } from '../../src/lib/speed';
import { speedColorRange } from '../../src/lib/speedRange';
import { detectSpins } from '../../src/lib/spinDetector';
import { lineFromLayout, type CrossPoint, type StartLine } from '../../src/lib/startLine';
import { samplesToSilhouette } from '../../src/lib/trackSilhouette';
import { countCorners } from '../../src/lib/trackShapeStats';
import {
  recordedLaps as stopLaps,
  saveReferenceLayout,
  sliceLaps,
  toLapRecord,
  type RecordedLap,
} from '../../src/recording/finishSession';
import { createLivePoll } from '../../src/recording/livePoll';
import { handleLocations } from '../../src/recording/locationHandler';
import { createImuCapture } from '../../src/recording/imuCapture';
import { createSessionClock } from '../../src/recording/sessionClock';
import { G, type GpsFrame, type ImuFrame, type SeriesMeta } from '../../src/telemetry/frame';
import { analysisGps, lapFrames, sliceLapWindows } from '../../src/telemetry/laps';
import { gpsSeriesOf, imuSeriesOf } from '../../src/telemetry/series';
import type { Session, TrackLayout } from '../../src/storage/db';
import { loadLaps, sessionOwner } from '../../src/storage/lapRepo';
import { getLayout, sqlLayoutRepo } from '../../src/storage/layoutRepo';
import { readSeries } from '../../src/telemetry/telemetryStore';
import { openV5Database } from '../helpers/v5Database';
import {
  session1,
  session2,
  session3,
  session4,
  T0,
  type ImuEvent,
  type LocationBatch,
  type RecordedSessionInput,
} from './sessions';

// ---------------------------------------------------------------------------
// Stubs dos módulos nativos
// ---------------------------------------------------------------------------

type DbState = {
  sessions: Session[];
  laps: LapRecord[];
  layouts: TrackLayout[];
};

const db: DbState = { sessions: [], laps: [], layouts: [] };
/** O banco (sql.js) em que o `seedDemoSession` real grava a sessão demo. */
const demoDb = openV5Database();
const liveRows: Record<string, unknown>[] = [];

function stub(path: string, exports: Record<string, unknown>): void {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
}

stub('../../src/storage/db', {
  getSession: async (id: string) => db.sessions.find((s) => s.id === id) ?? null,
  getLapsForSession: async (id: string) => db.laps.filter((l) => l.sessionId === id),
  getLayout: async (id: string) => db.layouts.find((l) => l.id === id) ?? null,
  getDefaultLayoutForTrack: async () => null,
  getTrackHistory: async () => [],
  listSessions: async () => [],
  createSession: async (input: Omit<Session, 'id' | 'startedAt' | 'recovered'>) => {
    const session = { ...input, id: 'session_demo', startedAt: Date.now(), recovered: false };
    await (await demoDb).conn.runAsync(
      `INSERT INTO sessions (id, track_name, kart, notes, started_at, weather, track_id, mode, layout_id, kart_setup_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      session.trackName,
      session.kart,
      session.notes,
      session.startedAt,
      session.weather,
      session.trackId,
      session.mode,
      session.layoutId,
      session.kartSetupId,
    );
    return session;
  },
  appSqlConn: async () => (await demoDb).conn,
  deleteSession: async () => {},
});
stub('../../src/storage/profile', { getProfile: async () => null });
stub('../../src/lib/deviceId', { getDeviceId: async () => 'golden-device' });
stub('../../src/lib/supabase', {
  getSupabase: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        liveRows.push(row);
        return { error: null };
      },
    }),
  }),
});
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const { loadCoachContext } = require('../../src/lib/coachContext') as typeof import('../../src/lib/coachContext');
const { seedDemoSession } = require('../../src/lib/demoSession') as typeof import('../../src/lib/demoSession');
const { publishSample, toLiveSample } = require('../../src/lib/liveSession') as typeof import('../../src/lib/liveSession');

// ---------------------------------------------------------------------------
// Subamostra e resumos
// ---------------------------------------------------------------------------

export const SAMPLE_K = 10;
export const IMU_K = 50;
export const MATCH_K = 10;
/** Um a cada `POLL_K` polls é guardado (o estado do tracker corre em todos). */
export const POLL_K = 4;

type Series<T> = { len: number; k: number; items: T[] };

function sub<T>(arr: T[], k: number): Series<T> {
  return { len: arr.length, k, items: arr.filter((_, i) => i % k === 0) };
}

function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/**
 * Resumo de frames de GPS para o `expected.json`, que guarda a visão antiga: `t` absoluto
 * (`t0 + t`) e só as chaves de antes. `t0` é o t0Utc da série (0 quando o `t` já é o gravado).
 */
function gpsSeries(frames: GpsFrame[], t0: number, k = SAMPLE_K) {
  const samples = frames.map((f) => legacyFrame(f, t0));
  return {
    ...sub(samples, k),
    first: samples[0] ?? null,
    last: samples[samples.length - 1] ?? null,
    latSum: sum(samples.map((p) => p.lat)),
    lngSum: sum(samples.map((p) => p.lng)),
    speedSum: sum(samples.map((p) => p.speed)),
    accuracySum: sum(samples.map((p) => p.accuracy)),
  };
}

/** Resumo da IMU para o `expected.json`, na visão antiga (`t` absoluto, accel em g). */
function imuSeries(frames: ImuFrame[] | undefined, t0: number) {
  if (!frames) return null;
  const imu = frames.map((f) => legacyImu(f, t0));
  return {
    ...sub(imu, IMU_K),
    first: imu[0] ?? null,
    last: imu[imu.length - 1] ?? null,
    gyroZSum: sum(imu.map((s) => s.gyro.z)),
    accelXSum: sum(imu.map((s) => s.accel.x)),
  };
}

function lapSummary(l: LapRecord, t0: number) {
  return {
    id: l.id,
    startedAt: l.startedAt,
    durationMs: l.durationMs,
    samples: gpsSeries(l.gps, t0),
    imu: imuSeries(l.imu, t0),
  };
}

function matchedSummary(m: MatchedLap) {
  return {
    durationMs: m.durationMs,
    referenceLength: m.referenceLength,
    points: sub(m.points, MATCH_K),
    sSum: sum(m.points.map((p) => p.s)),
    speedSum: sum(m.points.map((p) => p.speed)),
  };
}

function refSummary(ref: ReferenceLap) {
  return {
    totalLength: ref.totalLength,
    origin: ref.origin,
    pointCount: ref.points.length,
    cumulativeDist: sub(ref.cumulativeDist, MATCH_K),
  };
}

/** `tValues` do LapTrace é tempo (ms): sai como `tValuesMs` para a regra de tolerância. */
function traceSummary(tr: LapTrace) {
  return { sValues: tr.sValues, tValuesMs: tr.tValues, speedValues: tr.speedValues, durationMs: tr.durationMs };
}

function compareSummary(r: CompareResult) {
  return {
    aTotalMs: r.aTotalMs,
    bTotalMs: r.bTotalMs,
    totalDeltaMs: r.totalDeltaMs,
    trackLengthM: r.trackLengthM,
    traceA: traceSummary(r.traceA),
    traceB: traceSummary(r.traceB),
    trechos: r.trechos,
    sectors: r.sectors,
    matchedA: matchedSummary(r.matchedA),
    matchedB: matchedSummary(r.matchedB),
  };
}

// ---------------------------------------------------------------------------
// Captura: lotes de fix → handleLocations; eventos da IMU → pares
// ---------------------------------------------------------------------------

/**
 * Visão antiga de um frame de GPS: `t` absoluto (`t0Utc + t`) e só as chaves de antes.
 * Serve ao que vai para o `expected.json` e aos consumidores ainda não migrados na fase 5.
 */
function legacyFrame(f: GpsFrame, t0Utc: number) {
  return {
    t: t0Utc + f.t,
    lat: f.lat,
    lng: f.lng,
    speed: f.speed,
    accuracy: f.accuracy!,
    heading: f.heading,
    altitude: f.altitude,
    altitudeAccuracy: f.altitudeAccuracy,
    synthetic: f.synthetic,
  };
}

/** Os frames que a análise lê (`analysisGps`, ≤ 30 m), na visão antiga. */
function legacyGps(frames: GpsFrame[], t0Utc: number): GpsSample[] {
  return analysisGps(frames).map((f) => ({ ...legacyFrame(f, t0Utc), kind: 'gps', source: f.source, fix: f.fix }));
}

/** IMU na visão antiga, para o `expected.json`: `t` absoluto e o acelerômetro em g, como o sensor entrega. */
function legacyImu(f: ImuFrame, t0Utc: number) {
  return {
    t: t0Utc + f.t,
    accel: { x: f.accel!.x / G, y: f.accel!.y / G, z: f.accel!.z / G },
    gyro: f.gyro!,
  };
}

/** Os lotes pela tarefa de localização, no relógio da sessão que começa em `t0Utc`. */
async function captureGps(batches: LocationBatch[], t0Utc: number): Promise<GpsFrame[]> {
  const buf = { samples: [] as GpsFrame[] };
  const clock = { trustsRaw: false, session: createSessionClock(t0Utc) };
  for (const b of batches) {
    await handleLocations(b.locations, {
      buf,
      journal: null,
      uiActive: true,
      stopLocationUpdates: async () => {},
      now: () => b.arrivalAt,
      clock,
    });
  }
  return buf.samples;
}

/**
 * As voltas como o app as recorta: janelas do `sliceLapWindows` sobre os frames
 * e os frames de cada uma pelo `lapFrames` (fronteiras geradas na leitura), pelo
 * `recordedLaps` do "Encerrar". Os frames ficam no relógio da sessão.
 */
function recordedLaps(gps: GpsFrame[], imu: ImuFrame[], t0Utc: number, line: StartLine | null): RecordedLap[] {
  const meta = (kind: 'gps' | 'imu'): SeriesMeta => ({
    id: `golden_${kind}`,
    owner: { kind: 'session', id: 'golden' },
    source: 'PHONE',
    kind,
    t0Utc,
    legacy: false,
  });
  return stopLaps(sliceLapWindows(gps, line), gpsSeriesOf(meta('gps'), gps), imuSeriesOf(meta('imu'), imu), t0Utc);
}

/** O sensor conta desde o boot: o `timestamp` dos eventos é o instante de chegada menos este boot. */
const IMU_BOOT_AT = T0 - 3_600_000;

/**
 * A captura da IMU do app (`createImuCapture`) sobre os eventos do expo-sensors,
 * no relógio da sessão que começa em `t0Utc`. Volta na visão antiga para os
 * consumidores de hoje: `t` absoluto e o acelerômetro em g, como chegou.
 */
function captureImu(events: ImuEvent[], t0Utc: number): ImuFrame[] {
  const frames: ImuFrame[] = [];
  let now = t0Utc;
  const cap = createImuCapture(createSessionClock(t0Utc), (f) => frames.push(f), () => now);
  for (const e of events) {
    now = e.at;
    const reading = { x: e.x, y: e.y, z: e.z, timestamp: (e.at - IMU_BOOT_AT) / 1000 };
    if (e.kind === 'accel') cap.onAccel(reading);
    else cap.onGyro(reading);
  }
  cap.flush();
  return frames;
}

// ---------------------------------------------------------------------------
// O poll do ao vivo (`createLivePoll`, o mesmo do hook), em modo de referência 'best'
// ---------------------------------------------------------------------------

async function livePoll(input: RecordedSessionInput, line: StartLine | null, sectorRef: ReferenceLap | null) {
  const buf = { samples: [] as GpsFrame[] };
  const clock = { trustsRaw: false, session: createSessionClock(input.t0) };
  const frames: GpsFrame[] = [];
  const poll = createLivePoll(line, () => sectorRef);
  const polls: unknown[] = [];
  const payloads: Record<string, unknown>[] = [];
  let pollCount = 0;
  let liveDeltaCount = 0;
  let bi = 0;

  for (let pollAt = input.t0 + 500; bi < input.batches.length; pollAt += 500) {
    while (bi < input.batches.length && input.batches[bi].arrivalAt <= pollAt) {
      const b = input.batches[bi];
      await handleLocations(b.locations, {
        buf,
        journal: null,
        uiActive: true,
        stopLocationUpdates: async () => {},
        now: () => b.arrivalAt,
        clock,
      });
      bi++;
    }
    if (buf.samples.length > 0) {
      frames.push(...buf.samples);
      buf.samples = [];
    }
    const r = poll.step(frames, { nowMs: pollAt, mode: 'best' });

    pollCount++;
    if (r.reading && r.reading.deltaMs !== null) liveDeltaCount++;
    if ((pollCount - 1) % POLL_K !== 0) continue;
    polls.push({
      pollAt,
      sampleCount: r.all.length,
      lapsCompleted: r.detection.laps.length,
      bestLapMs: r.bestLapMs,
      currentLapElapsedMs: r.currentLapElapsedMs,
      liveDeltaMs: r.liveDeltaMs,
      reading: r.reading,
      currentSectorIdx: r.currentSectorIdx,
      currentSectorElapsedMs: r.currentSectorElapsedMs,
      currentSectors: r.currentSectors,
      lastClosedLapSectors: r.lastClosedLapSectors,
      bestSectors: r.bestSectors,
    });

    // O que `app/recording.tsx` publica para o ponto, com o `info` deste poll.
    if (r.last) {
      liveRows.length = 0;
      await publishSample(
        'golden-live',
        toLiveSample(
          r.last,
          {
            lapsCompleted: r.detection.laps.length,
            currentLapElapsedMs: r.currentLapElapsedMs,
            bestLapMs: r.bestLapMs,
            liveDeltaMs: r.liveDeltaMs,
            currentSectorIdx: r.currentSectorIdx,
            currentSectorElapsedMs: r.currentSectorElapsedMs,
            currentSectors: r.currentSectors,
          },
          input.t0,
        ),
      );
      payloads.push(...liveRows);
    }
  }
  return { pollCount, liveDeltaCount, k: POLL_K, polls, payloads };
}

// ---------------------------------------------------------------------------
// Pipeline das telas sobre as voltas salvas
// ---------------------------------------------------------------------------

type GoldenSession = {
  name: string;
  session: Session;
  laps: LapRecord[];
  layout: TrackLayout | null;
  /** O t0Utc das séries da sessão; 0 na legada, cujo `t` é o gravado. Só para o resumo no `expected.json`. */
  t0: number;
};

function prepareLap(l: LapRecord): { lap: LapRecord; repaired: boolean } {
  const cleaned = cleanSamples(l.gps, 10);
  const { samples, repaired } = repairDegenerateTimestamps(cleaned, l.durationMs, l.startedAt);
  return { lap: { ...l, gps: samples, samples }, repaired };
}

/** A tela da sessão (`app/session/[id].tsx`), com cada volta como a selecionada. */
function sessionScreen(gs: GoldenSession) {
  let anyRepaired = false;
  const laps = gs.laps.map((l) => {
    const p = prepareLap(l);
    if (p.repaired) anyRepaired = true;
    return p.lap;
  });
  let reference = gs.layout;
  if (reference && reference.samples.length >= 2) {
    const { samples, repaired } = repairDegenerateTimestamps(reference.samples, reference.durationMs);
    if (repaired) {
      anyRepaired = true;
      reference = { ...reference, samples };
    }
  }
  const saved: Record<string, GpsFrame[]> = {};
  for (const l of gs.laps) saved[l.id] = sectorLapSamples(l);

  const sessionBest = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  const useExternalRef = reference !== null;
  const refSamples = useExternalRef ? reference!.samples : sessionBest.gps;
  const refDurationMs = useExternalRef ? reference!.durationMs : sessionBest.durationMs;
  const refLap = buildReferenceLap(refSamples, { lat: refSamples[0].lat, lng: refSamples[0].lng });
  const corners = detectCorners(refLap);
  const matchedRef = matchLapToReference(
    { id: 'ref', sessionId: 'ref', startedAt: 0, durationMs: refDurationMs, gps: refSamples, samples: refSamples },
    refLap,
  );
  const bestSaved = saved[sessionBest.id] ?? sessionBest.gps;
  const sectorRef = (useExternalRef ? referenceFromLayout(reference!.samples) : null) ?? referenceFromLap({ gps: bestSaved });
  const refSplits = sectorSplits(useExternalRef ? reference!.samples : bestSaved, sectorRef);

  const perLap = laps.map((selected) => {
    if (refSamples.length < 5 || selected.gps.length < 5) return { id: selected.id, kind: 'too-short' };
    const isSelectedReference = !useExternalRef && selected.id === sessionBest.id;
    const matchedCurrent = matchLapToReference(selected, refLap);
    const analysis = !isSelectedReference ? analyzeLap(matchedCurrent, matchedRef, 20) : null;
    const cornerMetrics = analyzeCorners(corners, refLap, matchedCurrent, isSelectedReference ? null : matchedRef);
    const splits = sectorSplits(saved[selected.id] ?? selected.gps, sectorRef);
    const peak = peakSpeedMs(selected.gps);
    return {
      id: selected.id,
      kind: 'ok',
      isSelectedReference,
      matchedCurrent: matchedSummary(matchedCurrent),
      analysis,
      sectorPeaksKmh: (analysis?.sectors ?? []).map((sec) => msToKmh(peakSpeedInSectorMs(matchedCurrent, sec.sStart, sec.sEnd))),
      cornerMetrics,
      sectorSplits: splits,
      peakSpeedMs: peak,
      peakSpeedKmh: peakSpeedKmh(selected.gps),
      hardestBraking: hardestBraking(selected.gps),
      speedColorRange: speedColorRange(selected.gps),
    };
  });

  return {
    approxTimestamps: anyRepaired,
    sessionBestId: sessionBest.id,
    useExternalRef,
    refDurationMs,
    refPeakKmh: peakSpeedKmh(refSamples),
    refLap: refSummary(refLap),
    corners,
    matchedReference: matchedSummary(matchedRef),
    refSectorSplits: refSplits,
    laps: perLap,
  };
}

/** O mapa detalhado (`app/track-map.tsx`): só existe com traçado. */
function trackMapScreen(laps: LapRecord[], layout: TrackLayout) {
  const cleanedRef = cleanSamples(layout.samples, 10);
  const { samples: refSamples } = repairDegenerateTimestamps(cleanedRef, layout.durationMs);
  const refLap = buildReferenceLap(refSamples, { lat: refSamples[0].lat, lng: refSamples[0].lng });
  const corners = detectCorners(refLap);
  const sectorRef = referenceFromLayout(layout.samples);
  return laps.map((lap) => {
    const { lap: prepared } = prepareLap(lap);
    const matched = matchLapToReference(prepared, refLap);
    return {
      id: lap.id,
      corners,
      cornerSpeeds: minSpeedPerCorner(corners, matched),
      sectorSplits: sectorRef ? sectorSplits(sectorLapSamples(lap), sectorRef) : null,
      thirdPeaksKmh: [0, 1, 2].map((i) =>
        msToKmh(peakSpeedInSectorMs(matched, (i * refLap.totalLength) / 3, ((i + 1) * refLap.totalLength) / 3)),
      ),
    };
  });
}

/** A comparação de voltas (`app/lap-compare.tsx`), que exige traçado. */
function lapCompareScreen(savedA: LapRecord, savedB: LapRecord, layout: TrackLayout) {
  const { samples: refSamples } = repairDegenerateTimestamps(layout.samples, layout.durationMs);
  const refLap = buildReferenceLap(refSamples, { lat: refSamples[0].lat, lng: refSamples[0].lng });
  const corners = detectCorners(refLap);
  const result = compareLaps(prepareLap(savedA).lap, prepareLap(savedB).lap, refLap, corners, { a: savedA, b: savedB });
  return { a: savedA.id, b: savedB.id, result: compareSummary(result) };
}

async function coachContexts(gs: GoldenSession) {
  db.sessions = [gs.session];
  db.laps = gs.laps;
  db.layouts = gs.layout ? [gs.layout] : [];
  const out = [];
  for (const lap of gs.laps) {
    const r = await loadCoachContext(gs.session.id, lap.id);
    if (r.kind !== 'ok') {
      out.push({ id: lap.id, kind: r.kind });
      continue;
    }
    const c = r.context;
    out.push({
      id: lap.id,
      kind: r.kind,
      lapSampleCount: c.lap.samples.length,
      lapSamples: gpsSeries(c.lap.gps, gs.t0),
      refDurationMs: c.refDurationMs,
      analysis: c.analysis,
      cornerMetrics: c.cornerMetrics,
      trackName: c.trackName,
      pilot: c.pilot,
      history: c.history,
    });
  }
  return out;
}

function sessionRow(id: string, trackName: string, startedAt: number, layoutId: string | null): Session {
  return {
    id,
    trackName,
    kart: null,
    notes: null,
    startedAt,
    weather: 'dry',
    trackId: null,
    mode: 'race',
    layoutId,
    kartSetupId: null,
    recovered: false,
  };
}

function detectionSummary(samples: GpsSample[], line: StartLine | null) {
  const d = detectLaps(samples, { line });
  return {
    movingStartIdx: d.movingStartIdx,
    startFinishLine: d.startFinishLine,
    laps: d.laps,
    openCross: d.openCross,
  };
}

// ---------------------------------------------------------------------------
// Tudo
// ---------------------------------------------------------------------------

const DEMO_NOW = T0 + 20_000_000;

export type GoldenOutput = Record<string, Record<string, unknown>>;

export async function runGolden(): Promise<GoldenOutput> {
  const s1 = session1();
  const s2 = session2();
  const layout = session3();
  const legacy = session4();
  const layoutLine = lineFromLayout(layout.samples);
  const layoutRef = referenceFromLayout(layout.samples);

  // Captura: os mesmos lotes que a tarefa de localização recebe, em frames.
  const s1Frames = await captureGps(s1.batches, s1.t0);
  const s1ImuFrames = captureImu(s1.imuEvents, s1.t0);
  const s2Frames = await captureGps(s2.batches, s2.t0);
  // Visão antiga, para a detecção (até a T33).
  const s1Gps = legacyGps(s1Frames, s1.t0);
  const s2Gps = legacyGps(s2Frames, s2.t0);

  // Voltas salvas: janelas + lapFrames + toLapRecord, como no "Encerrar".
  const s1Recorded = recordedLaps(s1Frames, s1ImuFrames, s1.t0, null);
  const s1Laps = s1Recorded.map((l, i) => toLapRecord(l, 'session_golden_s1', i));
  const s1LayoutLaps = recordedLaps(s1Frames, s1ImuFrames, s1.t0, layoutLine).map((l, i) =>
    toLapRecord(l, 'session_golden_s1_layout', i),
  );
  const s2Laps = recordedLaps(s2Frames, [], s2.t0, null).map((l, i) => toLapRecord(l, 'session_golden_s2', i));

  // Sessão demo pelo caminho real do seed, com o relógio congelado: gravada no
  // banco (sql.js) em série e janelas, e lida de volta pelo `loadLaps`.
  const realNow = Date.now;
  Date.now = () => DEMO_NOW;
  let demoId: string;
  try {
    demoId = await seedDemoSession();
  } finally {
    Date.now = realNow;
  }
  const { conn: demoConn } = await demoDb;
  const demoT0 = (await readSeries(demoConn, sessionOwner(demoId), { kinds: ['gps'] })).series[0].meta.t0Utc!;
  const demoLaps = await loadLaps(demoConn, demoId);

  const sessions: GoldenSession[] = [
    { name: 's1', session: sessionRow('session_golden_s1', 'Golden', T0, null), laps: s1Laps, layout: null, t0: s1.t0 },
    {
      name: 's1Layout',
      session: sessionRow('session_golden_s1_layout', 'Golden', T0, layout.id),
      laps: s1LayoutLaps,
      layout,
      t0: s1.t0,
    },
    {
      name: 's2',
      session: sessionRow('session_golden_s2', 'Leandro Merlo', s2.t0, null),
      laps: s2Laps,
      layout: null,
      t0: s2.t0,
    },
    {
      name: 'demo',
      session: sessionRow('session_demo', 'Leandro Merlo', DEMO_NOW, null),
      laps: demoLaps,
      layout: null,
      t0: demoT0,
    },
    { name: 's4', session: sessionRow(legacy.sessionId, 'Golden', legacy.startedAt, null), laps: [legacy], layout: null, t0: 0 },
  ];
  const byName = (n: string) => sessions.find((s) => s.name === n)!;

  const out: GoldenOutput = {};
  const put = (consumer: string, session: string, value: unknown) => {
    out[consumer] ??= {};
    out[consumer][session] = value;
  };

  // Captura e detecção.
  put('handleLocations', 's1', gpsSeries(analysisGps(s1Frames), s1.t0));
  put('handleLocations', 's2', gpsSeries(analysisGps(s2Frames), s2.t0));
  put('handleLocations', 's1HeadTimesMs', s1Gps.slice(0, 300).map((p) => p.t));
  put('imuPairing', 's1', imuSeries(s1ImuFrames, s1.t0));
  put('detectLaps', 's1', detectionSummary(s1Gps, null));
  put('detectLaps', 's1Layout', detectionSummary(s1Gps, layoutLine));
  put('detectLaps', 's2', detectionSummary(s2Gps, null));

  for (const gs of sessions) {
    put('lapRecords', gs.name, gs.laps.map((l) => lapSummary(l, gs.t0)));
    put('sessionScreen', gs.name, sessionScreen(gs));
    put('peakSpeedMsOfLaps', gs.name, peakSpeedMsOfLaps(gs.laps));
    put('buildLapInsight', gs.name, (() => {
      const r = buildLapInsight(gs.laps);
      return r && { ...r, best: { id: r.best.id, durationMs: r.best.durationMs, sampleCount: r.best.gps.length } };
    })());
    // O trompo sai no relógio da sessão; o `expected.json` guarda o instante absoluto.
    put('detectSpins', gs.name, gs.laps.map((l) => detectSpins(l.samples, l.imuSamples).map((e) => ({ ...e, startT: gs.t0 + e.startT, endT: gs.t0 + e.endT }))));
    put('buildPilotDna', gs.name, buildPilotDna([{ trackName: gs.session.trackName, startedAt: gs.session.startedAt, laps: gs.laps }]));
    put('coachContext', gs.name, await coachContexts(gs));
    const bestLap = gs.laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), gs.laps[0]);
    put('countCorners', gs.name, countCorners(bestLap.samples));
    put('samplesToSilhouette', gs.name, samplesToSilhouette(bestLap.samples));
    put('polylineLength', gs.name, gs.laps.map((l) => polylineLength(l.samples)));
  }

  const dnaInputs: DnaSessionInput[] = ['demo', 's2', 's1', 's4'].map((n) => {
    const gs = byName(n);
    return { trackName: gs.session.trackName, startedAt: gs.session.startedAt, laps: gs.laps };
  });
  put('buildPilotDna', 'all', buildPilotDna(dnaInputs));

  // Traçado (sessão 3): linha, régua, curvas, silhueta, e o traçado novo que
  // o "Encerrar" de uma gravação de referência salvaria a partir da sessão 1.
  put('lineFromLayout', 's3', layoutLine);
  put('referenceFromLayout', 's3', layoutRef && refSummary(layoutRef));
  put('countCorners', 's3', countCorners(layout.samples));
  put('samplesToSilhouette', 's3', samplesToSilhouette(layout.samples));
  put('polylineLength', 's3', polylineLength(layout.samples));
  put('sectorSplits', 's3', layoutRef && sectorSplits(layout.samples, layoutRef));
  // As voltas como o `stop()` as devolve (janelas e frames, `recordedLaps` do app),
  // o traçado gravado no banco (sql.js) pelo `layoutRepo` com a série dele e lido
  // de volta dessa série. Na visão antiga para o resumo.
  const seriesMeta = (kind: 'gps' | 'imu'): SeriesMeta => ({
    id: `golden_${kind}`,
    owner: { kind: 'session', id: 'golden' },
    source: 'PHONE',
    kind,
    t0Utc: s1.t0,
    legacy: false,
  });
  const s1StopLaps = stopLaps(
    sliceLapWindows(s1Frames, null),
    gpsSeriesOf(seriesMeta('gps'), s1Frames),
    imuSeriesOf(seriesMeta('imu'), s1ImuFrames),
    s1.t0,
  );
  const layoutDb = await openV5Database();
  const created = await saveReferenceLayout(
    {
      recordingId: 'golden_s1',
      trackId: 'golden-track',
      layoutName: null,
      laps: s1StopLaps,
      recordedAt: s1.phases.end,
    },
    sqlLayoutRepo(async () => layoutDb.conn),
  );
  const newLayout = (await getLayout(layoutDb.conn, created.id))!;
  put('saveReferenceLayout', 's1', {
    id: newLayout.id,
    trackId: newLayout.trackId,
    name: newLayout.name,
    samples: gpsSeries(newLayout.gps!, s1.t0),
    durationMs: newLayout.durationMs,
    lengthM: newLayout.lengthM,
    recordedAt: newLayout.recordedAt,
    isDefault: newLayout.isDefault,
  });

  // Mapa detalhado e comparação: só com traçado.
  put('trackMapScreen', 's1Layout', trackMapScreen(s1LayoutLaps, layout));
  put('trackMapScreen', 's4', trackMapScreen([legacy], layout));
  const sorted = [...s1LayoutLaps].sort((a, b) => a.durationMs - b.durationMs);
  const spinLap = s1LayoutLaps[3];
  put('compareLaps', 's1Layout', [
    lapCompareScreen(sorted[1], sorted[0], layout),
    lapCompareScreen(spinLap, sorted[0], layout),
  ]);
  put('compareLaps', 's4', [lapCompareScreen(legacy, sorted[0], layout)]);

  // Ao vivo: a sequência do DeltaTracker e o payload de live_samples.
  put('livePoll', 's1', await livePoll(s1, null, null));
  put('livePoll', 's1Layout', await livePoll(s1, layoutLine, layoutRef));
  put('livePoll', 's2', await livePoll(s2, null, null));

  return out;
}

/** O que vai para o JSON: undefined some, como no arquivo gravado. */
export function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
