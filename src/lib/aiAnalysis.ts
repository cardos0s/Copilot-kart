/**
 * Coach IA via Claude/Gemini/OpenAI — análise inicial + follow-up em chat.
 *
 * Fluxo:
 *  1. `requestAiAnalysis(input, opts)` faz a chamada inicial com o prompt
 *     estruturado (setores, contexto do piloto, histórico) e devolve o
 *     texto da resposta. Por baixo, salva a thread `[user, assistant]` no
 *     cache em memória sob `cacheKey`.
 *  2. `continueAiChat({cacheKey, userMessage})` empilha a próxima pergunta
 *     do piloto, manda a thread inteira pro provider, devolve a resposta e
 *     atualiza a thread no cache.
 *  3. `getChatThread(cacheKey)` permite a UI ler o estado pra renderizar.
 *
 * Setup: cada piloto cola a própria API key + escolhe o provider em
 * Ajustes / Coach IA. Persistida via expo-secure-store (ver src/storage/apiKey.ts).
 *
 * Independência de provider: as chamadas vão através de `getClient(provider).call(...)`
 * — qualquer um dos três providers usa a mesma interface, sem `if`s aqui.
 *
 * Prompt caching: pedido ao client via `enableCaching: true`. Claude usa
 * cache_control ephemeral, OpenAI faz cache automático em GPT-4o+, Gemini
 * ignora (free tier compensa).
 *
 * ⚠️ A chamada sai direto do app (sem backend proxy). Cada usuário banca
 * o próprio consumo; não temos jeito de aplicar rate-limit centralizado.
 */

import { AnalysisInput, buildAnalysisPrompt } from './analysisPrompt';
import { getStoredCredential } from '../storage/apiKey';
import { getClient, LLMError } from './llm';
import {
  deleteAiChatThread,
  getAiChatThread,
  saveAiChatThread,
} from '../storage/db';

// Limites altos pra não cortar resposta no meio. Gemini 2.5 Pro e Claude
// Sonnet 4.6 raramente passam de 800 tokens nessa task, mas o teto generoso
// evita corte em casos onde o coach se aprofunda numa explicação.
const MAX_TOKENS_INITIAL = 2048;
const MAX_TOKENS_FOLLOWUP = 1024;

let aiEnabledFlag = false;
export function isAiEnabled(): boolean {
  return aiEnabledFlag;
}
export async function refreshAiEnabled(): Promise<boolean> {
  const c = await getStoredCredential();
  aiEnabledFlag = Boolean(c);
  return aiEnabledFlag;
}

export type AiErrorCode =
  | 'no_key'
  | 'network'
  | 'unauthorized'
  | 'rate_limited'
  | 'server'
  | 'invalid_response'
  | 'unknown'
  | 'no_thread';

