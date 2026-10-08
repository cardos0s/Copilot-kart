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
 *
 * Dois caminhos a mais (T45), comparados com o mesmo `expected.json`:
 * - `runGoldenNewPipeline`: as entradas brutas pela captura, o diário num banco sql.js,
 *   o `stop()` do hook, o `finishRecording` e o `loadLaps`;
 * - `runGoldenLegacy`: o JSON que o código antigo salvava (a visão antiga das voltas e
 *   do traçado) num banco v4, a migração v5 inteira (v5a, v5b, v5c) e o `loadLaps`.
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
import { finishRecording } from '../../src/recording/finishRecording';
import { recordingSeries, RecordingJournal } from '../../src/recording/journal';
import { createSessionClock } from '../../src/recording/sessionClock';
import { G, type GpsFrame, type ImuFrame, type SeriesMeta } from '../../src/telemetry/frame';
import { analysisGps, lapFrames, sliceLapWindows } from '../../src/telemetry/laps';
import { gpsSeriesOf, imuSeriesOf } from '../../src/telemetry/series';
import type { Session, TrackLayout } from '../../src/storage/db';
import { loadLaps, sessionOwner } from '../../src/storage/lapRepo';
import { getLayout, layoutGps, sqlLayoutRepo } from '../../src/storage/layoutRepo';
import { migrateV5Cleanup, migrateV5Data, migrateV5Schema, migrationExecutorFrom } from '../../src/storage/migrations';
import { sqlSessionRepo } from '../../src/storage/sqlSessionRepo';
import { readSeries } from '../../src/telemetry/telemetryStore';
import { openV4Database } from '../helpers/v4Database';
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
 * Visão antiga de um frame de GPS, só para o resumo que vai para o `expected.json`:
 * `t` absoluto (`t0Utc + t`) e só as chaves de antes. Os consumidores recebem os frames.
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
  if (reference && layoutGps(reference).length >= 2) {
    const { samples, repaired } = repairDegenerateTimestamps(layoutGps(reference), reference.durationMs);
    if (repaired) {
      anyRepaired = true;
      reference = { ...reference, gps: samples, samples };
    }
  }
  const saved: Record<string, GpsFrame[]> = {};
  for (const l of gs.laps) saved[l.id] = sectorLapSamples(l);

  const sessionBest = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  const useExternalRef = reference !== null;
  const refSamples = useExternalRef ? layoutGps(reference!) : sessionBest.gps;
  const refDurationMs = useExternalRef ? reference!.durationMs : sessionBest.durationMs;
  const refLap = buildReferenceLap(refSamples, { lat: refSamples[0].lat, lng: refSamples[0].lng });
  const corners = detectCorners(refLap);
  const matchedRef = matchLapToReference(
    { id: 'ref', sessionId: 'ref', startedAt: 0, durationMs: refDurationMs, gps: refSamples, samples: refSamples },
    refLap,
  );
  const bestSaved = saved[sessionBest.id] ?? sessionBest.gps;
  const sectorRef = (useExternalRef ? referenceFromLayout(layoutGps(reference!)) : null) ?? referenceFromLap({ gps: bestSaved });
  const refSplits = sectorSplits(useExternalRef ? layoutGps(reference!) : bestSaved, sectorRef);

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
  const cleanedRef = cleanSamples(layoutGps(layout), 10);
  const { samples: refSamples } = repairDegenerateTimestamps(cleanedRef, layout.durationMs);
  const refLap = buildReferenceLap(refSamples, { lat: refSamples[0].lat, lng: refSamples[0].lng });
  const corners = detectCorners(refLap);
  const sectorRef = referenceFromLayout(layoutGps(layout));
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
  const { samples: refSamples } = repairDegenerateTimestamps(layoutGps(layout), layout.durationMs);
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
      lapSampleCount: c.lap.gps.length,
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

/**
 * A detecção sobre os frames de análise, no relógio da sessão. O `expected.json` guarda
 * os cruzamentos e o início das voltas em epoch ms: o resumo soma o `t0`.
 */
