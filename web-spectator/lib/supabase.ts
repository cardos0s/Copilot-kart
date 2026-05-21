import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para o spectator web.
 *
 * Usa as MESMAS env vars do app Copilot (NEXT_PUBLIC_ em vez de EXPO_PUBLIC_,
 * mesma URL/anon key). Vercel respeita NEXT_PUBLIC_ no client bundle.
 *
 * Segurança real é via Row Level Security no Supabase — a anon key foi feita
 * pra rodar exposta no cliente.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não configuradas. ' +
        'Defina no Vercel (ou .env.local) antes de buildar.'
    );
  }
  cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, // não precisa de auth pra spectator público
  });
  return cached;
}
