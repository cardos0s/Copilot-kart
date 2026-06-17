import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listSessions, Session, getLapsForSession } from '../../src/storage/db';
import { getProfile, PilotProfile } from '../../src/storage/profile';
import { findTrackById } from '../../src/data/tracks';
import { TrackSilhouette } from '../../src/components/TrackSilhouette';
import { Button, Card, Chart, DecorativeSplash, Icon, Metric } from '../../src/components/ui';
import { SennaQuoteCard } from '../../src/components/SennaQuoteCard';
import { peakSpeedMsOfLaps, msToKmh } from '../../src/lib/speed';
import { LapRecord } from '../../src/lib/analysis';
import { colors, spacing, radius, typography } from '../../src/theme';
import { getPilotType, type PilotType } from '../../src/storage/pilotType';
import { IndoorHome } from '../../src/components/IndoorHome';
import { EvolutionChart } from '../../src/components/EvolutionChart';

type SessionWithStats = Session & {
  bestLapMs: number | null;
  lapMsList: number[];
  peakSpeedKmh: number;
  laps: LapRecord[];
};

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number) {
  const s = ms / 1000;
  const sign = s >= 0 ? '+' : '-';
  return `${sign}${Math.abs(s).toFixed(3)}`;
}

function greetingFor(hour: number) {
  if (hour < 5) return 'Boa madrugada';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** "HOJE" / "ONTEM" / "15 JUN" */
function relDay(ts: number): string {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff <= 0) return 'HOJE';
  if (diff === 1) return 'ONTEM';
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).toUpperCase();
}

/** Consistência 0-100 a partir das voltas (mesma fórmula do insights). */
function consistencyPct(laps: number[]): number {
  if (laps.length < 2) return 0;
  const sorted = [...laps].sort((a, b) => a - b);
  const cut = Math.max(2, Math.floor(sorted.length * 0.8));
  const sample = sorted.slice(0, cut);
  const best = sample[0];
  const avg = sample.reduce((a, b) => a + b, 0) / sample.length;
  const std = Math.sqrt(sample.reduce((a, b) => a + (b - avg) ** 2, 0) / sample.length);
  return Math.round(Math.max(0, Math.min(100, (1 - (std / best) * 8) * 100)));
}

