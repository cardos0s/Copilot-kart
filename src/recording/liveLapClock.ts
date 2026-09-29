/**
 * Relógio da volta em curso e referência do delta ao vivo (AD-006; TMP-05
 * AC 3, TMP-10).
 *
 * A volta em curso começa no cruzamento interpolado da linha, e não no
 * primeiro ponto cru depois dele: é o mesmo instante que abre a volta salva
 * pelo `sliceLaps`. A referência do delta é a volta com os pontos de
 * fronteira, também pelo `sliceLaps`.
 *
 * Puro: nada nativo, testado em Node.
 */
import type { GpsSample } from '../lib/geometry';
import type { DetectLapsResult } from '../lib/lapDetector';
import { crossing, type StartLine } from '../lib/startLine';
import { sliceLaps } from './finishSession';

export type LiveLapClock = {
  /** Instante do cruzamento que abriu a volta em curso. */
  lapStartT: number;
  /** `nowSampleT − lapStartT`. */
  elapsedMs: number;
};

/**
 * Início da volta em curso: o `endCross.t` da última volta fechada ou, antes
 * da primeira, o 1º cruzamento da linha, pela mesma regra do `detectLaps`.
 * Sem traçado, esse cruzamento é o ponto em que o ritmo começou (f = 0). Com
 * traçado (`line`) e nenhum cruzamento ainda, devolve `null`: o cronômetro
 * não corre.
 *
 * `line` é a mesma linha passada ao `detectLaps` (`null` sem traçado).
 */
export function liveLapClock(
  detection: Pick<DetectLapsResult, 'laps' | 'movingStartIdx'>,
  all: GpsSample[],
  nowSampleT: number,
  line: StartLine | null
): LiveLapClock | null {
  let lapStartT: number | null = null;
  if (detection.laps.length > 0) {
    lapStartT = detection.laps[detection.laps.length - 1].endCross.t;
  } else if (detection.movingStartIdx >= 0) {
    if (!line) {
      lapStartT = all[detection.movingStartIdx].t;
    } else {
      for (let i = Math.max(1, detection.movingStartIdx); i < all.length; i++) {
        const c = crossing(all[i - 1], all[i], line);
        if (c) {
          lapStartT = c.t;
          break;
        }
      }
    }
  }
  if (lapStartT === null) return null;
  return { lapStartT, elapsedMs: nowSampleT - lapStartT };
}

/**
 * Referência do `DeltaTracker` para a volta fechada `lapIdx`: a volta como o
 * `sliceLaps` a recorta, começando e terminando nos pontos sintéticos na
 * linha. `null` se a volta não existe.
 */
export function deltaReferenceLap(
  all: GpsSample[],
  line: StartLine | null,
  lapIdx: number
): { samples: GpsSample[]; durationMs: number } | null {
  const lap = sliceLaps(all, [], line)[lapIdx];
  return lap ? { samples: lap.samples, durationMs: lap.durationMs } : null;
}
