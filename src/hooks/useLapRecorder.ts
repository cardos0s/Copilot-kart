import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { GpsSample, LatLng } from '../lib/geometry';
import { detectLaps, DetectedLap } from '../lib/lapDetector';
import { DeltaTracker } from '../lib/realtimeDelta';

const BG_TASK = 'KARTLAP_BG_LOCATION';

type Buffer = { samples: GpsSample[] };
const buf: Buffer = (globalThis as any).__kartlapBuf ?? { samples: [] };
(globalThis as any).__kartlapBuf = buf;

TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[Copilot BG] erro:', error);
    return;
  }
  const { locations } = (data as any) ?? {};
  if (!locations) return;
  for (const loc of locations as Location.LocationObject[]) {
    if ((loc.coords.accuracy ?? 999) > 30) continue;
    // Fallback pra Date.now() porque algumas builds Expo/Android entregam
    // loc.timestamp = 0 ou undefined; sem isso a volta inteira fica com
    // tMs constante e a análise por setor zera (curMs = 0 em tudo).
    const t = loc.timestamp && loc.timestamp > 0 ? loc.timestamp : Date.now();
    buf.samples.push({
      t,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      speed: loc.coords.speed ?? 0,
      accuracy: loc.coords.accuracy ?? 999,
      heading: loc.coords.heading ?? undefined,
    });
  }
});

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped';

export type ReferenceMode = 'best' | 'previous';

export type LiveInfo = {
  totalSamples: number;
  lastAccuracy: number;
  lastSpeedKmh: number;
  elapsedMs: number;
  isMoving: boolean;
  /** Número de voltas completadas (detectadas em tempo real) */
  lapsCompleted: number;
  /** Tempo da melhor volta até agora, ms */
  bestLapMs: number | null;
  /** Tempo da volta imediatamente anterior, ms. Vira null quando ainda
   *  não há volta fechada. */
  previousLapMs: number | null;
  /** Tempo decorrido desde o início da volta ATUAL (em curso). Zera ao
   *  cruzar a linha de chegada. null quando ainda não entrou em ritmo. */
  currentLapElapsedMs: number | null;
  /**
   * Delta em tempo real no ponto atual da pista, comparado contra a
   * referência ativa (best ou previous, depende de `referenceMode`).
   *
   * Negativo = mais rápido que a referência no mesmo ponto = VERDE.
   * Positivo = mais lento = VERMELHO.
   * null = sem referência ainda, ou sample fora do traçado, ou map
   *        matching falhou. UI cai pra mostrar o cronômetro nu.
   */
  liveDeltaMs: number | null;
  /** Modo atual da referência usada pelo liveDeltaMs. */
  referenceMode: ReferenceMode;
  /** True quando a última volta fechada virou nova melhor da sessão.
   *  Vira false depois de 4s (resetado pelo próximo poll). Útil pra
   *  flashar "NEW BEST!" sem precisar de timer na UI. */
  justSetNewBest: boolean;
};

/** Volta pronta pra consumo — samples já recortados, duração calculada. */
export type RecordedLap = {
  samples: GpsSample[];
  durationMs: number;
  startedAt: number;
};

/** Resultado final de uma gravação. Fonte única de verdade pro que foi gravado. */
export type RecordingResult = {
  /** Todas as amostras capturadas, em ordem cronológica. */
  allSamples: GpsSample[];
  /** Voltas fechadas, já recortadas e com duração. */
  laps: RecordedLap[];
  /** Índice em allSamples onde o piloto entrou em ritmo. -1 se nunca entrou. */
  movingStartIdx: number;
  /** Linha de largada detectada. null se nunca entrou em ritmo. */
  startFinishLine: LatLng | null;
};

export type LapRecorderOptions = {
  /** Se definido, quando lapsCompleted >= targetLaps o hook chama onTargetReached */
  targetLaps?: number;
  onTargetReached?: () => void;
};

/**
 * Hook de gravação de GPS com detecção de voltas em tempo real.
 *
 * Responsabilidades:
 *   1. Gerenciar o ciclo de vida do background location task.
 *   2. Drenar o buffer global para um array estável.
 *   3. Chamar detectLaps() a cada poll pra atualizar estado reativo.
 *   4. No stop(), entregar voltas já recortadas (não samples crus).
 *
 * NÃO-responsabilidades:
 *   - Implementar a lógica de detecção de voltas (vive em src/lib/lapDetector.ts).
 *   - Persistir em SQLite (responsabilidade de quem chama stop()).
 */
