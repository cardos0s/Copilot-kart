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

import { useMemo } from 'react';
import { useEventRanking, type LivePosition } from '@/lib/useEventRanking';
import { fmtLap } from '@/lib/format';
import type { EventRankingRow } from '@/lib/liveTypes';
import { projectProgress, type CompiledReference } from '@/lib/trackProgress';

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

  const { event, ranking, reference, positions } = state;
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
        {/* Mapa ao vivo + posição de corrida — só aparece quando algum
          * piloto já fechou volta (define a referência do evento). */}
        {reference && positions.length > 0 && (
          <div className="max-w-3xl mx-auto mb-6">
            <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-3">
              <TrackMap reference={reference} positions={positions} />
              <LivePositionList positions={positions} hasRef={!!reference} />
            </div>
          </div>
        )}

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

/**
 * Mapa SVG da pista com cada kart no ponto onde ele está agora.
 * - Polyline da referência do evento
 * - Bolinha colorida por piloto na lat/lng atual
 * - Lado a lado com a lista de posição ao vivo
 */
function TrackMap({
  reference,
  positions,
}: {
  reference: CompiledReference;
  positions: LivePosition[];
}) {
  const W = 480;
  const H = 360;
  const PAD = 20;
  const { bbox } = reference;
  const dx = Math.max(1, bbox.maxX - bbox.minX);
  const dy = Math.max(1, bbox.maxY - bbox.minY);
  const scale = Math.min((W - PAD * 2) / dx, (H - PAD * 2) / dy);
  const offX = (W - dx * scale) / 2 - bbox.minX * scale;
  const offY = (H - dy * scale) / 2 - bbox.minY * scale;
  // Y do SVG cresce pra baixo; queremos norte pra cima → inverte
  const tx = (x: number) => offX + x * scale;
  const ty = (y: number) => H - (offY + y * scale);

  const path = useMemo(() => {
    return reference.points.reduce(
      (acc, p, i) => acc + (i === 0 ? `M ${tx(p.x).toFixed(1)} ${ty(p.y).toFixed(1)}` : ` L ${tx(p.x).toFixed(1)} ${ty(p.y).toFixed(1)}`),
      ''
    );
  }, [reference]);

  // Projeta cada piloto pra coords da tela
  const karts = positions.map((p, i) => {
    const proj = projectProgress({ lat: p.lat, lng: p.lng }, reference);
    return {
      ...p,
      sx: tx(proj.x),
      sy: ty(proj.y),
      color: kartColor(i),
      label: p.kartNumber ?? p.pilotName.slice(0, 2).toUpperCase(),
    };
  });

  return (
    <div className="bg-surface rounded-2xl border border-border p-3">
      <div className="text-textMuted text-[10px] font-extrabold tracking-widest mb-2">
        POSIÇÃO AO VIVO
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
      >
        {/* Pista */}
        <path
          d={path}
          stroke="#2a2a35"
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={path}
          stroke="#00FF88"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        {/* Karts */}
        {karts.map((k) => (
          <g key={k.sessionId}>
            <circle cx={k.sx} cy={k.sy} r={11} fill={k.color} opacity={0.25} />
            <circle
              cx={k.sx}
              cy={k.sy}
              r={7}
              fill={k.color}
              stroke="#08080C"
              strokeWidth={1.5}
            />
            <text
              x={k.sx}
              y={k.sy + 3}
              fill="#08080C"
              fontSize="8"
              fontWeight="900"
              textAnchor="middle"
            >
              {k.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function LivePositionList({ positions, hasRef }: { positions: LivePosition[]; hasRef: boolean }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-3">
      <div className="text-textMuted text-[10px] font-extrabold tracking-widest mb-2">
        ORDEM NA PISTA
      </div>
      <div className="flex flex-col gap-1.5">
        {positions.map((p, i) => (
          <div
            key={p.sessionId}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-bg border border-border"
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black"
              style={{ backgroundColor: kartColor(i), color: '#08080C' }}
            >
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-extrabold truncate">{p.pilotName}</div>
              <div className="text-textMuted text-[10px]">
                volta {p.lapNumber + 1}
                {hasRef && p.progress != null && ` · ${Math.round(p.progress * 100)}%`}
              </div>
            </div>
            {p.kartNumber && (
              <span className="text-primary font-mono text-xs font-bold">
                #{p.kartNumber}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Paleta estável de cores por índice — kart 1 sempre amarelo, kart 2 azul, etc. */
function kartColor(idx: number): string {
  const palette = ['#FFEB3B', '#00BCD4', '#FF4757', '#9D5BFF', '#00FF88', '#FF9800', '#E91E63', '#3DDCFF'];
  return palette[idx % palette.length];
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
