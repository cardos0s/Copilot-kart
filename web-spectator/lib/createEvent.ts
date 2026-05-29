/**
 * Cria um evento de competição pelo navegador (organizador que não corre).
 * Gera código único e insere em `events`. Retorna o código pra compartilhar
 * com os pilotos (que entram pelo app).
 */

import { getSupabase } from './supabase';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I/L

function generateCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export async function createEvent(opts: {
  name: string | null;
  trackName?: string | null;
}): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  try {
    const supabase = getSupabase();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const { error } = await supabase.from('events').insert({
        code,
        name: opts.name,
        track_name: opts.trackName ?? null,
        created_by: 'web',
      });
      if (!error) return { ok: true, code };
      // 23505 = unique violation → tenta outro código
      if ((error as any).code !== '23505') {
        return { ok: false, error: error.message };
      }
    }
    return { ok: false, error: 'Não consegui gerar código único.' };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro desconhecido' };
  }
}
