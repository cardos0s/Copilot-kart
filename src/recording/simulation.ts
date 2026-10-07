/**
 * Gerador da gravação simulada (modo demo): replaya os pontos do GPX de bench
 * no ritmo do relógio, em laço, como frames de GPS no relógio da sessão. Puro:
 * o hook chama `step` a cada 80 ms com o `Date.now()`.
 *
 * O `t` vem do `clock.gpsT`, estritamente crescente: quando o laço reinicia, o
 * 1º ponto do laço novo pode cair no mesmo instante do último do anterior, e o
 * relógio o empurra 1 ms (TF-06).
 */
import type { DemoPoint } from '../data/demoLap';
import type { GpsFrame } from '../telemetry/frame';
import type { SessionClock } from './sessionClock';

/** Precisão fixa dos pontos simulados, em m. */
export const SIMULATED_ACCURACY_M = 3;

export type Simulation = {
  /** Os pontos cujo instante (escalado) já passou em `nowMs`. */
  step(nowMs: number): GpsFrame[];
};

/**
 * `scale` estica ou encolhe o tempo dos pontos (o hook varia ±4% por sessão);
 * `startAt` é o instante (epoch ms) em que o 1º laço começa.
 */
export function createSimulation(
  points: readonly DemoPoint[],
  clock: SessionClock,
  scale: number,
  startAt: number
): Simulation {
  let idx = 0;
  let loopT0 = startAt;
  return {
    step(nowMs) {
      const elapsed = nowMs - loopT0;
      const out: GpsFrame[] = [];
      while (idx < points.length && points[idx].t * scale <= elapsed) {
        const p = points[idx];
        out.push({
          kind: 'gps',
          source: 'PHONE',
          t: clock.gpsT(loopT0 + p.t * scale),
          lat: p.lat,
          lng: p.lng,
          speed: p.speed,
          accuracy: SIMULATED_ACCURACY_M,
          fix: 'unknown',
        });
        idx++;
      }
      // Laço contínuo até o "Encerrar".
      if (idx >= points.length) {
        idx = 0;
        loopT0 = nowMs;
      }
      return out;
    },
  };
}
