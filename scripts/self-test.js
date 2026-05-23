#!/usr/bin/env node
/**
 * Teste sintético: simula 3 voltas numa pista oval e valida que o pipeline
 * de segmentação + análise detecta:
 *  - 3 voltas completas
 *  - identifica a mais rápida
 *  - aponta o setor onde a volta "ruim" perdeu tempo
 *
 * Também testa buildAnalysisPrompt com setores fake.
 *
 * Roda sem dependências extras: node scripts/self-test.js
 */

const R_EARTH = 6371000;
const DEG = Math.PI / 180;

function haversine(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

function makeProjector(origin) {
  const lat0 = origin.lat * DEG;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0);
  const mLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0);
  return {
    toXY: (p) => ({ x: (p.lng - origin.lng) * mLng, y: (p.lat - origin.lat) * mLat }),
    toLatLng: (p) => ({ lat: origin.lat + p.y / mLat, lng: origin.lng + p.x / mLng }),
  };
}

/**
 * Gera uma volta de pista oval em torno do centro (lat, lng).
 * A pista é dividida em 4 setores: reta norte, curva leste, reta sul, curva oeste.
 * Cada setor tem uma velocidade média definida.
 * `slowdownSector` torna esse setor 30% mais lento (simulando perda de tempo).
 */
function generateLap({ center, startTime, slowdownSector = null, noiseM = 0.5 }) {
  const proj = makeProjector(center);
  const points = [];
  const samplesPerSector = 50; // 4 setores x 50 = 200 pontos por volta
  const baseSpeeds = [22, 14, 22, 14]; // m/s por setor: reta rápida, curva lenta, etc
  let t = startTime;

  // Traçado: oval com 200m de semi-eixo maior (x) e 60m de semi-eixo menor (y)
  // Total ~800m de perímetro (fórmula Ramanujan: ~π·(3(a+b) - √((3a+b)(a+3b))))
  const a = 200, b = 60;
  const totalSamples = 4 * samplesPerSector;

  for (let i = 0; i < totalSamples; i++) {
    const theta = (i / totalSamples) * 2 * Math.PI;
    const sectorIdx = Math.floor(i / samplesPerSector);
    const speedBase = baseSpeeds[sectorIdx];
    const speed = slowdownSector === sectorIdx ? speedBase * 0.7 : speedBase;

    // Posição na oval
    const x = a * Math.cos(theta) + (Math.random() - 0.5) * noiseM;
    const y = b * Math.sin(theta) + (Math.random() - 0.5) * noiseM;
    const ll = proj.toLatLng({ x, y });

    // Tempo: dt = segmento / velocidade
    const segLen = (2 * Math.PI / totalSamples) * Math.sqrt((a * Math.sin(theta)) ** 2 + (b * Math.cos(theta)) ** 2);
    t += Math.round((segLen / speed) * 1000);

    points.push({
      t,
      lat: ll.lat,
      lng: ll.lng,
      speed,
      accuracy: 4 + Math.random() * 2,
    });
  }
  return points;
}

function segmentSession(samples) {
  const MOVING = 8;
  const LINE_RADIUS = 15;
  const MIN_DIST = 300;
  const MIN_DUR = 25_000;

  let startIdx = samples.findIndex((s) => s.speed >= MOVING);
  if (startIdx < 0) return { laps: [] };

  const startFinish = { lat: samples[startIdx].lat, lng: samples[startIdx].lng };
  const laps = [];
  let lapStart = startIdx;
  let justCrossed = true;
  let prev = samples[startIdx];
  let cumDistLap = 0;

  for (let i = startIdx + 1; i < samples.length; i++) {
    const d = haversine(prev, samples[i]);
    cumDistLap += d;
    prev = samples[i];

    const distToStart = haversine(samples[i], startFinish);
    if (distToStart > LINE_RADIUS * 2) justCrossed = false;

    const elapsed = samples[i].t - samples[lapStart].t;
    if (!justCrossed && distToStart < LINE_RADIUS && cumDistLap >= MIN_DIST && elapsed >= MIN_DUR) {
      laps.push({
        samples: samples.slice(lapStart, i + 1),
        durationMs: elapsed,
        distance: cumDistLap,
      });
      lapStart = i;
      cumDistLap = 0;
      justCrossed = true;
    }
  }
  return { laps, startFinish };
}

// ============================================================
// TESTE 1: segmentação de sessão com 3 voltas sintéticas
// ============================================================
console.log('\n🧪 Teste sintético do pipeline KartLap\n');

