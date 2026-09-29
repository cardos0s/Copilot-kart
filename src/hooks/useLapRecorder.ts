import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { DEMO_LAP } from '../data/demoLap';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { GpsSample, ImuSample, LatLng, ReferenceLap } from '../lib/geometry';
import { detectLaps, DetectedLap, type OpenCross } from '../lib/lapDetector';
import { DeltaTracker } from '../lib/realtimeDelta';
import { referenceFromLayout, sectorSplits } from '../lib/sectors';
import { lineFromLayout, type CrossPoint, type StartLine } from '../lib/startLine';
import { sliceLaps, type RecordedLap } from '../recording/finishSession';
import { deltaReferenceLap, liveLapClock } from '../recording/liveLapClock';
import type { RecordingMetaInput } from '../recording/journal';
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

/** Ponto sintético na linha de chegada (AD-006), como o `sliceLaps` monta. */
function crossSample(cross: CrossPoint, accuracy: number): GpsSample {
  return { t: cross.t, lat: cross.lat, lng: cross.lng, speed: cross.speed, accuracy, synthetic: true };
}

/**
 * Pontos da volta em curso, do jeito que o `sliceLaps` vai recortá-la quando
 * fechar: o cruzamento que a abriu (`openCross` do `detectLaps`, ponto
 * sintético) e os pontos crus depois dele. Depois de um box, é o cruzamento
 * depois da parada, e não o fim da última volta fechada. `null` se a volta
 * ainda não abriu.
 */
function currentLapSamples(all: GpsSample[], openCross: OpenCross | null): GpsSample[] | null {
  if (!openCross) return null;
  const t0 = openCross.t;
  return [crossSample(openCross, all[openCross.idx].accuracy), ...all.slice(openCross.idx).filter((p) => p.t > t0)];
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

  /** A última escrita do diário falhou: o HUD mostra "Salvamento automático falhou". */
  autosaveFailed: boolean;
};

