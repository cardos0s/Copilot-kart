import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { GpsSample, ImuSample, LatLng } from '../lib/geometry';
import { detectLaps, DetectedLap } from '../lib/lapDetector';
import { DeltaTracker } from '../lib/realtimeDelta';
import { saveRecoverySnapshot, clearRecoverySnapshot } from '../storage/recovery';

/** Metadata da sessão pro snapshot de recuperação anti-crash. */
export type RecoveryMeta = {
  trackId: string | null;
  trackName: string;
  layoutId: string | null;
  kartSetupId: string | null;
  mode: 'race' | 'reference';
};

const BG_TASK = 'KARTLAP_BG_LOCATION';

// IMU update rate em ms. 20ms = 50Hz — suficiente pra capturar rotação de
// spin (durações típicas 200-800ms) sem virar mar de dados (50 amostras/s
// vs 10 do GPS = 5x mais por volta de 50s ≈ 2500 samples IMU/volta).
const IMU_UPDATE_MS = 20;

type Buffer = { samples: GpsSample[]; imu: ImuSample[] };
const buf: Buffer = (globalThis as any).__kartlapBuf ?? { samples: [], imu: [] };
// Garante que a versão velha do buffer (sem imu) seja migrada — apps em
// dev podem ter o objeto cacheado de um reload anterior.
if (!buf.imu) buf.imu = [];
(globalThis as any).__kartlapBuf = buf;

TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[Copilot BG] erro:', error);
    return;
  }
  const { locations } = (data as any) ?? {};
  if (!locations) return;

  // Timestamp dos samples — fonte de verdade pro tempo de volta.
  //
  // Problema observado em campo: alguns Android entregam loc.timestamp
  // QUANTIZADO a segundos cheios (sempre múltiplo de 1000ms). Isso fazia
  // durationMs = sample[fim].t − sample[início].t sair sempre redondo
  // (42.000, 43.999...) — sem precisão de centésimo/milésimo.
  //
  // Date.now() no momento do processamento do BG task tem precisão de ms
  // e fica a poucos ms do tempo real do fix (o task roda quase em
  // tempo real quando a app está em foreground gravando). Então:
  //   - loc.timestamp COM precisão sub-segundo (% 1000 != 0) → confia nele
  //   - senão (quantizado, 0, ou ausente) → Date.now() com spread
  //     intra-batch pra samples não colidirem no mesmo ms.
  const arrivalNow = Date.now();
  const locs = locations as Location.LocationObject[];
  const n = locs.length;
  for (let i = 0; i < n; i++) {
    const loc = locs[i];
    if ((loc.coords.accuracy ?? 999) > 30) continue;
    const rawTs = loc.timestamp;
    const hasSubSecond = rawTs && rawTs > 0 && rawTs % 1000 !== 0;
    // Quando cai no Date.now(), espalha ~100ms por sample retroativamente
    // (assume GPS ~10Hz) pra batch com várias locations não virar um único t.
    const t = hasSubSecond ? rawTs : arrivalNow - (n - 1 - i) * 100;
    buf.samples.push({
      t,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      speed: loc.coords.speed ?? 0,
      accuracy: loc.coords.accuracy ?? 999,
      heading: loc.coords.heading ?? undefined,
      altitude: loc.coords.altitude ?? undefined,
      altitudeAccuracy: loc.coords.altitudeAccuracy ?? undefined,
    });
  }
});

/**
 * Estado e subscriptions ativas dos sensores IMU. Buffer paralelo ao GPS
 * mas com timestamps próprios (relógio do device).
 *
 * Estratégia: usamos os listeners "globais" do expo-sensors que rodam no
 * native side enquanto a app está em foreground. Em background, IMU para
 * — diferente do GPS via TaskManager. Aceitável porque a tela de gravação
 * fica em landscape acordada (KeepAwake).
 */