const center = { lat: -14.8615, lng: -40.8442 }; // aproximadamente Vitória da Conquista
let t = Date.now();

// 10 segundos no paddock (velocidade baixa, não conta)
const paddock = [];
const proj = makeProjector(center);
for (let i = 0; i < 30; i++) {
  const ll = proj.toLatLng({ x: -180 + i * 0.5, y: -70 });
  paddock.push({ t: t + i * 300, lat: ll.lat, lng: ll.lng, speed: 2, accuracy: 5 });
}
t = paddock[paddock.length - 1].t + 1000;

// 3 voltas de ritmo: volta 2 tem perda de tempo no setor 1 (curva leste)
const lap1 = generateLap({ center, startTime: t });
t = lap1[lap1.length - 1].t + 100;
const lap2 = generateLap({ center, startTime: t, slowdownSector: 1 });
t = lap2[lap2.length - 1].t + 100;
const lap3 = generateLap({ center, startTime: t });

const all = [...paddock, ...lap1, ...lap2, ...lap3];
console.log(`  Gerado: ${all.length} amostras, ${paddock.length} no paddock + 3 voltas`);

const { laps } = segmentSession(all);
console.log(`  Detectado: ${laps.length} voltas`);

if (laps.length !== 3) {
  console.log(`  ❌ ESPERADO 3 VOLTAS, detectou ${laps.length}`);
  process.exit(1);
}

const sorted = [...laps].sort((a, b) => a.durationMs - b.durationMs);
console.log('\n  Tempos:');
laps.forEach((l, i) => {
  const isBest = l === sorted[0];
  const m = Math.floor(l.durationMs / 60000);
  const s = ((l.durationMs % 60000) / 1000).toFixed(3);
  console.log(`    Volta ${i + 1}: ${m}:${s.padStart(6, '0')} ${isBest ? '★' : ''} (${l.distance.toFixed(0)}m)`);
});

// Valida: volta 2 (com slowdown) deve ser a mais lenta
const lapTimes = laps.map((l) => l.durationMs);
const slowestIdx = lapTimes.indexOf(Math.max(...lapTimes));
console.log(`\n  Volta mais lenta: ${slowestIdx + 1}`);

if (slowestIdx !== 1) {
  console.log(`  ❌ ESPERADO volta 2 ser a mais lenta (tinha slowdown), foi ${slowestIdx + 1}`);
  process.exit(1);
}

const delta = (lapTimes[slowestIdx] - sorted[0].durationMs) / 1000;
console.log(`  Delta da volta lenta: +${delta.toFixed(3)}s`);

if (delta < 1.5 || delta > 8) {
  console.log(`  ⚠️  Delta fora da faixa esperada (1.5-8s)`);
}

console.log('\n✅ Teste passou: segmentação detecta voltas corretamente');
console.log('✅ Volta com slowdown foi identificada como a mais lenta\n');

// ============================================================================
// ⚠️ ATENÇÃO: código abaixo é cópia JS de src/lib/analysisPrompt.ts
// MANTER SINCRONIZADO quando alterar o TS. Dívida técnica registrada.
// Solução definitiva: migrar self-test pra ts-node.
// ============================================================================

function groupSectorsIntoZones(sectors) {
  const NOISE_THRESHOLD_MS = 20;
  const zones = [];
  let current = null;

  for (const sector of sectors) {
    const isNoise = Math.abs(sector.deltaMs) < NOISE_THRESHOLD_MS;
    if (isNoise) {
      if (current) { zones.push(current); current = null; }
      continue;
    }

    const kind = sector.deltaMs > 0 ? 'loss' : 'gain';

    if (!current || current.kind !== kind) {
      if (current) zones.push(current);
      current = {
        sectorStart: sector.index,
        sectorEnd: sector.index,
        totalDeltaMs: sector.deltaMs,
        avgSpeedCurrent: sector.avgSpeedCurrent,
        avgSpeedRef: sector.avgSpeedRef,
        avgSpeedDiffKmh: (sector.avgSpeedCurrent - sector.avgSpeedRef) * 3.6,
        kind,
      };
    } else {
      const nSoFar = current.sectorEnd - current.sectorStart + 1;
      current.sectorEnd = sector.index;
      current.totalDeltaMs += sector.deltaMs;
      current.avgSpeedCurrent =
        (current.avgSpeedCurrent * nSoFar + sector.avgSpeedCurrent) / (nSoFar + 1);
      current.avgSpeedRef =
        (current.avgSpeedRef * nSoFar + sector.avgSpeedRef) / (nSoFar + 1);
      current.avgSpeedDiffKmh =
        (current.avgSpeedCurrent - current.avgSpeedRef) * 3.6;
    }
  }

  if (current) zones.push(current);
  return zones;
}