function fmtKmh(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

/** delta em segundos com sinal: "-4,2s" / "+1,1s" */
function fmtSecDelta(ms: number): string {
  const sign = ms <= 0 ? '-' : '+';
  return `${sign}${Math.abs(ms / 1000).toFixed(1).replace('.', ',')}s`;
}

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [sessions, setSessions] = useState<SessionWithStats[]>([]);
  const [pilotType, setPilotTypeState] = useState<PilotType | null>(null);
  const [evoSel, setEvoSel] = useState<number | null>(null);

  const load = useCallback(async () => {
    setEvoSel(null);
    const [prof, list, pt] = await Promise.all([getProfile(), listSessions(), getPilotType()]);
    setProfile(prof);
    setPilotTypeState(pt);
    const enriched = await Promise.all(
      list.map(async (sess) => {
        const laps = await getLapsForSession(sess.id);
        const lapMsList = laps.map((l) => l.durationMs);
        const bestLapMs = lapMsList.length ? Math.min(...lapMsList) : null;
        const peakSpeedKmh = msToKmh(peakSpeedMsOfLaps(laps));
        return { ...sess, bestLapMs, lapMsList, peakSpeedKmh, laps };
      })
    );
    setSessions(enriched);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const firstName = profile?.name?.split(' ')[0] ?? '';
  const greeting = greetingFor(new Date().getHours());

  const lastSession = sessions[0] ?? null;
  const prevSession = sessions[1] ?? null;
  const track = lastSession?.trackId ? findTrackById(lastSession.trackId) : null;

  const deltaMs =
    lastSession?.bestLapMs != null && prevSession?.bestLapMs != null
      ? lastSession.bestLapMs - prevSession.bestLapMs
      : null;

  // Sparkline: melhor volta das últimas N sessões (ordem cronológica)
  const sparkData = sessions
    .filter((s) => s.bestLapMs != null)
    .slice(0, 12)
    .map((s) => s.bestLapMs as number)
    .reverse();

  const isEmpty = sessions.length === 0;
  const evoDeltaMs =
    sparkData.length >= 2 ? sparkData[sparkData.length - 1] - sparkData[0] : null;
  // Sessões alinhadas ao sparkData (mesma ordem cronológica) p/ tooltip do gráfico.
  const sparkSessions = sessions
    .filter((s) => s.bestLapMs != null)
    .slice(0, 12)
    .reverse();
  const evoSelSession = evoSel != null ? sparkSessions[evoSel] : null;

  // Modo Indoor (competição): home focada em ranking.
  if (pilotType === 'indoor') {
    return <IndoorHome />;
  }

  return (
    <View style={s.root}>
      <DecorativeSplash position="top-right" intensity="subtle" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.l,
          paddingBottom: 120,
          paddingHorizontal: spacing.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — greeting + bell */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.greetingLabel}>
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long' }).toUpperCase().slice(0, 3)} ·{' '}
              {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).toUpperCase()}
            </Text>
            <Text style={s.greetingName}>
              {greeting}{firstName ? `, ${firstName}.` : '.'}
            </Text>
          </View>
          <Pressable hitSlop={12} onPress={() => { /* placeholder */ }}>
            <Icon name="bell" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Citação Senna — destaque emocional, troca a cada abertura */}
        <View style={{ marginTop: spacing.l }}>
          <SennaQuoteCard />
        </View>

        {/* Card: Última sessão — compacto (silhueta + tempo + voltas) */}
        <Card variant="flat" padding="l" style={s.sessionCard}>
          <View style={s.sessionRow}>
            <View style={s.silBox}>
              {lastSession && lastSession.lapMsList.length > 0 ? (
                <LastSessionSilhouette sessionId={lastSession.id} size={50} />
              ) : (
                <Icon name="map" size={24} color={colors.textMuted} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardLabel}>
                ÚLTIMA SESSÃO{lastSession ? ` · ${relDay(lastSession.startedAt)}` : ''}
              </Text>
              {lastSession ? (
                <>
                  <Text style={s.trackName} numberOfLines={1}>
                    {track?.shortName ?? lastSession.trackName}
                  </Text>
                  <View style={s.lastMetaRow}>
                    <Text style={s.lastLap}>
                      {lastSession.bestLapMs != null ? fmtLap(lastSession.bestLapMs) : '—'}
                    </Text>
                    {deltaMs != null && (
                      <Text style={[s.lastDelta, { color: deltaMs <= 0 ? colors.success : colors.danger }]}>
                        {deltaMs <= 0 ? '▼' : '▲'} {Math.abs(deltaMs / 1000).toFixed(1).replace('.', ',')}s
                      </Text>
                    )}
                    <Text style={s.lastLaps}>· {lastSession.lapMsList.length} voltas</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={s.emptyTitle}>Sem sessões ainda</Text>
                  <Text style={s.emptySub}>
                    Sua primeira volta vai dizer onde você pode ganhar tempo.
                  </Text>
                </>
              )}
            </View>
          </View>
        </Card>

        {/* 3 métricas */}
        {lastSession && lastSession.lapMsList.length > 0 && (
          <View style={s.metricRow}>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>MELHOR VOLTA</Text>
              <Text style={s.metricValue}>
                {lastSession.bestLapMs != null ? fmtLap(lastSession.bestLapMs) : '—'}
              </Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>VEL MÁX</Text>
              <Text style={s.metricValue}>
                {fmtKmh(lastSession.peakSpeedKmh)}<Text style={s.metricUnit}> km/h</Text>
              </Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>CONSIST.</Text>
              <Text style={s.metricValue}>
                {consistencyPct(lastSession.lapMsList)}<Text style={s.metricUnit}>%</Text>
              </Text>
            </View>
          </View>
        )}

        {/* Card: Evolução */}
        {sparkData.length >= 2 && (
          <Card variant="flat" padding="l" style={s.evoCard}>
            <View style={s.evoHeader}>
              <Text style={s.cardLabel}>EVOLUÇÃO</Text>
              {evoSelSession ? (
                <Text style={[s.evoDelta, { color: colors.accentLime }]}>
                  {relDay(evoSelSession.startedAt)}
                </Text>
              ) : (
                <Text style={[s.evoDelta, { color: (evoDeltaMs ?? 0) <= 0 ? colors.success : colors.danger }]}>
                  {evoDeltaMs != null ? fmtSecDelta(evoDeltaMs) : ''} · {sparkData.length} sessões
                </Text>
              )}
            </View>
            <View style={{ marginTop: spacing.m }}>
              <EvolutionChart
                data={sparkData}
                width={320}
                height={80}
                selectedIndex={evoSel}
                onSelect={setEvoSel}
                formatValue={fmtLap}
              />
            </View>
            <View style={s.evoFooter}>
              {evoSelSession ? (
                <>
                  <Text style={s.evoFootText}>{fmtDate(evoSelSession.startedAt)}</Text>
                  <Text style={s.evoFootText}>{fmtLap(sparkData[evoSel as number])}</Text>
                </>
              ) : (
                <>
                  <Text style={s.evoFootText}>Toque no gráfico pra ver cada sessão</Text>
                  <Text style={s.evoFootText}>melhor: {fmtLap(Math.min(...sparkData))}</Text>
                </>
              )}
            </View>
          </Card>
        )}

        {/* Evolução — placeholder com 1 sessão (precisa de 2 pra traçar a curva) */}
        {sparkData.length === 1 && (
          <Card variant="flat" padding="l" style={s.evoCard}>
            <Text style={s.cardLabel}>EVOLUÇÃO</Text>
            <Text style={s.evoPlaceholder}>
              Grave mais uma sessão pra ver sua evolução — o gráfico compara a melhor volta de cada sessão.
            </Text>
          </Card>
        )}

        {/* Modos lado a lado: Lendas + Ranking */}
        <View style={s.modesRow}>
          <Pressable
            style={({ pressed }) => [s.modeCard, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/legends' as any)}
          >
            <View style={[s.modeIcon, { backgroundColor: 'rgba(47,107,255,0.12)', borderColor: colors.racingBlue }]}>
              <Text style={s.modeEmoji}>⚔️</Text>
            </View>
            <Text style={s.modeTitle}>LENDAS</Text>
            <Text style={s.modeSub}>vs fantasma de Senna & cia</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.modeCard, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/ranking' as any)}
          >
            <View style={[s.modeIcon, { backgroundColor: 'rgba(0,255,136,0.10)', borderColor: colors.success }]}>
              <Text style={s.modeEmoji}>🏁</Text>
            </View>
            <Text style={s.modeTitle}>RANKING</Text>
            <Text style={s.modeSub}>corra ao vivo no ranking</Text>
          </Pressable>
        </View>

        {/* CTA — Iniciar Sessão */}
        <Pressable
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
          onPress={() => router.push('/new-session')}
        >
          <Text style={s.ctaIcon}>⏻</Text>
          <Text style={s.ctaText}>INICIAR SESSÃO</Text>
        </Pressable>

        {isEmpty && (
          <Text style={s.hintFirst}>Toque pra começar sua primeira sessão.</Text>
        )}
      </ScrollView>
    </View>
  );
}

/** Mostra a silhueta da melhor volta da sessão. */
function LastSessionSilhouette({ sessionId, size = 56 }: { sessionId: string; size?: number }) {
  const [bestSamples, setBestSamples] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const laps = await getLapsForSession(sessionId);
        if (laps.length === 0) return;
        const best = laps.reduce((a, b) => (a.durationMs < b.durationMs ? a : b));
        setBestSamples(best.samples);
      })();
    }, [sessionId])
  );

  if (bestSamples.length < 2) return null;
  return <TrackSilhouette samples={bestSamples} width={size} height={size * 0.82} strokeWidth={2} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  greetingLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  greetingName: {
    fontFamily: 'PlayfairDisplay_400Regular',
    color: colors.textPrimary,
    fontSize: 26,
    letterSpacing: -0.3,
    marginTop: 4,
  },

  cardLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  trackName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  dateText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },

  silhouetteWrap: {
    width: 110,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sessionCard: { marginTop: spacing.xxl, borderColor: 'transparent', backgroundColor: colors.surface },
  sessionRow: { flexDirection: 'row', gap: spacing.m, alignItems: 'center' },
  silBox: {
    width: 64,
    height: 64,
    borderRadius: radius.m,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lastMetaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  lastLap: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  lastDelta: { fontSize: 12, fontWeight: '800' },
  lastLaps: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },

  metricRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  metricCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.m, padding: spacing.m },
  metricLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  metricValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', letterSpacing: -0.5, marginTop: 5, fontVariant: ['tabular-nums'] },
  metricUnit: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },

  evoCard: { marginTop: spacing.m, borderColor: 'transparent', backgroundColor: colors.surface },
  evoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  evoDelta: { fontSize: 12, fontWeight: '800' },
  evoFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.s },
  evoFootText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  evoPlaceholder: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.s },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.huge * 2,
    marginHorizontal: spacing.xxl,
    backgroundColor: colors.primary,
    borderRadius: radius.m,
    paddingVertical: 12,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  ctaIcon: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ctaText: { color: '#fff', fontSize: 13, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  modesRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  modeCard: { flex: 1, padding: spacing.l, backgroundColor: colors.surface, borderRadius: radius.l, borderWidth: 1, borderColor: colors.border },
  modeIcon: { width: 44, height: 44, borderRadius: radius.m, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.m },
  modeEmoji: { fontSize: 20 },
  modeTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  modeSub: { color: colors.textSecondary, fontSize: 11, marginTop: 3, lineHeight: 15 },

  bestNum: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  chartHint: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 4,
  },

  peakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.s,
  },
  peakDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accentCyan,
  },
  peakLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  peakValue: {
    color: colors.accentCyan,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  emptySub: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 19,
  },

  hintFirst: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.m,
    fontWeight: '500',
  },
});
