/**
 * O poll de 500 ms do ao vivo, fora do hook e sem nada nativo: recebe todos os
 * frames de GPS da gravação e devolve o que o `info` do HUD mostra (voltas,
 * melhor e anterior, delta ao vivo, S1/S2/S3). O hook (`useLapRecorder`) só
 * drena os buffers, chama `step` e publica o estado; a comparação de referência
 * (golden) roda este mesmo código em Node.
 *
 * A detecção roda sobre os frames de análise (`analysisGps`, ≤ 30 m, TF-12), com
 * a linha da gravação: a mesma função e a mesma linha do "Encerrar" (TMP-06).
 * Os índices (`openCross.idx`, voltas) são índices nesse array de análise.
 */
import type { ReferenceLap } from '../lib/geometry';
import { detectLaps, type DetectLapsResult, type OpenCross } from '../lib/lapDetector';
import { DeltaTracker, type DeltaReading } from '../lib/realtimeDelta';
import { sectorSplits } from '../lib/sectors';
import type { CrossPoint, StartLine } from '../lib/startLine';
import type { GpsFrame } from '../telemetry/frame';
import { analysisGps, type AnalysisGpsFrame } from '../telemetry/laps';
import { sliceLaps } from './finishSession';
import { deltaReferenceLap, lapOpened, liveLapClock } from './liveLapClock';

export type ReferenceMode = 'best' | 'previous';

/** S1/S2/S3; null = o setor ainda não fechou. */
export type SectorTimes = { s1Ms: number | null; s2Ms: number | null; s3Ms: number | null };

/** Snapshot da volta que acabou de fechar (ver `ClosedLapInfo` no hook). */
export type ClosedLap = {
  lapNumber: number;
  durationMs: number;
  deltaVsRefMs: number | null;
  isPb: boolean;
  referenceMode: ReferenceMode;
};

export type LivePollResult = {
  /** Os frames de análise (≤ 30 m) da gravação até agora. */
  all: AnalysisGpsFrame[];
  last: AnalysisGpsFrame | undefined;
  detection: DetectLapsResult;
  bestLapMs: number | null;
  previousLapMs: number | null;
  currentLapElapsedMs: number | null;
  /** A leitura do `DeltaTracker` no último frame, ou null sem referência/volta. */
  reading: DeltaReading | null;
  liveDeltaMs: number | null;
  justSetNewBest: boolean;
  lastClosedLap: ClosedLap | null;
  currentSectorIdx: 0 | 1 | 2 | null;
  currentSectorElapsedMs: number | null;
  currentSectors: SectorTimes;
  lastClosedLapSectors: SectorTimes | null;
  bestSectors: SectorTimes;
};

export type LivePoll = {
  step(frames: readonly GpsFrame[], ctx: { nowMs: number; mode: ReferenceMode }): LivePollResult;
  /** O modo de referência mudou: o próximo `step` recarrega a referência do tracker. */
  invalidateReference(): void;
};

/** Ponto sintético na linha de chegada (AD-006), como o `sliceLaps` monta. */
function crossSample(cross: CrossPoint, from: GpsFrame): GpsFrame {
  return {
    kind: 'gps',
    source: from.source,
    fix: 'unknown',
    t: cross.t,
    lat: cross.lat,
    lng: cross.lng,
    speed: cross.speed,
    accuracy: from.accuracy,
    synthetic: true,
  };
}

/**
 * Pontos da volta em curso, do jeito que o `sliceLaps` vai recortá-la quando
 * fechar: o cruzamento que a abriu (`openCross` do `detectLaps`, ponto
 * sintético) e os pontos crus depois dele. Depois de um box, é o cruzamento
 * depois da parada, e não o fim da última volta fechada. `null` se a volta
 * ainda não abriu.
 */
function currentLapSamples(all: GpsFrame[], openCross: OpenCross | null): GpsFrame[] | null {
  if (!openCross) return null;
  const t0 = openCross.t;
  return [crossSample(openCross, all[openCross.idx]), ...all.slice(openCross.idx).filter((p) => p.t > t0)];
}

/**
 * Poll de uma gravação. `line` é a linha da gravação (do traçado, ou null para a
 * inferida), fixada no início. `sectorRef` dá a régua de S1/S2/S3 do traçado
 * (null sem traçado), lida a cada poll, como o hook fazia.
 */
