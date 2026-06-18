import { getSupabase } from './supabase';

/**
 * Sincronização de "partida" ao vivo entre pilotos na MESMA pista.
 *
 * Modelo leve: cada piloto entra num canal Realtime `match:<trackId>` e faz
 * BROADCAST da própria posição a ~1.4Hz. Todos recebem a posição de todos —
 * sem tabela, sem RLS, efêmero. Quem para de transmitir some em 5s.
 *
 * Auto-match por pista: todo mundo gravando no mesmo kartódromo cai na mesma
 * partida automaticamente, sem lobby/código. Perfeito pra um grupo de testes
 * num mesmo kartódromo.
 *
 * Depende do Supabase configurado (env vars) E do projeto ATIVO (não pausado).
 * Sem Supabase, joinMatch vira no-op e o piloto corre sozinho (a UI cai pro
 * fallback demo quando não há peers).
 */

export type MatchPeerState = {
  pilotId: string;
  name: string;
  kartNum: string;
  colorIdx: number;
  lapNumber: number; // 1-based
  lapProgress: number; // 0..1 dentro da volta atual
  speedKmh: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  ts: number; // Date.now() do emissor (pra expirar peers parados)
};

export type MatchHandle = { leave: () => void };

const STALE_MS = 5000;

export function joinMatch(
  trackId: string,
  getMyState: () => MatchPeerState | null,
  onPeers: (peers: MatchPeerState[]) => void
): MatchHandle {
  const supabase = getSupabase();
  if (!supabase || !trackId) {
    return { leave: () => {} };
  }

  const peers = new Map<string, MatchPeerState>();
  let subscribed = false;

  const channel = supabase.channel(`match:${trackId}`, {
    config: { broadcast: { self: false } },
  });

  channel.on('broadcast', { event: 'pos' }, (msg: any) => {
    const p = msg?.payload as MatchPeerState | undefined;
    if (!p || !p.pilotId) return;
    peers.set(p.pilotId, { ...p, ts: Date.now() });
  });

  channel.subscribe((status: string) => {
    subscribed = status === 'SUBSCRIBED';
  });

  const timer = setInterval(() => {
    // Transmite minha posição
    const mine = getMyState();
    if (mine && subscribed) {
      channel.send({ type: 'broadcast', event: 'pos', payload: mine }).catch(() => {});
    }
    // Expira peers parados e entrega a lista atual
    const now = Date.now();
    for (const [id, p] of peers) {
      if (now - p.ts > STALE_MS) peers.delete(id);
    }
    onPeers(Array.from(peers.values()));
  }, 700);

  return {
    leave: () => {
      clearInterval(timer);
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ok */
      }
    },
  };
}