function detectionSummary(frames: GpsFrame[], line: StartLine | null, t0: number) {
  const d = detectLaps(frames, { line });
  const at = <C extends { t: number }>(c: C): C => ({ ...c, t: t0 + c.t });
  return {
    movingStartIdx: d.movingStartIdx,
    startFinishLine: d.startFinishLine,
    laps: d.laps.map((l) => ({ ...l, startCross: at(l.startCross), endCross: at(l.endCross), startedAt: t0 + l.startedAt })),
    openCross: d.openCross && at(d.openCross),
  };
}

// ---------------------------------------------------------------------------
// Tudo
// ---------------------------------------------------------------------------

const DEMO_NOW = T0 + 20_000_000;

export type GoldenOutput = Record<string, Record<string, unknown>>;
type Put = (consumer: string, session: string, value: unknown) => void;

function collector(): { out: GoldenOutput; put: Put } {
  const out: GoldenOutput = {};
  return {
    out,
    put: (consumer, session, value) => {
      out[consumer] ??= {};
      out[consumer][session] = value;
    },
  };
}

/** Os consumidores de uma sessão: a lista de cada sessão no `expected.json`. */
async function putSession(put: Put, gs: GoldenSession): Promise<void> {
  put('lapRecords', gs.name, gs.laps.map((l) => lapSummary(l, gs.t0)));
  put('sessionScreen', gs.name, sessionScreen(gs));
  put('peakSpeedMsOfLaps', gs.name, peakSpeedMsOfLaps(gs.laps));
  put('buildLapInsight', gs.name, (() => {
    const r = buildLapInsight(gs.laps);
    return r && { ...r, best: { id: r.best.id, durationMs: r.best.durationMs, sampleCount: r.best.gps.length } };
  })());
  // O trompo sai no relógio da sessão; o `expected.json` guarda o instante absoluto.
  put('detectSpins', gs.name, gs.laps.map((l) => detectSpins(l.gps, l.imu).map((e) => ({ ...e, startT: gs.t0 + e.startT, endT: gs.t0 + e.endT }))));
  put('buildPilotDna', gs.name, buildPilotDna([{ trackName: gs.session.trackName, startedAt: gs.session.startedAt, laps: gs.laps }]));
  put('coachContext', gs.name, await coachContexts(gs));
  const bestLap = gs.laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), gs.laps[0]);
  put('countCorners', gs.name, countCorners(bestLap.samples));
  put('samplesToSilhouette', gs.name, samplesToSilhouette(bestLap.samples));
  put('polylineLength', gs.name, gs.laps.map((l) => polylineLength(l.samples)));
}

/** O Pilot DNA de todas as sessões juntas. */
function putDnaAll(put: Put, byName: (n: string) => GoldenSession): void {
  const dnaInputs: DnaSessionInput[] = ['demo', 's2', 's1', 's4'].map((n) => {
    const gs = byName(n);
    return { trackName: gs.session.trackName, startedAt: gs.session.startedAt, laps: gs.laps };
  });
  put('buildPilotDna', 'all', buildPilotDna(dnaInputs));
}

/** O traçado (sessão 3): linha, régua, curvas e silhueta. */
function putLayout(put: Put, layout: TrackLayout): void {
  const gps = layoutGps(layout);
  const layoutRef = referenceFromLayout(gps);
  put('lineFromLayout', 's3', lineFromLayout(gps));
  put('referenceFromLayout', 's3', layoutRef && refSummary(layoutRef));
  put('countCorners', 's3', countCorners(gps));
  put('samplesToSilhouette', 's3', samplesToSilhouette(gps));
  put('polylineLength', 's3', polylineLength(gps));
  put('sectorSplits', 's3', layoutRef && sectorSplits(gps, layoutRef));
}

