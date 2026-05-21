'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState('');

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (clean.length >= 4) {
      router.push(`/live/${clean}`);
    }
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
            Acompanhar
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
