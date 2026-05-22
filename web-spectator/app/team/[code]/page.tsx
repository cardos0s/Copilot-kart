/**
 * Painel da Equipe (Box) — visão tática ao vivo.
 *
 * Funcionalidades:
 *   1. Traçado GPS ao vivo + posição atual do kart
 *   2. Delta gigante vs PB da sessão + previsão de tempo final
 *   3. Per-setor: ganho/perda em S1/S2/S3 (com cores semânticas)
 *   4. Pontos a melhorar — ranking dos setores onde mais perdeu tempo
 *   5. Diagnóstico em PT-BR (rule-based, sem LLM): texto curto explicando
 *      onde ganhou/perdeu, com previsão e contexto
 *   6. Velocímetro com curva da volta atual + marker "VOCÊ AQUI"
 *   7. Stats rápidos: atual, mínimo (em curva), médio (S2), máximo
 *   8. Mensageria pro piloto: botões rápidos por severidade + custom
 *
 * NÃO implementado (precisa de outras features):
 *   - RPM (precisa de ECU)
 *   - Curvas nomeadas (C1, C4, etc) — precisa de anotador por pista
 *   - Multi-piloto na equipe — precisa de modelo de team
 *   - Histórico de mensagens com causa-efeito — versão simples só lista
 */

'use client';

import { useMemo, useState, useTransition } from 'react';
import { useLive } from '@/lib/useLive';
import { fmtDelta, fmtKmh, fmtLap, fmtTime } from '@/lib/format';
import { projectTrack } from '@/lib/trackProjection';
import { sendMessage } from '@/lib/sendMessage';
import type { LiveLap, LiveMessage, LiveSample, MessageSeverity } from '@/lib/liveTypes';

// ============================================================================
// QUICK MESSAGES — comandos pré-definidos disponíveis na tela da equipe
// ============================================================================
// Cada um vira um botão na barra inferior. Severidade controla cor/prioridade
// visual no overlay do piloto. Texto vai como veio (uppercased no piloto).
const QUICK_MESSAGES: Array<{
  label: string;
  text: string;
  severity: MessageSeverity;
}> = [
  { label: 'Boa volta', text: 'BOA VOLTA', severity: 'info' },
  { label: 'Mantém ritmo', text: 'MANTÉM RITMO', severity: 'info' },
  { label: 'Setor 2 lento', text: 'SETOR 2 LENTO', severity: 'warning' },
  { label: 'Corrija saída', text: 'CORRIJA SAÍDA', severity: 'warning' },
  { label: 'Cuidado tráfego', text: 'CUIDADO TRÁFEGO', severity: 'warning' },
  { label: 'Box na próxima', text: 'BOX NA PRÓXIMA', severity: 'critical' },
  { label: 'Reduz ritmo', text: 'REDUZ RITMO', severity: 'critical' },
  { label: 'Box agora', text: 'BOX AGORA', severity: 'critical' },
];

const MAX_CUSTOM_LEN = 24;

// ============================================================================
// PAGE
// ============================================================================

export default function TeamPage({ params }: { params: { code: string } }) {
  const state = useLive(params.code);

  if (state.kind === 'loading') return <Center text="Conectando…" />;
  if (state.kind === 'not-found') {
    return (
      <Center
        title="Código não encontrado"
        text={`Não achei a sessão "${params.code}". Confere se o piloto tá transmitindo.`}
      />
    );
  }
  if (state.kind === 'error') return <Center title="Erro" text={state.message} />;

  return <TeamDashboard state={state} />;
}

// ============================================================================
// DASHBOARD
// ============================================================================