/** Mapa detalhado e comparação: só com traçado. */
function putLayoutScreens(put: Put, s1LayoutLaps: LapRecord[], legacy: LapRecord, layout: TrackLayout): void {
  put('trackMapScreen', 's1Layout', trackMapScreen(s1LayoutLaps, layout));
  put('trackMapScreen', 's4', trackMapScreen([legacy], layout));
  const sorted = [...s1LayoutLaps].sort((a, b) => a.durationMs - b.durationMs);
  const spinLap = s1LayoutLaps[3];
  put('compareLaps', 's1Layout', [
    lapCompareScreen(sorted[1], sorted[0], layout),
    lapCompareScreen(spinLap, sorted[0], layout),
  ]);
  put('compareLaps', 's4', [lapCompareScreen(legacy, sorted[0], layout)]);
}

type Prepared = {
  s1: ReturnType<typeof session1>;
  s2: RecordedSessionInput;
  layout: TrackLayout;
  layoutLine: StartLine | null;
  layoutRef: ReferenceLap | null;
  s1Frames: GpsFrame[];
  s1ImuFrames: ImuFrame[];
  s2Frames: GpsFrame[];
  sessions: GoldenSession[];
};

let prepared: Promise<Prepared> | null = null;

/** As entradas e as voltas do pipeline, uma vez por processo (a demo é gravada uma vez no banco dela). */
function prepare(): Promise<Prepared> {
  prepared ??= (async () => {
    const s1 = session1();
    const s2 = session2();
    const layout = session3();
    const legacy = session4();
    const layoutLine = lineFromLayout(layoutGps(layout));
    const layoutRef = referenceFromLayout(layoutGps(layout));

    // Captura: os mesmos lotes que a tarefa de localização recebe, em frames.
    const s1Frames = await captureGps(s1.batches, s1.t0);
    const s1ImuFrames = captureImu(s1.imuEvents, s1.t0);
    const s2Frames = await captureGps(s2.batches, s2.t0);

    // Voltas salvas: janelas + lapFrames + toLapRecord, como no "Encerrar".
    const s1Laps = recordedLaps(s1Frames, s1ImuFrames, s1.t0, null).map((l, i) => toLapRecord(l, 'session_golden_s1', i));
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
    return { s1, s2, layout, layoutLine, layoutRef, s1Frames, s1ImuFrames, s2Frames, sessions };
  })();
  return prepared;
}

export async function runGolden(): Promise<GoldenOutput> {
  const { s1, s2, layout, layoutLine, layoutRef, s1Frames, s1ImuFrames, s2Frames, sessions } = await prepare();
  const byName = (n: string) => sessions.find((s) => s.name === n)!;
  // Os frames que a análise lê (≤ 30 m), no relógio da sessão.
  const s1Gps = analysisGps(s1Frames);
  const s2Gps = analysisGps(s2Frames);
  const { out, put } = collector();

  // Captura e detecção.
  put('handleLocations', 's1', gpsSeries(s1Gps, s1.t0));
  put('handleLocations', 's2', gpsSeries(s2Gps, s2.t0));
  put('handleLocations', 's1HeadTimesMs', s1Gps.slice(0, 300).map((p) => s1.t0 + p.t));
  put('imuPairing', 's1', imuSeries(s1ImuFrames, s1.t0));
  put('detectLaps', 's1', detectionSummary(s1Gps, null, s1.t0));
  put('detectLaps', 's1Layout', detectionSummary(s1Gps, layoutLine, s1.t0));
  put('detectLaps', 's2', detectionSummary(s2Gps, null, s2.t0));

  for (const gs of sessions) await putSession(put, gs);
  putDnaAll(put, byName);

  // Traçado (sessão 3), e o traçado novo que o "Encerrar" de uma gravação de
  // referência salvaria a partir da sessão 1.
  putLayout(put, layout);
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

  putLayoutScreens(put, byName('s1Layout').laps, byName('s4').laps[0], layout);

  // Ao vivo: a sequência do DeltaTracker e o payload de live_samples.
  put('livePoll', 's1', await livePoll(s1, null, null));
  put('livePoll', 's1Layout', await livePoll(s1, layoutLine, layoutRef));
  put('livePoll', 's2', await livePoll(s2, null, null));

  return out;
}

// ---------------------------------------------------------------------------
// Pipeline novo de ponta a ponta (T45): captura → diário no banco → "Encerrar" → loadLaps
// ---------------------------------------------------------------------------

