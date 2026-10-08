import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { DEMO_LAP } from '../data/demoLap';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import type { LatLng, ReferenceLap } from '../lib/geometry';
import { detectLaps } from '../lib/lapDetector';
import { referenceFromLayout } from '../lib/sectors';
import { lineFromLayout, type StartLine } from '../lib/startLine';
import { recordedLaps, type RecordedLap } from '../recording/finishSession';
import { createImuCapture, type ImuCapture } from '../recording/imuCapture';
import { recordingSeries, type RecordingMetaInput } from '../recording/journal';
import {
  createLivePoll,
  type ClosedLap,
  type LivePoll,
  type ReferenceMode,
  type SectorTimes,
} from '../recording/livePoll';
import { createSessionClock, type SessionClock } from '../recording/sessionClock';
import { createSimulation } from '../recording/simulation';
import type { GpsFrame, ImuFrame } from '../telemetry/frame';
import { analysisGps, sliceLapWindows, type AnalysisGpsFrame, type LapWindowRecord } from '../telemetry/laps';
import { gpsSeriesOf, imuSeriesOf } from '../telemetry/series';
import {
  BG_TASK,
  buf,
  setLocationTaskJournal,
  setLocationTaskUiActive,
} from '../recording/locationTask';
import { journal } from '../recording/runtime';

// IMU update rate em ms. 20ms = 50Hz — suficiente pra capturar rotação de
// spin (durações típicas 200-800ms) sem virar mar de dados (50 amostras/s
// vs 10 do GPS = 5x mais por volta de 50s ≈ 2500 samples IMU/volta).
const IMU_UPDATE_MS = 20;

/** Mensagem da spec (REC-10, AC 2) quando o GPS não liga. */
export const GPS_START_ERROR =
  'Não consegui ligar o GPS. Confira a permissão de localização e tente de novo.';

// O buffer global (`buf`), o `BG_TASK` e o `defineTask` vivem em
// `src/recording/locationTask.ts`, importado no topo de `app/_layout.tsx`.

/**
 * Subscriptions ativas dos sensores IMU. O pareamento de acelerômetro e
 * giroscópio e o relógio estão em `createImuCapture` (relógio do sensor, no
 * relógio da sessão); os frames vão para `buf.imu`.
 *
 * Estratégia: usamos os listeners "globais" do expo-sensors que rodam no
 * native side enquanto a app está em foreground. Em background, IMU para
 * — diferente do GPS via TaskManager. Aceitável porque a tela de gravação
 * fica em landscape acordada (KeepAwake).
 */
let accelSub: { remove: () => void } | null = null;
let gyroSub: { remove: () => void } | null = null;
let imuCapture: ImuCapture | null = null;

function startImuCapture(clock: SessionClock) {
  // Idempotente — se já tá rodando, não duplica subscription.
  if (accelSub || gyroSub) return;
  const capture = createImuCapture(clock, (frame) => buf.imu.push(frame));
  imuCapture = capture;
  Accelerometer.setUpdateInterval(IMU_UPDATE_MS);
  Gyroscope.setUpdateInterval(IMU_UPDATE_MS);
  accelSub = Accelerometer.addListener((m) => capture.onAccel(m));
  gyroSub = Gyroscope.addListener((m) => capture.onGyro(m));
}

