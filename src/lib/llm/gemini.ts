/**
 * Cliente Google Gemini (Generative Language API).
 *
 * Diferenças importantes vs Claude/OpenAI que justificam a abstração:
 *   - Role do assistant chama "model" (não "assistant")
 *   - System prompt vai num campo separado `system_instruction`
 *   - Content é uma lista de "parts" com `text`, não string crua
 *   - max_tokens chama `maxOutputTokens` e vai dentro de `generationConfig`
 *   - Auth via query string `?key=...`, sem header
 *
 * Prompt caching: Gemini suporta "context caching" via API separada
 * (createCachedContent), mas o overhead de criar/listar caches não compensa
 * pra conversas curtas como as do Coach. E o Flash é tão barato (~$0.075/M
 * input) que a economia seria irrelevante. Por isso ignoramos `enableCaching`.
 */

import {
  KeyTestResult,
  LLMCallArgs,
  LLMClient,
  LLMError,
  LLMErrorCode,
  ProviderMeta,
} from './types';

// Pro em vez de Flash: bem melhor pra raciocinio técnico (trail brake, setup,
// física do pneu, etc). Free tier do Pro: ~100 req/dia — mais que suficiente
// pra uso pessoal. Se quiser voltar pro Flash (1500 req/dia, mais raso),
// seta EXPO_PUBLIC_GEMINI_MODEL=gemini-2.5-flash no .env.
const DEFAULT_MODEL = 'gemini-2.5-pro';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getModel(): string {
  return process.env.EXPO_PUBLIC_GEMINI_MODEL ?? DEFAULT_MODEL;
}

function buildUrl(model: string, apiKey: string): string {
  return `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export const geminiClient: LLMClient = {
  meta: {
    id: 'gemini',
    displayName: 'Gemini',
    tagline: 'Google — grátis até 1500 req/dia no Flash.',
    keyPrefix: 'AIza',
    keyPlaceholder: 'AIzaSy...',
    consoleUrl: 'https://aistudio.google.com/apikey',
    defaultModel: DEFAULT_MODEL,
    costHint: 'Free tier: 1500 req/dia · sem cartão · ideal pra uso pessoal',
  } as ProviderMeta,

  async call({ apiKey, system, messages, maxTokens }: LLMCallArgs): Promise<string> {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    let response: Response;
    try {
      response = await fetch(buildUrl(getModel(), apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      });
    } catch (err: any) {
      throw new LLMError(`Sem conexão com a API: ${err?.message ?? 'erro de rede'}.`, 'network');
    }

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        /* ignora */
      }
      const code: LLMErrorCode =
        response.status === 400 || response.status === 401 || response.status === 403
          ? 'unauthorized'
          : response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'server'
              : 'unknown';
      throw new LLMError(`Gemini retornou ${response.status}. ${bodyText.slice(0, 200)}`, code);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new LLMError('Resposta da API não é JSON válido.', 'invalid_response');
    }

    // Gemini pode devolver várias `candidates`; pegamos a primeira.
    // Cada candidate.content.parts[] é uma lista de partes — geralmente
    // só uma com `text`, mas concatena por garantia.
    const parts: Array<{ text?: string }> = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p?.text ?? '').join('').trim();
    if (!text) {
      // Se finishReason indicar SAFETY ou MAX_TOKENS, expomos pro user.
      const reason = data?.candidates?.[0]?.finishReason;
      throw new LLMError(
        `Gemini retornou resposta vazia${reason ? ` (motivo: ${reason})` : ''}.`,
        'invalid_response'
      );
    }
    return text;
  },

  async testKey(value: string): Promise<KeyTestResult> {
    const key = value.trim();
    if (!key) return { kind: 'unauthorized' };
    try {
      // Endpoint barato: listar modelos. Não consome quota de generate.
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        { method: 'GET' }
      );
      if (res.ok) return { kind: 'ok' };
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { kind: 'unauthorized' };
      }
      if (res.status === 429) return { kind: 'rate_limited' };
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      return { kind: 'unknown', detail: detail.slice(0, 200) };
    } catch (err: any) {
      if (err?.message?.includes('Network')) return { kind: 'network' };
      return { kind: 'unknown', detail: err?.message ?? 'erro desconhecido' };
    }
  },
};