function TeamDashboard({
  state,
}: {
  state: Extract<ReturnType<typeof useLive>, { kind: 'live' | 'ended' }>;
}) {
  const { info, samples, laps, messages } = state;
  const isLive = state.kind === 'live';

  const lastSample = samples.length > 0 ? samples[samples.length - 1] : null;
  const bestLap = useMemo(() => {
    if (laps.length === 0) return null;
    return laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b), laps[0]);
  }, [laps]);
  const previousLap = laps.length > 0 ? laps[laps.length - 1] : null;

  // Delta vs PB usa o que veio do sample (autoritativo do app); fallback
  // calcula localmente se faltar.
  const deltaVsBest =
    lastSample?.deltaVsRefMs ??
    (lastSample?.bestLapMs && info.referenceLapMs
      ? lastSample.bestLapMs - info.referenceLapMs
      : null);

  // Previsão = tempo da volta atual + (tempo restante estimado pela PB
  // - tempo já passado da PB no ponto equivalente). Aproximação útil mas
  // não exata sem o tracker geográfico. Versão simples: PB - delta atual.
  const projectedLapMs = useMemo(() => {
    if (!bestLap) return null;
    if (deltaVsBest === null) return bestLap.durationMs;
    return bestLap.durationMs + deltaVsBest;
  }, [bestLap, deltaVsBest]);

  return (
    <main className="min-h-screen flex flex-col bg-bg text-textPrimary">
      <TopBar info={info} isLive={isLive} bestLap={bestLap} previousLap={previousLap} />
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3 px-4 pb-3 min-h-0">
        <div className="flex flex-col gap-3 min-h-0">
          <TrackPanel samples={samples} lastSample={lastSample} />
          <BottomStats samples={samples} lastSample={lastSample} />
        </div>
        <aside className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <DeltaCard
            deltaVsBest={deltaVsBest}
            projectedLapMs={projectedLapMs}
            currentLapMs={lastSample?.lapElapsedMs ?? 0}
            lastSample={lastSample}
            bestLap={bestLap}
          />
          <PointsToImprove laps={laps} bestLap={bestLap} />
          <DiagnosticCard
            laps={laps}
            bestLap={bestLap}
            projectedLapMs={projectedLapMs}
            deltaVsBest={deltaVsBest}
          />
        </aside>
      </div>
      <Messaging sessionId={info.id} messages={messages} disabled={!isLive} />
    </main>
  );
}

// ============================================================================
// TOP BAR — sessão · piloto · pista · volta · best · última · config
// ============================================================================

function TopBar({
  info,
  isLive,
  bestLap,
  previousLap,
}: {
  info: {
    code: string;
    pilotName?: string | null;
    pilotKartNumber?: string | null;
    trackName: string | null;
  };
  isLive: boolean;
  bestLap: LiveLap | null;
  previousLap: LiveLap | null;
}) {
  return (
    <header className="flex items-center gap-4 px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <span
          className={
            'w-2.5 h-2.5 rounded-full ' +
            (isLive ? 'bg-danger animate-pulse' : 'bg-textMuted')
          }
        />
        <span className="text-xs font-extrabold tracking-widest">
          {isLive ? 'SESSÃO AO VIVO' : 'ENCERRADA'}
        </span>
      </div>

      {info.pilotKartNumber && (
        <div className="flex items-center justify-center w-12 h-10 rounded-lg border border-primary text-primary font-mono font-black text-lg">
          {info.pilotKartNumber}
        </div>
      )}

      <div className="min-w-0">
        <div className="text-base font-extrabold truncate">
          {info.pilotName ?? 'Piloto anônimo'}
        </div>
        <div className="text-textMuted text-[10px] font-bold tracking-wider truncate">
          {info.code}
        </div>
      </div>

      <Stat label="PISTA" value={info.trackName ?? '—'} />
      <Stat label="VOLTA" value={previousLap ? `L ${previousLap.lapNumber + 1}` : 'L 1'} />
      <Stat
        label="MELHOR"
        value={bestLap ? fmtLap(bestLap.durationMs) : '—'}
        valueClass="text-success"
      />
      <Stat
        label="ÚLTIMA"
        value={previousLap ? fmtLap(previousLap.durationMs) : '—'}
      />
    </header>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-textMuted text-[9px] font-extrabold tracking-widest">
        {label}
      </span>
      <span
        className={
          'font-mono text-base font-black tabular-nums ' +
          (valueClass ?? 'text-textPrimary')
        }
      >
        {value}
      </span>
    </div>
  );
}

// ============================================================================
// TRACK PANEL — SVG do traçado + posição do kart + setores
// ============================================================================