export function createLivePoll(line: StartLine | null, sectorRef: () => ReferenceLap | null): LivePoll {
  const tracker = new DeltaTracker();
  let trackerLoadedFrom: { mode: ReferenceMode; lapIdx: number } | null = null;
  let lastLapCount = 0;
  let lastOpenCross: OpenCross | null = null;
  let newBestUntil = 0;
  let closedLapData: ClosedLap | null = null;
  let closedLapClearAt = 0;
  const best: { s1: number | null; s2: number | null; s3: number | null } = { s1: null, s2: null, s3: null };
  let lastClosedLapSectors: SectorTimes | null = null;

  return {
    invalidateReference() {
      trackerLoadedFrom = null;
    },

    step(frames, { nowMs, mode }) {
      const all = analysisGps(frames);
      const sectors = line ? sectorRef() : null;
      const last = all[all.length - 1];
      const detection = detectLaps(all, { line });

      // Melhor + anterior + índice da PB
      let bestLapMs: number | null = null;
      let bestLapIdx = -1;
      for (let i = 0; i < detection.laps.length; i++) {
        const lap = detection.laps[i];
        if (bestLapMs === null || lap.durationMs < bestLapMs) {
          bestLapMs = lap.durationMs;
          bestLapIdx = i;
        }
      }
      const previousLapMs = detection.laps.length > 0 ? detection.laps[detection.laps.length - 1].durationMs : null;
      const previousLapIdx = detection.laps.length - 1;

      // 'best' usa a PB da sessão; 'previous' usa a última volta fechada.
      const refLapIdx = mode === 'best' ? bestLapIdx : previousLapIdx;

      // Volta nova abriu desde o último poll (fechou uma volta ou, depois de
      // um box, a anterior foi descartada por passar de 180 s): o hint do
      // tracker volta ao início do traçado (TMP-10).
      if (lapOpened(lastOpenCross, detection.openCross)) tracker.resetLap();
      lastOpenCross = detection.openCross;

      // Volta nova fechou desde o último poll?
      if (detection.laps.length > lastLapCount) {
        const closed = detection.laps[detection.laps.length - 1];
        // Delta contra a referência que estava ativa enquanto a volta era andada.
        const priorLaps = detection.laps.slice(0, lastLapCount);
        const previousBest = priorLaps.length > 0 ? Math.min(...priorLaps.map((l) => l.durationMs)) : Infinity;
        const isPb = closed.durationMs < previousBest;
        if (isPb) newBestUntil = nowMs + 4000;

        let deltaVsRefMs: number | null = null;
        if (priorLaps.length > 0) {
          const priorRefMs = mode === 'best' ? previousBest : priorLaps[priorLaps.length - 1].durationMs;
          deltaVsRefMs = closed.durationMs - priorRefMs;
        }
        closedLapData = { lapNumber: detection.laps.length, durationMs: closed.durationMs, deltaVsRefMs, isPb, referenceMode: mode };
        // Janela de 1 s para a UI capturar o overlay.
        closedLapClearAt = nowMs + 1000;

        // Setores da volta que acabou de fechar: a volta recortada pelo mesmo
        // `sliceLaps` do "Encerrar" (pontos de fronteira na linha), medida pela
        // mesma `sectorSplits` da análise. É o que vai para a equipe (TMP-08).
        if (sectors) {
          const sliced = sliceLaps(all, [], line);
          const splits = sectorSplits(sliced[sliced.length - 1].gps, sectors);
          lastClosedLapSectors = splits;
          const { s1Ms: s1, s2Ms: s2, s3Ms: s3 } = splits;
          if (s1 !== null && s2 !== null && s3 !== null) {
            if (best.s1 === null || s1 < best.s1) best.s1 = s1;
            if (best.s2 === null || s2 < best.s2) best.s2 = s2;
            if (best.s3 === null || s3 < best.s3) best.s3 = s3;
          }
        }
        // Força o reload da referência abaixo.
        trackerLoadedFrom = null;
      }
      lastLapCount = detection.laps.length;

      // (Re)carrega a referência no tracker se mudou o modo ou o índice. A volta
      // com os pontos de fronteira na linha (AD-006): o t = 0 da referência é o cruzamento.
      const loaded = trackerLoadedFrom;
      if (refLapIdx >= 0 && (loaded === null || loaded.mode !== mode || loaded.lapIdx !== refLapIdx)) {
        const refLap = deltaReferenceLap(all, line, refLapIdx);
        if (refLap) tracker.setReference(refLap.gps, refLap.durationMs);
        trackerLoadedFrom = { mode, lapIdx: refLapIdx };
      } else if (refLapIdx < 0 && tracker.hasReference()) {
        tracker.clear();
        trackerLoadedFrom = null;
      }

      // Tempo da volta em curso, a partir do cruzamento que a abriu. Com
      // traçado, antes do 1º cruzamento o cronômetro não corre.
      const clock = last ? liveLapClock(detection, all, last.t, line) : null;
      const currentLapElapsedMs = clock ? clock.elapsedMs : null;

      const reading =
        last && currentLapElapsedMs !== null && tracker.hasReference() ? tracker.compute(last, currentLapElapsedMs) : null;

      // Setores da volta em curso, pela mesma `sectorSplits` do fechamento e
      // da análise (TMP-07). S3 só sai quando a volta fecha.
      let currentSectorIdx: 0 | 1 | 2 | null = null;
      let currentSectorElapsedMs: number | null = null;
      let currentSectors: SectorTimes = { s1Ms: null, s2Ms: null, s3Ms: null };
      if (last && sectors) {
        const lapSamples = currentLapSamples(all, detection.openCross);
        if (lapSamples) {
          const splits = sectorSplits(lapSamples, sectors);
          currentSectors = { s1Ms: splits.s1Ms, s2Ms: splits.s2Ms, s3Ms: null };
          const lapStartT = lapSamples[0].t;
          if (splits.s1Ms === null) {
            currentSectorIdx = 0;
            currentSectorElapsedMs = last.t - lapStartT;
          } else if (splits.s2Ms === null) {
            currentSectorIdx = 1;
            currentSectorElapsedMs = last.t - (lapStartT + splits.s1Ms);
          } else {
            currentSectorIdx = 2;
            currentSectorElapsedMs = last.t - (lapStartT + splits.s1Ms + splits.s2Ms);
          }
        }
      }

      return {
        all,
        last,
        detection,
        bestLapMs,
        previousLapMs,
        currentLapElapsedMs,
        reading,
        liveDeltaMs: reading ? reading.deltaMs : null,
        justSetNewBest: nowMs < newBestUntil,
        lastClosedLap: nowMs < closedLapClearAt ? closedLapData : null,
        currentSectorIdx,
        currentSectorElapsedMs,
        currentSectors,
        lastClosedLapSectors,
        bestSectors: { s1Ms: best.s1, s2Ms: best.s2, s3Ms: best.s3 },
      };
    },
  };
}
