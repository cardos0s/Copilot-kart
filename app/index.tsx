import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listSessions, Session, getLapsForSession } from '../src/storage/db';
import { LapRecord } from '../src/lib/analysis';
import { TrackSilhouette } from '../src/components/TrackSilhouette';
import { getProfile, PilotProfile } from '../src/storage/profile';
import { findTrackById } from '../src/data/tracks';
import { colors, typography, spacing, radius, shadows } from '../src/theme';

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function greetingFor(hour: number) {
  if (hour < 5) return 'Boa madrugada';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

type SessionCard = Session & {
  laps: LapRecord[];
  bestLapMs: number | null;
};

export default function Home() {
  const [sessions, setSessions] = useState<SessionCard[]>([]);
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    const [list, prof] = await Promise.all([
      listSessions(),
      getProfile(),
    ]);
    const enriched = await Promise.all(
      list.map(async (sess) => {
        const laps = await getLapsForSession(sess.id);
        const bestLapMs = laps.length
          ? Math.min(...laps.map((l) => l.durationMs))
          : null;
        return { ...sess, laps, bestLapMs };
      })
    );
    setSessions(enriched);
    setProfile(prof);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalSessions = sessions.length;
  const totalLaps = sessions.reduce((acc, sess) => acc + sess.laps.length, 0);
  const bestEver = sessions.reduce<number | null>((acc, sess) => {
    if (sess.bestLapMs === null) return acc;
    if (acc === null) return sess.bestLapMs;
    return Math.min(acc, sess.bestLapMs);
  }, null);

  const firstName = profile?.name?.split(' ')[0] ?? '';
  const greeting = greetingFor(new Date().getHours());
  const homeTrack = profile?.homeTrackId ? findTrackById(profile.homeTrackId) : null;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={s.header}>
              <Text style={s.brand}>
                <Text style={s.brandWhite}>co</Text>
                <Text style={s.brandGreen}>pilot</Text>
              </Text>
              <View style={s.greetingRow}>
                <Text style={s.greeting}>
                  {greeting}{firstName ? `, ${firstName}` : ''}
                </Text>
                {homeTrack && (
                  <Text style={s.homeTrack}>{homeTrack.shortName}</Text>
                )}
              </View>
            </View>

            {totalSessions > 0 && (
              <View style={s.statsRow}>
                <Stat label="Sessões" value={String(totalSessions)} />
                <Stat label="Voltas" value={String(totalLaps)} />
                <Stat
                  label="Melhor"
                  value={bestEver !== null ? formatLap(bestEver) : '—'}
                  highlight
                />
              </View>
            )}

            <Text style={s.sectionTitle}>Sessões recentes</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🏁</Text>
            <Text style={s.emptyTitle}>Nenhuma sessão ainda</Text>
            <Text style={s.emptySub}>Grave sua primeira volta pra ver onde tá perdendo tempo</Text>
          </View>
        }
        renderItem={({ item }) => {
          const bestLap = item.laps.reduce<LapRecord | null>(
            (best, l) => (!best || l.durationMs < best.durationMs ? l : best),
            null
          );
          return (
            <Pressable
              style={({ pressed }) => [s.card, pressed && { backgroundColor: colors.bgPressed }]}
              onPress={() => router.push(`/session/${item.id}`)}
            >
              <View style={s.cardSilhouette}>
                {bestLap ? (
                  <TrackSilhouette samples={bestLap.samples} width={96} height={72} />
                ) : (
                  <View style={s.cardSilhouettePlaceholder}>
                    <Text style={{ color: colors.textMuted, fontSize: 24 }}>?</Text>
                  </View>
                )}
              </View>
              <View style={s.cardBody}>
                <Text style={s.cardTitle} numberOfLines={1}>{item.trackName}</Text>
                <Text style={s.cardMeta}>{formatDate(item.startedAt)}</Text>
                <View style={s.cardTags}>
                  <Tag text={`${item.laps.length} voltas`} />
                  {item.weather && (
                    <Tag text={item.weather === 'wet' ? 'Molhado' : 'Seco'} />
                  )}
                  {item.bestLapMs !== null && (
                    <Tag text={formatLap(item.bestLapMs)} highlight />
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: 140 }}
      />
      <Pressable
        style={({ pressed }) => [s.fab, { bottom: insets.bottom + spacing.xxl }, pressed && { opacity: 0.9 }]}
        onPress={() => router.push('/new-session')}
      >
        <View style={s.fabInner}>
          <Text style={s.fabIcon}>+</Text>
          <Text style={s.fabText}>Nova sessão</Text>
        </View>
      </Pressable>
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, highlight && { color: colors.primary }]}>{value}</Text>
    </View>
  );
}

function Tag({ text, highlight }: { text: string; highlight?: boolean }) {
  return (
    <View style={[s.tag, highlight && s.tagHighlight]}>
      <Text style={[s.tagText, highlight && s.tagTextHighlight]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.l, paddingBottom: spacing.m },
  brand: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
  },
  brandWhite: { color: colors.textPrimary },
  brandGreen: {
    color: colors.primary,
    textShadowColor: 'rgba(0,255,136,0.3)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.s,
  },
  greeting: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  homeTrack: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    gap: spacing.m,
    marginTop: spacing.l,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    padding: spacing.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: { ...typography.label, color: colors.textMuted },
  statValue: {
    ...typography.h2,
    ...typography.mono,
    color: colors.textPrimary,
    marginTop: 4,
  },
  sectionTitle: {
    ...typography.labelL,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxl,
    marginBottom: spacing.m,
  },
  card: {
    flexDirection: 'row',
    marginHorizontal: spacing.l,
    marginVertical: spacing.xs,
    padding: spacing.m,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.m,
  },
  cardSilhouette: {
    width: 96,
    height: 72,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardSilhouettePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardMeta: { ...typography.bodyS, color: colors.textMuted, marginTop: 2 },
  cardTags: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.s, flexWrap: 'wrap' },
  tag: {
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bgPressed,
  },
  tagHighlight: { backgroundColor: colors.primaryGlow, borderWidth: 1, borderColor: colors.primary },
  tagText: { ...typography.bodyS, color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  tagTextHighlight: { color: colors.primary, ...typography.mono },
  empty: { padding: spacing.huge, alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: spacing.m },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  emptySub: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.s, lineHeight: 20 },
  fab: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    borderRadius: radius.l,
    backgroundColor: colors.primary,
    ...shadows.glow,
  },
  fabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
    gap: spacing.s,
  },
  fabIcon: { color: colors.textOnPrimary, fontSize: 22, fontWeight: '900' },
  fabText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
});