let accelSub: { remove: () => void } | null = null;
let gyroSub: { remove: () => void } | null = null;
// Buffer temporário pra juntar samples de accel e gyro do mesmo "frame"
// (chegam separados via callbacks distintos do expo-sensors). Quando
// um par é completo, emite ImuSample no buf.imu.
const pendingImu: { accel: ImuSample['accel'] | null; gyro: ImuSample['gyro'] | null } = {
  accel: null,
  gyro: null,
};

function startImuCapture() {
  // Idempotente — se já tá rodando, não duplica subscription.
  if (accelSub || gyroSub) return;
  Accelerometer.setUpdateInterval(IMU_UPDATE_MS);
  Gyroscope.setUpdateInterval(IMU_UPDATE_MS);
  accelSub = Accelerometer.addListener(({ x, y, z }) => {
    pendingImu.accel = { x, y, z };
    flushImu();
  });
  gyroSub = Gyroscope.addListener(({ x, y, z }) => {
    pendingImu.gyro = { x, y, z };
    flushImu();
  });
}

function flushImu() {
  // Espera ter ambos accel e gyro pra emitir uma amostra completa. Numa
  // taxa de 50Hz, os dois chegam em poucos ms de diferença — o pareamento
  // funciona bem na prática. Se um lado atrasar, o sample emite quando
  // ambos atualizarem (timestamp do momento da emissão).
  if (pendingImu.accel && pendingImu.gyro) {
    buf.imu.push({
      t: Date.now(),
      accel: pendingImu.accel,
      gyro: pendingImu.gyro,
    });
    pendingImu.accel = null;
    pendingImu.gyro = null;
  }
}

function stopImuCapture() {
  accelSub?.remove();
  gyroSub?.remove();
  accelSub = null;
  gyroSub = null;
  pendingImu.accel = null;
  pendingImu.gyro = null;
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped';

export type ReferenceMode = 'best' | 'previous';

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
export type ClosedLapInfo = {
  /** 1-indexed (igual ao que o piloto enxerga: "L 1", "L 2"). */
  lapNumber: number;
  durationMs: number;
  /** Volta - referenciaAtiva. Negativo = ganhou tempo, positivo = perdeu. */
  deltaVsRefMs: number | null;
  /** Nova melhor volta da sessão. Sempre true na 1ª volta. */
  isPb: boolean;
  /** Modo de referência no momento do fechamento. */
  referenceMode: ReferenceMode;
};

/**
 * Tempos S1/S2/S3 — quando algum é null, ainda não fechou aquele setor.
 * Setores são definidos em fração da pista (1/3 e 2/3 da polyline de
 * referência do layout). Quando uma volta fecha, S3 fica preenchido.
 */
export type SectorTimes = {
  s1Ms: number | null;
  s2Ms: number | null;
  s3Ms: number | null;
};

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
};

/** Volta pronta pra consumo — samples já recortados, duração calculada. */
export type RecordedLap = {
  samples: GpsSample[];
  /** Samples da IMU recortados pra mesma janela de tempo da volta.
   *  Tipicamente 50Hz, ~2500 samples por volta de 50s. Usado pra
   *  detecção de spin e replay 3D pós-sessão. Vazio se IMU falhou. */
  imuSamples: ImuSample[];
  durationMs: number;
  startedAt: number;
};