export class AiAnalysisError extends Error {
  constructor(message: string, public code: AiErrorCode = 'unknown') {
    super(message);
    this.name = 'AiAnalysisError';
  }
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

type ThreadState = {
  system: string;
  messages: ChatMessage[];
};

const threads = new Map<string, ThreadState>();

export function getChatThread(cacheKey: string): ChatMessage[] {
  return threads.get(cacheKey)?.messages.slice() ?? [];
}

/**
 * Async — usa quando a UI abre uma conversa antiga (ex: tela Insights
 * carregando uma thread que ficou no SQLite mas não tá em memória ainda).
 * Hidrata o cache em memória pra próximas leituras serem síncronas.
 */
export async function loadChatThread(cacheKey: string): Promise<ChatMessage[]> {
  const inMem = threads.get(cacheKey);
  if (inMem) return inMem.messages.slice();
  const row = await getAiChatThread(cacheKey);
  if (!row) return [];
  threads.set(cacheKey, {
    system: row.systemPrompt,
    messages: row.messages,
  });
  return row.messages.slice();
}

export async function clearChatThread(cacheKey: string): Promise<void> {
  threads.delete(cacheKey);
  await deleteAiChatThread(cacheKey).catch(() => {
    /* silencioso — se o DB der ruim, a UI já tá ok com o reset em memória */
  });
}

export function clearAiAnalysisCache(): void {
  threads.clear();
}

export type AiAnalysisOptions = {
  /** Chave de cache da thread. Convenção: `${sessionId}:${lapId}`. */
  cacheKey?: string;
  /** Necessário pra persistir a thread no SQLite. Se ausente, vive só em memória. */
  sessionId?: string;
  /** Necessário pra persistir a thread no SQLite. Se ausente, vive só em memória. */
  lapId?: string;
};

/** Persiste se temos os 3: cacheKey + sessionId + lapId. */
async function persistThread(
  opts: AiAnalysisOptions | undefined,
  provider: string,
  system: string,
  messages: ChatMessage[]
): Promise<void> {
  if (!opts?.cacheKey || !opts.sessionId || !opts.lapId) return;
  try {
    await saveAiChatThread({
      cacheKey: opts.cacheKey,
      sessionId: opts.sessionId,
      lapId: opts.lapId,
      provider,
      systemPrompt: system,
      messages,
    });
  } catch {
    /* silencioso — falha de persistência não pode quebrar resposta da IA */
  }
}

/** Converte LLMError do client em AiAnalysisError com o code certo pra UI. */
function adaptError(err: unknown): AiAnalysisError {
  if (err instanceof LLMError) {
    return new AiAnalysisError(err.message, err.code as AiErrorCode);
  }
  if (err instanceof Error) {
    return new AiAnalysisError(err.message, 'unknown');
  }
  return new AiAnalysisError(String(err), 'unknown');
}

export async function requestAiAnalysis(
  input: AnalysisInput,
  opts?: AiAnalysisOptions
): Promise<string> {
  const cred = await getStoredCredential();
  if (!cred) {
    throw new AiAnalysisError(
      'Coach IA não configurado. Cola sua API key em Ajustes / Coach IA.',
      'no_key'
    );
  }
  aiEnabledFlag = true;

  if (opts?.cacheKey) {
    const existing = threads.get(opts.cacheKey);
    if (existing && existing.messages.length >= 2) {
      return existing.messages[1].content;
    }
  }

  const { systemPrompt, userPrompt } = buildAnalysisPrompt(input);
  const client = getClient(cred.provider);

  let assistantText: string;
  try {
    assistantText = await client.call({
      apiKey: cred.apiKey,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: MAX_TOKENS_INITIAL,
      enableCaching: true,
    });
  } catch (err) {
    throw adaptError(err);
  }

  const initialMessages: ChatMessage[] = [
    { role: 'user', content: userPrompt },
    { role: 'assistant', content: assistantText },
  ];
  if (opts?.cacheKey) {
    threads.set(opts.cacheKey, { system: systemPrompt, messages: initialMessages });
    await persistThread(opts, cred.provider, systemPrompt, initialMessages);
  }

  return assistantText;
}

export type ContinueChatArgs = {
  cacheKey: string;
  userMessage: string;
  /** Pra persistir no SQLite. Se ausente, atualiza só em memória. */
  sessionId?: string;
  lapId?: string;
};

// ===== Quick Insight (Coach IA flutuante) =====

export type QuickInsightInput = {
  /** Nome da pista pra contextualizar. */
  trackName: string;
  /** Melhor volta da sessão (ms). */
  bestLapMs: number;
  /** PB anterior dessa pista (ms), null se 1ª vez. */
  previousPbMs: number | null;
  /** Quantas voltas a sessão teve. */
  lapCount: number;
  /** Pico de velocidade km/h. */
  peakKmh?: number;
  /** Nome do piloto (opcional, pra IA usar). */
  pilotName?: string | null;
};

export type QuickInsight = {
  title: string; // 3-6 palavras
  body: string; // 2-3 frases
  metric?: string; // ex "+0.42s", "47.3 km/h"
};

/**
 * Gera um insight curto via LLM pra alimentar o Coach IA flutuante.
 * Resposta estruturada em JSON pra UI poder destacar a métrica.
 *
 * Retorna null se:
 *   - IA não configurada (sem key)
 *   - LLM falhou ou devolveu formato inválido
 *   - Sem conexão
 *
 * Caller deve ter um fallback (insight mock) caso essa retorne null.
 */
export async function requestQuickInsight(
  input: QuickInsightInput
): Promise<QuickInsight | null> {
  const cred = await getStoredCredential();
  if (!cred) return null;

  const isNewPb = input.previousPbMs == null || input.bestLapMs < input.previousPbMs;
  const deltaMs = input.previousPbMs != null ? input.bestLapMs - input.previousPbMs : 0;

  const system = `Você é um coach técnico de kart brasileiro. Sua tarefa AGORA é gerar UM insight curto e acionável pra mostrar num botão flutuante na app, sobre a sessão que o piloto acabou de fazer.

Regras OBRIGATÓRIAS:
- Responda APENAS um objeto JSON válido, sem markdown, sem fences, sem texto adicional.
- Schema EXATO:
  { "title": "string", "body": "string", "metric": "string opcional" }
- "title": 3-6 palavras, sem ponto final. Direto e específico. Ex: "Foco na freada da curva 3", "Consistência tá boa".
- "body": 2-4 frases curtas. Conecta o dado a uma AÇÃO prática pra próxima sessão. Tom de coach amigo, 2ª pessoa.
- "metric": opcional. Se tem um número-chave (delta, km/h), inclui aqui formatado curto. Ex: "+0.42s", "−0.3s", "85 km/h".
- PROIBIDO usar asteriscos, sublinhados, markdown, emojis no JSON.
- Se faltar dado pra dica específica, dá orientação técnica geral pra aquela situação (freada, apex, consistência).`;

  const user = `Pista: ${input.trackName}
Melhor volta dessa sessão: ${(input.bestLapMs / 1000).toFixed(3)}s
${input.previousPbMs != null ? `PB anterior: ${(input.previousPbMs / 1000).toFixed(3)}s (delta ${(deltaMs / 1000).toFixed(3)}s${isNewPb ? ' — NOVA PB' : ''})` : 'Sem PB anterior nessa pista (1ª vez)'}
Voltas na sessão: ${input.lapCount}
${input.peakKmh != null ? `Pico de velocidade: ${input.peakKmh.toFixed(0)} km/h` : ''}
${input.pilotName ? `Piloto: ${input.pilotName.split(' ')[0]}` : ''}

Gere o JSON do insight.`;

  let text: string;
  try {
    const client = getClient(cred.provider);
    text = await client.call({
      apiKey: cred.apiKey,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 300,
      enableCaching: false,
    });
  } catch {
    return null;
  }

  // Limpa cercas markdown caso o LLM tenha posto (Gemini às vezes faz)
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed?.title === 'string' &&
      typeof parsed?.body === 'string' &&
      parsed.title.length > 0 &&
      parsed.body.length > 0
    ) {
      return {
        title: parsed.title.slice(0, 60),
        body: parsed.body.slice(0, 320),
        metric:
          typeof parsed.metric === 'string' && parsed.metric.length > 0
            ? parsed.metric.slice(0, 20)
            : undefined,
      };
    }
  } catch {
    /* JSON inválido, cai pro null */
  }
  return null;
}

