import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { GpsSample, LatLng } from '../lib/geometry';
import { detectLaps, DetectedLap } from '../lib/lapDetector';

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
  });
  /** Samples expostos pra UI (radar ao vivo). Decimados pra não re-render demais. */
  const [liveSamples, setLiveSamples] = useState<GpsSample[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTRef = useRef<number>(0);
  const allSamplesRef = useRef<GpsSample[]>([]);
  const lastDetectionRef = useRef<DetectedLap[]>([]);
  const movingStartIdxRef = useRef<number>(-1);
  const targetReachedRef = useRef<boolean>(false);

  const start = useCallback(async () => {
    setState('requesting');
    buf.samples = [];
    allSamplesRef.current = [];
    lastDetectionRef.current = [];
    movingStartIdxRef.current = -1;
    targetReachedRef.current = false;

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

      // Melhor volta até agora
      let bestLapMs: number | null = null;
      for (const lap of detection.laps) {
        if (bestLapMs === null || lap.durationMs < bestLapMs) {
          bestLapMs = lap.durationMs;
        }
      }

      setInfo({
        totalSamples: all.length,
        lastAccuracy: last?.accuracy ?? 0,
        lastSpeedKmh: last ? last.speed * 3.6 : 0,
        elapsedMs: Date.now() - startTRef.current,
        isMoving: last ? last.speed > 5 : false,
        lapsCompleted: detection.laps.length,
        bestLapMs,
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

  return { state, info, liveSamples, start, stop };
}