/** Resultado final de uma gravação. Fonte única de verdade pro que foi gravado. */
export type RecordingResult = {
  /** Todas as amostras capturadas, em ordem cronológica. */
  allSamples: GpsSample[];
  /** Todas as amostras IMU capturadas, em ordem cronológica. */
  allImuSamples: ImuSample[];
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
    lastClosedLap: null,
    currentSectorIdx: null,
    currentSectorElapsedMs: null,
    currentSectors: { s1Ms: null, s2Ms: null, s3Ms: null },
    lastClosedLapSectors: null,
    bestSectors: { s1Ms: null, s2Ms: null, s3Ms: null },
  });
  /** Samples expostos pra UI (radar ao vivo). Decimados pra não re-render demais. */
  const [liveSamples, setLiveSamples] = useState<GpsSample[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTRef = useRef<number>(0);
  const allSamplesRef = useRef<GpsSample[]>([]);
  // Buffer paralelo de IMU samples. Cresce mais rápido (50Hz vs 10Hz GPS)
  // mas é local — não publica em realtime (sobrecarga de rede). Stop()
  // recorta esses por timestamp pra cada lap.
  const allImuRef = useRef<ImuSample[]>([]);
  // Recovery anti-crash: metadata da sessão + timestamp do último snapshot.
  const recoveryMetaRef = useRef<RecoveryMeta | null>(null);
  const lastSnapshotAtRef = useRef<number>(0);
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
  // Snapshot da última volta fechada + janela de exposição. A UI tem 1s
  // pra capturar (o overlay roda animação local de 3s sem depender da
  // janela), depois lastClosedLap volta a null. Janela curta evita que
  // a celebração se "duplique" se o hook receber re-render por outro
  // motivo (mudança de modo, etc).
  const closedLapDataRef = useRef<ClosedLapInfo | null>(null);
  const closedLapClearAtRef = useRef<number>(0);

  // ===== Sectors =====
  // Tracker separado, carregado com a referência do LAYOUT (não da sessão).
  // Setores são geográficos: 1/3 e 2/3 da polyline da ref do layout. Não
  // mexem com PB/anterior da sessão. Reutiliza o DeltaTracker só pela
  // projeção (descarta o deltaMs interno — usamos apenas sNormalized).
  const layoutTrackerRef = useRef<DeltaTracker>(new DeltaTracker());
  // Timestamps de quando o piloto cruzou os limites geográficos. Resetado
  // a cada volta nova. [s1End_ts, s2End_ts] — s3End é o end-of-lap.
  const sectorBoundaryTsRef = useRef<[number | null, number | null]>([null, null]);
  // Melhores S1, S2, S3 vistos na sessão (atualizados a cada lap close).
  const bestSectorsRef = useRef<{ s1: number | null; s2: number | null; s3: number | null }>({
    s1: null,
    s2: null,
    s3: null,
  });
  // Setores da última volta fechada. Compartilhado com lastClosedLap mas
  // tem ciclo próprio (não some após 1s — fica visível até a próxima volta).
  const lastClosedLapSectorsRef = useRef<SectorTimes | null>(null);

  const start = useCallback(async (recoveryMeta?: RecoveryMeta) => {
    setState('requesting');
    recoveryMetaRef.current = recoveryMeta ?? null;
    lastSnapshotAtRef.current = 0;
    buf.samples = [];
    buf.imu = [];
    allSamplesRef.current = [];
    allImuRef.current = [];
    lastDetectionRef.current = [];
    movingStartIdxRef.current = -1;
    targetReachedRef.current = false;
    deltaTrackerRef.current.clear();
    trackerLoadedFromRef.current = null;
    lastLapCountInPollRef.current = 0;
    newBestUntilRef.current = 0;
    closedLapDataRef.current = null;
    closedLapClearAtRef.current = 0;
    // NÃO chama layoutTrackerRef.current.clear() — quem chamou setLayoutReference
    // antes do start() perderia a ref. Só reseta o estado da volta (hint, lastS).
    layoutTrackerRef.current.resetLap();
    sectorBoundaryTsRef.current = [null, null];
    bestSectorsRef.current = { s1: null, s2: null, s3: null };
    lastClosedLapSectorsRef.current = null;

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
        notificationTitle: 'Cockpit gravando',
        notificationBody: 'Gravando trajetória da pista',
        notificationColor: '#00ff88',
      },
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
    });

    // IMU em paralelo ao GPS. Roda só em foreground; em background o
    // expo-sensors não recebe callbacks (limitação Android/iOS). Pra
    // tela de cockpit isso é OK — ela mantém-se acordada via KeepAwake.
    startImuCapture();

    startTRef.current = Date.now();
    setState('recording');
    setLiveSamples([]);

    pollRef.current = setInterval(() => {
      // Drena buffer GPS
      if (buf.samples.length > 0) {
        allSamplesRef.current.push(...buf.samples);
        buf.samples = [];
      }
      // Drena buffer IMU (50Hz × 500ms = ~25 samples por poll)
      if (buf.imu.length > 0) {
        allImuRef.current.push(...buf.imu);
        buf.imu = [];
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
        // Voltas que existiam ANTES desta fechar — base pra calcular delta
        // contra a referência "antiga" (a que estava ativa enquanto piloto
        // andava esta volta). Senão, numa PB, delta vs best daria 0 (porque
        // a própria volta vira a nova best).
        const priorLaps = detection.laps.slice(0, lastLapCountInPollRef.current);
        const previousBest =
          priorLaps.length > 0
            ? Math.min(...priorLaps.map((l) => l.durationMs))
            : Infinity;
        const isPb = last.durationMs < previousBest;
        if (isPb) {
          newBestUntilRef.current = Date.now() + 4000;
        }

        // Computa delta vs referência ATIVA no momento (best ou previous).
        // null quando não há volta prévia (1ª volta da sessão).
        let deltaVsRefMs: number | null = null;
        if (priorLaps.length > 0) {
          const priorRefMs =
            mode === 'best'
              ? previousBest
              : priorLaps[priorLaps.length - 1].durationMs;
          deltaVsRefMs = last.durationMs - priorRefMs;
        }

        closedLapDataRef.current = {
          lapNumber: detection.laps.length,
          durationMs: last.durationMs,
          deltaVsRefMs,
          isPb,
          referenceMode: mode,
        };
        // Janela de 1s pra UI capturar — overlay tem animação local de 3s
        // a partir do momento em que vê o novo lapNumber.
        closedLapClearAtRef.current = Date.now() + 1000;

        // ===== Finaliza setores da volta que acabou de fechar =====
        // Reconstrói S1/S2/S3 a partir dos timestamps de cruzamento de
        // limite + start/end da volta. Só finaliza se conseguimos marcar
        // OS DOIS limites (S1 end e S2 end). Senão, o layout ref pode não
        // estar carregado ou GPS perdeu samples nos pontos críticos.
        const lapStartT = last.startedAt;
        const lapEndT = last.startedAt + last.durationMs;
        const s1EndT = sectorBoundaryTsRef.current[0];
        const s2EndT = sectorBoundaryTsRef.current[1];
        if (s1EndT !== null && s2EndT !== null) {
          const s1 = s1EndT - lapStartT;
          const s2 = s2EndT - s1EndT;
          const s3 = lapEndT - s2EndT;
          lastClosedLapSectorsRef.current = { s1Ms: s1, s2Ms: s2, s3Ms: s3 };
          // Atualiza melhores da sessão (campos independentes — best de cada
          // setor pode vir de voltas diferentes).
          const best = bestSectorsRef.current;
          if (best.s1 === null || s1 < best.s1) best.s1 = s1;
          if (best.s2 === null || s2 < best.s2) best.s2 = s2;
          if (best.s3 === null || s3 < best.s3) best.s3 = s3;
        }
        // Reset pro próximo lap. Layout tracker também reseta hint pra
        // recomeçar a busca do começo da polyline.
        sectorBoundaryTsRef.current = [null, null];
        layoutTrackerRef.current.resetLap();

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

      // ===== Sectors: projeta sample atual no layout ref, atualiza =====
      // Layout tracker projeta o ponto atual contra a polyline da referência
      // do layout. sNormalized indica progresso geográfico [0..1] — usamos
      // pra detectar quando o piloto cruzou 1/3 e 2/3 da pista.
      //
      // Diferente do delta tracker (que usa session PB), este usa o LAYOUT
      // reference. Setores não mudam com PB — são geográficos.
      let sNormForSector: number | null = null;
      if (last && layoutTrackerRef.current.hasReference()) {
        // compute() aceita lapElapsedMs mas só usamos sNormalized — passa 0.
        const reading = layoutTrackerRef.current.compute(last, 0);
        sNormForSector = reading.sNormalized;
      }

      // Recompute lapStart pra setores (mesma lógica do currentLapElapsedMs).
      // Setores precisam do timestamp do 1º sample da volta atual pra
      // calcular S1 = (s1End_ts - lapStart_ts).
      let currentLapStartT: number | null = null;
      if (last && detection.movingStartIdx >= 0) {
        const startIdx =
          detection.laps.length > 0
            ? detection.laps[detection.laps.length - 1].endIdx + 1
            : detection.movingStartIdx;
        if (startIdx < all.length) {
          currentLapStartT = all[startIdx].t;
        }
      }

      // Marca cruzamento de limite (1/3 e 2/3). Só marca uma vez por volta
      // — se sNormForSector oscilar perto do limite, o primeiro >= já fixou.
      if (last && sNormForSector !== null && currentLapStartT !== null) {
        if (sNormForSector >= 1 / 3 && sectorBoundaryTsRef.current[0] === null) {
          sectorBoundaryTsRef.current[0] = last.t;
        }
        if (sNormForSector >= 2 / 3 && sectorBoundaryTsRef.current[1] === null) {
          sectorBoundaryTsRef.current[1] = last.t;
        }
      }

      // Setor atual + tempo decorrido nele.
      let currentSectorIdx: 0 | 1 | 2 | null = null;
      let currentSectorElapsedMs: number | null = null;
      if (sNormForSector !== null) {
        if (sNormForSector < 1 / 3) currentSectorIdx = 0;
        else if (sNormForSector < 2 / 3) currentSectorIdx = 1;
        else currentSectorIdx = 2;
      }
      if (last && currentSectorIdx !== null && currentLapStartT !== null) {
        const s1EndT = sectorBoundaryTsRef.current[0];
        const s2EndT = sectorBoundaryTsRef.current[1];
        if (currentSectorIdx === 0) {
          currentSectorElapsedMs = last.t - currentLapStartT;
        } else if (currentSectorIdx === 1 && s1EndT !== null) {
          currentSectorElapsedMs = last.t - s1EndT;
        } else if (currentSectorIdx === 2 && s2EndT !== null) {
          currentSectorElapsedMs = last.t - s2EndT;
        }
      }

      // Parciais S1/S2 da volta em curso (S3 só preenche quando fecha →
      // vai pro lastClosedLapSectors).
      const s1EndT = sectorBoundaryTsRef.current[0];
      const s2EndT = sectorBoundaryTsRef.current[1];
      const currentSectors: SectorTimes = {
        s1Ms:
          s1EndT !== null && currentLapStartT !== null
            ? s1EndT - currentLapStartT
            : null,
        s2Ms: s1EndT !== null && s2EndT !== null ? s2EndT - s1EndT : null,
        s3Ms: null,
      };

      // lastClosedLap só fica não-null por ~1s após o fechamento. Suficiente
      // pra UI capturar via useEffect e arrancar a animação local.
      const lastClosedLap =
        Date.now() < closedLapClearAtRef.current ? closedLapDataRef.current : null;

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
        lastClosedLap,
        currentSectorIdx,
        currentSectorElapsedMs,
        currentSectors,
        lastClosedLapSectors: lastClosedLapSectorsRef.current,
        bestSectors: {
          s1Ms: bestSectorsRef.current.s1,
          s2Ms: bestSectorsRef.current.s2,
          s3Ms: bestSectorsRef.current.s3,
        },
      });

      // Live samples pro radar: só expõe a partir de quando entrou em ritmo
      if (detection.movingStartIdx >= 0) {
        const movingSamples = all.slice(detection.movingStartIdx);
        const step = Math.max(1, Math.floor(movingSamples.length / 300));
        setLiveSamples(movingSamples.filter((_, i) => i % step === 0));
      } else {
        setLiveSamples([]);
      }

      // ===== Auto-save anti-crash =====
      // Snapshot do estado bruto em arquivo on lap close + a cada 30s.
      // Se o app morrer (crash/SO/bateria) no meio da sessão, o boot
      // detecta o arquivo e oferece recuperar. Fire-and-forget (async,
      // não bloqueia o poll). Só roda se recoveryMeta foi passado no start.
      const meta = recoveryMetaRef.current;
      if (meta && all.length > 0) {
        const now = Date.now();
        const shouldSnapshot =
          closedNewLap || now - lastSnapshotAtRef.current > 30_000;
        if (shouldSnapshot) {
          lastSnapshotAtRef.current = now;
          saveRecoverySnapshot({
            version: 1,
            startedAt: startTRef.current,
            updatedAt: now,
            trackId: meta.trackId,
            trackName: meta.trackName,
            layoutId: meta.layoutId,
            kartSetupId: meta.kartSetupId,
            mode: meta.mode,
            samples: all,
            imuSamples: allImuRef.current,
          });
        }
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
    stopImuCapture();
    deactivateKeepAwake('copilot-recording');

    // Encerramento limpo — apaga o snapshot de recovery. A sessão vai ser
    // salva normalmente pelo caller (createSession + saveLap), então não
    // há o que recuperar. fire-and-forget.
    recoveryMetaRef.current = null;
    clearRecoverySnapshot();

    // Última drenagem do buffer — pode ter samples chegando entre o poll
    // anterior e agora. GPS + IMU.
    if (buf.samples.length > 0) {
      allSamplesRef.current.push(...buf.samples);
      buf.samples = [];
    }
    if (buf.imu.length > 0) {
      allImuRef.current.push(...buf.imu);
      buf.imu = [];
    }

    const allSamples = allSamplesRef.current;
    const allImuSamples = allImuRef.current;
    setState('stopped');

    // Detecção final com os samples completos, incluindo o que chegou na
    // última janela. Essa é a fonte de verdade que os consumidores usam.
    const detection = detectLaps(allSamples);

    // Materializa as voltas: aqui sim copiamos slices, porque é uma vez só
    // no fim da gravação. O consumidor recebe voltas prontas pra persistir.
    // IMU é recortada por TIMESTAMP (não por índice — escalas diferentes,
    // 50Hz vs 10Hz). startedAt vem do GPS sample inicial da volta, lapEnd
    // = startedAt + durationMs. Pega tudo da IMU nessa janela.
    const laps: RecordedLap[] = detection.laps.map((lap) => {
      const lapEndT = lap.startedAt + lap.durationMs;
      const imuSlice = allImuSamples.filter((s) => s.t >= lap.startedAt && s.t <= lapEndT);
      return {
        samples: allSamples.slice(lap.startIdx, lap.endIdx + 1),
        imuSamples: imuSlice,
        durationMs: lap.durationMs,
        startedAt: lap.startedAt,
      };
    });

    return {
      allSamples,
      allImuSamples,
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
    // certo daqui, mas marcar como null faz o poll detectar e recarregar.
    trackerLoadedFromRef.current = null;
  }, []);

  /**
   * Define a referência geográfica usada pelo tracking de setores. Tipicamente
   * chamado uma vez no início (quando a tela carrega o layout salvo da pista).
   *
   * Pode ser chamado antes ou depois de start(). Sem chamar isso, setores
   * ficam todos null — a UI esconde a barra de setores e mostra só
   * velocímetro + cronômetro + delta pill.
   *
   * Os limites geográficos S1/S2/S3 são 1/3 e 2/3 da polyline da ref (por
   * distância acumulada). Independente da PB da sessão — setores não se
   * movem quando o piloto bate volta nova.
   */
  const setLayoutReference = useCallback(
    (samples: GpsSample[], durationMs: number) => {
      layoutTrackerRef.current.setReference(samples, durationMs);
    },
    []
  );

  /** Limpa a referência de layout — usado quando o usuário desassocia a
   *  pista. Setores voltam a null. */
  const clearLayoutReference = useCallback(() => {
    layoutTrackerRef.current.clear();
    sectorBoundaryTsRef.current = [null, null];
  }, []);

  return {
    state,
    info,
    liveSamples,
    start,
    stop,
    setReferenceMode,
    setLayoutReference,
    clearLayoutReference,
  };
}