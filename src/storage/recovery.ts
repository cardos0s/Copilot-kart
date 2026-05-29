/**
 * Recuperação anti-crash de sessão de gravação.
 *
 * Problema: durante a gravação os samples vivem só em memória
 * (allSamplesRef no hook), salvos no SQLite só no Encerrar. Se o app
 * crashar/for morto pelo SO/bateria acabar no meio de uma sessão de
 * 15min, perde TUDO.
 *
 * Solução: a cada volta fechada + a cada 30s, gravamos um snapshot do
 * estado bruto (samples + imu + metadata) num arquivo JSON. No encerramento
 * limpo, apagamos. No boot do app, se o arquivo existe → houve crash →
 * oferecemos recuperar.
 *
 * Arquivo único (sobrescreve) em documentDirectory. Snapshot completo a
 * cada escrita (não append) — mais simples e robusto; o custo de escrever
 * ~1-3MB a cada 30s é aceitável e roda async sem travar a gravação.
 */

import * as FileSystem from 'expo-file-system';
import type { GpsSample, ImuSample } from '../lib/geometry';
import { detectLaps } from '../lib/lapDetector';
import type { LapRecord } from '../lib/analysis';
import { createSession, saveLap } from './db';

// expo-file-system v19 expõe API legada via cast (mesmo padrão do
// profile.ts). documentDirectory + read/write/delete/getInfo.
const FS = FileSystem as any;
const RECOVERY_URI = (FS.documentDirectory ?? '') + 'copilot-recovery.json';

export type RecoverySnapshot = {
  version: 1;
  startedAt: number;
  updatedAt: number;
  trackId: string | null;
  trackName: string;
  layoutId: string | null;
  kartSetupId: string | null;
  mode: 'race' | 'reference';
  samples: GpsSample[];
  imuSamples: ImuSample[];
};

/** Grava (sobrescreve) o snapshot. Best-effort — falha não quebra gravação. */
export async function saveRecoverySnapshot(snap: RecoverySnapshot): Promise<void> {
  try {
    await FS.writeAsStringAsync(RECOVERY_URI, JSON.stringify(snap));
  } catch {
    /* best-effort: se o disco falhar, a gravação em memória segue normal */
  }
}

/** Lê o snapshot se existir e for válido. null caso contrário. */
export async function loadRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  try {
    const info = await FS.getInfoAsync(RECOVERY_URI);
    if (!info?.exists) return null;
    const raw = await FS.readAsStringAsync(RECOVERY_URI);
    const parsed = JSON.parse(raw);
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.samples) ||
      parsed.samples.length === 0
    ) {
      return null;
    }
    return parsed as RecoverySnapshot;
  } catch {
    return null;
  }
}

/** Existe snapshot recuperável? (mais barato que loadRecoverySnapshot). */
export async function hasRecoverySnapshot(): Promise<boolean> {
  try {
    const info = await FS.getInfoAsync(RECOVERY_URI);
    return !!info?.exists;
  } catch {
    return false;
  }
}

/** Apaga o snapshot — chamado no encerramento limpo ou após recuperar/descartar. */
export async function clearRecoverySnapshot(): Promise<void> {
  try {
    await FS.deleteAsync(RECOVERY_URI, { idempotent: true });
  } catch {
    /* idempotente; ignora se já não existe */
  }
}

/**
 * Reconstrói uma sessão salva a partir do snapshot e apaga o arquivo.
 * Roda detectLaps nos samples brutos (mesma fonte de verdade do stop()),
 * cria a session no SQLite e salva cada volta com seus samples + IMU
 * recortados por timestamp.
 *
 * Versão enxuta vs handleFinish do recording: NÃO roda gamification/IA/
 * leaderboard (nice-to-have). O importante é não perder o dado bruto —
 * análise pode ser refeita depois sobre a sessão recuperada.
 *
 * Retorna o id da sessão criada, ou null se não deu pra reconstruir
 * (ex: poucos samples / nenhuma volta fechada).
 */
export async function recoverSnapshotToSession(
  snap: RecoverySnapshot
): Promise<string | null> {
  const detection = detectLaps(snap.samples);
  if (detection.laps.length === 0) {
    // Sem volta fechada — nada útil pra salvar. Limpa e desiste.
    await clearRecoverySnapshot();
    return null;
  }

  const session = await createSession({
    trackName: snap.trackName,
    kart: null,
    notes: 'Sessão recuperada após interrupção',
    weather: 'dry',
    trackId: snap.trackId,
    mode: snap.mode,
    layoutId: snap.layoutId,
    kartSetupId: snap.kartSetupId,
  });

  for (let i = 0; i < detection.laps.length; i++) {
    const lap = detection.laps[i];
    const lapEndT = lap.startedAt + lap.durationMs;
    const imuSlice = snap.imuSamples.filter(
      (s) => s.t >= lap.startedAt && s.t <= lapEndT
    );
    const rec: LapRecord = {
      id: `${session.id}_lap_${i + 1}`,
      sessionId: session.id,
      samples: snap.samples.slice(lap.startIdx, lap.endIdx + 1),
      startedAt: lap.startedAt,
      durationMs: lap.durationMs,
      imuSamples: imuSlice.length > 0 ? imuSlice : undefined,
    };
    await saveLap(rec);
  }

  await clearRecoverySnapshot();
  return session.id;
}
