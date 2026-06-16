import { useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { saveProfile, getProfile } from '../storage/profile';

/**
 * Autenticação via Sign in with Apple + Supabase Auth.
 *
 * Fluxo nativo: o app pega o `identityToken` da Apple e troca por uma sessão
 * Supabase via `signInWithIdToken`. A sessão persiste no AsyncStorage (config
 * em supabase.ts), então sobrevive a reaberturas e habilita sync entre devices.
 *
 * Pré-requisitos (config externa — ver checklist):
 *  - iOS: capability "Sign in with Apple" (app.config: usesAppleSignIn) — EAS
 *    adiciona o entitlement no build de produção.
 *  - Supabase Dashboard → Auth → Providers → Apple: habilitado, com o bundle id
 *    `com.cortextech.copilot` nos Authorized Client IDs.
 */

export type AppleAuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'canceled' | 'unavailable' | 'no-supabase' | 'error'; message?: string };

export async function isAppleAuthAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<AppleAuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'no-supabase' };

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED') return { ok: false, reason: 'canceled' };
    return { ok: false, reason: 'error', message: String(e?.message ?? e) };
  }

  if (!credential.identityToken) {
    return { ok: false, reason: 'error', message: 'Sem identityToken da Apple' };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error || !data.user) {
    return { ok: false, reason: 'error', message: error?.message ?? 'Falha no Supabase' };
  }

  // A Apple só manda nome no PRIMEIRO consentimento — aproveita pra preencher
  // o perfil local se ainda não tiver nome.
  const fullName = credential.fullName;
  if (fullName?.givenName) {
    const existing = await getProfile();
    if (!existing?.name) {
      await saveProfile({
        name: [fullName.givenName, fullName.familyName].filter(Boolean).join(' ').trim(),
        nickname: existing?.nickname ?? null,
        category: existing?.category ?? '',
        homeTrackId: existing?.homeTrackId ?? null,
        createdAt: existing?.createdAt ?? Date.now(),
      });
    }
  }

  return { ok: true, user: data.user };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (supabase) await supabase.auth.signOut().catch(() => {});
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Hook reativo: acompanha a sessão de auth (login/logout em tempo real). */
export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}
