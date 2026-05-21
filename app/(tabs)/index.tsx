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
import { colors, spacing, typography } from '../../src/theme';

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

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [sessions, setSessions] = useState<SessionWithStats[]>([]);

  const load = useCallback(async () => {
    const [prof, list] = await Promise.all([getProfile(), listSessions()]);
    setProfile(prof);
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

        {/* Card: Última sessão — sem border duro, com mais respiro */}
        <Card variant="flat" padding="l" style={{ marginTop: spacing.xxl, borderColor: 'transparent', backgroundColor: colors.surface }}>
          <View style={{ flexDirection: 'row', gap: spacing.m }}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardLabel}>ÚLTIMA SESSÃO</Text>
              {lastSession ? (
                <>
                  <Text style={s.trackName} numberOfLines={1}>
                    {track?.shortName ?? lastSession.trackName}
                  </Text>
                  <Text style={s.dateText}>{fmtDate(lastSession.startedAt)}</Text>
                  <View style={{ marginTop: spacing.m }}>
                    <Metric
                      label="MELHOR VOLTA"
                      value={lastSession.bestLapMs != null ? fmtLap(lastSession.bestLapMs) : '—'}
                      tone="primary"
                      size="l"
                      delta={deltaMs != null ? fmtDelta(deltaMs) : undefined}
                      deltaTone={deltaMs != null && deltaMs < 0 ? 'success' : 'danger'}
                      hint={deltaMs != null ? 'vs sessão anterior' : undefined}
                    />
                  </View>
                  {lastSession.peakSpeedKmh > 0 && (
                    <View style={s.peakRow}>
                      <View style={s.peakDot} />
                      <Text style={s.peakLabel}>PICO</Text>
                      <Text style={[s.peakValue, typography.mono]}>
                        {lastSession.peakSpeedKmh.toFixed(0)} km/h
                      </Text>
                    </View>
                  )}
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
            {lastSession && lastSession.lapMsList.length > 0 && (
              <View style={s.silhouetteWrap}>
                <LastSessionSilhouette sessionId={lastSession.id} />
              </View>
            )}
          </View>
        </Card>

        {/* Card: Desempenho */}
        {sparkData.length >= 2 && (
          <Card variant="flat" padding="l" style={{ marginTop: spacing.m, borderColor: 'transparent', backgroundColor: colors.surface }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={s.cardLabel}>DESEMPENHO</Text>
              <Text style={[s.bestNum, typography.mono]}>
                {fmtLap(Math.min(...sparkData))}
              </Text>
            </View>
            <View style={{ marginTop: spacing.m }}>
              <Chart
                data={sparkData}
                width={320}
                height={80}
                color={colors.primary}
                showArea
                showDots
                highlightLast
              />
            </View>
            <Text style={s.chartHint}>Melhor volta · últimas {sparkData.length} sessões</Text>
          </Card>
        )}

        {/* CTA — respiro generoso pra separar do conteúdo acima */}
        <View style={{ marginTop: spacing.huge * 1.5 }}>
          <Button
            label="Iniciar Sessão"
            onPress={() => router.push('/new-session')}
            variant="primary"
            size="l"
            fullWidth
          />
        </View>

        {isEmpty && (
          <Text style={s.hintFirst}>
            Toque acima pra começar sua primeira sessão.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

/** Mostra a silhueta da melhor volta da sessão. */
function LastSessionSilhouette({ sessionId }: { sessionId: string }) {
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
  return <TrackSilhouette samples={bestSamples} width={110} height={88} strokeWidth={2.5} />;
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