/**
 * Uma gravação inteira pelo caminho do app, num banco sql.js: os lotes pela tarefa de
 * localização (`handleLocations` com o diário), os eventos da IMU pelo `createImuCapture`
 * e o diário, em ordem de chegada, com a escrita a cada 5 s; o `stop()` do hook
 * (janelas e `recordedLaps`), o `finishRecording` do "Encerrar" (sessão e janelas
 * numa transação, `journal.end`) e as voltas lidas de volta do banco pelo `loadLaps`.
 *
 * O id da sessão é o da gravação (`session_rec_<início>_<aleatório>`). As voltas são
 * renomeadas para o id da sessão de referência, que é o que o `expected.json` guarda:
 * o id é um nome, e nenhum número depende dele.
 */
async function recordOnDb(input: RecordedSessionInput, line: StartLine | null, sessionId: string): Promise<LapRecord[]> {
  const { conn, store } = await openV5Database();
  const journal = new RecordingJournal(store, () => input.t0);
  const recordingId = await journal.begin({
    mode: 'race',
    trackId: 'golden-track',
    trackName: 'Golden',
    layoutId: null,
    layoutName: null,
    kartSetupId: null,
    line,
  });
  const t0 = journal.t0Utc!;
  const buf = { samples: [] as GpsFrame[] };
  const clock = { trustsRaw: false, session: createSessionClock(t0) };
  const gps: GpsFrame[] = [];
  const imu: ImuFrame[] = [];
  let pendingImu: ImuFrame[] = [];
  let now = t0;
  const cap = createImuCapture(createSessionClock(t0), (f) => pendingImu.push(f), () => now);
  const drainImu = () => {
    if (pendingImu.length === 0) return;
    journal.appendImu(pendingImu);
    imu.push(...pendingImu);
    pendingImu = [];
  };

  type Arrival = { at: number; batch?: LocationBatch; imu?: ImuEvent };
  const arrivals: Arrival[] = [
    ...input.batches.map((b) => ({ at: b.arrivalAt, batch: b })),
    ...input.imuEvents.map((e) => ({ at: e.at, imu: e })),
  ].sort((a, b) => a.at - b.at);
  for (const a of arrivals) {
    now = a.at;
    if (a.batch) {
      const b = a.batch;
      await handleLocations(b.locations, {
        buf,
        journal,
        uiActive: true,
        stopLocationUpdates: async () => {},
        now: () => b.arrivalAt,
        clock,
      });
      gps.push(...buf.samples);
      buf.samples = [];
      drainImu();
    } else {
      const e = a.imu!;
      const reading = { x: e.x, y: e.y, z: e.z, timestamp: (e.at - IMU_BOOT_AT) / 1000 };
      if (e.kind === 'accel') cap.onAccel(reading);
      else cap.onGyro(reading);
    }
  }
  cap.flush();
  drainImu();
  await journal.flush();

  // O `stop()` do hook: janelas sobre os frames de análise e as voltas por `recordedLaps`.
  const series = recordingSeries('result', t0);
  const laps = stopLaps(sliceLapWindows(analysisGps(gps), line), gpsSeriesOf(series.gps, gps), imuSeriesOf(series.imu, imu), t0);
  const outcome = await finishRecording(
    { allSamples: analysisGps(gps), laps },
    { recordingId, trackName: 'Golden', trackId: 'golden-track', layoutId: null, kartSetupId: null, mode: 'race', startedAt: t0 },
    { journal, repo: sqlSessionRepo(async () => conn), postSave: async () => {} },
  );
  if (outcome.kind !== 'saved') throw new Error(`golden: o "Encerrar" não salvou (${outcome.kind})`);
  const saved = await loadLaps(conn, outcome.saved.session.id, { imu: true });
  return saved.map((l) => ({ ...l, id: l.id.replace(outcome.saved.session.id, sessionId), sessionId }));
}

