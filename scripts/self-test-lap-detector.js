/**
 * Testes do detector de voltas.
 *
 * Roda em Node puro (sem React, sem expo). Objetivo: validar o algoritmo
 * de detecção em menos de 100ms, com dados sintéticos que cobrem os
 * cenários reais de uma sessão de kart.
 *
 * Uso: node scripts/self-test-lap-detector.js
 */

// Importa a implementação que vamos escrever no Bloco 2.
// No Bloco 1 isso VAI QUEBRAR — é o ponto. A gente roda, vê os 5 testes
// falhando por "cannot find module", e aí escreve o módulo pra passarem.
const { detectLaps } = require('../src/lib/lapDetector.ts');
// ============================================================
// Gerador de traçado sintético
// ============================================================

/**
 * Gera uma pista circular simples em lat/lng, centrada em (baseLat, baseLng).
 * Retorna uma função que, dado um progresso [0,1), devolve o ponto correspondente.
 *
 * Usar "lat/lng real" simplifica porque reusa o haversine sem mocks.
 * 1 grau de latitude ≈ 111km. Pista de 800m = ~0.0072 graus de raio total.
 */
function makeCircularTrack(baseLat, baseLng, radiusMeters = 120) {
  // radiusMeters = raio do círculo. Perímetro ≈ 2πr ≈ 754m (realista pra kart).
  const metersPerDegLat = 111_320;
  // metersPerDegLng varia com latitude. Pra Vitória da Conquista (~-14°), cos(lat)≈0.97.
  const metersPerDegLng = 111_320 * Math.cos((baseLat * Math.PI) / 180);
  const radiusLat = radiusMeters / metersPerDegLat;
  const radiusLng = radiusMeters / metersPerDegLng;

  return function pointAt(progress) {
    // progress em [0, 1), 0 = linha de largada
    const theta = progress * 2 * Math.PI;
    return {
      lat: baseLat + radiusLat * Math.sin(theta),
      lng: baseLng + radiusLng * Math.cos(theta) - radiusLng, // largada fica em (baseLat, baseLng)
    };
  };
}

/**
 * Gera samples GPS simulando N voltas numa pista circular.
 * - sampleRateHz: taxa de amostragem (Expo em BestForNavigation entrega ~5-10Hz)
 * - lapDurationS: tempo de cada volta em segundos
 * - warmupS: tempo parado/devagar antes de entrar em ritmo
 * - cooldownS: tempo parado/devagar depois (simula pit in)
 */
function generateLapSamples({
  baseLat = -14.8619, // Vitória da Conquista aproximada
  baseLng = -40.8444,
  radiusMeters = 120,
  numLaps = 2,
  lapDurationS = 55,
  sampleRateHz = 5,
  warmupS = 3,
  cooldownS = 0,
  startTimestamp = Date.now(),
}) {
  const track = makeCircularTrack(baseLat, baseLng, radiusMeters);
  const samples = [];
  const dt = 1000 / sampleRateHz; // ms entre samples
  let t = startTimestamp;

  // Fase 1: warmup (parado perto da linha de largada, speed ~0)
  const warmupSamples = Math.floor(warmupS * sampleRateHz);
  const startPt = track(0);
  for (let i = 0; i < warmupSamples; i++) {
    samples.push({
      t,
      lat: startPt.lat + (Math.random() - 0.5) * 0.00001, // jitter leve
      lng: startPt.lng + (Math.random() - 0.5) * 0.00001,
      speed: 0.5 + Math.random() * 0.5, // ~0.5-1 m/s (parado, com ruído)
      accuracy: 4,
      heading: 0,
    });
    t += dt;
  }

  // Fase 2: voltas em ritmo
  const samplesPerLap = Math.floor(lapDurationS * sampleRateHz);
  const totalRaceSamples = numLaps * samplesPerLap;
  // velocidade média necessária pra completar uma volta no tempo dado
  const perimeter = 2 * Math.PI * radiusMeters;
  const avgSpeed = perimeter / lapDurationS; // m/s

  for (let i = 0; i < totalRaceSamples; i++) {
    const globalProgress = i / samplesPerLap; // 0, 1, 2... entre voltas
    const lapProgress = globalProgress % 1;
    const pt = track(lapProgress);
    samples.push({
      t,
      lat: pt.lat,
      lng: pt.lng,
      speed: avgSpeed + (Math.random() - 0.5) * 2, // ±1 m/s de variação
      accuracy: 4,
      heading: 0,
    });
    t += dt;
  }

  // Fase 3: cooldown (pit in, desacelerando)
  const cooldownSamples = Math.floor(cooldownS * sampleRateHz);
  const pitPt = track(0.1); // parou um pouco depois da linha
  for (let i = 0; i < cooldownSamples; i++) {
    samples.push({
      t,
      lat: pitPt.lat + (Math.random() - 0.5) * 0.00001,
      lng: pitPt.lng + (Math.random() - 0.5) * 0.00001,
      speed: Math.max(0, 2 - i * 0.2),
      accuracy: 4,
      heading: 0,
    });
    t += dt;
  }

  return samples;
}