function TrackPanel({
  samples,
  lastSample,
}: {
  samples: LiveSample[];
  lastSample: LiveSample | null;
}) {
  const W = 800;
  const H = 540;
  const { points, project } = useMemo(() => projectTrack(samples, W, H), [samples]);

  const currentSector = lastSample?.currentSectorIdx;
  const sectorLabel =
    currentSector === 0
      ? 'S1'
      : currentSector === 1
        ? 'S2'
        : currentSector === 2
          ? 'S3'
          : '—';

  return (
    <section className="bg-surface rounded-2xl border border-border p-4 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-textMuted text-[10px] font-extrabold tracking-widest">
          TRAÇADO · LIVE GPS
        </h2>
        {currentSector !== null && currentSector !== undefined && (
          <div className="bg-primary/10 border border-primary/40 px-3 py-1 rounded-full">
            <span className="text-primary text-[11px] font-extrabold tracking-wider">
              {sectorLabel} · {sectorProgressLabel(currentSector, lastSample)}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-[300px] relative">
        {points.length < 2 ? (
          <div className="absolute inset-0 flex items-center justify-center text-textMuted text-sm">
            Esperando os primeiros pontos do GPS…
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
          >
            {/* Trajeto inteiro como sombra de fundo */}
            <path
              d={pointsToPath(points)}
              stroke="#2a2a35"
              strokeWidth={22}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Trajeto colorido (verde claro) por cima */}
            <path
              d={pointsToPath(points)}
              stroke="#00FF88"
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.7}
            />
            {/* Posição do kart */}
            {lastSample &&
              (() => {
                const p = project(lastSample);
                return (
                  <g>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={22}
                      fill="#00FF88"
                      opacity={0.18}
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={9}
                      fill="#00FF88"
                      stroke="#08080C"
                      strokeWidth={2}
                    />
                  </g>
                );
              })()}
          </svg>
        )}
      </div>
    </section>
  );
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  return points.reduce(
    (acc, p, i) => acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`),
    ''
  );
}

function sectorProgressLabel(
  sectorIdx: number,
  lastSample: LiveSample | null
): string {
  // Estimativa grossa: usa o tempo médio típico de um setor (~33%) como
  // denominador. Sem dado fino do progresso geográfico exato, é só um hint
  // visual ("T4 · 31%" no mock — aqui não temos T4, mas mostramos % aprox).
  if (!lastSample?.currentSectorElapsedMs) return '0%';
  // Heurística: 18s por setor de kart. Cap a 100%.
  const pct = Math.min(100, Math.round((lastSample.currentSectorElapsedMs / 18000) * 100));
  return `${pct}%`;
}

// ============================================================================
// DELTA CARD — número gigante + por setor + previsão
// ============================================================================

function DeltaCard({
  deltaVsBest,
  projectedLapMs,
  currentLapMs,
  lastSample,
  bestLap,
}: {
  deltaVsBest: number | null;
  projectedLapMs: number | null;
  currentLapMs: number;
  lastSample: LiveSample | null;
  bestLap: LiveLap | null;
}) {
  const deltaColor =
    deltaVsBest == null
      ? 'text-textMuted'
      : deltaVsBest > 0
        ? 'text-danger'
        : 'text-success';

  // Per-sector delta — pra cada setor que tem dado tanto no current lap
  // quanto no bestLap, calcula diferença. S3 só fica disponível pós-fechar.
  const perSector = useMemo(() => {
    if (!lastSample || !bestLap) return [null, null, null];
    const cur = [lastSample.s1Ms, lastSample.s2Ms, lastSample.s3Ms];
    const ref = [bestLap.s1Ms, bestLap.s2Ms, bestLap.s3Ms];
    return cur.map((c, i) => {
      if (c == null || ref[i] == null) return null;
      return c - (ref[i] as number);
    });
  }, [lastSample, bestLap]);

  return (
    <section className="bg-surface rounded-2xl border border-border p-4 flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-success text-[10px] font-extrabold tracking-widest">
            ★ DELTA · LIVE
          </span>
          {bestLap && (
            <span className="text-textMuted text-[10px] font-bold">
              vs MELHOR (L {bestLap.lapNumber})
            </span>
          )}
        </div>
        <div className={`font-mono text-7xl font-black tabular-nums tracking-tighter ${deltaColor}`}>
          {deltaVsBest == null ? '—' : fmtDelta(deltaVsBest)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div>
          <div className="text-textMuted text-[9px] font-extrabold tracking-widest mb-0.5">
            PREVISÃO
          </div>
          <div className="font-mono text-2xl font-black tabular-nums">
            {projectedLapMs != null ? fmtLap(projectedLapMs) : '—'}
          </div>
        </div>
        <div>
          <div className="text-textMuted text-[9px] font-extrabold tracking-widest mb-0.5">
            VOLTA
          </div>
          <div className="font-mono text-2xl font-black tabular-nums">
            {fmtTime(currentLapMs)}
          </div>
        </div>
      </div>

      <div>
        <div className="text-textMuted text-[10px] font-extrabold tracking-widest mb-2">
          POR SETOR
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <SectorChip key={i} label={`S${i + 1}`} deltaMs={perSector[i]} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SectorChip({ label, deltaMs }: { label: string; deltaMs: number | null }) {
  const tone =
    deltaMs == null
      ? 'bg-surfaceHigh border-border text-textMuted'
      : deltaMs > 0
        ? 'bg-danger/10 border-danger/40 text-danger'
        : 'bg-success/10 border-success/40 text-success';
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${tone}`}>
      <div className="text-[9px] font-extrabold tracking-widest opacity-70">{label}</div>
      <div className="font-mono text-sm font-black tabular-nums">
        {deltaMs == null ? 'LIVE' : fmtDelta(deltaMs)}
      </div>
    </div>
  );
}

