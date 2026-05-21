'use client';

import { useMemo } from 'react';
import { useLive } from '@/lib/useLive';
import { fmtDelta, fmtKmh, fmtLap, fmtTime } from '@/lib/format';
import { projectTrack } from '@/lib/trackProjection';
import type { LiveLap, LiveSample } from '@/lib/liveTypes';

export default function LiveSpectatorPage({ params }: { params: { code: string } }) {
  const state = useLive(params.code);

  if (state.kind === 'loading') {
    return <Center text="Conectando…" />;
  }
  if (state.kind === 'not-found') {
    return (
      <Center
        title="Código não encontrado"
        text={`Não achei a sessão "${params.code}". Confere se o piloto tá com a transmissão ativa.`}
      />
    );
  }
  if (state.kind === 'error') {
    return <Center title="Erro" text={state.message} />;
  }

  const { info, samples, laps } = state;
  const isLive = state.kind === 'live';
  const lastSample = samples.length > 0 ? samples[samples.length - 1] : null;
  const referenceLapMs = info.referenceLapMs;
  const deltaVsRef =
    lastSample?.deltaVsRefMs ??
    (lastSample?.bestLapMs && referenceLapMs
      ? lastSample.bestLapMs - referenceLapMs
      : null);

  return (
    <main className="min-h-screen flex flex-col">
      <Header info={info} isLive={isLive} />
      <div className="flex-1 flex flex-col lg:flex-row gap-3 px-4 pb-4">
        <div className="flex-1 lg:flex-[3] bg-surface rounded-2xl border border-border p-4 flex flex-col">
          <h2 className="text-textMuted text-xs font-extrabold tracking-widest mb-3">
            TRAJETÓRIA AO VIVO
          </h2>
          <div className="flex-1 min-h-[300px]">
            <TrackCanvas samples={samples} lastSample={lastSample} />
          </div>
        </div>

        <aside className="lg:flex-[2] flex flex-col gap-3">
          <BigStats
            currentLapMs={lastSample?.lapElapsedMs ?? 0}
            deltaMs={deltaVsRef}
            speedKmh={lastSample ? lastSample.speed * 3.6 : 0}
            lapNumber={lastSample?.lapNumber ?? 0}
          />
          <LapsTable laps={laps} referenceLapMs={referenceLapMs} />
        </aside>
      </div>
    </main>
  );
}

// ===== Header =====

function Header({
  info,
  isLive,
}: {
  info: { code: string; trackName: string | null; pilotName?: string | null; pilotKartNumber?: string | null };
  isLive: boolean;
}) {
  return (
    <header className="flex items-center justify-between px-4 py-3 gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={
            'w-2.5 h-2.5 rounded-full ' +
            (isLive ? 'bg-danger pulse-live' : 'bg-textMuted')
          }
        />
        <span className="text-xs font-extrabold tracking-widest text-textPrimary">
          {isLive ? 'AO VIVO' : 'ENCERRADA'}
        </span>
        <span className="text-textMuted text-xs">·</span>
        <span className="text-xs font-mono text-textSecondary">{info.code}</span>
      </div>

      <div className="flex-1 text-center min-w-0">
        <div className="text-base font-extrabold truncate">
          {info.pilotName ?? 'Piloto anônimo'}
          {info.pilotKartNumber && (
            <span className="text-primary ml-2">#{info.pilotKartNumber}</span>
          )}
        </div>
        <div className="text-textMuted text-xs truncate">{info.trackName ?? '—'}</div>
      </div>

      <div className="w-20" />
    </header>
  );
}

// ===== Big stats sidebar =====

