/**
 * Ponto de frenagem mais forte da volta (marcador "B" do mapa da sessão).
 *
 * Maior desaceleração entre pontos consecutivos, só onde o intervalo entre
 * eles fica entre 0,05 s e 5 s. Abaixo de 3 m/s² não há marcador.
 */
import type { GpsSample } from './geometry';

export type BrakingPoint = {
  /** Índice do ponto em que a desaceleração termina. */
  index: number;
  lat: number;
  lng: number;
  /** Desaceleração, em m/s². */
  decelMs2: number;
};

export function hardestBraking(samples: GpsSample[]): BrakingPoint | null {
  let brakeIdx = -1;
  let maxDecel = 0;
  for (let i = 1; i < samples.length; i++) {
    const dv = samples[i].speed - samples[i - 1].speed;
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt > 0.05 && dt < 5) {
      const decel = -dv / dt; // m/s²
      if (decel > maxDecel) {
        maxDecel = decel;
        brakeIdx = i;
      }
    }
  }
  if (brakeIdx > 0 && maxDecel > 3 && samples[brakeIdx]) {
    return { index: brakeIdx, lat: samples[brakeIdx].lat, lng: samples[brakeIdx].lng, decelMs2: maxDecel };
  }
  return null;
}
