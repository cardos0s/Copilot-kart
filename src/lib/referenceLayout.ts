/**
 * "ATUALIZAR REFERÊNCIA" depois de uma volta mais rápida que o traçado.
 *
 * Decisão de 30/09: cria um traçado novo, que vira o padrão da pista, em vez
 * de sobrescrever o anterior. As sessões antigas continuam presas ao traçado
 * com que foram gravadas, e os S1/S2/S3 delas não mudam.
 *
 * Puro: só tipos do armazenamento, nada nativo.
 */
import type { LapRecord } from './analysis';
import { polylineLength } from './geometry';
import type { TrackLayout } from '../storage/db';

const DATE_SUFFIX = / · \d{2}\/\d{2}$/;

function ddmm(now: number): string {
  const d = new Date(now);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * O traçado novo a partir da melhor volta. Os pontos são os da volta como foi
 * salva, com as fronteiras sintéticas na linha (AD-006). O id sai da volta,
 * então gravar de novo o mesmo traçado não cria um segundo.
 */
export function nextReferenceLayout(
  reference: TrackLayout,
  best: LapRecord,
  sessionId: string,
  now: number
): TrackLayout {
  const baseName = reference.name.replace(DATE_SUFFIX, '');
  return {
    id: `layout_${best.id}`,
    trackId: reference.trackId,
    name: `${baseName} · ${ddmm(now)}`,
    samples: [...best.samples],
    durationMs: best.durationMs,
    lengthM: polylineLength(best.samples),
    recordedAt: now,
    sourceSessionId: sessionId,
    sourceLapId: best.id,
    isDefault: true,
  };
}
