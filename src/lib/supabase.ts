import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para o app.
 *
 * As env vars `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`
 * são públicas — a anon key foi feita pra rodar no cliente. Segurança real
 * é via RLS no Supabase.
 *
 * Se as envs não estão definidas, retorna null e o app continua funcionando
 * apenas em modo local (sem live sharing).
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Falha silenciosa — features de live são opcionais
    if (__DEV__) {
      console.warn('[supabase] env vars não configuradas. Live sharing desabilitado.');
    }
    return null;
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage as any,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  });
  return _client;
}

export function isLiveEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
