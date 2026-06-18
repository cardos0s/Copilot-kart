import { getSupabase } from './supabase';

/**
 * Sincronização de "partida" ao vivo entre pilotos, por CÓDIGO de partida.
 *
 * Modelo leve: cada piloto entra num canal Realtime `match:<code>` e faz
 * BROADCAST da própria posição a ~1.4Hz. Todos recebem a posição de todos —
 * sem tabela, sem RLS, efêmero. Quem para de transmitir some em 5s.
 *
 * Fluxo: um piloto CRIA a partida (gera um código de 6 dígitos) e compartilha;
 * os outros DIGITAM o código pra entrar na mesma corrida. Como o canal é só o
 * nome `match:<code>`, não precisa persistir nada — quem tem o código entra.
 *
 * Depende do Supabase configurado (env vars) E do projeto ATIVO (não pausado).
 * Sem Supabase, joinMatch vira no-op e o piloto corre sozinho (a UI cai pro
 * fallback demo quando não há peers).
 */

// Alfabeto sem caracteres ambíguos (0/O, 1/I) — código fácil de ditar/digitar.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Gera um código de partida de 6 caracteres (ex: "K7P2QX"). */
export function generateMatchCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

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
  code: string,
  getMyState: () => MatchPeerState | null,
  onPeers: (peers: MatchPeerState[]) => void
): MatchHandle {
  const supabase = getSupabase();
  if (!supabase || !code) {
    return { leave: () => {} };
  }

  const peers = new Map<string, MatchPeerState>();
  let subscribed = false;

  const channel = supabase.channel(`match:${code.toUpperCase()}`, {
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
