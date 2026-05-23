/**
 * Storage da credencial do Coach IA — provider + API key.
 *
 * Persiste no SecureStore (Keychain iOS / encrypted SharedPreferences
 * Android) pra credencial não vazar via backup/screenshot/debug bridge.
 *
 * Modelo: uma credencial ativa de cada vez. Trocar de provider sobrescreve.
 * Se a feature evoluir pra "tenho key de mais de um provider e troco entre
 * eles", basta passar a guardar um mapa `Record<LLMProvider, string>`.
 *
 * Compatibilidade: a primeira versão guardava só a key, sob `anthropic_api_key_v1`.
 * Migração transparente: se ler a chave legada e não encontrar a nova,
 * assume provider=claude e move pra `llm_credential_v1`.
 */

import * as SecureStore from 'expo-secure-store';
import { LLMProvider, getClient } from '../lib/llm';

const KEY = 'llm_credential_v1';
const LEGACY_CLAUDE_KEY = 'anthropic_api_key_v1';

export type StoredCredential = {
  provider: LLMProvider;
  apiKey: string;
};

let cached: StoredCredential | null | undefined; // undefined = ainda não consultado

export async function getStoredCredential(): Promise<StoredCredential | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredCredential;
      if (parsed.provider && parsed.apiKey) {
        cached = parsed;
        return cached;
      }
    }
    // Migração da chave legada (versão v1 com Claude only)
    const legacy = await SecureStore.getItemAsync(LEGACY_CLAUDE_KEY);
    if (legacy) {
      const migrated: StoredCredential = { provider: 'claude', apiKey: legacy };
      await SecureStore.setItemAsync(KEY, JSON.stringify(migrated));
      await SecureStore.deleteItemAsync(LEGACY_CLAUDE_KEY).catch(() => {});
      cached = migrated;
      return cached;
    }
    cached = null;
  } catch {
    cached = null;
  }

  // Fallback em dev pra não atrapalhar meu loop: se a env var existir, usa
  // Claude. Em produção/APK essa env não vai estar disponível.
  if (!cached && __DEV__) {
    const envKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
    if (envKey) return { provider: 'claude', apiKey: envKey };
  }
  return cached;
}

export async function setStoredCredential(value: StoredCredential): Promise<void> {
  const apiKey = value.apiKey.trim();
  if (!apiKey) throw new Error('Key vazia');
  const cred: StoredCredential = { provider: value.provider, apiKey };
  await SecureStore.setItemAsync(KEY, JSON.stringify(cred));
  cached = cred;
}

export async function clearStoredCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(LEGACY_CLAUDE_KEY).catch(() => {});
  cached = null;
}

/** Mascarado pra display: "sk-ant-...XJ4k". Nunca devolve a key inteira. */
export function maskApiKey(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 12) return value.slice(0, 4) + '…';
  return value.slice(0, 8) + '…' + value.slice(-4);
}

/**
 * Valida uma key chamando a API do provider correspondente.
 * Delegação pra LLMClient.testKey — cada provider sabe qual endpoint barato
 * usar (Anthropic faz uma message com max_tokens=1, OpenAI/Gemini só listam
 * modelos).
 */
export async function testCredential(value: StoredCredential) {
  const client = getClient(value.provider);
  return client.testKey(value.apiKey);
}
