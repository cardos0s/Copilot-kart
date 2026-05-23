/**
 * Detector de rodadas ("spins") do kart.
 *
 * Estratégia híbrida — usa IMU quando disponível, GPS como fallback:
 *
 * Caminho A — Giroscópio (preferencial, alta precisão):
 *   - Yaw rate = velocidade angular em torno do eixo vertical do celular.
 *     No cockpit landscape, isso é o eixo Y (apontando "pra cima" do kart
 *     na orientação landscape do device, ou Z dependendo da fixação).
 *   - Heurística: |yaw rate| > 90°/s sustentado por > 0.5s = rodada.
 *     Threshold escolhido a partir de medição empírica: curvas normais
 *     de kart raramente passam de 60°/s; spins genuínos passam de 180°/s
 *     no pico.
 *
 * Caminho B — Só GPS (fallback quando IMU faltou):
 *   - Detecta queda brusca de velocidade (>50% em <1s) acompanhada de
 *     mudança de heading >120° na mesma janela.
 *   - Menos preciso porque GPS heading é "course over ground" (pra onde
 *     o kart está SE MOVENDO, não onde está APONTANDO) — se o kart roda
 *     deslizando, COG só atualiza depois.
 *
 * Saída:
 *   - Array de SpinEvent com {start, end, peakRate, totalRotation, lossEstimate}
 *   - Cada evento sinaliza um trecho onde o kart girou perdendo aderência.
 *
 * Use-case principal: marcação pós-sessão. Roda no replay 3D pra
 * destacar voltas que tiveram rodada (e onde) + estima quanto tempo
 * perdeu vs uma referência.
 */

import type { GpsSample, ImuSample } from './geometry';

export type SpinEvent = {
  /** Timestamp do início do spin (ms desde epoch). */
  startT: number;
  /** Timestamp do fim do spin. */
  endT: number;
  /** Duração total do evento (ms). */
  durationMs: number;
  /** Pico de yaw rate observado (graus/segundo, sempre positivo). */
  peakYawRate: number;
  /** Rotação total acumulada durante o evento (graus). >180° = pião completo. */
  totalRotationDeg: number;
  /** Velocidade média (m/s) durante o spin — baixa = perdeu mesmo todo o ímpeto. */
  meanSpeedMs: number;
  /** Fonte usada pra detecção. */
  source: 'imu' | 'gps';
  /** Posição aproximada onde aconteceu (lat/lng do meio do evento). */
  lat: number;
  lng: number;
};

const RAD2DEG = 180 / Math.PI;

// Thresholds — ajustáveis. Os defaults aqui vêm de medição em sessões
// de kart amador (Granja Viana, Leandro Merlo) + handful de simulações.
const YAW_RATE_THRESHOLD_DEG_S = 90;  // entrada
const YAW_RATE_THRESHOLD_END_DEG_S = 30; // saída (histerese pra não fragmentar)
const MIN_SPIN_DURATION_MS = 400;     // <400ms é só correção fina, não spin
const MAX_GAP_BETWEEN_SAMPLES_MS = 200; // gap > isso quebra a continuidade

/**
 * Detecta spins usando giroscópio. Yaw é geralmente o eixo z do device
 * (saindo da tela) em landscape — mas montagens variam. Pra robustez
 * checamos o eixo de maior magnitude e usamos esse como yaw rate efetivo.
 *
 * Retorna spins ordenados por startT.
 */
export function detectSpinsFromImu(
  imuSamples: ImuSample[],
  gpsSamples: GpsSample[]
): SpinEvent[] {
  if (imuSamples.length < 10) return [];

  // Decide qual eixo é o yaw — pegamos a magnitude média dos 3 eixos no
  // primeiro segundo onde o kart se mexe; o eixo de MENOR variação tipicamente
  // é o yaw em terreno plano (kart não pula, só gira). Mas pra simplificar
  // e ser mais robusto, usamos o eixo de MAIOR magnitude POSITIVA observada
  // num spin candidato — heurística que funciona em qualquer orientação.
  //
  // Implementação pragmática: testa cada eixo, escolhe o que produz spin
  // events mais "limpos" (peakRate > 90°/s + durations razoáveis).
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  let best: { axis: 'x' | 'y' | 'z'; events: SpinEvent[] } = {
    axis: 'z',
    events: [],
  };
  for (const axis of axes) {
    const events = detectOnAxis(imuSamples, gpsSamples, axis);
    if (events.length > best.events.length) {
      best = { axis, events };
    }
  }
  return best.events;
}

