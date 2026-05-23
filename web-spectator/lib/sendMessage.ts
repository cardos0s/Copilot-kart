/**
 * Helper pra equipe mandar mensagem pro piloto. Insert simples em
 * live_messages — o app do piloto recebe via realtime no canal
 * `live:<sessionId>` e mostra como overlay full-screen por ~5s.
 *
 * `sentBy` é etiqueta livre (nome do coach/box). Não é auth.
 * Texto: idealmente <=24 chars pra caber na tela do cockpit em letras
 * grandes. UI deve avisar o coach se passar — aqui não validamos.
 */

import { getSupabase } from './supabase';
import type { MessageSeverity } from './liveTypes';

export async function sendMessage(
  sessionId: string,
  msg: {
    severity: MessageSeverity;
    text: string;
    sentBy?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('live_messages').insert({
      live_session_id: sessionId,
      severity: msg.severity,
      text: msg.text.trim(),
      sent_by: msg.sentBy ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro desconhecido' };
  }
}