/** Volta pronta pra consumo — samples já recortados, duração calculada. */
export type { RecordedLap };

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
  /** Samples expostos pra UI (radar ao vivo). Decimados pra não re-render demais. */
  const [liveSamples, setLiveSamples] = useState<GpsSample[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTRef = useRef<number>(0);
  const allSamplesRef = useRef<GpsSample[]>([]);
  // Buffer paralelo de IMU samples. Cresce mais rápido (50Hz vs 10Hz GPS)
  // mas é local — não publica em realtime (sobrecarga de rede). Stop()
  // recorta esses por timestamp pra cada lap.
  const allImuRef = useRef<ImuSample[]>([]);
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
  // Melhores S1, S2, S3 vistos na sessão (atualizados a cada lap close).
  const bestSectorsRef = useRef<{ s1: number | null; s2: number | null; s3: number | null }>({
    s1: null,
    s2: null,
    s3: null,
  });
  // Setores da última volta fechada. Compartilhado com lastClosedLap mas
  // tem ciclo próprio (não some após 1s — fica visível até a próxima volta).
  const lastClosedLapSectorsRef = useRef<SectorTimes | null>(null);

  const start = useCallback(async (startOpts?: {
    simulate?: boolean;
    /** Meta da gravação para o diário. Sem ela, nada vai para o diário. */
    meta?: RecordingMetaInput;
  }) => {
    setState('requesting');
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
    // NÃO limpa a linha nem a régua do traçado: quem chamou setLayoutReference
    // antes do start() perderia a ref.
    recordingLineRef.current = layoutLineRef.current;
    bestSectorsRef.current = { s1: null, s2: null, s3: null };
    lastClosedLapSectorsRef.current = null;

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
    // Tela de gravação ligada: a tarefa entrega ao buffer mesmo sem diário.
    setLocationTaskUiActive(true);

    const simulate = startOpts?.simulate === true;
    if (simulate) {
      // Modo demo: replaya o GPX de bench no MESMO buffer (buf.samples) que o
      // GPS preencheria — todo o pipeline (velocímetro, voltas, setores, save)
      // roda idêntico, sem precisar de GPS/movimento.
      await activateKeepAwakeAsync('copilot-recording');
      // Varia ±4% por sessão → cada run salva uma melhor volta diferente,
      // pra o gráfico de evolução mostrar uma curva (em vez de reto).
      const simScale = 0.96 + Math.random() * 0.08;
      let simIdx = 0;
      let simT0 = Date.now();
      simRef.current = setInterval(() => {
        const elapsed = Date.now() - simT0;
        const simulated: GpsSample[] = [];
        while (simIdx < DEMO_LAP.length && DEMO_LAP[simIdx].t * simScale <= elapsed) {
          const dp = DEMO_LAP[simIdx];
          simulated.push({ t: simT0 + dp.t * simScale, lat: dp.lat, lng: dp.lng, speed: dp.speed, accuracy: 3 });
          simIdx++;
        }
        // No GPS real, é a tarefa de localização que entrega ao diário.
        buf.samples.push(...simulated);
        journal.appendGps(simulated);
        // Loop contínuo até o usuário tocar em "Encerrar".
        if (simIdx >= DEMO_LAP.length) {
          simIdx = 0;
          simT0 = Date.now();
        }
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
        // GPS não ligou: solta o keep-awake, descarta o diário vazio e volta
        // ao ocioso, sem estado preso em 'requesting' (REC-10, AC 2).
        console.warn('start:', e);
        deactivateKeepAwake('copilot-recording');
        setLocationTaskJournal(null);
        setLocationTaskUiActive(false);
        if (recordingId) await journal.end(recordingId).catch(() => {});
        setState('idle');
        throw new Error(GPS_START_ERROR);
      }

      // IMU em paralelo ao GPS. Roda só em foreground; em background o
      // expo-sensors não recebe callbacks (limitação Android/iOS). Pra
      // tela de cockpit isso é OK — ela mantém-se acordada via KeepAwake.
      startImuCapture();
    }

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
        journal.appendImu(buf.imu);
        buf.imu = [];
      }
      // Escrita durável a cada 5 s; uma falha só liga o aviso do HUD.
      void journal.flushIfDue(Date.now());
      const all = allSamplesRef.current;
      const last = all[all.length - 1];

      // Detecção de voltas — uma única chamada, mesma função e mesma linha
      // que o stop() usa.
      const line = recordingLineRef.current;
      const sectorRef = line ? layoutSectorRefRef.current : null;
      const detection = detectLaps(all, { line });
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

        // ===== Setores da volta que acabou de fechar =====
        // A volta recortada pela mesma `sliceLaps` do stop() (pontos de
        // fronteira na linha), medida pela mesma `sectorSplits` da análise.
        // É o que vai para a equipe (TMP-08).
        if (sectorRef) {
          const sliced = sliceLaps(all, [], line);
          const closedSamples = sliced[sliced.length - 1].samples;
          const splits = sectorSplits(closedSamples, sectorRef);
          lastClosedLapSectorsRef.current = splits;
          const { s1Ms: s1, s2Ms: s2, s3Ms: s3 } = splits;
          if (s1 !== null && s2 !== null && s3 !== null) {
            // Atualiza melhores da sessão (campos independentes — best de
            // cada setor pode vir de voltas diferentes).
            const best = bestSectorsRef.current;
            if (best.s1 === null || s1 < best.s1) best.s1 = s1;
            if (best.s2 === null || s2 < best.s2) best.s2 = s2;
            if (best.s3 === null || s3 < best.s3) best.s3 = s3;
          }
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
        // A volta com os pontos de fronteira na linha (AD-006), como o
        // sliceLaps a salva: o t = 0 da referência é o cruzamento.
        const refLap = deltaReferenceLap(all, line, refLapIdx);
        if (refLap) tracker.setReference(refLap.samples, refLap.durationMs);
        trackerLoadedFromRef.current = { mode, lapIdx: refLapIdx };
      } else if (refLapIdx < 0 && tracker.hasReference()) {
        tracker.clear();
        trackerLoadedFromRef.current = null;
      }

      // Elapsed da volta ATUAL (em curso), a partir do cruzamento da linha
      // que a abriu. Com traçado, antes do 1º cruzamento o cronômetro não corre.
      const clock = last ? liveLapClock(detection, all, last.t, line) : null;
      const currentLapElapsedMs: number | null = clock ? clock.elapsedMs : null;

      // Computa delta no último sample.
      let liveDeltaMs: number | null = null;
      if (last && currentLapElapsedMs !== null && tracker.hasReference()) {
        const reading = tracker.compute(last, currentLapElapsedMs);
        liveDeltaMs = reading.deltaMs;
      }

      // ===== Setores da volta em curso =====
      // Os pontos da volta em curso, com o cruzamento que a abriu, pela mesma
      // `sectorSplits` do fechamento e da análise (TMP-07). O setor ainda não
      // alcançado fica null. S3 só sai quando a volta fecha.
      let currentSectorIdx: 0 | 1 | 2 | null = null;
      let currentSectorElapsedMs: number | null = null;
      let currentSectors: SectorTimes = { s1Ms: null, s2Ms: null, s3Ms: null };
      if (last && line && sectorRef) {
        const lapSamples = currentLapSamples(all, detection.openCross);
        if (lapSamples) {
          const splits = sectorSplits(lapSamples, sectorRef);
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

    // Última drenagem do buffer — pode ter samples chegando entre o poll
    // anterior e agora. GPS + IMU.
    if (buf.samples.length > 0) {
      allSamplesRef.current.push(...buf.samples);
      buf.samples = [];
    }
    if (buf.imu.length > 0) {
      allImuRef.current.push(...buf.imu);
      journal.appendImu(buf.imu);
      buf.imu = [];
    }
    // Flush final antes de quem chamou abrir a transação do salvamento. O
    // diário continua ativo até o `journal.end` depois do commit.
    await journal.flush();

    const allSamples = allSamplesRef.current;
    const allImuSamples = allImuRef.current;
    setState('stopped');

    // Detecção final com os samples completos, incluindo o que chegou na
    // última janela. Essa é a fonte de verdade que os consumidores usam.
    const line = recordingLineRef.current;
    const detection = detectLaps(allSamples, { line });

    // Materializa as voltas (uma vez só, no fim): IMU recortada por
    // timestamp, pela mesma função e mesma linha que a recuperação usa.
    const laps: RecordedLap[] = sliceLaps(allSamples, allImuSamples, line);

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
   * A linha de chegada é a do traçado (`lineFromLayout`), e S1/S2/S3 são os
   * terços do traçado (`referenceFromLayout`). Independente da PB da sessão —
   * setores não se movem quando o piloto bate volta nova. Traçado com menos
   * de 5 pontos ou sem comprimento conta como sem traçado. A linha vale a
   * partir do próximo start().
   */
  const setLayoutReference = useCallback(
    (samples: GpsSample[], _durationMs: number) => {
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
    start,
    stop,
    setReferenceMode,
    setLayoutReference,
    clearLayoutReference,
  };
}