import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  countChallengeStreak,
  DailyChallenge,
} from '../src/storage/db';
import {
  getChallengesForToday,
  getTemplate,
  refreshTodayChallenges,
} from '../src/lib/challenges';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

export default function ChallengesScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState<DailyChallenge[]>([]);
  const [streak, setStreak] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    // Refresh primeiro pra refletir sessões recentes do dia
    await refreshTodayChallenges();
    const [cs, st] = await Promise.all([
      getChallengesForToday(),
      countChallengeStreak(),
    ]);
    setChallenges(cs);
    setStreak(st);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Chama do streak pulsa
  const flame = useSharedValue(0);
  useFocusEffect(useCallback(() => {
    flame.value = 0;
    flame.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => { flame.value = 0; };
  }, [flame]));

  const flameStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + flame.value * 0.15 },
      { rotate: `${flame.value * 4 - 2}deg` },
    ],
  }));

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const completedCount = challenges.filter((c) => c.completed).length;

  return (
    <View style={s.root}>
      <ScreenHeader title="DESAFIOS DIÁRIOS" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Streak card */}
        <View style={s.streakCard}>
          <Animated.Text style={[s.streakFlame, flameStyle]}>🔥</Animated.Text>
          <Text style={s.streakValue}>{streak}</Text>
          <Text style={s.streakLabel}>
            DIA{streak === 1 ? '' : 'S'} EM SEQUÊNCIA
          </Text>
          <Text style={s.streakHint}>
            Complete pelo menos 1 desafio por dia pra manter
          </Text>
        </View>

        {/* Progresso do dia */}
        <Text style={s.sectionTitle}>HOJE · {completedCount}/{challenges.length}</Text>

        {challenges.map((c, i) => (
          <ChallengeCard key={c.id} challenge={c} index={i} />
        ))}

        <Text style={s.hint}>
          Desafios novos a cada dia. Faça sessões pra ver progresso atualizar.
        </Text>
      </ScrollView>
    </View>
  );
}

function ChallengeCard({ challenge, index }: { challenge: DailyChallenge; index: number }) {
  const tpl = getTemplate(challenge.templateId);
  if (!tpl) return null;

  const ratio = Math.min(1, challenge.progress / challenge.target);

  // Stagger reveal
  const reveal = useSharedValue(0);
  useFocusEffect(useCallback(() => {
    reveal.value = 0;
    reveal.value = withTiming(1, {
      duration: 600,
      easing: Easing.bezier(0.2, 0.7, 0.3, 1),
    });
  }, [reveal]));

  const cardStyle = useAnimatedStyle(() => {
    const delay = index * 0.15;
    const t = interpolate(reveal.value, [delay, delay + 0.3], [0, 1], 'clamp');
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * 12 }],
    };
  });

  const barStyle = useAnimatedStyle(() => {
    const delay = 0.4 + index * 0.15;
    const t = interpolate(reveal.value, [delay, delay + 0.4], [0, ratio], 'clamp');
    return { width: `${t * 100}%` };
  });

  return (
    <Animated.View
      style={[
        s.challengeCard,
        challenge.completed && s.challengeCardDone,
        cardStyle,
      ]}
    >
      <View style={s.challengeHeader}>
        <Text style={s.challengeIcon}>{tpl.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.challengeTitle}>{tpl.title}</Text>
          <Text style={s.challengeDesc}>{tpl.description(challenge.target)}</Text>
        </View>
        {challenge.completed && <Text style={s.doneCheck}>✓</Text>}
      </View>

      <View style={s.barRow}>
        <View style={s.barTrack}>
          <Animated.View style={[s.barFill, barStyle]} />
        </View>
        <Text style={[s.barLabel, typography.mono]}>
          {Math.min(challenge.progress, challenge.target)} / {challenge.target}
        </Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, paddingBottom: spacing.huge, gap: spacing.s },

  streakCard: {
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning + '55',
    alignItems: 'center',
    marginBottom: spacing.l,
  },
  streakFlame: { fontSize: 56 },
  streakValue: {
    color: colors.textPrimary,
    fontSize: 48,
    fontWeight: '900',
    marginTop: 4,
  },
  streakLabel: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 4,
  },
  streakHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.s,
    textAlign: 'center',
  },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: spacing.s,
  },

  challengeCard: {
    padding: spacing.m,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  challengeCardDone: {
    borderColor: colors.success,
    backgroundColor: colors.success + '11',
  },
  challengeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
  },
  challengeIcon: { fontSize: 28 },
  challengeTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  challengeDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  doneCheck: { color: colors.success, fontSize: 24, fontWeight: '900' },

  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginTop: spacing.s,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bg,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.primary },
  barLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 50,
    textAlign: 'right',
  },

  hint: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.l,
  },
});
