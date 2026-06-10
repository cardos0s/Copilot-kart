import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  getGamificationState,
  listUnlockedAchievements,
  listSessions,
} from '../src/storage/db';
import {
  ACHIEVEMENTS,
  Achievement,
  LEVELS,
  Level,
  levelForXp,
  nextLevel,
  xpProgressInLevel,
} from '../src/lib/gamification';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

type Milestone =
  | { kind: 'level'; level: Level; reached: boolean; current: boolean }
  | {
      kind: 'achievement';
      achievement: Achievement;
      unlocked: boolean;
      current: boolean;
    };

export default function CareerScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [xp, setXp] = useState(0);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [stats, setStats] = useState({
    sessions: 0,
    achievements: 0,
    totalAchievements: ACHIEVEMENTS.length,
  });

  const reveal = useSharedValue(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
    const [state, unlocked, sessions] = await Promise.all([
      getGamificationState().catch(() => ({ xp: 0 } as any)),
      listUnlockedAchievements().catch(() => []),
      listSessions().catch(() => []),
    ]);
    const unlockedIds = new Set(unlocked.map((u) => u.achievementId));
    const currentLevel = levelForXp(state.xp);

    // Constrói lista mista de marcos: alterna levels e achievements em ordem
    // cronológica de "quando vira marco". Pra MVP, ordenamos: levels pela
    // threshold + achievements pela rarity.
    const list: Milestone[] = [];
    // Inserir os 6 níveis em ordem
    for (const lvl of LEVELS) {
      list.push({
        kind: 'level',
        level: lvl,
        reached: state.xp >= lvl.threshold,
        current: lvl.index === currentLevel.index,
      });
    }
    // Inserir achievements (filtra desbloqueados primeiro depois alguns trancados)
    const achList = [
      ...ACHIEVEMENTS.filter((a) => unlockedIds.has(a.id)),
      ...ACHIEVEMENTS.filter((a) => !unlockedIds.has(a.id)).slice(0, 8),
    ];
    for (const ach of achList) {
      list.push({
        kind: 'achievement',
        achievement: ach,
        unlocked: unlockedIds.has(ach.id),
        current: false,
      });
    }

    setXp(state.xp);
    setMilestones(list);
    setStats({
      sessions: sessions.length,
      achievements: unlocked.length,
      totalAchievements: ACHIEVEMENTS.length,
    });
    } finally {
      setLoading(false);
    }

    // Trigger anim
    reveal.value = 0;
    reveal.value = withTiming(1, {
      duration: 1400,
      easing: Easing.bezier(0.2, 0.7, 0.3, 1),
    });
  }, [reveal]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: reveal.value }],
  }));

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const currentLevel = levelForXp(xp);
  const progress = xpProgressInLevel(xp);

  return (
    <View style={s.root}>
      <ScreenHeader title="CARREIRA" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header: nível atual + XP */}
        <View style={s.headerCard}>
          <Text style={s.headerKicker}>NÍVEL ATUAL</Text>
          <Text style={s.headerLevel}>{currentLevel.name}</Text>
          <Text style={s.headerTitle}>{currentLevel.title}</Text>
          {progress.needed > 0 && (
            <>
              <View style={s.xpRow}>
                <Text style={s.xpLabel}>
                  {progress.earned} / {progress.needed} XP
                </Text>
                <Text style={s.xpLabel}>
                  {Math.round(progress.ratio * 100)}%
                </Text>
              </View>
              <View style={s.xpTrack}>
                <View style={[s.xpFill, { width: `${progress.ratio * 100}%` }]} />
              </View>
            </>
          )}

          <View style={s.statsRow}>
            <View style={s.stat}>
              <Text style={s.statValue}>{stats.sessions}</Text>
              <Text style={s.statLabel}>SESSÕES</Text>
            </View>
            <View style={s.stat}>
              <Text style={[s.statValue, typography.mono]}>
                {stats.achievements}/{stats.totalAchievements}
              </Text>
              <Text style={s.statLabel}>CONQUISTAS</Text>
            </View>
            <View style={s.stat}>
              <Text style={[s.statValue, typography.mono]}>{xp}</Text>
              <Text style={s.statLabel}>XP TOTAL</Text>
            </View>
          </View>
        </View>

        {/* Path com marcos */}
        <Text style={s.sectionTitle}>SUA JORNADA</Text>
        <View style={s.pathContainer}>
          {/* Linha vertical animada */}
          <Animated.View style={[s.pathLine, lineStyle]} />

          {milestones.map((m, i) => (
            <MilestoneNode key={i} milestone={m} index={i} reveal={reveal} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function MilestoneNode({
  milestone,
  index,
  reveal,
}: {
  milestone: Milestone;
  index: number;
  reveal: Animated.SharedValue<number>;
}) {
  const isActive =
    (milestone.kind === 'level' && milestone.current) ||
    (milestone.kind === 'achievement' && milestone.unlocked);

  const pulse = useSharedValue(0);
  // Pulse contínuo no nó atual
  useFocusEffect(useCallback(() => {
    if (milestone.kind === 'level' && milestone.current) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    }
    return () => {
      pulse.value = 0;
    };
  }, [milestone, pulse]));

  const itemStyle = useAnimatedStyle(() => {
    // Cada nó tem stagger de 150ms (em relação à reveal master)
    const start = Math.min(0.9, index * 0.04);
    const end = start + 0.15;
    const t = interpolate(reveal.value, [start, end], [0, 1], 'clamp');
    return {
      opacity: t,
      transform: [{ translateX: (1 - t) * 30 }],
    };
  });

  const ringStyle = useAnimatedStyle(() => {
    if (!(milestone.kind === 'level' && milestone.current)) return { opacity: 0 };
    return {
      opacity: 0.4 + pulse.value * 0.6,
      transform: [{ scale: 1 + pulse.value * 0.3 }],
    };
  });

  const reached =
    milestone.kind === 'level' ? milestone.reached : milestone.unlocked;

  return (
    <Animated.View style={[s.milestoneRow, itemStyle]}>
      {/* Nó (círculo) */}
      <View style={s.nodeWrap}>
        {milestone.kind === 'level' && milestone.current && (
          <Animated.View style={[s.nodeRing, ringStyle]} />
        )}
        <View
          style={[
            s.node,
            reached && s.nodeReached,
            isActive && s.nodeActive,
          ]}
        >
          <Text style={s.nodeIcon}>
            {milestone.kind === 'level' ? '◆' : milestone.achievement.icon}
          </Text>
        </View>
      </View>

      {/* Descrição */}
      <View style={s.milestoneText}>
        <Text style={[s.milestoneTitle, !reached && { color: colors.textMuted }]}>
          {milestone.kind === 'level'
            ? `Nível ${milestone.level.name}`
            : milestone.achievement.title}
        </Text>
        <Text style={s.milestoneSub}>
          {milestone.kind === 'level'
            ? milestone.level.title
            : milestone.achievement.description}
        </Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, paddingBottom: spacing.huge },

  headerCard: {
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    alignItems: 'center',
    marginBottom: spacing.l,
  },
  headerKicker: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  headerLevel: {
    color: colors.textPrimary,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 4,
  },
  headerTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing.m,
  },

  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 6,
  },
  xpLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  xpTrack: {
    width: '100%',
    height: 6,
    backgroundColor: colors.bg,
    borderRadius: 3,
    overflow: 'hidden',
  },
  xpFill: { height: '100%', backgroundColor: colors.primary },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: spacing.l,
  },
  stat: { alignItems: 'center' },
  statValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: spacing.m,
  },

  pathContainer: {
    position: 'relative',
    paddingLeft: 20,
  },
  pathLine: {
    position: 'absolute',
    left: 35,
    top: 0,
    bottom: 20,
    width: 2,
    backgroundColor: colors.primary,
    opacity: 0.4,
    transformOrigin: 'top',
  },

  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginBottom: spacing.l,
  },
  nodeWrap: { width: 32, alignItems: 'center', justifyContent: 'center' },
  nodeRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
  },
  node: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeReached: { borderColor: colors.primary + 'AA', backgroundColor: colors.primary + '22' },
  nodeActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  nodeIcon: { fontSize: 14 },

  milestoneText: { flex: 1 },
  milestoneTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  milestoneSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
});