function stopImuCapture() {
  accelSub?.remove();
  gyroSub?.remove();
  accelSub = null;
  gyroSub = null;
  // A leitura que ficou sem par sai sozinha (edge do par incompleto).
  imuCapture?.flush();
  imuCapture = null;
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped';

export type { ReferenceMode };

/**
 * Snapshot da volta que acabou de fechar. Exposto no LiveInfo por uma
 * janela curta (~1s) após cada cruzamento da linha de chegada, depois
 * volta a null.
 *
 * É a fonte que alimenta o overlay animado de GANHOU/PERDEU na tela do
 * kart. O componente de UI captura esse dado em estado local quando
 * lapNumber muda e roda a animação independente (3s) — então não importa
 * se o hook nulifica antes do fim da animação.
 *
 * deltaVsRefMs é calculado contra a referência ATIVA NO MOMENTO em que
 * a volta fechou (best ou previous, conforme referenceMode). Pra primeira
 * volta da sessão, não há referência prévia → deltaVsRefMs é null e
 * isPb é true automaticamente.
 */
export type ClosedLapInfo = ClosedLap;

/**
 * Tempos S1/S2/S3 — quando algum é null, ainda não fechou aquele setor.
 * Setores são definidos em fração da pista (1/3 e 2/3 da polyline de
 * referência do layout). Quando uma volta fecha, S3 fica preenchido.
 */
export type { SectorTimes };

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
  /**
   * Snapshot da última volta fechada — exposto por ~1s após o cruzamento,
   * depois volta a null. Dispara o overlay GANHOU/PERDEU na UI (que tem
   * animação própria de 3s — não depende dessa janela).
   *
   * Null fora da janela e antes da 1ª volta. lapNumber mudando entre
   * polls é o sinal pra UI animar.
   */
  lastClosedLap: ClosedLapInfo | null;

  // ===== Sectors (S1/S2/S3) =====
  // Setores geográficos: 1/3 e 2/3 da polyline de referência do layout.
  // Só preenchem quando setLayoutReference foi chamado (i.e., a pista tem
  // referência salva). Sem layout ref → todos os campos abaixo ficam null.

  /** Setor onde o piloto está AGORA: 0 (S1), 1 (S2), 2 (S3) ou null. */
  currentSectorIdx: 0 | 1 | 2 | null;
  /** Tempo decorrido no setor ATUAL (não na volta inteira). null se não há ref. */
  currentSectorElapsedMs: number | null;
  /** Tempos S1/S2/S3 da volta em curso, parciais. Cada um vira número
   *  no momento que o piloto cruza o limite geográfico do setor. S3 só
   *  preenche quando a volta fecha (vai pro lastClosedLapSectors). */
  currentSectors: SectorTimes;
  /** Tempos S1/S2/S3 da última volta fechada. Preenche quando lapsCompleted
   *  incrementa. Null antes da 1ª volta ou se não havia layout ref. */
  lastClosedLapSectors: SectorTimes | null;
  /** Melhor S1, S2, S3 observados na sessão (campos independentes — podem
   *  vir de voltas diferentes). Pra destacar "PB do setor" mesmo quando a
   *  volta inteira não é PB. */
  bestSectors: SectorTimes;

  /** A última escrita do diário falhou: o HUD mostra "Salvamento automático falhou". */
  autosaveFailed: boolean;
};

/** Volta pronta pra consumo — samples já recortados, duração calculada. */
export type { RecordedLap };