function BigStats({
  currentLapMs,
  deltaMs,
  speedKmh,
  lapNumber,
}: {
  currentLapMs: number;
  deltaMs: number | null;
  speedKmh: number;
  lapNumber: number;
}) {
  const deltaColor =
    deltaMs == null ? 'text-textMuted' : deltaMs > 0 ? 'text-danger' : 'text-success';
  return (
    <div className="bg-surface rounded-2xl border border-border p-4 flex flex-col gap-4">
      <div className="text-center">
        <div className="text-textMuted text-[10px] font-extrabold tracking-widest mb-1">
          VOLTA {lapNumber + 1}
        </div>
        <div className="font-mono text-5xl lg:text-6xl font-black tabular-nums tracking-tighter">
          {fmtTime(currentLapMs)}
        </div>
      </div>
      <div className="text-center">
        <div className="text-textMuted text-[10px] font-extrabold tracking-widest mb-1">
          DELTA vs REF
        </div>
        <div className={`font-mono text-3xl font-black tabular-nums ${deltaColor}`}>
          {deltaMs == null ? '—' : fmtDelta(deltaMs)}
        </div>
      </div>
      <div className="text-center">
        <div className="text-textMuted text-[10px] font-extrabold tracking-widest mb-1">
          VELOCIDADE
        </div>
        <div className="font-mono text-2xl font-black tabular-nums text-cyan">
          {fmtKmh(speedKmh / 3.6)} <span className="text-sm text-textMuted">km/h</span>
        </div>
      </div>
    </div>
  );
}

// ===== Laps table =====

function LapsTable({
  laps,
  referenceLapMs,
}: {
  laps: LiveLap[];
  referenceLapMs: number | null;
}) {
  if (laps.length === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-border p-6 text-center text-textMuted text-sm flex-1">
        Aguardando primeira volta…
      </div>
    );
  }
  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  // Ordem inversa — mais recente no topo
  const reversed = [...laps].reverse();

  return (
    <div className="bg-surface rounded-2xl border border-border p-3 flex-1 flex flex-col min-h-0">
      <h2 className="text-textMuted text-xs font-extrabold tracking-widest mb-2 px-1">
        VOLTAS COMPLETAS
      </h2>
      <div className="flex-1 overflow-y-auto pr-1">
        {reversed.map((lap) => {
          const isBest = lap.lapNumber === best.lapNumber;
          const delta = referenceLapMs != null ? lap.durationMs - referenceLapMs : null;
          return (
            <div
              key={lap.lapNumber}
              className={
                'flex items-center justify-between py-2 px-2 rounded-lg ' +
                (isBest ? 'bg-primary/10 border border-primary/40' : '')
              }
            >
              <span className="text-textMuted text-xs font-bold w-8">
                #{lap.lapNumber}
              </span>
              <span
                className={
                  'font-mono text-base font-extrabold ' +
                  (isBest ? 'text-primary' : 'text-textPrimary')
                }
              >
                {fmtLap(lap.durationMs)}
              </span>
              {delta != null ? (
                <span
                  className={
                    'font-mono text-xs font-bold w-16 text-right ' +
                    (delta > 0 ? 'text-danger' : 'text-success')
                  }
                >
                  {fmtDelta(delta)}
                </span>
              ) : (
                <span className="w-16" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Track canvas (SVG) =====

function TrackCanvas({
  samples,
  lastSample,
}: {
  samples: LiveSample[];
  lastSample: LiveSample | null;
}) {
  const W = 800;
  const H = 600;
  const { points, project } = useMemo(() => projectTrack(samples, W, H), [samples]);

  if (points.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-textMuted text-sm">
        Esperando primeiros pontos do GPS…
      </div>
    );
  }

  const d = points.reduce(
    (acc, p, i) => acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`),
    ''
  );
  const kart = lastSample ? project(lastSample) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
    >
      <path
        d={d}
        stroke="#D4FF3A"
        strokeWidth={4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      {kart && (
        <>
          <circle cx={kart.x} cy={kart.y} r={20} fill="#FF3DCB" opacity={0.25} />
          <circle cx={kart.x} cy={kart.y} r={10} fill="#FF3DCB" stroke="#fff" strokeWidth={2} />
        </>
      )}
    </svg>
  );
}

// ===== Helpers =====

function Center({ title, text }: { title?: string; text: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        {title && <h1 className="text-2xl font-extrabold mb-3">{title}</h1>}
        <p className="text-textSecondary text-sm leading-relaxed">{text}</p>
      </div>
    </main>
  );
}