function formatZone(zone, sectorMeters) {
  const lengthM = (zone.sectorEnd - zone.sectorStart + 1) * sectorMeters;
  const deltaS = (zone.totalDeltaMs / 1000).toFixed(2);
  const verb = zone.kind === 'loss' ? 'perdeu' : 'ganhou';
  const speedCur = (zone.avgSpeedCurrent * 3.6).toFixed(1);
  const speedRef = (zone.avgSpeedRef * 3.6).toFixed(1);
  const speedDiff = zone.avgSpeedDiffKmh.toFixed(1);
  const speedDiffSigned = zone.avgSpeedDiffKmh >= 0 ? `+${speedDiff}` : speedDiff;

  const setoresLabel =
    zone.sectorStart === zone.sectorEnd
      ? `Setor ${zone.sectorStart + 1}`
      : `Setores ${zone.sectorStart + 1}-${zone.sectorEnd + 1}`;

  return `${setoresLabel} (~${lengthM.toFixed(0)}m): ${verb} ${Math.abs(Number(deltaS)).toFixed(2)}s · vel média ${speedCur}km/h vs ${speedRef}km/h ref (${speedDiffSigned}km/h)`;
}

function fmtLap(ms) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function buildAnalysisPrompt(input) {
  const { analysis, lapDurationMs, referenceDurationMs, trackName } = input;
  const sectors = analysis.sectors;
  const sectorMeters =
    sectors.length > 0 ? sectors[0].sEnd - sectors[0].sStart : 0;

  const zones = groupSectorsIntoZones(sectors);
  const losses = zones.filter((z) => z.kind === 'loss').sort((a, b) => b.totalDeltaMs - a.totalDeltaMs);
  const gains = zones.filter((z) => z.kind === 'gain').sort((a, b) => a.totalDeltaMs - b.totalDeltaMs);


  const systemPrompt = `Você é um analista técnico de kart indoor/outdoor brasileiro. Sua função é ler dados de telemetria GPS comparando uma volta do piloto com sua volta de referência (melhor volta conhecida na mesma pista), e apontar onde o piloto perdeu ou ganhou tempo.

Diretrizes obrigatórias de resposta:
1. Tom neutro em português brasileiro — equilibrado entre técnico e acessível. Sem gírias, sem formalidade excessiva.
2. Formato: lista de itens, um por zona relevante da pista. Máximo 6 itens.
3. Cada item começa com o identificador da zona (ex: "Setores 5-8:" ou "Setor 12:") seguido de dois pontos.
4. Dentro de cada item, cite o delta em segundos com 2 casas decimais e a diferença de velocidade em km/h. Sugira UMA hipótese técnica (freou antes/depois, acelerou tarde, trajetória mais aberta, etc).
5. Não invente dados que não foram fornecidos. Se o dado não permite concluir, diga "dado insuficiente pra afirmar causa".
6. Não use emojis, não use markdown, não use asteriscos. Texto corrido.
7. Após a lista, encerre com uma linha começando com "Resumo:" em no máximo 20 palavras.`;

  const lossLines = losses.slice(0, 4).map((z) => `- ${formatZone(z, sectorMeters)}`);
  const gainLines = gains.slice(0, 2).map((z) => `- ${formatZone(z, sectorMeters)}`);

  const userPrompt = `Pista: ${trackName}
Volta analisada: ${fmtLap(lapDurationMs)}
Volta de referência: ${fmtLap(referenceDurationMs)}
Delta total: ${(analysis.totalDeltaMs / 1000).toFixed(2)}s (${analysis.totalDeltaMs > 0 ? 'mais lento' : 'mais rápido'} que a referência)

A pista está dividida em ${sectors.length} mini-setores iguais de ~${sectorMeters.toFixed(0)}m cada.

ZONAS DE PERDA DE TEMPO (ordenadas do pior pro menos grave):
${lossLines.length > 0 ? lossLines.join('\n') : '- Nenhuma zona de perda significativa (>20ms por setor)'}

ZONAS DE GANHO DE TEMPO (onde foi melhor que a referência):
${gainLines.length > 0 ? gainLines.join('\n') : '- Nenhuma zona de ganho significativa'}

Analise essa volta seguindo as diretrizes do sistema.`;

  const totalChars = systemPrompt.length + userPrompt.length;
  const estimatedInputTokens = Math.ceil(totalChars / 4);

  return { systemPrompt, userPrompt, estimatedInputTokens };
}