/** Resultado final de uma gravação. Fonte única de verdade pro que foi gravado. */
export type RecordingResult = {
  /** Início da sessão (epoch ms): o `t` dos frames conta a partir dele. */
  t0Utc: number;
  /** Todos os frames de GPS capturados, inclusive os com precisão pior que 30 m. */
  gps: GpsFrame[];
  /** Todos os frames de IMU capturados, em ordem cronológica. */
  imu: ImuFrame[];
  /** As voltas fechadas como janelas sobre o bruto. */
  windows: LapWindowRecord[];
  /** Os frames de análise (≤ 30 m). Transição: as telas ainda contam pontos por aqui. */
  allSamples: AnalysisGpsFrame[];
  /** Voltas fechadas, já recortadas (janela e frames) e com duração. */
  laps: RecordedLap[];
  /** Índice em allSamples (frames de análise) onde o piloto entrou em ritmo. -1 se nunca entrou. */
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
 *   5. Alimentar o diário da gravação (`journal`) durante a sessão.
 *
 * NÃO-responsabilidades:
 *   - Implementar a lógica de detecção de voltas (vive em src/lib/lapDetector.ts).
 *   - Salvar a sessão e apagar o diário (quem chama stop(), via finishSession).
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
    lastClosedLap: null,
    currentSectorIdx: null,
    currentSectorElapsedMs: null,
    currentSectors: { s1Ms: null, s2Ms: null, s3Ms: null },
    lastClosedLapSectors: null,
    bestSectors: { s1Ms: null, s2Ms: null, s3Ms: null },
    autosaveFailed: false,
  });
  /** Frames de análise expostos pra UI (radar ao vivo). Decimados pra não re-render demais. */
  const [liveSamples, setLiveSamples] = useState<AnalysisGpsFrame[]>([]);
  /** Início da sessão em curso (epoch ms): o `t` dos frames conta a partir dele. */
  const [t0Utc, setT0Utc] = useState<number>(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTRef = useRef<number>(0);
  const t0UtcRef = useRef<number>(0);
  // Todos os frames de GPS da gravação, inclusive os com precisão pior que 30 m
  // (TF-03). A detecção lê só os de análise (≤ 30 m).
  const allGpsRef = useRef<GpsFrame[]>([]);
  // Buffer paralelo de frames de IMU. Cresce mais rápido (50Hz vs 10Hz GPS)
  // mas é local — não publica em realtime (sobrecarga de rede). Stop()
  // recorta esses por tempo pra cada volta.
  const allImuRef = useRef<ImuFrame[]>([]);
  const targetReachedRef = useRef<boolean>(false);

  // ===== Poll do ao vivo =====
  // Voltas, delta MyChron-style e setores em `createLivePoll` (puro). Uma
  // instância por gravação, com a linha fixada no start().
  const livePollRef = useRef<LivePoll | null>(null);
  // Modo de referência ativo (best=melhor da sessão, previous=volta anterior).
  // Vive em ref pra que o poll leia o valor atual sem precisar de dep no
  // useEffect (poll roda de 500ms em 500ms).
  const refModeRef = useRef<ReferenceMode>('best');

  // ===== Linha e setores =====
  // Linha de chegada e régua de S1/S2/S3 do traçado (`setLayoutReference`).
  // Sem traçado, as duas ficam null: a linha é inferida e não há setores ao
  // vivo (TMP-09). Setores são os terços do traçado, pela mesma `sectorSplits`
  // da análise, e não mexem com PB/anterior da sessão.
  const layoutLineRef = useRef<StartLine | null>(null);
  const layoutSectorRefRef = useRef<ReferenceLap | null>(null);
  // Linha da gravação em curso, fixada no start(): o poll, o diário e o
  // stop() usam a mesma (TMP-06).
  const recordingLineRef = useRef<StartLine | null>(null);

  const start = useCallback(async (startOpts?: {
    simulate?: boolean;
    /** Meta da gravação para o diário. Sem ela, nada vai para o diário. */
    meta?: RecordingMetaInput;
  }) => {
    setState('requesting');
    buf.gps = [];
    buf.imu = [];
    allGpsRef.current = [];
    allImuRef.current = [];
    targetReachedRef.current = false;
    // NÃO limpa a linha nem a régua do traçado: quem chamou setLayoutReference
    // antes do start() perderia a ref.
    recordingLineRef.current = layoutLineRef.current;
    livePollRef.current = createLivePoll(recordingLineRef.current, () => layoutSectorRefRef.current);

    // Diário primeiro: com uma gravação interrompida ainda não resolvida, o
    // `begin` rejeita com UnresolvedRecordingError e nada liga (REC-13).
    let recordingId: string | null = null;
    if (startOpts?.meta) {
      try {
        recordingId = await journal.begin({ ...startOpts.meta, line: recordingLineRef.current });
      } catch (e) {
        setState('idle');
        throw e;
      }
      setLocationTaskJournal(journal);
    }
    // Relógio da sessão: o t0Utc é o início do diário (ou agora, sem diário).
    // GPS e IMU contam `t` a partir dele (TF-05).
    const t0 = journal.t0Utc ?? Date.now();
    t0UtcRef.current = t0;
    setT0Utc(t0);
    const clock = createSessionClock(t0);
    // Tela de gravação ligada: a tarefa entrega ao buffer mesmo sem diário.
    setLocationTaskUiActive(true, t0);

    const simulate = startOpts?.simulate === true;
    if (simulate) {
      // Modo demo: replaya o GPX de bench no MESMO buffer (buf.gps) que o
      // GPS preencheria — todo o pipeline (velocímetro, voltas, setores, save)
      // roda idêntico, sem precisar de GPS/movimento.
      await activateKeepAwakeAsync('copilot-recording');
      // Varia ±4% por sessão → cada run salva uma melhor volta diferente,
      // pra o gráfico de evolução mostrar uma curva (em vez de reto).
      const simScale = 0.96 + Math.random() * 0.08;
      const sim = createSimulation(DEMO_LAP, clock, simScale, Date.now());
      simRef.current = setInterval(() => {
        const simulated = sim.step(Date.now());
        // No GPS real, é a tarefa de localização que entrega ao diário.
        buf.gps.push(...simulated);
        journal.appendGps(simulated);
      }, 80);
    } else {
      try {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== 'granted') throw new Error('Permissão de localização negada');
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
      } catch (e) {
        // GPS não ligou: solta o keep-awake, descarta o diário vazio (com as
        // séries) e volta ao ocioso, sem estado preso em 'requesting' (REC-10, AC 2).
        console.warn('start:', e);
        deactivateKeepAwake('copilot-recording');
        setLocationTaskJournal(null);
        setLocationTaskUiActive(false);
        if (recordingId) await journal.discard(recordingId).catch(() => {});
        setState('idle');
        throw new Error(GPS_START_ERROR);
      }

      // IMU em paralelo ao GPS. Roda só em foreground; em background o
      // expo-sensors não recebe callbacks (limitação Android/iOS). Pra
      // tela de cockpit isso é OK — ela mantém-se acordada via KeepAwake.
      // O `t` vem do relógio do sensor, no relógio da sessão (TF-05).
      startImuCapture(clock);
    }

    startTRef.current = Date.now();
    setState('recording');
    setLiveSamples([]);

    pollRef.current = setInterval(() => {
      // Drena buffer GPS
      if (buf.gps.length > 0) {
        allGpsRef.current.push(...buf.gps);
        buf.gps = [];
      }
      // Drena buffer IMU (50Hz × 500ms = ~25 frames por poll). A IMU só vai
      // para o diário com a tela montada (via poll); o recorder nativo (v2)
      // resolve os buracos quando a tela sai.
      if (buf.imu.length > 0) {
        allImuRef.current.push(...buf.imu);
        journal.appendImu(buf.imu);
        buf.imu = [];
      }
      // Escrita durável a cada 5 s; uma falha só liga o aviso do HUD.
      void journal.flushIfDue(Date.now());

      const now = Date.now();
      const mode = refModeRef.current;
      const r = livePollRef.current!.step(allGpsRef.current, { nowMs: now, mode });
      const { all, last, detection } = r;

      // Target atingido?
      const target = options?.targetLaps;
      if (target && !targetReachedRef.current && detection.laps.length >= target) {
        targetReachedRef.current = true;
        options?.onTargetReached?.();
      }

      setInfo({
        totalSamples: all.length,
        lastAccuracy: last?.accuracy ?? 0,
        lastSpeedKmh: last ? last.speed * 3.6 : 0,
        elapsedMs: now - startTRef.current,
        isMoving: last ? last.speed > 5 : false,
        lapsCompleted: detection.laps.length,
        bestLapMs: r.bestLapMs,
        previousLapMs: r.previousLapMs,
        currentLapElapsedMs: r.currentLapElapsedMs,
        liveDeltaMs: r.liveDeltaMs,
        referenceMode: mode,
        justSetNewBest: r.justSetNewBest,
        lastClosedLap: r.lastClosedLap,
        currentSectorIdx: r.currentSectorIdx,
        currentSectorElapsedMs: r.currentSectorElapsedMs,
        currentSectors: r.currentSectors,
        lastClosedLapSectors: r.lastClosedLapSectors,
        bestSectors: r.bestSectors,
        autosaveFailed: journal.failed,
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
    if (simRef.current) {
      clearInterval(simRef.current);
      simRef.current = null;
    }
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
    setLocationTaskJournal(null);
    setLocationTaskUiActive(false);
    stopImuCapture();
    deactivateKeepAwake('copilot-recording');

    // Última drenagem do buffer — pode ter frames chegando entre o poll
    // anterior e agora. GPS + IMU.
    if (buf.gps.length > 0) {
      allGpsRef.current.push(...buf.gps);
      buf.gps = [];
    }
    if (buf.imu.length > 0) {
      allImuRef.current.push(...buf.imu);
      journal.appendImu(buf.imu);
      buf.imu = [];
    }
    // Flush final antes de quem chamou abrir a transação do salvamento. O
    // diário continua ativo até o `journal.end` depois do commit.
    await journal.flush();

    const gps = allGpsRef.current;
    const imu = allImuRef.current;
    const t0 = t0UtcRef.current;
    setState('stopped');

    // Detecção final com os frames completos, incluindo o que chegou na
    // última janela, sobre os frames de análise (≤ 30 m, TF-12). Essa é a
    // fonte de verdade que os consumidores usam.
    const line = recordingLineRef.current;
    const allSamples = analysisGps(gps);
    const detection = detectLaps(allSamples, { line });

    // As voltas são janelas sobre o bruto, pela mesma função e mesma linha que
    // a recuperação usa. Os frames de cada uma (IMU recortada por tempo) saem
    // do `lapFrames`, com as fronteiras geradas na leitura (AD-006).
    const windows = sliceLapWindows(analysisGps(gps), line);
    const series = recordingSeries('result', t0);
    const laps: RecordedLap[] = recordedLaps(
      windows,
      gpsSeriesOf(series.gps, gps),
      imuSeriesOf(series.imu, imu),
      t0
    );

    return {
      t0Utc: t0,
      gps,
      imu,
      windows,
      allSamples,
      laps,
      movingStartIdx: detection.movingStartIdx,
      startFinishLine: detection.startFinishLine,
    };
  }, []);

  useEffect(() => {
    return () => {
      if (simRef.current) clearInterval(simRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      setLocationTaskJournal(null);
      setLocationTaskUiActive(false);
      Location.hasStartedLocationUpdatesAsync(BG_TASK).then((started) => {
        if (started) Location.stopLocationUpdatesAsync(BG_TASK).catch(() => {});
      });
      stopImuCapture();
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
    // certo daqui, mas o próximo poll detecta e recarrega.
    livePollRef.current?.invalidateReference();
  }, []);

  /**
   * Define a referência geográfica usada pelo tracking de setores. Tipicamente
   * chamado uma vez no início (quando a tela carrega o layout salvo da pista).
   *
   * Pode ser chamado antes ou depois de start(). Sem chamar isso, setores
   * ficam todos null — a UI esconde a barra de setores e mostra só
   * velocímetro + cronômetro + delta pill.
   *
   * A linha de chegada é a do traçado (`lineFromLayout`), e S1/S2/S3 são os
   * terços do traçado (`referenceFromLayout`). Independente da PB da sessão —
   * setores não se movem quando o piloto bate volta nova. Traçado com menos
   * de 5 pontos ou sem comprimento conta como sem traçado. A linha vale a
   * partir do próximo start().
   */
  const setLayoutReference = useCallback(
    (samples: GpsFrame[], _durationMs: number) => {
      layoutLineRef.current = lineFromLayout(samples);
      layoutSectorRefRef.current = layoutLineRef.current ? referenceFromLayout(samples) : null;
    },
    []
  );

  /** Limpa a referência de layout — usado quando o usuário desassocia a
   *  pista. Setores voltam a null. */
  const clearLayoutReference = useCallback(() => {
    layoutLineRef.current = null;
    layoutSectorRefRef.current = null;
  }, []);

  return {
    state,
    info,
    liveSamples,
    t0Utc,
    start,
    stop,
    setReferenceMode,
    setLayoutReference,
    clearLayoutReference,
  };
}