// ============================================================
// Framework de testes mínimo (sem dependências)
// ============================================================

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
    failed++;
    failures.push({ name, error: e.message });
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg ?? ''}  esperado: ${expected}, recebido: ${actual}`);
  }
}

function assertGte(actual, expected, msg) {
  if (!(actual >= expected)) {
    throw new Error(`${msg ?? ''}  esperado >= ${expected}, recebido: ${actual}`);
  }
}

function assertInRange(actual, min, max, msg) {
  if (actual < min || actual > max) {
    throw new Error(`${msg ?? ''}  esperado em [${min}, ${max}], recebido: ${actual}`);
  }
}

// ============================================================
// Casos de teste
// ============================================================

console.log('\n🧪 Testes do detector de voltas\n');

test('Caso 1: ritmo nunca atingido (só paddock)', () => {
  // 30 segundos de samples parados, velocidade ~1 m/s
  const samples = generateLapSamples({
    numLaps: 0,
    warmupS: 30,
    cooldownS: 0,
  });
  const result = detectLaps(samples);
  assertEq(result.movingStartIdx, -1, 'movingStartIdx deve ser -1');
  assertEq(result.startFinishLine, null, 'linha de largada deve ser null');
  assertEq(result.laps.length, 0, 'não deve detectar voltas');
});

test('Caso 2: entrou em ritmo mas não fechou volta (meia volta só)', () => {
  // Entra em ritmo e faz apenas metade de uma volta
  const allSamples = generateLapSamples({
    numLaps: 1,
    warmupS: 3,
    cooldownS: 0,
  });
  // Corta na metade — piloto deu meia volta e parou
  const halfway = Math.floor(allSamples.length / 2);
  const samples = allSamples.slice(0, halfway);
  const result = detectLaps(samples);
  assertGte(result.movingStartIdx, 0, 'movingStartIdx deve ser >= 0');
  assertEq(result.laps.length, 0, 'não deve fechar volta');
});

test('Caso 3: duas voltas completas (caso feliz)', () => {
  const samples = generateLapSamples({
    numLaps: 2,
    warmupS: 3,
    cooldownS: 2,
    lapDurationS: 55,
  });
  const result = detectLaps(samples);
  assertGte(result.movingStartIdx, 0);
  assertEq(result.laps.length, 2, 'deve detectar exatamente 2 voltas');
  // Cada volta deve ter duração próxima do alvo (±3s tolerância p/ jitter)
  for (const lap of result.laps) {
    assertInRange(lap.durationMs, 52_000, 58_000, 'duração da volta fora da faixa');
  }
});

test('Caso 4: rejeita "volta" curta demais (jitter na linha)', () => {
  // Simula piloto que cruza a linha, sai 16m, volta e cruza de novo em 2s.
  // Não é volta — é ruído de GPS. Detector deve ignorar.
  const baseLat = -14.8619;
  const baseLng = -40.8444;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((baseLat * Math.PI) / 180);
  // 16m de offset em lat
  const offsetLat = 16 / metersPerDegLat;

  const samples = [];
  let t = Date.now();
  // Warmup em ritmo
  for (let i = 0; i < 30; i++) {
    samples.push({ t, lat: baseLat, lng: baseLng, speed: 10, accuracy: 4 });
    t += 200;
  }
  // Sai 16m
  for (let i = 0; i < 10; i++) {
    samples.push({
      t,
      lat: baseLat + offsetLat * (i / 10),
      lng: baseLng,
      speed: 10,
      accuracy: 4,
    });
    t += 200;
  }
  // Volta à linha
  for (let i = 0; i < 10; i++) {
    samples.push({
      t,
      lat: baseLat + offsetLat * (1 - i / 10),
      lng: baseLng,
      speed: 10,
      accuracy: 4,
    });
    t += 200;
  }

  const result = detectLaps(samples);
  assertEq(result.laps.length, 0, 'não deve contar jitter na linha como volta');
});

test('Caso 5: três voltas + pit in (cenário real do teste em pista)', () => {
  const samples = generateLapSamples({
    numLaps: 3,
    warmupS: 5,
    cooldownS: 10,
    lapDurationS: 55,
  });
  const result = detectLaps(samples);
  assertEq(result.laps.length, 3, 'deve detectar exatamente 3 voltas');
  // A última volta deve terminar antes do fim dos samples
  // (porque depois dela é cooldown, não conta como volta)
  const lastLap = result.laps[result.laps.length - 1];
  const samplesAfterLastLap = samples.length - 1 - lastLap.endIdx;
  assertGte(samplesAfterLastLap, 30, 'deve sobrar samples de cooldown após última volta');
});

// ============================================================
// Resumo
// ============================================================

console.log(`\n${passed} passou, ${failed} falhou\n`);
if (failed > 0) {
  process.exit(1);
}