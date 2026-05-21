/**
 * Store global de insights do Coach IA (em memória, pub-sub simples).
 *
 * Quando uma análise da IA gera dicas acionáveis (PB analysis, follow-up, ou
 * análise automática pós-sessão), os insights vão pra essa fila. O botão
 * flutuante (AssistiveTouch-style) consome e mostra um por vez, com o badge
 * indicando quantos estão pendentes.
 *
 * Sem persistência por enquanto — a fila reseta quando o app fecha. Quem
 * dispensar um insight remove só dele (não da thread original do Coach).
 */

import { useEffect, useState } from 'react';

export type CoachInsight = {
  id: string;
  /** Título curto (1 linha, ≤30 chars). Ex: "Freada da curva 4". */
  title: string;
  /** Body completo do insight, 2-4 frases. */
  body: string;
  /** Métrica destacada (verde neon no painel). Ex: "+0.42s". */
  metric?: string;
  /** Setor da pista pra mini-map highlight. */
  sectorRef?: { trackId: string; sStart: number; sEnd: number; label: string };
  /** Quando virou disponível (epoch ms). */
  createdAt: number;
  /** sessionId que originou (pra deep-link). */
  sessionId?: string;
};

type Listener = (insights: CoachInsight[]) => void;

let queue: CoachInsight[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(queue.slice());
}

export function pushCoachInsight(insight: Omit<CoachInsight, 'id' | 'createdAt'>): string {
  const id = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const full: CoachInsight = { ...insight, id, createdAt: Date.now() };
  queue = [...queue, full];
  emit();
  return id;
}

export function dismissCoachInsight(id: string): void {
  queue = queue.filter((i) => i.id !== id);
  emit();
}

export function clearCoachInsights(): void {
  queue = [];
  emit();
}

export function getCoachInsights(): CoachInsight[] {
  return queue.slice();
}

/** Hook pra UI reativa. */
export function useCoachInsights(): CoachInsight[] {
  const [items, setItems] = useState<CoachInsight[]>(queue);
  useEffect(() => {
    const l: Listener = (next) => setItems(next);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return items;
}
