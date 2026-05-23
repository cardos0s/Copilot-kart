/**
 * Abstração de provider de LLM pra o Coach IA.
 *
 * O app suporta três provedores (Claude/Anthropic, Gemini/Google, OpenAI).
 * Cada piloto escolhe um e cola a própria API key — não tem fallback no
 * servidor nem chave compartilhada. As três APIs têm shapes de request/
 * response totalmente diferentes, então a abstração aqui esconde isso
 * atrás de uma interface só.
 */

export type LLMProvider = 'claude' | 'gemini' | 'openai';

export type LLMMessage = { role: 'user' | 'assistant'; content: string };

export type LLMCallArgs = {
  apiKey: string;
  system: string;
  messages: LLMMessage[];
  maxTokens: number;
  /**
   * Se true, o provider pode usar prompt caching nativo na primeira user
   * message (caso suporte). Caller só pede; cada provider decide se ativa.
   */
  enableCaching?: boolean;
};

export type LLMErrorCode =
  | 'network'
  | 'unauthorized'
  | 'rate_limited'
  | 'server'
  | 'invalid_response'
  | 'unknown';

export class LLMError extends Error {
  constructor(message: string, public code: LLMErrorCode = 'unknown') {
    super(message);
    this.name = 'LLMError';
  }
}

export type KeyTestResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized' }
  | { kind: 'network' }
  | { kind: 'rate_limited' }
  | { kind: 'unknown'; detail: string };

export type ProviderMeta = {
  id: LLMProvider;
  /** Nome curto pra mostrar em pills/cards. */
  displayName: string;
  /** Frase de um linha sobre o provider, pra ajuda visual. */
  tagline: string;
  /** Prefixo esperado da key (sanidade simples antes de testar). */
  keyPrefix: string;
  /** Placeholder do input. */
  keyPlaceholder: string;
  /** URL pra abrir no navegador onde criar/gerenciar key. */
  consoleUrl: string;
  /** Sugestão de modelo default. */
  defaultModel: string;
  /** Indicação de custo pra usuário ver antes de escolher. */
  costHint: string;
};

export interface LLMClient {
  readonly meta: ProviderMeta;
  /**
   * Faz a chamada de chat. Lança LLMError em qualquer caso de erro
   * (rede, status != 200, payload inválido). Retorna o texto puro.
   */
  call(args: LLMCallArgs): Promise<string>;
  /** Valida a key contra a API real do provider. */
  testKey(apiKey: string): Promise<KeyTestResult>;
}