function detectOnAxis(
  imuSamples: ImuSample[],
  gpsSamples: GpsSample[],
  axis: 'x' | 'y' | 'z'
): SpinEvent[] {
  const events: SpinEvent[] = [];
  let inSpin = false;
  let spinStartIdx = -1;
  let lastT = imuSamples[0].t;
  let accumulatedRotation = 0;
  let peakRate = 0;

  for (let i = 0; i < imuSamples.length; i++) {
    const s = imuSamples[i];
    const rateRad = s.gyro[axis]; // rad/s
    const rateDeg = Math.abs(rateRad * RAD2DEG);
    const dt = (s.t - lastT) / 1000;

    if (!inSpin && rateDeg > YAW_RATE_THRESHOLD_DEG_S) {
      // Entrou em spin
      inSpin = true;
      spinStartIdx = i;
      accumulatedRotation = rateDeg * dt;
      peakRate = rateDeg;
    } else if (inSpin) {
      // Detecta gap (perdeu samples) ou queda abaixo do threshold de saída
      const gap = s.t - lastT;
      const ended = rateDeg < YAW_RATE_THRESHOLD_END_DEG_S || gap > MAX_GAP_BETWEEN_SAMPLES_MS;
      accumulatedRotation += rateDeg * dt;
      if (rateDeg > peakRate) peakRate = rateDeg;

      if (ended) {
        const startT = imuSamples[spinStartIdx].t;
        const endT = s.t;
        const duration = endT - startT;
        if (duration >= MIN_SPIN_DURATION_MS) {
          const midT = (startT + endT) / 2;
          const { lat, lng, meanSpeed } = interpolateGpsAt(gpsSamples, startT, endT, midT);
          events.push({
            startT,
            endT,
            durationMs: duration,
            peakYawRate: peakRate,
            totalRotationDeg: accumulatedRotation,
            meanSpeedMs: meanSpeed,
            source: 'imu',
            lat,
            lng,
          });
        }
        inSpin = false;
        spinStartIdx = -1;
        accumulatedRotation = 0;
        peakRate = 0;
      }
    }
    lastT = s.t;
  }
  return events;
}

/**
 * Fallback de detecção via GPS only — usado quando lap não tem IMU
 * (versão antiga do app, sensor falhou, etc).
 *
 * Critério: velocidade caiu >50% E heading mudou >120° dentro de uma
 * janela de 2s. Menos preciso que IMU; pode missar spins onde o kart
 * mantém momento mas roda, ou flagar pit-stop como spin.
 */
export function detectSpinsFromGps(gpsSamples: GpsSample[]): SpinEvent[] {
  if (gpsSamples.length < 5) return [];
  const events: SpinEvent[] = [];
  const WINDOW_MS = 2000;
  const SPEED_DROP_RATIO = 0.5;
  const HEADING_CHANGE_DEG = 120;

  for (let i = 0; i < gpsSamples.length; i++) {
    const start = gpsSamples[i];
    if (start.speed < 3) continue; // não estava andando, não conta

    // Procura sample dentro da janela de tempo
    let j = i + 1;
    while (j < gpsSamples.length && gpsSamples[j].t - start.t <= WINDOW_MS) {
      const end = gpsSamples[j];
      const speedDropped = end.speed < start.speed * (1 - SPEED_DROP_RATIO);
      const headingDiff = circularHeadingDiff(start.heading, end.heading);
      if (speedDropped && headingDiff > HEADING_CHANGE_DEG) {
        // Spin candidato
        const midT = (start.t + end.t) / 2;
        const midSample = gpsSamples[Math.floor((i + j) / 2)];
        events.push({
          startT: start.t,
          endT: end.t,
          durationMs: end.t - start.t,
          peakYawRate: headingDiff / ((end.t - start.t) / 1000),
          totalRotationDeg: headingDiff,
          meanSpeedMs: (start.speed + end.speed) / 2,
          source: 'gps',
          lat: midSample.lat,
          lng: midSample.lng,
        });
        i = j; // pula pra depois do spin pra não duplicar
        break;
      }
      j++;
    }
  }
  return events;
}

/** Detecta spins automaticamente — prefere IMU se houver, senão cai pro GPS. */
export function detectSpins(
  gpsSamples: GpsSample[],
  imuSamples: ImuSample[] | undefined
): SpinEvent[] {
  if (imuSamples && imuSamples.length >= 10) {
    return detectSpinsFromImu(imuSamples, gpsSamples);
  }
  return detectSpinsFromGps(gpsSamples);
}

// ============================================================================
// Helpers internos
// ============================================================================

function interpolateGpsAt(
  samples: GpsSample[],
  startT: number,
  endT: number,
  targetT: number
): { lat: number; lng: number; meanSpeed: number } {
  // Pega o sample GPS mais próximo do targetT, e calcula a velocidade média
  // entre os samples dentro da janela [startT, endT].
  let closest = samples[0];
  let closestDiff = Math.abs(samples[0].t - targetT);
  let speedSum = 0;
  let speedCount = 0;
  for (const s of samples) {
    if (s.t >= startT && s.t <= endT) {
      speedSum += s.speed;
      speedCount++;
    }
    const diff = Math.abs(s.t - targetT);
    if (diff < closestDiff) {
      closest = s;
      closestDiff = diff;
    }
  }
  return {
    lat: closest.lat,
    lng: closest.lng,
    meanSpeed: speedCount > 0 ? speedSum / speedCount : 0,
  };
}

function circularHeadingDiff(a: number | undefined, b: number | undefined): number {
  if (a == null || b == null) return 0;
  let diff = Math.abs(b - a) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}