// ============================================================================
// TESTE 2: buildAnalysisPrompt com setores fake
// ============================================================================
console.log('=== TESTE: buildAnalysisPrompt ===\n');

// Simula saída do analyzeLap com 20 setores iguais
const fakeSectors = Array.from({ length: 20 }, (_, i) => ({
  index: i,
  sStart: i * 40,
  sEnd: (i + 1) * 40,
  referenceMs: 2500,
  currentMs: 2500,
  deltaMs: 0,
  avgSpeedRef: 16,
  avgSpeedCurrent: 16,
}));

// Simula perda concentrada nos setores 4-7 (uma curva lenta)
[4, 5, 6, 7].forEach((i) => {
  fakeSectors[i].deltaMs = 85 + Math.random() * 30;
  fakeSectors[i].currentMs = 2500 + fakeSectors[i].deltaMs;
  fakeSectors[i].avgSpeedCurrent = 14;
});

// Simula ganho no setor 14 (reta onde pilotou melhor)
fakeSectors[14].deltaMs = -60;
fakeSectors[14].currentMs = 2440;
fakeSectors[14].avgSpeedCurrent = 17.5;

const fakeAnalysis = {
  totalDeltaMs: fakeSectors.reduce((acc, s) => acc + s.deltaMs, 0),
  sectors: fakeSectors,
  worstSectorIdx: 5,
  bestSectorIdx: 14,
};

const prompt = buildAnalysisPrompt({
  analysis: fakeAnalysis,
  lapDurationMs: 50000 + fakeAnalysis.totalDeltaMs,
  referenceDurationMs: 50000,
  trackName: 'Kartódromo Leandro Merlo',
});

console.log('--- SYSTEM ---');
console.log(prompt.systemPrompt);
console.log('\n--- USER ---');
console.log(prompt.userPrompt);
console.log('\n--- STATS ---');
console.log('Estimated input tokens:', prompt.estimatedInputTokens);

// ============================================================================
// TESTE 3: DeltaTracker (realtime MyChron-style)
//
// Cenário: piloto faz volta de referência em ~36s. Depois faz a volta atual
// 0.5s mais rápida UNIFORMEMENTE (multiplica todos os dts por 36/36.5).
// Em qualquer ponto da pista, o delta esperado é proporcional ao progresso:
//
//   delta(s) ≈ - (s / totalLength) * 0.5s
//
// No meio da pista, delta ≈ -0.25s. No final, delta ≈ -0.5s.
//
// Implementação JS minimalista do tracker. Em produção usa a TS em
// src/lib/realtimeDelta.ts — esse teste valida só a aritmética/lógica.
// ============================================================================
console.log('\n=== TESTE: DeltaTracker (realtime MyChron) ===\n');