/** As sessões gravadas (1 com e sem traçado, 2) pelo pipeline novo de ponta a ponta, nos consumidores. */
export async function runGoldenNewPipeline(): Promise<GoldenOutput> {
  const { s1, s2, layout, layoutLine, sessions } = await prepare();
  const byName = (n: string) => sessions.find((s) => s.name === n)!;
  const recorded: GoldenSession[] = [
    { ...byName('s1'), laps: await recordOnDb(s1, null, 'session_golden_s1') },
    { ...byName('s1Layout'), laps: await recordOnDb(s1, layoutLine, 'session_golden_s1_layout') },
    { ...byName('s2'), laps: await recordOnDb(s2, null, 'session_golden_s2') },
  ];
  const { out, put } = collector();
  for (const gs of recorded) await putSession(put, gs);
  putLayoutScreens(put, recorded[1].laps, byName('s4').laps[0], layout);
  return out;
}

// ---------------------------------------------------------------------------
// Caminho legado (T45): o JSON que o código antigo salvava → v5a/v5b/v5c → loadLaps
// ---------------------------------------------------------------------------

/**
 * As sessões de referência como o código antigo as deixava no banco v4: cada volta em
 * JSON na visão antiga (`t` absoluto, só as chaves de antes, accel em g, os pontos
 * sintéticos nas pontas) e o traçado da sessão 3 também em JSON. A migração v5 inteira
 * roda no sql.js, e as voltas e o traçado são lidos pelo `loadLaps` e pelo `layoutRepo`.
 */
export async function runGoldenLegacy(): Promise<GoldenOutput> {
  const { layout, sessions } = await prepare();
  const conn = await openV4Database();
  for (const gs of sessions) {
    const s = gs.session;
    await conn.runAsync(
      `INSERT INTO sessions (id, track_name, kart, notes, started_at, weather, track_id, mode, layout_id, kart_setup_id, recovered)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      s.id, s.trackName, s.kart, s.notes, s.startedAt, s.weather, s.trackId, s.mode, s.layoutId, s.kartSetupId,
    );
    for (const l of gs.laps) {
      await conn.runAsync(
        'INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json, imu_samples_json) VALUES (?, ?, ?, ?, ?, ?)',
        l.id,
        l.sessionId,
        l.startedAt,
        l.durationMs,
        JSON.stringify(l.gps.map((f) => legacyFrame(f, gs.t0))),
        l.imu && l.imu.length > 0 ? JSON.stringify(l.imu.map((f) => legacyImu(f, gs.t0))) : null,
      );
    }
  }
  await conn.runAsync(
    `INSERT INTO track_layouts (id, track_id, name, samples_json, duration_ms, length_m, recorded_at, source_session_id, source_lap_id, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    layout.id, layout.trackId, layout.name, JSON.stringify(layoutGps(layout).map((f) => legacyFrame(f, 0))),
    layout.durationMs, layout.lengthM, layout.recordedAt, layout.sourceSessionId ?? null, layout.sourceLapId ?? null, layout.isDefault ? 1 : 0,
  );

  await migrateV5Schema(migrationExecutorFrom(conn));
  const report = await migrateV5Data(conn, () => {});
  if (report.failed.length > 0) throw new Error(`golden: a v5b falhou em ${report.failed.join(', ')}`);
  if (!(await migrateV5Cleanup(migrationExecutorFrom(conn)))) throw new Error('golden: a v5c não rodou');

  const converted = (await getLayout(conn, layout.id))!;
  const migrated: GoldenSession[] = [];
  for (const gs of sessions) {
    const gpsSeries = (await readSeries(conn, sessionOwner(gs.session.id), { kinds: ['gps'] })).series[0];
    migrated.push({
      ...gs,
      laps: await loadLaps(conn, gs.session.id, { imu: true }),
      layout: gs.layout ? converted : null,
      t0: gpsSeries.meta.t0Utc!,
    });
  }
  const byName = (n: string) => migrated.find((s) => s.name === n)!;
  const { out, put } = collector();
  for (const gs of migrated) await putSession(put, gs);
  putDnaAll(put, byName);
  putLayout(put, converted);
  putLayoutScreens(put, byName('s1Layout').laps, byName('s4').laps[0], converted);
  return out;
}

/** O que vai para o JSON: undefined some, como no arquivo gravado. */
export function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
