import type { LiveLap, LiveSample, LiveSessionInfo } from './liveTypes';

/**
 * Gera uma sessão ao vivo FALSA pro painel de equipe (box) — pra testar o
 * layout sem precisar de uma sessão real transmitindo. Ativado quando o
 * código da sessão é "DEMO".
 */

const LAP_MS = 42180; // ~42.2s por volta
const REF_MS = 42180; // referência (PB)

// Loop sintético próximo a Granja Viana (Cotia/SP). Coords exatas não importam:
// o painel auto-escala o traçado.
const CLAT = -23.601;
const CLNG = -46.843;
const RLAT = 0.0011;
const RLNG = 0.0016;

export function startDemoLive(setState: (s: any) => void): () => void {
  const t0 = Date.now();
  const info: LiveSessionInfo = {
    id: 'demo',
    code: 'DEMO',
    pilotId: 'demo',
    pilotName: 'Ju Santos',
    pilotKartNumber: '219',
    trackName: 'Granja Viana',
    trackId: 'granja-viana',
    referenceLapMs: REF_MS,
    startedAt: t0,
    endedAt: null,
  };

  const samples: LiveSample[] = [];
  const laps: LiveLap[] = [];
  let lapsClosed = 0; // voltas já empurradas pra `laps`
  let lapDelta = 320; // gap (ms vs ref) da volta em curso

  const id = setInterval(() => {
    const now = Date.now();
    // Tempo por MÓDULO — robusto a throttle de aba em background (nunca estoura).
    const totalEl = now - t0;
    const lapNum = Math.floor(totalEl / LAP_MS) + 1;
    const lapEl = totalEl % LAP_MS;
    const frac = lapEl / LAP_MS;
    const ang = frac * Math.PI * 2 - Math.PI / 2;

    const lat = CLAT + RLAT * Math.sin(ang);
    const lng = CLNG + RLNG * Math.cos(ang);
    const speed = 12 + Math.abs(Math.cos(ang * 2)) * 13; // m/s ~12–25 → 43–90 km/h
    const delta = Math.round(lapDelta * frac * (0.85 + 0.3 * Math.sin(frac * Math.PI * 3)));
    const sectorIdx = (frac < 1 / 3 ? 0 : frac < 2 / 3 ? 1 : 2) as 0 | 1 | 2;

    // Fecha as voltas que passaram (robusto se a aba pulou várias).
    while (lapsClosed < lapNum - 1) {
      laps.push({
        lapNumber: lapsClosed + 1,
        durationMs: REF_MS + lapDelta,
        finishedAt: t0 + (lapsClosed + 1) * LAP_MS,
        s1Ms: 14060,
        s2Ms: 14100,
        s3Ms: 14020 + lapDelta,
      });
      lapsClosed += 1;
      lapDelta = 120 + Math.round(Math.random() * 520);
    }

    samples.push({
      t: now,
      lat,
      lng,
      speed,
      lapNumber: lapNum,
      lapElapsedMs: lapEl,
      bestLapMs: REF_MS,
      deltaVsRefMs: delta,
      currentSectorIdx: sectorIdx,
      currentSectorElapsedMs: lapEl - sectorIdx * (LAP_MS / 3),
      s1Ms: frac > 1 / 3 ? 14060 + Math.round(Math.sin(lapNum) * 120) : null,
      s2Ms: frac > 2 / 3 ? 14100 + Math.round(Math.cos(lapNum) * 120) : null,
      s3Ms: null,
    });
    if (samples.length > 1200) samples.splice(0, samples.length - 1200);

    setState({ kind: 'live', info, samples: [...samples], laps: [...laps], messages: [] });
  }, 100);

  return () => clearInterval(id);
}