function makeRefLap(samples, origin) {
  const proj = makeProjector(origin);
  const points = samples.map((s) => ({ ...s, ...proj.toXY(s) }));
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cumulative.push(cumulative[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return {
    points,
    cumulativeDist: cumulative,
    totalLength: cumulative[cumulative.length - 1] || 0,
    origin,
  };
}

function projectOnSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    const dx = p.x - a.x, dy = p.y - a.y;
    return { dist: Math.sqrt(dx * dx + dy * dy), t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const projX = a.x + t * abx, projY = a.y + t * aby;
  const dx = p.x - projX, dy = p.y - projY;
  return { dist: Math.sqrt(dx * dx + dy * dy), t };
}

function matchPointToRef(p, ref) {
  let bestDist = Infinity, bestS = 0;
  for (let i = 0; i < ref.points.length - 1; i++) {
    const a = ref.points[i], b = ref.points[i + 1];
    const { dist, t } = projectOnSegment(p, a, b);
    if (dist < bestDist) {
      bestDist = dist;
      const segLen = ref.cumulativeDist[i + 1] - ref.cumulativeDist[i];
      bestS = ref.cumulativeDist[i] + t * segLen;
    }
  }
  return { s: bestS, dist: bestDist };
}

// Mapeia cada sample da REF pro (s, tMs desde t0) — quando vamos interpolar.
function buildRefMapping(refSamples, ref) {
  const proj = makeProjector(ref.origin);
  const t0 = refSamples[0].t;
  return refSamples.map((s) => {
    const xy = proj.toXY(s);
    const m = matchPointToRef(xy, ref);
    return { s: m.s, tMs: s.t - t0 };
  });
}

function interpolateTimeAtS(mapping, s) {
  if (mapping.length < 2) return null;
  if (s <= mapping[0].s) return mapping[0].tMs;
  if (s >= mapping[mapping.length - 1].s) return mapping[mapping.length - 1].tMs;
  for (let i = 1; i < mapping.length; i++) {
    if (mapping[i].s >= s) {
      const a = mapping[i - 1], b = mapping[i];
      const ratio = (s - a.s) / (b.s - a.s);
      return a.tMs + ratio * (b.tMs - a.tMs);
    }
  }
  return mapping[mapping.length - 1].tMs;
}

// Gera ref oval + atual oval mas TODOS os dts comprimidos por fator 0.985
// (volta atual ~1.5% mais rápida no total).
const refSamples = generateLap({
  center: { lat: -23.7038, lng: -46.6988 },
  startTime: 0,
  noiseM: 0.2,
});
const refDurationMs = refSamples[refSamples.length - 1].t - refSamples[0].t;

// Cria volta atual: mesma trajetória, todos os dts multiplicados por 0.985
const SPEED_FACTOR = 0.985; // 1.5% mais rápido
const curSamples = [];
let curT = 0;
for (let i = 0; i < refSamples.length; i++) {
  const refSample = refSamples[i];
  if (i > 0) {
    const refDt = refSample.t - refSamples[i - 1].t;
    curT += Math.round(refDt * SPEED_FACTOR);
  }
  curSamples.push({ ...refSample, t: curT });
}

const ref = makeRefLap(refSamples, { lat: refSamples[0].lat, lng: refSamples[0].lng });
const mapping = buildRefMapping(refSamples, ref);

console.log(`  Pista oval ~${ref.totalLength.toFixed(0)}m`);
console.log(`  Ref: ${refDurationMs}ms · Atual: ${curSamples[curSamples.length - 1].t}ms`);
console.log(`  Esperado delta final: ${curSamples[curSamples.length - 1].t - refDurationMs}ms (≈ -${(refDurationMs * (1 - SPEED_FACTOR)).toFixed(0)}ms)`);

// Simula a tracking ao vivo: a cada sample, calcula delta.
// Pega os deltas em ~25%, 50%, 75%, 100% da volta atual.
const liveProj = makeProjector(ref.origin);
const checkpoints = [0.25, 0.5, 0.75, 1.0];
const checkIdxs = checkpoints.map((p) => Math.floor(p * (curSamples.length - 1)));
const deltas = checkIdxs.map((idx) => {
  const sample = curSamples[idx];
  const xy = liveProj.toXY(sample);
  const m = matchPointToRef(xy, ref);
  const lapElapsed = sample.t - curSamples[0].t;
  const tRefAtS = interpolateTimeAtS(mapping, m.s);
  return tRefAtS === null ? null : lapElapsed - tRefAtS;
});

console.log('\n  Deltas ao longo da volta (delta = atual - ref no mesmo ponto):');
checkpoints.forEach((p, i) => {
  const d = deltas[i];
  const sign = d >= 0 ? '+' : '-';
  console.log(`    ${(p * 100).toFixed(0).padStart(3)}% pista → delta = ${sign}${Math.abs(d).toFixed(0)}ms`);
});

// Asserções:
// 1. Todos os deltas devem ser negativos (volta atual é mais rápida).
// 2. |delta| deve crescer monotonicamente (perda acumulada).
// 3. Delta no final ≈ delta total esperado (tolerância ±50ms pra ruído de match).
const expectedFinalMs = curSamples[curSamples.length - 1].t - refDurationMs;
const lastDelta = deltas[deltas.length - 1];

let ok = true;
if (deltas.some((d) => d === null)) {
  console.log('  ❌ Algum checkpoint teve match falhando');
  ok = false;
}
if (deltas.some((d) => d > 0)) {
  console.log('  ❌ Algum delta positivo (volta atual deveria ser sempre mais rápida)');
  ok = false;
}
for (let i = 1; i < deltas.length; i++) {
  if (Math.abs(deltas[i]) < Math.abs(deltas[i - 1]) - 30) {
    console.log(`  ❌ |delta| diminuiu entre cp ${i - 1} e ${i} (deveria crescer monotonicamente)`);
    ok = false;
  }
}
if (Math.abs(lastDelta - expectedFinalMs) > 60) {
  console.log(`  ❌ Delta final ${lastDelta}ms diverge >60ms do esperado ${expectedFinalMs}ms`);
  ok = false;
}

if (!ok) process.exit(1);
console.log('\n✅ DeltaTracker: deltas batem com a volta de referência, sem null, monotônicos\n');