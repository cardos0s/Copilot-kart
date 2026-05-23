/**
 * Registry de providers de LLM. Exports:
 *   - `getClient(provider)` — instância pra chamar
 *   - `PROVIDERS` — lista pra UI iterar (cards, pills, etc)
 *   - re-exports de tipos
 */

import { claudeClient } from './claude';
import { geminiClient } from './gemini';
import { openaiClient } from './openai';
import { LLMClient, LLMProvider, ProviderMeta } from './types';

const CLIENTS: Record<LLMProvider, LLMClient> = {
  claude: claudeClient,
  gemini: geminiClient,
  openai: openaiClient,
};

export function getClient(provider: LLMProvider): LLMClient {
  return CLIENTS[provider];
}

/** Ordem importa pra UI — Gemini primeiro porque é o default recomendado. */
export const PROVIDERS: ProviderMeta[] = [
  geminiClient.meta,
  claudeClient.meta,
  openaiClient.meta,
];

export const DEFAULT_PROVIDER: LLMProvider = 'gemini';

export * from './types';