export function useLapRecorder(options?: LapRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle');
  const [info, setInfo] = useState<LiveInfo>({
    totalSamples: 0,
    lastAccuracy: 0,
    lastSpeedKmh: 0,
    elapsedMs: 0,
    isMoving: false,
    lapsCompleted: 0,
    bestLapMs: null,
    previousLapMs: null,
    currentLapElapsedMs: null,
    liveDeltaMs: null,
    referenceMode: 'best',
    justSetNewBest: false,
  });
  /** Samples expostos pra UI (radar ao vivo). Decimados pra não re-render demais. */
  const [liveSamples, setLiveSamples] = useState<GpsSample[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTRef = useRef<number>(0);
  const allSamplesRef = useRef<GpsSample[]>([]);
  const lastDetectionRef = useRef<DetectedLap[]>([]);
  const movingStartIdxRef = useRef<number>(-1);
  const targetReachedRef = useRef<boolean>(false);

  // ===== Realtime delta (MyChron-style) =====
  // O tracker é stateful — segura referência preparada + hint do último
  // segmento matched. Vive em ref pra não re-criar a cada render.
  const deltaTrackerRef = useRef<DeltaTracker>(new DeltaTracker());
  // Modo de referência ativo (best=melhor da sessão, previous=volta anterior).
  // Vive em ref pra que o poll leia o valor atual sem precisar de dep no
  // useEffect (poll roda de 500ms em 500ms).
  const refModeRef = useRef<ReferenceMode>('best');
  // Marca qual volta (índice em laps[]) está carregada no tracker. Evita
  // refazer o setReference toda iteração se nada mudou.
  const trackerLoadedFromRef = useRef<{ mode: ReferenceMode; lapIdx: number } | null>(null);
  // Conta de voltas no último poll — pra detectar "fechou nova volta".
  const lastLapCountInPollRef = useRef<number>(0);
  // Quando bateu PB, registra timestamp pra UI flashar 4s.
  const newBestUntilRef = useRef<number>(0);

  const start = useCallback(async () => {
    setState('requesting');
    buf.samples = [];
    allSamplesRef.current = [];
    lastDetectionRef.current = [];
    movingStartIdxRef.current = -1;
    targetReachedRef.current = false;
    deltaTrackerRef.current.clear();
    trackerLoadedFromRef.current = null;
    lastLapCountInPollRef.current = 0;
    newBestUntilRef.current = 0;

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      setState('idle');
      throw new Error('Permissão de localização negada');
    }
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      console.warn('Permissão de background negada — gravação para se a tela apagar');
    }

    await activateKeepAwakeAsync('copilot-recording');

    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 100,
      distanceInterval: 0,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Copilot gravando',
        notificationBody: 'Gravando trajetória da pista',
        notificationColor: '#00ff88',
      },
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
    });

    startTRef.current = Date.now();
    setState('recording');
    setLiveSamples([]);

    pollRef.current = setInterval(() => {
      // Drena buffer
      if (buf.samples.length > 0) {
        allSamplesRef.current.push(...buf.samples);
        buf.samples = [];
      }
      const all = allSamplesRef.current;
      const last = all[all.length - 1];

      // Detecção de voltas — uma única chamada, mesma função que o stop() usa.
      const detection = detectLaps(all);
      lastDetectionRef.current = detection.laps;
      movingStartIdxRef.current = detection.movingStartIdx;

      // Target atingido?
      const target = options?.targetLaps;
      if (target && !targetReachedRef.current && detection.laps.length >= target) {
        targetReachedRef.current = true;
        options?.onTargetReached?.();
      }

      // Melhor + anterior + índice da PB ===========================
      let bestLapMs: number | null = null;
      let bestLapIdx = -1;
      for (let i = 0; i < detection.laps.length; i++) {
        const lap = detection.laps[i];
        if (bestLapMs === null || lap.durationMs < bestLapMs) {
          bestLapMs = lap.durationMs;
          bestLapIdx = i;
        }
      }
      const previousLapMs =
        detection.laps.length > 0
          ? detection.laps[detection.laps.length - 1].durationMs
          : null;
      const previousLapIdx = detection.laps.length - 1;

      // ===== Delta em tempo real =====
      const tracker = deltaTrackerRef.current;
      const mode = refModeRef.current;

      // Decide qual volta vai pro tracker como referência neste poll.
      // 'best' usa a PB da sessão; 'previous' usa a última volta fechada
      // (que pode ser igual à best quando bateu PB agora).
      const refLapIdx = mode === 'best' ? bestLapIdx : previousLapIdx;

      // Volta nova fechou desde o último poll? Trata 3 coisas:
      //   1. Reseta o lap state do tracker (s volta a zero conceitualmente)
      //   2. Se bateu PB, marca flash de "NEW BEST!" por 4s
      //   3. Marca tracker como "precisa recarregar referência" — porque a
      //      melhor mudou (e/ou a "anterior" mudou)
      const closedNewLap = detection.laps.length > lastLapCountInPollRef.current;
      if (closedNewLap) {
        tracker.resetLap();
        const last = detection.laps[detection.laps.length - 1];
        const previousBest =
          lastLapCountInPollRef.current > 0
            ? Math.min(
                ...detection.laps
                  .slice(0, lastLapCountInPollRef.current)
                  .map((l) => l.durationMs)
              )
            : Infinity;
        if (last.durationMs < previousBest) {
          newBestUntilRef.current = Date.now() + 4000;
        }
        // Força reload da referência no próximo bloco
        trackerLoadedFromRef.current = null;
      }
      lastLapCountInPollRef.current = detection.laps.length;

      // (Re)carrega a referência no tracker se mudou o modo ou o índice.
      const loaded = trackerLoadedFromRef.current;
      if (
        refLapIdx >= 0 &&
        (loaded === null || loaded.mode !== mode || loaded.lapIdx !== refLapIdx)
      ) {
        const refLap = detection.laps[refLapIdx];
        const refSamples = all.slice(refLap.startIdx, refLap.endIdx + 1);
        tracker.setReference(refSamples, refLap.durationMs);
        trackerLoadedFromRef.current = { mode, lapIdx: refLapIdx };
      } else if (refLapIdx < 0 && tracker.hasReference()) {
        tracker.clear();
        trackerLoadedFromRef.current = null;
      }

      // Calcula elapsed da volta ATUAL (em curso).
      // tStartCurrentLap = primeiro sample após a última volta fechada,
      //                    ou movingStartIdx se ainda não fechou nenhuma.
      let currentLapElapsedMs: number | null = null;
      if (last && detection.movingStartIdx >= 0) {
        const startIdx =
          detection.laps.length > 0
            ? detection.laps[detection.laps.length - 1].endIdx + 1
            : detection.movingStartIdx;
        if (startIdx < all.length) {
          currentLapElapsedMs = last.t - all[startIdx].t;
        }
      }

      // Computa delta no último sample.
      let liveDeltaMs: number | null = null;
      if (last && currentLapElapsedMs !== null && tracker.hasReference()) {
        const reading = tracker.compute(last, currentLapElapsedMs);
        liveDeltaMs = reading.deltaMs;
      }

      setInfo({
        totalSamples: all.length,
        lastAccuracy: last?.accuracy ?? 0,
        lastSpeedKmh: last ? last.speed * 3.6 : 0,
        elapsedMs: Date.now() - startTRef.current,
        isMoving: last ? last.speed > 5 : false,
        lapsCompleted: detection.laps.length,
        bestLapMs,
        previousLapMs,
        currentLapElapsedMs,
        liveDeltaMs,
        referenceMode: mode,
        justSetNewBest: Date.now() < newBestUntilRef.current,
      });

      // Live samples pro radar: só expõe a partir de quando entrou em ritmo
      if (detection.movingStartIdx >= 0) {
        const movingSamples = all.slice(detection.movingStartIdx);
        const step = Math.max(1, Math.floor(movingSamples.length / 300));
        setLiveSamples(movingSamples.filter((_, i) => i % step === 0));
      } else {
        setLiveSamples([]);
      }
    }, 500);
  }, [options?.targetLaps, options?.onTargetReached]);

  const stop = useCallback(async (): Promise<RecordingResult> => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(BG_TASK);
      if (started) await Location.stopLocationUpdatesAsync(BG_TASK);
    } catch (e) {
      console.warn('stop:', e);
    }
    deactivateKeepAwake('copilot-recording');

    // Última drenagem do buffer — pode ter samples chegando entre o poll
    // anterior e agora.
    if (buf.samples.length > 0) {
      allSamplesRef.current.push(...buf.samples);
      buf.samples = [];
    }

    const allSamples = allSamplesRef.current;
    setState('stopped');

    // Detecção final com os samples completos, incluindo o que chegou na
    // última janela. Essa é a fonte de verdade que os consumidores usam.
    const detection = detectLaps(allSamples);

    // Materializa as voltas: aqui sim copiamos slices, porque é uma vez só
    // no fim da gravação. O consumidor recebe voltas prontas pra persistir.
    const laps: RecordedLap[] = detection.laps.map((lap) => ({
      samples: allSamples.slice(lap.startIdx, lap.endIdx + 1),
      durationMs: lap.durationMs,
      startedAt: lap.startedAt,
    }));

    return {
      allSamples,
      laps,
      movingStartIdx: detection.movingStartIdx,
      startFinishLine: detection.startFinishLine,
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      Location.hasStartedLocationUpdatesAsync(BG_TASK).then((started) => {
        if (started) Location.stopLocationUpdatesAsync(BG_TASK).catch(() => {});
      });
      deactivateKeepAwake('copilot-recording');
    };
  }, []);

  /**
   * Alterna o modo da referência usada pelo delta em tempo real.
   * Aplicado imediatamente — o próximo poll (até 500ms) já reflete na UI.
   */
  const setReferenceMode = useCallback((mode: ReferenceMode) => {
    refModeRef.current = mode;
    // Força o tracker a recarregar — não temos como saber qual é o lap idx
    // certo daqui, mas marcar como null faz o poll detectar e recarregar.
    trackerLoadedFromRef.current = null;
  }, []);

  return { state, info, liveSamples, start, stop, setReferenceMode };
}