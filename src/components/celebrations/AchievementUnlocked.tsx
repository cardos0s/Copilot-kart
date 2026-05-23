/**
 * Modal de conquista desbloqueada — bottom sheet que sobe com a medalha,
 * faz um shine sweep (gradiente passando) e revela texto sequencial.
 *
 * Composição:
 *   - Card sobe de fora da tela com cubic-bezier (~600ms)
 *   - Medalha entra com scale + rotate(-30deg → 0) spring
 *   - Shine sweep: gradiente em ~60° passa por cima da medalha 1.4s depois
 *   - Texto e estatísticas fazem fade sequencial
 *
 * Pode encadear vários se o piloto desbloqueou múltiplas conquistas numa
 * sessão — caller controla via `currentIndex` / `totalCount`.
 */

import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Achievement } from '../../lib/gamification';
import { colors, radius, spacing } from '../../theme';

export type AchievementUnlockedProps = {
  visible: boolean;
  onClose: () => void;
  achievement: Achievement | null;
  /** Quando há múltiplas conquistas, mostrar "1 de 3". */
  currentIndex?: number;
  totalCount?: number;
};

const RARITY_COLORS: Record<Achievement['rarity'], { ring: string; bg: string; label: string }> = {
  common: { ring: colors.textSecondary, bg: colors.surface, label: 'COMUM' },
  rare: { ring: colors.accentCyan, bg: colors.accentCyan + '15', label: 'RARO' },
  epic: { ring: colors.accentPurple, bg: colors.accentPurple + '15', label: 'ÉPICO' },
  legendary: { ring: colors.warning, bg: colors.warning + '15', label: 'LENDÁRIO' },
};

export function AchievementUnlocked({
  visible,
  onClose,
  achievement,
  currentIndex,
  totalCount,
}: AchievementUnlockedProps) {
  const slideUp = useSharedValue(0);
  const shineX = useSharedValue(-1);

  useEffect(() => {
    if (visible) {
      slideUp.value = 0;
      slideUp.value = withTiming(1, {
        duration: 700,
        easing: Easing.bezier(0.18, 0.7, 0.3, 1),
      });
      // Shine começa depois que o card já tá no lugar (~1.4s atraso)
      shineX.value = -1;
      shineX.value = withDelay(
        1400,
        withTiming(1, { duration: 900, easing: Easing.bezier(0.4, 0, 0.6, 1) })
      );
    }
  }, [visible, achievement?.id, slideUp, shineX]);

  if (!achievement) return null;

  const rarity = RARITY_COLORS[achievement.rarity];

  const cardStyle = useAnimatedStyle(() => ({
    opacity: slideUp.value,
    transform: [
      { translateY: interpolate(slideUp.value, [0, 1], [400, 0]) },
    ],
  }));

  const medalStyle = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, (slideUp.value - 0.3) / 0.5));
    const scale = t < 1 ? interpolate(t, [0, 0.7, 1], [0.4, 1.12, 1]) : 1;
    const rotate = interpolate(t, [0, 1], [-30, 0]);
    return {
      opacity: t,
      transform: [{ scale }, { rotate: `${rotate}deg` }],
    };
  });

  const textStyle = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, (slideUp.value - 0.65) / 0.35));
    return { opacity: t, transform: [{ translateY: (1 - t) * 8 }] };
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Animated.View style={[s.sheet, cardStyle]}>
          {/* Pull handle */}
          <View style={s.handle} />

          {/* Counter (1 de 3) se houver múltiplas */}
          {totalCount && totalCount > 1 && (
            <Text style={s.counter}>
              {currentIndex! + 1} de {totalCount}
            </Text>
          )}

          {/* Kicker */}
          <Text style={[s.kicker, { color: rarity.ring }]}>
            ✦ CONQUISTA · {rarity.label} ✦
          </Text>

          {/* Medal com shine */}
          <View style={s.medalContainer}>
            <Animated.View
              style={[
                s.medal,
                {
                  borderColor: rarity.ring,
                  backgroundColor: rarity.bg,
                  shadowColor: rarity.ring,
                },
                medalStyle,
              ]}
            >
              <Text style={s.medalIcon}>{achievement.icon}</Text>
              <Shine progress={shineX} />
            </Animated.View>
          </View>

          {/* Title + description */}
          <Animated.View style={[{ alignItems: 'center' }, textStyle]}>
            <Text style={s.title}>{achievement.title}</Text>
            <Text style={s.description}>{achievement.description}</Text>
          </Animated.View>

          {/* CTA */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.ctaText}>
              {totalCount && currentIndex! + 1 < totalCount
                ? 'Próxima conquista'
                : 'Continuar'}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Shine({ progress }: { progress: SharedValue<number> }) {
  // Gradient passa de left → right ao longo do progress -1 → 1.
  // Está clipado pelo border do medal (overflow hidden).
  const style = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [-1, 0, 1], [0, 1, 0]);
    return {
      opacity,
      transform: [{ translateX: progress.value * 120 }, { rotate: '15deg' }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[s.shineWrap, style]}>
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.5)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={s.shineGradient}
      />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.m,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.m,
  },
  counter: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: spacing.s,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.5,
    marginBottom: spacing.l,
  },

  medalContainer: {
    height: 140,
    width: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medal: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  },
  medalIcon: { fontSize: 64 },
  shineWrap: {
    position: 'absolute',
    top: -20,
    left: -100,
    bottom: -20,
    width: 80,
  },
  shineGradient: { flex: 1 },

  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    marginTop: spacing.l,
    marginBottom: spacing.s,
    textAlign: 'center',
  },
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: spacing.m,
    marginBottom: spacing.xl,
  },

  cta: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  ctaText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
});