export async function continueAiChat(args: ContinueChatArgs): Promise<string> {
  const cred = await getStoredCredential();
  if (!cred) {
    throw new AiAnalysisError(
      'Coach IA não configurado. Cola sua API key em Ajustes / Coach IA.',
      'no_key'
    );
  }
  aiEnabledFlag = true;

  const thread = threads.get(args.cacheKey);
  if (!thread) {
    throw new AiAnalysisError(
      'Conversa não iniciada. Pede a análise primeiro.',
      'no_thread'
    );
  }

  const updatedMessages: ChatMessage[] = [
    ...thread.messages,
    { role: 'user', content: args.userMessage },
  ];

  const client = getClient(cred.provider);
  let assistantText: string;
  try {
    assistantText = await client.call({
      apiKey: cred.apiKey,
      system: thread.system,
      messages: updatedMessages,
      maxTokens: MAX_TOKENS_FOLLOWUP,
      enableCaching: true,
    });
  } catch (err) {
    throw adaptError(err);
  }

  thread.messages = [
    ...updatedMessages,
    { role: 'assistant', content: assistantText },
  ];
  threads.set(args.cacheKey, thread);
  await persistThread(
    { cacheKey: args.cacheKey, sessionId: args.sessionId, lapId: args.lapId },
    cred.provider,
    thread.system,
    thread.messages
  );

  return assistantText;
}
