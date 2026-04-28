/**
 * Detector de voltas — fonte única de verdade do projeto.
 *
 * Função pura, sem dependência de React, GPS ou async. Recebe samples,
 * retorna índices de voltas fechadas. Usada tanto pelo hook (em tempo real,
 * a cada poll de 500ms) quanto pela tela de reconhecimento/corrida (no
 * momento de salvar). Mesma entrada → mesma saída, sem divergências.
 *
 * Algoritmo em três fases:
 *
 *   1. "Entrou em ritmo?" — acha o primeiro sample onde o piloto manteve
 *      velocidade acima de um limiar por N samples consecutivos. Antes
 *      disso é paddock: jitter de GPS parado, piloto arrumando macacão.
 *
 *   2. "Linha de largada" — é o ponto onde o ritmo começou. Não pedimos
 *      pro usuário marcar; usamos o ponto físico onde ele começou a andar
 *      a sério. Na prática, é onde ele saiu do box pra pista.
 *
 *   3. "Voltas" — a cada sample depois do início do ritmo, checa se o
 *      piloto voltou pra perto da linha de largada DEPOIS de ter andado
 *      uma distância mínima e por um tempo mínimo. Três validações que
 *      filtram jitter (piloto que cruza, sai 16m e volta não é volta) e
 *      voltas anormalmente rápidas (bug ou teletransporte).
 *
 * Performance: O(n) com n = número de samples. Uma sessão de 10min a 10Hz
 * tem 6000 samples; algoritmo roda em <5ms em JS. Pode ser chamado a cada
 * 500ms sem custo perceptível.
 */

import { GpsSample, haversine } from './geometry';

export type DetectLapsOptions = {
  /** Raio em metros para considerar "cruzou a linha". Default: 15 */
  lineRadius?: number;
  /** Distância mínima percorrida para fechar uma volta. Default: 300m */
  minLapDistance?: number;
  /** Duração mínima aceita pra uma volta. Default: 25000ms */
  minLapDuration?: number;
  /** Duração máxima aceita antes de considerar "saiu da pista". Default: 180000ms */
  maxLapDuration?: number;
  /** Velocidade (m/s) que marca "entrou em ritmo". Default: 5 (18 km/h) */
  ritmoSpeedMs?: number;
  /** Velocidade mínima (m/s) pra considerar ritmo sustentado. Default: 3 (11 km/h) */
  ritmoMinSustainedMs?: number;
  /** Quantos samples consecutivos acima do limiar confirmam ritmo. Default: 3 */
  ritmoConfirmSamples?: number;
};

const DEFAULTS: Required<DetectLapsOptions> = {
  lineRadius: 15,
  minLapDistance: 300,
  minLapDuration: 25_000,
  maxLapDuration: 180_000,
  ritmoSpeedMs: 5,
  ritmoMinSustainedMs: 3,
  ritmoConfirmSamples: 3,
};

export type DetectedLap = {
  /** Índice em `samples` onde a volta começa (sample imediatamente após cruzar a linha anterior, ou movingStartIdx para a primeira). */
  startIdx: number;
  /** Índice em `samples` onde a volta termina (sample que cruzou a linha). */
  endIdx: number;
  /** Duração em ms (samples[endIdx].t - samples[startIdx].t). */
  durationMs: number;
  /** Timestamp absoluto de início da volta. */
  startedAt: number;
};

export type DetectLapsResult = {
  /** Índice do primeiro sample "em ritmo". -1 se piloto nunca saiu do paddock. */
  movingStartIdx: number;
  /** Ponto usado como linha de largada/chegada. null se movingStartIdx === -1. */
  startFinishLine: { lat: number; lng: number } | null;
  /** Voltas fechadas, em ordem cronológica. */
  laps: DetectedLap[];
};

/**
 * Acha o índice do primeiro sample em que o piloto confirma ter entrado em ritmo.
 *
 * Não basta "velocidade > X em um sample", porque GPS parado flutua e
 * pode cuspir 6 m/s por um instante (ruído). Exigimos N samples
 * consecutivos acima do limiar pra dar como confirmado.
 *
 * Retorna o índice do PRIMEIRO sample do período sustentado, não o último.
 * Isso é importante: a linha de largada fica onde o ritmo começou, não
 * onde ele foi confirmado.
 */
function findRitmoStart(
  samples: GpsSample[],
  opts: Required<DetectLapsOptions>
): number {
  const { ritmoSpeedMs, ritmoMinSustainedMs, ritmoConfirmSamples } = opts;

  for (let i = 0; i <= samples.length - ritmoConfirmSamples; i++) {
    if (samples[i].speed < ritmoSpeedMs) continue;

    // Olha os próximos (ritmoConfirmSamples - 1) samples. Todos precisam
    // ter velocidade >= ritmoMinSustainedMs (um limiar mais baixo que o
    // gatilho, pra tolerar pequenas oscilações).
    let sustained = true;
    for (let j = 1; j < ritmoConfirmSamples; j++) {
      if (samples[i + j].speed < ritmoMinSustainedMs) {
        sustained = false;
        break;
      }
    }
    if (!sustained) continue;

    return i;
  }
  return -1;
}

export function detectLaps(
  samples: GpsSample[],
  options?: DetectLapsOptions
): DetectLapsResult {
  const opts: Required<DetectLapsOptions> = { ...DEFAULTS, ...options };

  if (samples.length < 10) {
    return { movingStartIdx: -1, startFinishLine: null, laps: [] };
  }

  const movingStartIdx = findRitmoStart(samples, opts);
  if (movingStartIdx < 0) {
    return { movingStartIdx: -1, startFinishLine: null, laps: [] };
  }

  const startPoint = samples[movingStartIdx];
  const startFinishLine = { lat: startPoint.lat, lng: startPoint.lng };

  // Varredura O(n) acumulando distância. Cada vez que a gente "fecha"
  // uma volta, zera o acumulador e usa o sample de fechamento como novo
  // startIdx pra próxima volta.
  const laps: DetectedLap[] = [];
  let currentLapStartIdx = movingStartIdx;
  let distSinceLapStart = 0;
  let justCrossed = true; // evita múltiplas detecções no mesmo cruzamento
  let prev = samples[movingStartIdx];

  for (let i = movingStartIdx + 1; i < samples.length; i++) {
    const curr = samples[i];
    distSinceLapStart += haversine(prev, curr);
    prev = curr;

    const distToStart = haversine(curr, startFinishLine);

    // Saiu da zona de cruzamento? Libera a flag pro próximo cruzamento contar.
    if (distToStart > opts.lineRadius * 2) {
      justCrossed = false;
    }

    const elapsed = curr.t - samples[currentLapStartIdx].t;

    const isClosingLap =
      !justCrossed &&
      distToStart < opts.lineRadius &&
      distSinceLapStart >= opts.minLapDistance &&
      elapsed >= opts.minLapDuration;

    if (!isClosingLap) continue;

    // Volta anormalmente longa (piloto parou no meio, foi no box, etc.)
    // → descarta, mas ainda reseta o ponteiro. A próxima tentativa conta
    // a partir daqui.
    if (elapsed > opts.maxLapDuration) {
      currentLapStartIdx = i;
      distSinceLapStart = 0;
      justCrossed = true;
      continue;
    }

    laps.push({
      startIdx: currentLapStartIdx,
      endIdx: i,
      durationMs: elapsed,
      startedAt: samples[currentLapStartIdx].t,
    });

    currentLapStartIdx = i;
    distSinceLapStart = 0;
    justCrossed = true;
  }

  return { movingStartIdx, startFinishLine, laps };
}