// ============================================================================
// PONTOS A MELHORAR — ranking por setor
// ============================================================================

function PointsToImprove({
  laps,
  bestLap,
}: {
  laps: LiveLap[];
  bestLap: LiveLap | null;
}) {
  // Pega a ÚLTIMA volta fechada (mais relevante pro "o que mudar AGORA")
  // e compara cada setor contra o melhor setor visto na sessão. Maior
  // perda = maior prioridade. Setores com ganho ficam no fim como
  // "validações" (verde).
  const ranked = useMemo(() => {
    if (laps.length === 0 || !bestLap) return [];
    const lastClosedLap = laps[laps.length - 1];
    // Best por setor (independente — pode vir de voltas diferentes)
    const bestS1 = Math.min(
      ...laps.map((l) => l.s1Ms ?? Infinity)
    );
    const bestS2 = Math.min(
      ...laps.map((l) => l.s2Ms ?? Infinity)
    );
    const bestS3 = Math.min(
      ...laps.map((l) => l.s3Ms ?? Infinity)
    );
    const out: Array<{ sector: number; label: string; delta: number }> = [];
    const sectors: Array<[number | null | undefined, number]> = [
      [lastClosedLap.s1Ms, bestS1],
      [lastClosedLap.s2Ms, bestS2],
      [lastClosedLap.s3Ms, bestS3],
    ];
    sectors.forEach(([cur, best], i) => {
      if (cur == null || best === Infinity) return;
      const delta = cur - best;
      if (Math.abs(delta) < 30) return; // ignora ruído (<30ms)
      out.push({ sector: i, label: `Setor ${i + 1}`, delta });
    });
    // Maior PERDA primeiro (delta > 0), depois ganhos (delta < 0)
    return out.sort((a, b) => b.delta - a.delta).slice(0, 3);
  }, [laps, bestLap]);

  return (
    <section className="bg-surface rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-textPrimary text-[10px] font-extrabold tracking-widest">
          ★ PONTOS A MELHORAR
        </span>
        <span className="text-textMuted text-[9px] font-bold tracking-widest">
          {ranked.length > 0 ? `${ranked.length} INSIGHTS` : 'AGUARDANDO'}
        </span>
      </div>
      {ranked.length === 0 ? (
        <div className="text-textMuted text-xs py-2">
          Aguardando voltas fechadas com setores pra rankear ganhos/perdas.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {ranked.map((p, idx) => {
            const isLoss = p.delta > 0;
            return (
              <div
                key={p.sector}
                className={
                  'flex items-center gap-3 p-2.5 rounded-lg border ' +
                  (isLoss
                    ? 'bg-danger/8 border-danger/30'
                    : 'bg-success/8 border-success/30')
                }
              >
                <div
                  className={
                    'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ' +
                    (isLoss
                      ? 'bg-danger text-textPrimary'
                      : 'bg-success text-bg')
                  }
                >
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-extrabold">{p.label}</div>
                  <div className="text-textMuted text-[10px]">
                    {isLoss ? 'perdeu tempo nesse trecho' : 'ganhou tempo nesse trecho'}
                  </div>
                </div>
                <div
                  className={
                    'font-mono text-sm font-black tabular-nums ' +
                    (isLoss ? 'text-danger' : 'text-success')
                  }
                >
                  {fmtDelta(p.delta)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// DIAGNÓSTICO — texto em PT-BR rule-based
// ============================================================================

function DiagnosticCard({
  laps,
  bestLap,
  projectedLapMs,
  deltaVsBest,
}: {
  laps: LiveLap[];
  bestLap: LiveLap | null;
  projectedLapMs: number | null;
  deltaVsBest: number | null;
}) {
  const text = useMemo(
    () => buildDiagnostic({ laps, bestLap, projectedLapMs, deltaVsBest }),
    [laps, bestLap, projectedLapMs, deltaVsBest]
  );
  return (
    <section className="bg-warning/8 rounded-2xl border border-warning/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-warning text-base">★</span>
        <span className="text-warning text-[10px] font-extrabold tracking-widest">
          DIAGNÓSTICO · LIVE
        </span>
      </div>
      <p className="text-sm leading-relaxed text-textSecondary">{text}</p>
    </section>
  );
}

function buildDiagnostic({
  laps,
  bestLap,
  projectedLapMs,
  deltaVsBest,
}: {
  laps: LiveLap[];
  bestLap: LiveLap | null;
  projectedLapMs: number | null;
  deltaVsBest: number | null;
}): string {
  if (laps.length === 0) {
    return 'Aguardando primeira volta fechada pra começar a análise.';
  }
  if (!bestLap) {
    return 'Coletando voltas. Análise inicia após 2 voltas pra ter referência.';
  }
  // Última volta fechada vs PB por setor
  const last = laps[laps.length - 1];
  const hasSectors = last.s1Ms != null && last.s2Ms != null && last.s3Ms != null;
  if (!hasSectors) {
    return 'App do piloto sem layout reference carregada — análise por setor indisponível. Pode ver delta total apenas.';
  }

  // Best por setor (independente)
  const bestS1 = Math.min(...laps.map((l) => l.s1Ms ?? Infinity));
  const bestS2 = Math.min(...laps.map((l) => l.s2Ms ?? Infinity));
  const bestS3 = Math.min(...laps.map((l) => l.s3Ms ?? Infinity));
  const deltas = [
    (last.s1Ms ?? 0) - bestS1,
    (last.s2Ms ?? 0) - bestS2,
    (last.s3Ms ?? 0) - bestS3,
  ];

  const parts: string[] = [];
  deltas.forEach((d, i) => {
    if (Math.abs(d) < 30) return;
    const s = `S${i + 1}`;
    if (d < 0) {
      parts.push(`ganhou ${(Math.abs(d) / 1000).toFixed(2)}s no ${s}`);
    } else {
      parts.push(`perdeu ${(d / 1000).toFixed(2)}s no ${s}`);
    }
  });

  if (parts.length === 0) {
    return `Volta consistente — todos os setores próximos ao melhor (variação <30ms). Mantém o ritmo.`;
  }

  let text = `Última volta (L ${last.lapNumber}): ` + parts.join(', ') + '.';
  if (projectedLapMs != null && bestLap.durationMs > 0) {
    const pbStr = fmtLap(projectedLapMs);
    const isPb = projectedLapMs < bestLap.durationMs;
    text += ` Previsão volta atual: ${pbStr}${isPb ? ' (potencial nova PB)' : ''}.`;
  } else if (deltaVsBest != null) {
    const d = Math.abs(deltaVsBest);
    text += ` Volta atual ${deltaVsBest >= 0 ? 'atrás' : 'à frente'} da PB por ${(d / 1000).toFixed(2)}s.`;
  }
  return text;
}

// ============================================================================
// BOTTOM STATS — números rápidos + velocímetro chart
// ============================================================================

function BottomStats({
  samples,
  lastSample,
}: {
  samples: LiveSample[];
  lastSample: LiveSample | null;
}) {
  // Stats agregadas da volta atual
  const stats = useMemo(() => {
    if (samples.length === 0) {
      return { current: 0, min: null as number | null, avg: null as number | null, max: 0 };
    }
    // Pega samples da volta atual (filtra pelo lapNumber do último). Se
    // não tem lapNumber, usa todas.
    const lapN = lastSample?.lapNumber ?? null;
    const currentLapSamples =
      lapN != null
        ? samples.filter((s) => s.lapNumber === lapN)
        : samples;
    const speeds = currentLapSamples.map((s) => s.speed * 3.6);
    if (speeds.length === 0) return { current: 0, min: null, avg: null, max: 0 };
    const max = Math.max(...speeds);
    const min = Math.min(...speeds);
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const current = lastSample ? lastSample.speed * 3.6 : 0;
    return { current, min, avg, max };
  }, [samples, lastSample]);

  return (
    <section className="bg-surface rounded-2xl border border-border p-4 grid grid-cols-[auto_auto_auto_auto_1fr] gap-4 items-center">
      <NumStat label="ATUAL" value={Math.round(stats.current)} unit="km/h" highlight />
      <NumStat label="MÍNIMO" value={stats.min != null ? Math.round(stats.min) : null} unit="km/h" />
      <NumStat label="MÉDIO" value={stats.avg != null ? Math.round(stats.avg) : null} unit="km/h" />
      <NumStat label="MÁX" value={Math.round(stats.max)} unit="km/h" />
      <SpeedChart samples={samples} lastSample={lastSample} />
    </section>
  );
}

function NumStat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number | null;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-textMuted text-[9px] font-extrabold tracking-widest">{label}</span>
      <div className="flex items-baseline gap-1">
        <span
          className={
            'font-mono text-2xl font-black tabular-nums ' +
            (highlight ? 'text-success' : 'text-textPrimary')
          }
        >
          {value == null ? '—' : value}
        </span>
        <span className="text-[10px] text-textMuted">{unit}</span>
      </div>
    </div>
  );
}

function SpeedChart({
  samples,
  lastSample,
}: {
  samples: LiveSample[];
  lastSample: LiveSample | null;
}) {
  // Filtra pra volta atual + plota curva de velocidade. Marker "VOCÊ AQUI"
  // é o último ponto.
  const lapN = lastSample?.lapNumber ?? null;
  const currentLapSamples = useMemo(() => {
    return lapN != null ? samples.filter((s) => s.lapNumber === lapN) : samples;
  }, [samples, lapN]);

  const W = 600;
  const H = 80;
  const PAD_TOP = 6;
  const PAD_BOT = 14;
  const usable = H - PAD_TOP - PAD_BOT;

  if (currentLapSamples.length < 2) {
    return (
      <div className="text-textMuted text-xs italic flex items-center justify-center min-h-[60px]">
        Aguardando dados da volta…
      </div>
    );
  }

  const speeds = currentLapSamples.map((s) => s.speed * 3.6);
  const maxS = Math.max(...speeds, 1);
  const path = currentLapSamples
    .map((s, i) => {
      const x = (i / (currentLapSamples.length - 1)) * W;
      const y = PAD_TOP + (1 - (s.speed * 3.6) / maxS) * usable;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const lastX = W;
  const lastY = PAD_TOP + (1 - (lastSample!.speed * 3.6) / maxS) * usable;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <span className="text-textMuted text-[9px] font-extrabold tracking-widest">
          VELOCIDADE · VOLTA ATUAL
        </span>
        <span className="text-success text-[10px] font-bold tabular-nums">
          ● VOCÊ AQUI · {Math.round(lastSample!.speed * 3.6)} km/h
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[80px]">
        <path
          d={path}
          stroke="#00FF88"
          strokeWidth={1.5}
          fill="none"
          strokeLinejoin="round"
          opacity={0.95}
        />
        {/* Sombra abaixo da curva pra dar volume */}
        <path
          d={path + ` L ${W} ${H - PAD_BOT} L 0 ${H - PAD_BOT} Z`}
          fill="#00FF88"
          opacity={0.12}
        />
        {/* Marker "VOCÊ AQUI" */}
        <line
          x1={lastX}
          y1={PAD_TOP}
          x2={lastX}
          y2={H - PAD_BOT}
          stroke="#00FF88"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.6}
        />
        <circle cx={lastX} cy={lastY} r={4} fill="#00FF88" stroke="#08080C" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ============================================================================
// MESSAGING — botões rápidos + custom input
// ============================================================================

function Messaging({
  sessionId,
  messages,
  disabled,
}: {
  sessionId: string;
  messages: LiveMessage[];
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const [pending, startTransition] = useTransition();
  const [lastError, setLastError] = useState<string | null>(null);

  const sentCount = messages.length;
  const lastSentAt =
    messages.length > 0 ? messages[messages.length - 1].sentAt : null;
  const secondsAgo = lastSentAt
    ? Math.max(0, Math.round((Date.now() - lastSentAt) / 1000))
    : null;

  const send = (msg: { severity: MessageSeverity; text: string }) => {
    if (disabled || pending) return;
    setLastError(null);
    startTransition(async () => {
      const result = await sendMessage(sessionId, msg);
      if (!result.ok) setLastError(result.error ?? 'Erro ao enviar');
    });
  };

  const sendCustom = () => {
    const text = custom.trim();
    if (!text) return;
    send({ severity: 'warning', text });
    setCustom('');
  };

  return (
    <footer className="border-t border-border bg-surfaceHigh px-4 py-3">
      <div className="flex items-start gap-4">
        <div className="flex flex-col justify-center min-w-[140px]">
          <div className="text-[10px] font-extrabold tracking-widest text-textMuted">
            MENSAGEM AO PILOTO
          </div>
          <div className="text-[10px] text-textMuted mt-0.5">
            {sentCount} enviada{sentCount === 1 ? '' : 's'}
            {secondsAgo != null && ` · última ${secondsAgo}s`}
          </div>
          {lastError && (
            <div className="text-[10px] text-danger mt-1">{lastError}</div>
          )}
        </div>

        <div className="flex-1 flex flex-wrap gap-2 items-center justify-center">
          {QUICK_MESSAGES.map((m) => (
            <button
              key={m.text}
              onClick={() => send({ severity: m.severity, text: m.text })}
              disabled={disabled || pending}
              className={
                'px-3 py-2 rounded-lg border text-xs font-extrabold tracking-wide transition disabled:opacity-40 ' +
                severityBtnClass(m.severity)
              }
            >
              {iconForSeverity(m.severity)} {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 min-w-[280px]">
          <input
            type="text"
            value={custom}
            maxLength={MAX_CUSTOM_LEN}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendCustom();
            }}
            disabled={disabled || pending}
            placeholder={`Mensagem curta (${MAX_CUSTOM_LEN} caracteres)`}
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary disabled:opacity-40"
          />
          <button
            onClick={sendCustom}
            disabled={disabled || pending || custom.trim().length === 0}
            className="bg-success text-bg px-4 py-2 rounded-lg font-extrabold text-xs tracking-wider disabled:opacity-40"
          >
            ENVIAR
          </button>
        </div>
      </div>
    </footer>
  );
}

function severityBtnClass(sev: MessageSeverity): string {
  switch (sev) {
    case 'info':
      return 'border-success/40 text-success bg-success/5 hover:bg-success/15';
    case 'warning':
      return 'border-warning/40 text-warning bg-warning/5 hover:bg-warning/15';
    case 'critical':
      return 'border-danger/40 text-danger bg-danger/5 hover:bg-danger/15';
  }
}

function iconForSeverity(sev: MessageSeverity): string {
  switch (sev) {
    case 'info':
      return '◐';
    case 'warning':
      return '◆';
    case 'critical':
      return '●';
  }
}

// ============================================================================
// HELPERS
// ============================================================================

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
