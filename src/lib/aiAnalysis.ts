/**
 * Análise de volta via Claude API.
 *
 * Pega os dados estruturados que `buildAnalysisPrompt` monta (já com setores
 * agrupados em zonas, deltas calculados) e manda pra Anthropic Messages API.
 * Retorna o texto puro da resposta (já em PT-BR conforme o system prompt).
 *
 * Setup:
 *   1. Pega API key em https://console.anthropic.com (Settings → API Keys)
 *   2. Adiciona EXPO_PUBLIC_ANTHROPIC_API_KEY no .env
 *   3. Opcional: EXPO_PUBLIC_ANTHROPIC_MODEL pra trocar o modelo
 *
 * ⚠️ A key fica embedded no APK (client-side). Pra MVP/uso pessoal é ok;
 * pra produção precisa de backend proxy.
 */

import { AnalysisInput, buildAnalysisPrompt } from './analysisPrompt';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1024;

function getApiKey(): string | null {
  return process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? null;
}

function getModel(): string {
  return process.env.EXPO_PUBLIC_ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

export function isAiEnabled(): boolean {
  return Boolean(getApiKey());
}

export type AiErrorCode =
  | 'no_key'
  | 'network'
  | 'unauthorized'
  | 'rate_limited'
  | 'server'
  | 'invalid_response'
  | 'unknown';

export class AiAnalysisError extends Error {
  constructor(message: string, public code: AiErrorCode = 'unknown') {
    super(message);
    this.name = 'AiAnalysisError';
  }
}

/**
 * Cache em memória — sessão atual do app. Evita re-chamar API pra mesma
 * volta. Key = `${sessionId}:${lapId}`.
 */
const cache = new Map<string, string>();

export type AiAnalysisOptions = {
  /** Chave de cache. Se não passar, cada chamada vira request nova. */
  cacheKey?: string;
};

export async function requestAiAnalysis(
  input: AnalysisInput,
  opts?: AiAnalysisOptions
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new AiAnalysisError(
      'IA não configurada. Adicione EXPO_PUBLIC_ANTHROPIC_API_KEY no .env.',
      'no_key'
    );
  }

  if (opts?.cacheKey && cache.has(opts.cacheKey)) {
    return cache.get(opts.cacheKey)!;
  }

  const { systemPrompt, userPrompt } = buildAnalysisPrompt(input);

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        // React Native às vezes envia User-Agent tipo browser. Esse header
        // libera a chamada CORS-like sem precisar de proxy.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch (err: any) {
    throw new AiAnalysisError(
      `Sem conexão com a API: ${err?.message ?? 'erro de rede'}.`,
      'network'
    );
  }

  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      /* ignora */
    }
    const code: AiErrorCode =
      response.status === 401
        ? 'unauthorized'
        : response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'server'
            : 'unknown';
    throw new AiAnalysisError(
      `API retornou ${response.status}. ${bodyText.slice(0, 200)}`,
      code
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new AiAnalysisError('Resposta da API não é JSON válido.', 'invalid_response');
  }

  const text: unknown = data?.content?.[0]?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new AiAnalysisError(
      'Resposta da API sem conteúdo de texto esperado.',
      'invalid_response'
    );
  }

  if (opts?.cacheKey) {
    cache.set(opts.cacheKey, text);
  }

  return text;
}

export function clearAiAnalysisCache(): void {
  cache.clear();
}
