/**
 * "ATUALIZAR REFERÊNCIA" depois de uma volta mais rápida que o traçado.
 *
 * Decisão de 30/09: cria um traçado novo, que vira o padrão da pista, em vez
 * de sobrescrever o anterior. As sessões antigas continuam presas ao traçado
 * com que foram gravadas, e os S1/S2/S3 delas não mudam.
 *
 * Decisão de 03/10: o traçado novo herda o PB do anterior. A linha de chegada
 * é a mesma, então o recorde continua comparável.
 *
 * Puro: só tipos do armazenamento, nada nativo.
 */
import type { LapRecord } from './analysis';
import { polylineLength } from './geometry';
import type { PbRecord, TrackLayout } from '../storage/db';

const DATE_SUFFIX = / · \d{2}\/\d{2}$/;

function ddmm(now: number): string {
  const d = new Date(now);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * O traçado novo a partir da melhor volta. Os pontos são os da volta como foi
 * salva, com as fronteiras sintéticas na linha (AD-006), e a janela dela. O id sai da volta,
 * então gravar de novo o mesmo traçado não cria um segundo.
 */
export function nextReferenceLayout(
  reference: TrackLayout,
  best: LapRecord,
  sessionId: string,
  now: number
): TrackLayout {
  const baseName = reference.name.replace(DATE_SUFFIX, '');
  const layout: TrackLayout = {
    id: `layout_${best.id}`,
    trackId: reference.trackId,
    name: `${baseName} · ${ddmm(now)}`,
    samples: [...best.gps],
    durationMs: best.durationMs,
    lengthM: polylineLength(best.gps),
    recordedAt: now,
    sourceSessionId: sessionId,
    sourceLapId: best.id,
    isDefault: true,
  };
  // A janela e os frames da volta: o `promoteReferenceLayout` os copia para a série
  // do traçado novo (TF-19). A volta ainda em JSON (até a v5b) não tem janela.
  if (best.window) {
    layout.window = best.window;
    layout.gps = [...best.gps];
    // Transição (até a T46): `samples` é o mesmo array de `gps`.
    layout.samples = layout.gps as typeof layout.samples;
  }
  return layout;
}

/**
 * O PB do traçado anterior, copiado para o traçado novo. Sai já celebrado:
 * o recorde não é novo, só mudou de traçado. Sem PB anterior, não há o que
 * herdar.
 */
export function inheritedPb(
  previousPb: PbRecord | null,
  nextLayout: TrackLayout,
  now: number
): PbRecord | null {
  if (!previousPb) return null;
  return {
    id: `pb_${nextLayout.id}_${now}`,
    trackId: nextLayout.trackId,
    layoutId: nextLayout.id,
    sessionId: previousPb.sessionId,
    lapId: previousPb.lapId,
    durationMs: previousPb.durationMs,
    celebrated: true,
    createdAt: now,
  };
}
