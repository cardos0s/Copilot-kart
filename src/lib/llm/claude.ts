/**
 * Cliente Anthropic Messages API. Suporta prompt caching ephemeral na
 * primeira user message — usado pra baratear follow-ups (Anthropic guarda
 * o prefixo 5min e cobra ~10% do input cacheado).
 */

import {
  KeyTestResult,
  LLMCallArgs,
  LLMClient,
  LLMError,
  LLMErrorCode,
  ProviderMeta,
} from './types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function getModel(): string {
  return process.env.EXPO_PUBLIC_ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

export const claudeClient: LLMClient = {
  meta: {
    id: 'claude',
    displayName: 'Claude',
    tagline: 'Anthropic — análise técnica detalhada.',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-...',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: DEFAULT_MODEL,
    costHint: '~$0.012 análise · ~$0.003 follow-up · $5 grátis na criação',
  } as ProviderMeta,

  async call({ apiKey, system, messages, maxTokens, enableCaching }: LLMCallArgs): Promise<string> {
    let messagesPayload: any[];
    if (enableCaching && messages.length >= 1 && messages[0].role === 'user') {
      const [first, ...rest] = messages;
      messagesPayload = [
        {
          role: 'user',
          content: [
            { type: 'text', text: first.content, cache_control: { type: 'ephemeral' } },
          ],
        },
        ...rest.map((m) => ({ role: m.role, content: m.content })),
      ];
    } else {
      messagesPayload = messages.map((m) => ({ role: m.role, content: m.content }));
    }

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: maxTokens,
          system,
          messages: messagesPayload,
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
        response.status === 401
          ? 'unauthorized'
          : response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'server'
              : 'unknown';
      throw new LLMError(`API retornou ${response.status}. ${bodyText.slice(0, 200)}`, code);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new LLMError('Resposta da API não é JSON válido.', 'invalid_response');
    }

    const text: unknown = data?.content?.[0]?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new LLMError('Resposta da API sem conteúdo de texto esperado.', 'invalid_response');
    }
    return text;
  },

  async testKey(value: string): Promise<KeyTestResult> {
    const key = value.trim();
    if (!key) return { kind: 'unauthorized' };
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (res.ok) return { kind: 'ok' };
      if (res.status === 401 || res.status === 403) return { kind: 'unauthorized' };
      if (res.status === 429) return { kind: 'rate_limited' };
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      return { kind: 'unknown', detail: detail.slice(0, 200) };
    } catch (err: any) {
      if (err?.message?.includes('Network')) return { kind: 'network' };
      return { kind: 'unknown', detail: err?.message ?? 'erro desconhecido' };
    }
  },
};
