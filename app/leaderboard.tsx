import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { fetchLeaderboard, LeaderboardEntry } from '../src/lib/leaderboard';
import { findTrackById } from '../src/data/tracks';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export default function LeaderboardScreen() {
  const router = useRouter();
  const { trackId, layoutId } = useLocalSearchParams<{
    trackId?: string;
    layoutId?: string;
  }>();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const reveal = useSharedValue(0);

  const load = useCallback(async () => {
    if (!trackId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchLeaderboard(trackId, layoutId ?? null, 20);
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
    reveal.value = 0;
    reveal.value = withTiming(1, {
      duration: 1400,
      easing: Easing.bezier(0.2, 0.7, 0.3, 1),
    });
  }, [trackId, layoutId, reveal]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const track = trackId ? findTrackById(trackId) : null;
  const trackName = track?.shortName ?? 'Pista';

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!trackId) {
    return (
      <View style={s.root}>
        <ScreenHeader title="RANKING" onBack={() => router.back()} />
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.empty}>Selecione uma pista pra ver o ranking.</Text>
        </View>
      </View>
    );
  }

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <View style={s.root}>
      <ScreenHeader title="RANKING" subtitle={trackName} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll}>
        {entries.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Sem rankings ainda</Text>
            <Text style={s.emptyBody}>
              Quando você ou outros pilotos completarem sessões nessa pista
              compartilhando ao vivo, o ranking aparece aqui.
            </Text>
          </View>
        ) : (
          <>
            {/* Pódio 1/2/3 */}
            <View style={s.podium}>
              {podium[1] && <PodiumStep entry={podium[1]} position={2} reveal={reveal} />}
              {podium[0] && <PodiumStep entry={podium[0]} position={1} reveal={reveal} />}
              {podium[2] && <PodiumStep entry={podium[2]} position={3} reveal={reveal} />}
            </View>

            {/* Resto da lista */}
            {rest.length > 0 && (
              <>
                <Text style={s.sectionTitle}>OUTROS PILOTOS</Text>
                {rest.map((e, i) => (
                  <Row key={e.id} entry={e} position={i + 4} reveal={reveal} startDelay={0.4} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PodiumStep({
  entry,
  position,
  reveal,
}: {
  entry: LeaderboardEntry;
  position: number;
  reveal: Animated.SharedValue<number>;
}) {
  const heights = { 1: 130, 2: 100, 3: 80 };
  const accent = position === 1 ? colors.primary : position === 2 ? colors.accentCyan : colors.warning;
  const order = position === 1 ? 2 : position === 2 ? 1 : 3;

  const animStyle = useAnimatedStyle(() => {
    const delay = position * 0.1;
    const t = interpolate(reveal.value, [delay, delay + 0.3], [0, 1], 'clamp');
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * 60 }],
    };
  });

  return (
    <Animated.View style={[s.podiumCol, { order }, animStyle]}>
      <View style={[s.podiumAvatar, { borderColor: accent }]}>
        <Text style={s.podiumPosition}>#{position}</Text>
      </View>
      <Text style={s.podiumName} numberOfLines={1}>
        {entry.pilotName ?? 'Anônimo'}
      </Text>
      <Text style={[s.podiumLap, typography.mono, { color: accent }]}>
        {fmtLap(entry.bestLapMs)}
      </Text>
      <View style={[s.podiumBlock, { height: heights[position as 1 | 2 | 3], borderColor: accent }]}>
        <Text style={[s.podiumNumber, { color: accent }]}>{position}</Text>
      </View>
    </Animated.View>
  );
}

function Row({
  entry,
  position,
  reveal,
  startDelay,
}: {
  entry: LeaderboardEntry;
  position: number;
  reveal: Animated.SharedValue<number>;
  startDelay: number;
}) {
  const animStyle = useAnimatedStyle(() => {
    const delay = startDelay + (position - 4) * 0.06;
    const t = interpolate(reveal.value, [delay, delay + 0.2], [0, 1], 'clamp');
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * 12 }],
    };
  });
  return (
    <Animated.View style={[s.row, animStyle]}>
      <Text style={s.rowPos}>{position}</Text>
      <Text style={s.rowName} numberOfLines={1}>
        {entry.pilotName ?? 'Anônimo'}
        {entry.pilotKartNumber && <Text style={s.rowKart}>  #{entry.pilotKartNumber}</Text>}
      </Text>
      <Text style={[s.rowLap, typography.mono]}>{fmtLap(entry.bestLapMs)}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, paddingBottom: spacing.huge },

  emptyCard: {
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: spacing.s },
  emptyBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },

  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingVertical: spacing.l,
    minHeight: 280,
  },
  podiumCol: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  podiumAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
  },
  podiumPosition: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  podiumName: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
    maxWidth: 100,
  },
  podiumLap: {
    fontSize: 14,
    fontWeight: '900',
    marginBottom: spacing.s,
  },
  podiumBlock: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: spacing.s,
  },
  podiumNumber: {
    fontSize: 32,
    fontWeight: '900',
  },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: spacing.l,
    marginBottom: spacing.s,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
    gap: spacing.m,
  },
  rowPos: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
    width: 28,
  },
  rowName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  rowKart: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  rowLap: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
});
