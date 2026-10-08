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
import type { GpsFrame } from '../telemetry/frame';
import type { AnalysisGpsFrame } from '../telemetry/laps';
import type { DetectLapsResult } from '../lib/lapDetector';
import type { CrossPoint, StartLine } from '../lib/startLine';
import { sliceLaps } from './finishSession';

export type LiveLapClock = {
  /** Instante do cruzamento que abriu a volta em curso. */
  lapStartT: number;
  /** `nowSampleT − lapStartT`. */
  elapsedMs: number;
};

/**
 * Início da volta em curso: o `openCross` do `detectLaps`, o cruzamento que a
 * abriu. Normalmente é o `endCross.t` da última volta fechada; depois de um
 * box (volta descartada por passar de 180 s), é o cruzamento depois da parada.
 * Antes da 1ª volta, é o 1º cruzamento da linha (sem traçado, o ponto em que
 * o ritmo começou). Com traçado e nenhum cruzamento ainda, devolve `null`: o
 * cronômetro não corre.
 *
 * `all` e `line` ficam na assinatura da T19, mas o início vem só de
 * `detection.openCross`, pela mesma regra que fecha as voltas.
 */
export function liveLapClock(
  detection: Pick<DetectLapsResult, 'openCross'>,
  _all: GpsFrame[],
  nowSampleT: number,
  _line: StartLine | null
): LiveLapClock | null {
  if (!detection.openCross) return null;
  const lapStartT = detection.openCross.t;
  return { lapStartT, elapsedMs: nowSampleT - lapStartT };
}

/**
 * Uma volta nova abriu desde o poll anterior: o `openCross` mudou. Vale quando
 * uma volta fecha e também quando a anterior foi descartada por passar de
 * 180 s (box), caso em que nenhuma volta fecha. O hook chama
 * `DeltaTracker.resetLap()` sempre que isto é verdadeiro (TMP-10 AC 6).
 */
export function lapOpened(
  prevOpenCross: Pick<CrossPoint, 't'> | null,
  openCross: Pick<CrossPoint, 't'> | null
): boolean {
  if (!openCross) return false;
  return !prevOpenCross || prevOpenCross.t !== openCross.t;
}

/**
 * Referência do `DeltaTracker` para a volta fechada `lapIdx`: a volta como o
 * `sliceLaps` a recorta, começando e terminando nos pontos sintéticos na
 * linha. `null` se a volta não existe.
 */
export function deltaReferenceLap(
  all: AnalysisGpsFrame[],
  line: StartLine | null,
  lapIdx: number
): { gps: GpsFrame[]; durationMs: number } | null {
  const lap = sliceLaps(all, [], line)[lapIdx];
  return lap ? { gps: lap.gps, durationMs: lap.durationMs } : null;
}
