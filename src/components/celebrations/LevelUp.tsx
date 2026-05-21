/**
 * Modal de level up — disparado quando o XP cruza o threshold de um novo
 * nível (Cadete → S1 → S2 → ...).
 *
 * Composição:
 *   - Linhas radiais girando lentamente no fundo (24s loop linear)
 *   - Hexágono SVG materializando com scale 0.4 → 1 spring + glow
 *   - Texto "LEVEL UP" e nome do nível com fonte Playfair (premium)
 *   - Barra de progresso de XP com clip reveal da esquerda (1.4s)
 *   - Lista de unlocks faz fade-up sequencial
 *
 * Self-contained — recebe o nível alvo, o XP atual/necessário, e a lista
 * de recursos desbloqueados pra mostrar.
 */

import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';
import { Level } from '../../lib/gamification';
import { colors, radius, spacing, typography } from '../../theme';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

export type Unlock = { icon: string; title: string; subtitle: string };

export type LevelUpProps = {
  visible: boolean;
  onClose: () => void;
  level: Level;
  xpCurrent: number;
  xpNeeded: number; // pra próximo nível (0 se é o máximo)
  unlocks: Unlock[];
};

export function LevelUp({
  visible,
  onClose,
  level,
  xpCurrent,
  xpNeeded,
  unlocks,
}: LevelUpProps) {
  const progress = useSharedValue(0);
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: 1800,
        easing: Easing.bezier(0.2, 0.7, 0.3, 1),
      });
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, { duration: 24000, easing: Easing.linear }),
        -1,
        false
      );
    }
  }, [visible, progress, rotation]);

  const hexStyle = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, (progress.value - 0.15) / 0.4));
    // Spring caseira com pequeno overshoot
    const scale = t < 1 ? interpolate(t, [0, 0.7, 1], [0.4, 1.08, 1]) : 1;
    return { opacity: t, transform: [{ scale }] };
  });

  const titleStyle = useStaggeredFade(progress, 0.0, 0.15);
  const subtitleStyle = useStaggeredFade(progress, 0.55, 0.7);
  const progressStyle = useStaggeredFade(progress, 0.7, 0.85);
  const unlocksStyle = useStaggeredFade(progress, 0.85, 1.0);

  const ratio = xpNeeded > 0 ? Math.min(1, xpCurrent / xpNeeded) : 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <RadialRays rotation={rotation} />

          <Pressable style={s.closeBtn} onPress={onClose} hitSlop={10}>
            <Text style={s.closeText}>×</Text>
          </Pressable>

          {/* Title */}
          <Animated.Text style={[s.kicker, titleStyle]}>★ LEVEL UP ★</Animated.Text>

          {/* Hexágono central */}
          <Animated.View style={[s.hexWrap, hexStyle]}>
            <Hexagon size={220} color={colors.primary} glow />
            <View style={s.hexLabel} pointerEvents="none">
              <Text style={s.hexNivelLabel}>NÍVEL</Text>
              <Text style={s.hexNivelName}>{level.name}</Text>
            </View>
          </Animated.View>

          {/* Welcome */}
          <Animated.Text style={[s.welcome, subtitleStyle]}>
            Bem-vindo, {level.title}.
          </Animated.Text>

          {/* XP bar */}
          {xpNeeded > 0 && (
            <Animated.View style={[s.xpBlock, progressStyle]}>
              <View style={s.xpRow}>
                <Text style={s.xpLabel}>{level.name} · {level.title.toUpperCase()}</Text>
                <Text style={[s.xpValue, typography.mono]}>
                  {xpCurrent} / {xpNeeded} XP
                </Text>
              </View>
              <View style={s.xpTrack}>
                <View style={[s.xpFill, { width: `${ratio * 100}%` }]} />
              </View>
            </Animated.View>
          )}

          {/* Unlocks */}
          {unlocks.length > 0 && (
            <Animated.View style={[s.unlocksCard, unlocksStyle]}>
              <Text style={s.unlocksLabel}>DESBLOQUEADO</Text>
              {unlocks.map((u, i) => (
                <View key={i} style={s.unlockRow}>
                  <View style={s.unlockIcon}>
                    <Text style={s.unlockIconText}>{u.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.unlockTitle}>{u.title}</Text>
                    <Text style={s.unlockSub}>{u.subtitle}</Text>
                  </View>
                </View>
              ))}
            </Animated.View>
          )}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.ctaText}>EXPLORAR NOVOS RECURSOS</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ===== Sub-componentes =====

function Hexagon({ size, color, glow }: { size: number; color: string; glow?: boolean }) {
  // 6 vértices distribuídos em 60° começando do topo
  const r = size / 2;
  const cx = r;
  const cy = r;
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r * 0.85 * Math.cos(angle);
    const y = cy + r * 0.85 * Math.sin(angle);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <Svg width={size} height={size}>
      {glow && (
        <Polygon points={points} fill={color} fillOpacity={0.08} />
      )}
      <Polygon
        points={points}
        fill="transparent"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      {/* Inner hex (dashed) */}
      <Polygon
        points={points
          .split(' ')
          .map((p) => {
            const [x, y] = p.split(',').map(Number);
            const dx = x - cx;
            const dy = y - cy;
            return `${(cx + dx * 0.85).toFixed(2)},${(cy + dy * 0.85).toFixed(2)}`;
          })
          .join(' ')}
        fill="transparent"
        stroke={color}
        strokeOpacity={0.35}
        strokeWidth={1.5}
        strokeDasharray="6,4"
      />
    </Svg>
  );
}

function RadialRays({ rotation }: { rotation: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  // 18 raios distribuídos
  const rays = Array.from({ length: 18 }, (_, i) => (i / 18) * 360);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, style, { alignItems: 'center', justifyContent: 'center' }]}>
      {rays.map((deg, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: 1,
            height: 600,
            backgroundColor: colors.primary,
            opacity: 0.08,
            transform: [{ rotate: `${deg}deg` }],
          }}
        />
      ))}
    </Animated.View>
  );
}

function useStaggeredFade(progress: SharedValue<number>, start: number, end: number) {
  return useAnimatedStyle(() => {
    const local = interpolate(progress.value, [start, end], [0, 1], 'clamp');
    return {
      opacity: local,
      transform: [{ translateY: (1 - local) * 12 }],
    };
  });
}

// ===== Styles =====

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.bg,
    borderRadius: 28,
    padding: spacing.xl,
    paddingTop: spacing.huge,
    alignItems: 'center',
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  closeText: { color: colors.textSecondary, fontSize: 20, lineHeight: 22 },

  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    marginBottom: spacing.m,
  },

  hexWrap: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.l,
  },
  hexLabel: {
    position: 'absolute',
    alignItems: 'center',
  },
  hexNivelLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
  },
  hexNivelName: {
    color: colors.textPrimary,
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: -4,
  },

  welcome: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: colors.textPrimary,
    fontSize: 24,
    textAlign: 'center',
    marginVertical: spacing.m,
  },

  xpBlock: {
    width: '100%',
    marginTop: spacing.s,
    marginBottom: spacing.l,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  xpLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  xpValue: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  xpTrack: {
    height: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },

  unlocksCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
    padding: spacing.m,
    marginBottom: spacing.l,
  },
  unlocksLabel: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: spacing.s,
  },
  unlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  unlockIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primary + '22',
    borderWidth: 1,
    borderColor: colors.primary + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockIconText: { fontSize: 18 },
  unlockTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  unlockSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  cta: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  ctaText: {
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
});
