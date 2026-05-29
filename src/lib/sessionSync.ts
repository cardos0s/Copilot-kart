/**
 * Sync anônimo de sessões pro Supabase — backup do tester + visibilidade
 * do dev na fase de campo. SEM login: chaveado por device_id.
 *
 * O QUE sincroniza: metadata da sessão (pista, modo, data) + tempos de
 * volta + setores. NÃO sincroniza os sample arrays brutos (GPS/IMU) —
 * grandes demais pro free tier do Supabase. Telemetria completa fica
 * local; pode ser sincronizada sob demanda no futuro.
 *
 * Idempotente: upsert por (device_id, local_session_id). Pode rodar
 * quantas vezes quiser sem duplicar. Respeita o toggle getCloudSyncEnabled
 * (opt-out de privacidade nas configurações).
 *
 * Falha silenciosa em tudo — sync é "nice to have", nunca quebra o fluxo
 * principal (gravar/salvar local sempre funciona offline).
 */

import { getSupabase } from './supabase';
import { getDeviceId } from './deviceId';
import { getProfile } from '../storage/profile';
import { getCloudSyncEnabled } from '../storage/preferences';
import { listSessions, getLapsForSession, type Session } from '../storage/db';
import type { LapRecord } from './analysis';

/**
 * Sincroniza UMA sessão (metadata + voltas). Chamado após salvar uma
 * sessão nova. Best-effort.
 */
export async function syncSession(session: Session, laps: LapRecord[]): Promise<void> {
  if (!(await getCloudSyncEnabled())) return;
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const deviceId = await getDeviceId();
    const profile = await getProfile();
    const lapMsList = laps.map((l) => l.durationMs);
    const bestLapMs = lapMsList.length > 0 ? Math.min(...lapMsList) : null;

    // Upsert da sessão (idempotente por device_id + local_session_id)
    await supabase.from('synced_sessions').upsert(
      {
        device_id: deviceId,
        local_session_id: session.id,
        pilot_name: profile?.name ?? null,
        track_id: session.trackId,
        track_name: session.trackName,
        layout_id: session.layoutId ?? null,
        mode: session.mode,
        started_at: new Date(session.startedAt).toISOString(),
        best_lap_ms: bestLapMs,
        lap_count: laps.length,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'device_id,local_session_id' }
    );

    // Upsert das voltas. lap_number derivado do índice (1-based) — estável
    // porque getLapsForSession ordena por started_at asc.
    if (laps.length > 0) {
      const rows = laps.map((lap, i) => ({
        device_id: deviceId,
        local_session_id: session.id,
        lap_number: i + 1,
        duration_ms: lap.durationMs,
        // Setores: o LapRecord não carrega sectors hoje (são derivados em
        // runtime). Deixa null por enquanto — pode ser preenchido quando
        // a detecção de setor for persistida no lap. Mantém o schema pronto.
        s1_ms: null,
        s2_ms: null,
        s3_ms: null,
      }));
      await supabase
        .from('synced_laps')
        .upsert(rows, { onConflict: 'device_id,local_session_id,lap_number' });
    }
  } catch {
    /* best-effort — sync nunca quebra o fluxo principal */
  }
}

/**
 * Backfill: sincroniza TODAS as sessões locais que ainda não estão na
 * nuvem (ou re-sincroniza — upsert é idempotente). Roda uma vez por
 * abertura do app (chamado no boot), em background.
 *
 * Pra footprint pequeno: como upsert é idempotente, re-enviar tudo é
 * seguro. Pra N pequeno (testers têm dezenas de sessões) é tranquilo.
 * Se crescer muito, dá pra adicionar flag synced_at local e filtrar.
 */
export async function syncAllSessions(): Promise<void> {
  if (!(await getCloudSyncEnabled())) return;
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const sessions = await listSessions();
    // Limita a 50 sessões mais recentes pra não martelar a rede no boot.
    for (const session of sessions.slice(0, 50)) {
      const laps = await getLapsForSession(session.id);
      await syncSession(session, laps);
    }
  } catch {
    /* best-effort */
  }
}
