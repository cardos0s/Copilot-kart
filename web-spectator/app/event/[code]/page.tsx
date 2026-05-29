/**
 * Ranking ao vivo de competição — /event/[code].
 *
 * Mostra o leaderboard agregado de todos os pilotos do evento: posição,
 * nome, kart#, melhor volta, gap pro líder, última volta, nº de voltas.
 * Atualiza em tempo real conforme cada piloto fecha volta.
 *
 * Ideal num tablet/TV no box pra galera acompanhar. Cada piloto roda o
 * app, entra no código do evento, e suas voltas aparecem aqui.
 */

'use client';

import { useEventRanking } from '@/lib/useEventRanking';
import { fmtLap } from '@/lib/format';
import type { EventRankingRow } from '@/lib/liveTypes';

export default function EventPage({ params }: { params: { code: string } }) {
  const state = useEventRanking(params.code);

  if (state.kind === 'loading') return <Center text="Carregando ranking…" />;
  if (state.kind === 'not-found') {
    return (
      <Center
        title="Competição não encontrada"
        text={`Não achei o evento "${params.code}". Confere o código.`}
      />
    );
  }
  if (state.kind === 'error') return <Center title="Erro" text={state.message} />;

  const { event, ranking } = state;
  const leaderBest = ranking.find((r) => r.bestLapMs != null)?.bestLapMs ?? null;

  return (
    <main className="min-h-screen flex flex-col bg-bg text-textPrimary">
      <header className="px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏁</span>
          <div>
            <h1 className="text-xl font-black tracking-tight">
              {event.name ?? 'Competição'}
            </h1>
            <div className="text-textMuted text-xs font-bold tracking-widest mt-0.5">
              {event.trackName ?? '—'} · CÓDIGO {event.code} · {ranking.length} piloto(s)
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-4">
        {ranking.length === 0 ? (
          <div className="text-center text-textMuted text-sm py-20">
            Aguardando pilotos entrarem na competição…
            <div className="mt-2 text-xs">
              No app: ativar "Competição" → entrar com o código{' '}
              <span className="font-mono text-primary">{event.code}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl mx-auto">
            {/* Cabeçalho da tabela */}
            <div className="flex items-center px-3 text-textMuted text-[10px] font-extrabold tracking-widest">
              <span className="w-8">#</span>
              <span className="flex-1">PILOTO</span>
              <span className="w-24 text-right">MELHOR</span>
              <span className="w-20 text-right">GAP</span>
              <span className="w-16 text-right">VLT</span>
            </div>
            {ranking.map((row, i) => (
              <RankingRow
                key={`${row.pilotName}-${i}`}
                row={row}
                position={i + 1}
                leaderBest={leaderBest}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function RankingRow({
  row,
  position,
  leaderBest,
}: {
  row: EventRankingRow;
  position: number;
  leaderBest: number | null;
}) {
  const gap =
    row.bestLapMs != null && leaderBest != null && row.bestLapMs > leaderBest
      ? row.bestLapMs - leaderBest
      : null;
  const isLeader = position === 1 && row.bestLapMs != null;

  return (
    <div
      className={
        'flex items-center px-3 py-3 rounded-xl border ' +
        (isLeader
          ? 'bg-primary/10 border-primary/40'
          : 'bg-surface border-border')
      }
    >
      <span
        className={
          'w-8 font-black text-lg ' +
          (isLeader ? 'text-primary' : 'text-textSecondary')
        }
      >
        {position}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-extrabold truncate">
          {row.pilotName}
          {row.kartNumber && (
            <span className="text-primary ml-2 text-sm">#{row.kartNumber}</span>
          )}
        </div>
        <div className="text-textMuted text-[11px]">
          última {row.lastLapMs != null ? fmtLap(row.lastLapMs) : '—'}
        </div>
      </div>
      <span className="w-24 text-right font-mono font-black tabular-nums">
        {row.bestLapMs != null ? fmtLap(row.bestLapMs) : '—'}
      </span>
      <span className="w-20 text-right font-mono text-sm tabular-nums text-textSecondary">
        {gap != null ? `+${(gap / 1000).toFixed(3)}` : isLeader ? '—' : ''}
      </span>
      <span className="w-16 text-right font-mono text-sm tabular-nums text-textMuted">
        {row.lapCount}
      </span>
    </div>
  );
}

function Center({ title, text }: { title?: string; text: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-bg">
      <div className="max-w-md text-center">
        {title && <h1 className="text-2xl font-extrabold mb-3 text-textPrimary">{title}</h1>}
        <p className="text-textSecondary text-sm leading-relaxed">{text}</p>
      </div>
    </main>
  );
}
