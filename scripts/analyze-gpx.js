#!/usr/bin/env node
/**
 * Valida o detector de voltas com um arquivo GPX real.
 *
 * Uso:
 *   npx tsx scripts/analyze-gpx.js path/to/track.gpx
 *
 * O GPX pode vir de qualquer app (Strava, GeoTracker, GPX Logger...).
 * Isso permite validar que o algoritmo de detecção funciona com dados
 * reais ANTES de gastar tempo no build do app.
 *
 * Importa detectLaps() direto da lib TypeScript — o mesmo algoritmo que
 * roda no app em produção. Zero duplicação, zero chance de divergência.
 *
 * Requer: npm install fast-xml-parser
 */

const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const { detectLaps } = require('../src/lib/lapDetector.ts');

// Haversine local só pra o parser do GPX preencher speed quando o arquivo
// não trouxer. O algoritmo de detecção NÃO usa essa cópia — ele usa o
// haversine de src/lib/geometry.ts via lapDetector.
function haversine(a, b) {
  const R = 6371000;
  const DEG = Math.PI / 180;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseGpx(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const doc = parser.parse(xml);
  const trkpts = [];
  const tracks = doc.gpx?.trk ?? [];
  const trackList = Array.isArray(tracks) ? tracks : [tracks];
  for (const trk of trackList) {
    const segs = Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg];
    for (const seg of segs) {
      const pts = Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt];
      for (const p of pts) {
        trkpts.push({
          lat: parseFloat(p.lat),
          lng: parseFloat(p.lon),
          t: new Date(p.time).getTime(),
          speed: p.speed ? parseFloat(p.speed) : 0,
          accuracy: 5, // assumimos accuracy decente pra GPX externo
        });
      }
    }
  }
  // Se o GPX não trouxer speed, calcula a partir de dt e dd
  for (let i = 1; i < trkpts.length; i++) {
    if (trkpts[i].speed === 0) {
      const dt = (trkpts[i].t - trkpts[i - 1].t) / 1000;
      const dd = haversine(trkpts[i - 1], trkpts[i]);
      trkpts[i].speed = dt > 0 ? dd / dt : 0;
    }
  }
  return trkpts;
}

function fmtLapTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return `${m}:${s.padStart(6, '0')}`;
}

function lapDistance(samples) {
  let d = 0;
  for (let i = 1; i < samples.length; i++) {
    d += haversine(samples[i - 1], samples[i]);
  }
  return d;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: npx tsx scripts/analyze-gpx.js arquivo.gpx');
    process.exit(1);
  }
  const xml = fs.readFileSync(file, 'utf8');
  const samples = parseGpx(xml);

  console.log(`\n📍 ${samples.length} pontos GPS lidos`);
  console.log(`⏱  Duração total: ${((samples[samples.length - 1].t - samples[0].t) / 1000).toFixed(0)}s`);
  const avgDt = (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1);
  console.log(`📊 Taxa média: ${(1000 / avgDt).toFixed(2)}Hz`);
  const maxSpeed = Math.max(...samples.map((s) => s.speed)) * 3.6;
  console.log(`🏁 Velocidade máxima: ${maxSpeed.toFixed(0)} km/h`);

  // Mesmo detector que o app usa em produção.
  const result = detectLaps(samples);

  if (result.movingStartIdx < 0) {
    console.log('\n⚠️  Piloto nunca entrou em ritmo (>18 km/h sustentado).');
    console.log('   Provável causa: GPX é só de paddock ou aquecimento lento.');
    return;
  }

  if (result.laps.length === 0) {
    console.log('\n⚠️  Entrou em ritmo mas não fechou nenhuma volta. Causas possíveis:');
    console.log('   - Não completou o circuito (só o primeiro giro)');
    console.log('   - Linha de largada mal detectada (começou reta longe do box)');
    console.log('   - Raio de cruzamento muito pequeno pra precisão do GPX');
    return;
  }

  const line = result.startFinishLine;
  console.log(`\n🏁 Linha de largada detectada: ${line.lat.toFixed(6)}, ${line.lng.toFixed(6)}`);
  console.log(`\n🏆 ${result.laps.length} VOLTA(S) DETECTADA(S):\n`);

  // Ordena pra achar a melhor, mas imprime em ordem cronológica
  const best = result.laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), result.laps[0]);

  for (let i = 0; i < result.laps.length; i++) {
    const lap = result.laps[i];
    const lapSamples = samples.slice(lap.startIdx, lap.endIdx + 1);
    const dist = lapDistance(lapSamples);
    const delta = lap.durationMs - best.durationMs;
    const isBest = lap === best;
    const marker = isBest ? '★' : ' ';
    const deltaStr = isBest ? '' : `  ${delta > 0 ? '+' : ''}${(delta / 1000).toFixed(3)}s`;
    console.log(`  ${marker} Volta ${i + 1}: ${fmtLapTime(lap.durationMs)}${deltaStr}  (${dist.toFixed(0)}m)`);
  }

  const bestSamples = samples.slice(best.startIdx, best.endIdx + 1);
  console.log(`\n✓ Pista estimada: ~${lapDistance(bestSamples).toFixed(0)}m\n`);
}

main();