/**
 * Cliente OpenAI Chat Completions API.
 *
 * Diferenças vs Claude/Gemini:
 *   - system prompt vai como mensagem com role 'system' (não campo separado)
 *   - Auth via Bearer token no Authorization header
 *   - Response em data.choices[0].message.content
 *
 * Prompt caching automático em GPT-4o+ — não precisa marcar nada; OpenAI
 * detecta prefixos repetidos entre chamadas e aplica desconto sozinha.
 */

import {
  KeyTestResult,
  LLMCallArgs,
  LLMClient,
  LLMError,
  LLMErrorCode,
  ProviderMeta,
} from './types';

const API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

function getModel(): string {
  return process.env.EXPO_PUBLIC_OPENAI_MODEL ?? DEFAULT_MODEL;
}

export const openaiClient: LLMClient = {
  meta: {
    id: 'openai',
    displayName: 'OpenAI',
    tagline: 'GPT-4o mini — barato e largamente testado.',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-proj-... ou sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
    defaultModel: DEFAULT_MODEL,
    costHint: '~$0.001 análise · sem free tier oficial, paga pay-as-you-go',
  } as ProviderMeta,

  async call({ apiKey, system, messages, maxTokens }: LLMCallArgs): Promise<string> {
    const payload = {
      model: getModel(),
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
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
        response.status === 401 || response.status === 403
          ? 'unauthorized'
          : response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'server'
              : 'unknown';
      throw new LLMError(`OpenAI retornou ${response.status}. ${bodyText.slice(0, 200)}`, code);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new LLMError('Resposta da API não é JSON válido.', 'invalid_response');
    }

    const text: unknown = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new LLMError('Resposta da API sem conteúdo de texto esperado.', 'invalid_response');
    }
    return text;
  },

  async testKey(value: string): Promise<KeyTestResult> {
    const key = value.trim();
    if (!key) return { kind: 'unauthorized' };
    try {
      // Lista modelos — endpoint barato que valida a key sem consumir tokens.
      const res = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { authorization: `Bearer ${key}` },
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
