'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Tela inicial — duas modalidades:
 *   - Espectador: vê traçado + tempos. Read-only. Pra família, amigos, fãs.
 *   - Equipe (Box): painel tático com pontos a melhorar, diagnóstico,
 *     mensagens curtas pro piloto. Quem tá no box do piloto.
 */
type Role = 'spectator' | 'team';

export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [role, setRole] = useState<Role>('spectator');

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (clean.length < 4) return;
    router.push(role === 'team' ? `/team/${clean}` : `/live/${clean}`);
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black tracking-tight text-primary">Copilot Live</h1>
          <p className="text-textSecondary mt-3 text-sm">
            Acompanhe um piloto em tempo real. Cole o código que o app dele te passou.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <RoleButton
            active={role === 'spectator'}
            onClick={() => setRole('spectator')}
            title="Espectador"
            sub="Só assistir"
          />
          <RoleButton
            active={role === 'team'}
            onClick={() => setRole('team')}
            title="Equipe"
            sub="Box do piloto"
          />
        </div>

        <form onSubmit={handleGo} className="space-y-3">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="LIVE-X9K2P"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-surface border border-border rounded-xl px-4 py-4 text-center text-2xl font-mono tracking-widest uppercase placeholder:text-textMuted text-textPrimary outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={code.trim().length < 4}
            className="w-full bg-primary text-bg font-extrabold py-4 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
          >
            {role === 'team' ? 'Entrar como equipe' : 'Acompanhar'}
          </button>
        </form>

        <p className="text-xs text-textMuted text-center mt-8">
          Ou escaneie o QR code que aparece no app do piloto com a câmera do seu
          aparelho — abre essa página direto.
        </p>
      </div>
    </main>
  );
}

function RoleButton({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-3 rounded-xl border text-left transition ' +
        (active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-surface hover:border-textMuted')
      }
    >
      <div
        className={
          'text-sm font-extrabold ' +
          (active ? 'text-primary' : 'text-textPrimary')
        }
      >
        {title}
      </div>
      <div className="text-[10px] text-textMuted">{sub}</div>
    </button>
  );
}
