/**
 * Coach IA flutuante — estilo AssistiveTouch da Apple.
 *
 * Estados:
 *   - Idle: círculo translúcido com glyph "✦" + anéis pulsando quando há
 *     insights pendentes + badge vermelho com contador
 *   - Drag: o piloto segura e arrasta. Ao soltar, snap pra borda mais próxima
 *     com spring (esquerda ou direita)
 *   - Open: tap abre painel completo num Modal com BlurView de fundo. Modal
 *     mostra o insight ativo + mini-map + ações + navegação pra próximo
 *
 * Pra aparecer numa tela, basta renderizar `<FloatingCoach />` no JSX dela
 * (em qualquer posição, ele usa absolute positioning).
 *
 * Self-contained: lê fila via useCoachInsights, gerencia posição local com
 * AsyncStorage pra persistir o canto entre sessions (no MVP, em memória).
 */

import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CoachInsight,
  dismissCoachInsight,
  useCoachInsights,
} from '../lib/coachInsights';
import { useCoachFloatingEnabled } from '../storage/preferences';
import { colors, radius, spacing, typography } from '../theme';

const BUTTON_SIZE = 56;
const SAFE_TOP = 80;
const SAFE_BOTTOM = 120;

export function FloatingCoach() {
  const [enabled] = useCoachFloatingEnabled();
  const insights = useCoachInsights();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Toggle desativado nas configurações — esconde por completo.
  if (!enabled) return null;

  const { width: screenW, height: screenH } = Dimensions.get('window');
  const x = useSharedValue(screenW - BUTTON_SIZE - 16);
  const y = useSharedValue(screenH - SAFE_BOTTOM - BUTTON_SIZE);
  const pulse = useSharedValue(0);

  const hasInsights = insights.length > 0;

  // Pulse anel quando há insights novos
  useEffect(() => {
    if (hasInsights) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    } else {
      pulse.value = 0;
    }
  }, [hasInsights, pulse]);

  // Reset índice ativo se mudar lista
  useEffect(() => {
    if (activeIdx >= insights.length) setActiveIdx(0);
  }, [insights.length, activeIdx]);

  // Gesto: arrasta + snap pra borda no release
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      // Snap horizontal pra borda mais próxima
      const targetX = x.value + BUTTON_SIZE / 2 < screenW / 2 ? 16 : screenW - BUTTON_SIZE - 16;
      x.value = withSpring(targetX, { damping: 14, stiffness: 180 });
      // Clamp vertical pra safe area
      const targetY = Math.max(SAFE_TOP, Math.min(screenH - SAFE_BOTTOM - BUTTON_SIZE, y.value));
      y.value = withSpring(targetY, { damping: 14, stiffness: 180 });
    });

  const tap = Gesture.Tap()
    .maxDistance(8)
    .onEnd(() => {
      runOnJS(setOpen)(true);
    });

  // Pan + Tap como composta (tap só dispara se não arrastar muito)
  const composed = Gesture.Race(pan, tap);

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  const ringStyle = useAnimatedStyle(() => {
    if (!hasInsights) return { opacity: 0, transform: [{ scale: 1 }] };
    return {
      opacity: 0.5 * (1 - pulse.value),
      transform: [{ scale: 1 + pulse.value * 1.6 }],
    };
  });
  const ring2Style = useAnimatedStyle(() => {
    if (!hasInsights) return { opacity: 0, transform: [{ scale: 1 }] };
    const offset = (pulse.value + 0.5) % 1;
    return {
      opacity: 0.4 * (1 - offset),
      transform: [{ scale: 1 + offset * 1.6 }],
    };
  });

  const active = insights[activeIdx] ?? null;

  return (
    <>
      {/* Botão idle (fica sempre montado, escondido se sem insights e fechado) */}
      <GestureDetector gesture={composed}>
        <Animated.View style={[s.bubble, buttonStyle]} pointerEvents="auto">
          {/* Anéis de pulso */}
          <Animated.View style={[s.ring, ringStyle]} />
          <Animated.View style={[s.ring, ring2Style]} />

          {/* Círculo do botão */}
          <View style={s.button}>
            <Text style={s.glyph}>✦</Text>
          </View>

          {/* Badge contador */}
          {insights.length > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{insights.length}</Text>
            </View>
          )}
        </Animated.View>
      </GestureDetector>

      {/* Modal painel expandido */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.modalRoot}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          <PanelContent
            insight={active}
            currentIdx={activeIdx}
            totalCount={insights.length}
            onClose={() => setOpen(false)}
            onNext={() => setActiveIdx((i) => (i + 1) % Math.max(insights.length, 1))}
            onDismiss={() => {
              if (active) {
                dismissCoachInsight(active.id);
                if (insights.length === 1) setOpen(false);
              }
            }}
          />
        </View>
      </Modal>
    </>
  );
}

// ===== Painel expandido =====

function PanelContent({
  insight,
  currentIdx,
  totalCount,
  onClose,
  onNext,
  onDismiss,
}: {
  insight: CoachInsight | null;
  currentIdx: number;
  totalCount: number;
  onClose: () => void;
  onNext: () => void;
  onDismiss: () => void;
}) {
  // Entrada do painel: scale + opacidade
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = 0;
    enter.value = withTiming(1, {
      duration: 350,
      easing: Easing.bezier(0.2, 0.7, 0.3, 1),
    });
  }, [insight?.id, enter]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: interpolate(enter.value, [0, 1], [0.88, 1]) }],
  }));

  if (!insight) {
    return (
      <Animated.View style={[s.panel, panelStyle]} pointerEvents="auto">
        <View style={s.panelInner}>
          <Text style={s.kicker}>★ COACH IA</Text>
          <Text style={s.title}>Sem insights novos</Text>
          <Text style={s.body}>
            Termine uma sessão pra eu analisar e sugerir onde ganhar tempo.
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.primaryBtnText}>Fechar</Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[s.panel, panelStyle]} pointerEvents="auto">
      <LinearGradient
        colors={[colors.primary + '15', 'transparent', colors.primary + '08']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.panelInner}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.kicker}>★ COACH IA</Text>
          {totalCount > 1 && (
            <Text style={s.counter}>
              {currentIdx + 1} / {totalCount}
            </Text>
          )}
        </View>

        {/* Sugestão */}
        <Text style={s.title}>{insight.title}</Text>
        {insight.metric && (
          <Text style={[s.metric, typography.mono]}>{insight.metric}</Text>
        )}
        <Text style={s.body}>{insight.body}</Text>

        {/* Mini-map placeholder — em versão futura, render do traçado real */}
        {insight.sectorRef && (
          <View style={s.minimap}>
            <Text style={s.minimapHint}>Hotspot: {insight.sectorRef.label}</Text>
          </View>
        )}

        {/* Ações rápidas */}
        <View style={s.actionsRow}>
          <ActionPill icon="↻" label="Replay" />
          <ActionPill icon="✓" label="Salvar" />
          <ActionPill icon="⏰" label="Lembrar" />
        </View>

        {/* Footer: navegação entre fila */}
        <View style={s.footer}>
          <View style={s.dotsRow}>
            {Array.from({ length: totalCount }).map((_, i) => (
              <View
                key={i}
                style={[s.dot, i === currentIdx && s.dotActive]}
              />
            ))}
          </View>
          {totalCount > 1 ? (
            <Pressable
              onPress={onNext}
              style={({ pressed }) => [s.nextBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.nextBtnText}>PRÓXIMA</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [s.nextBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.nextBtnText}>DISPENSAR</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

function ActionPill({ icon, label }: { icon: string; label: string }) {
  return (
    <Pressable
      style={({ pressed }) => [s.pill, pressed && { opacity: 0.7 }]}
    >
      <Text style={s.pillIcon}>{icon}</Text>
      <Text style={s.pillLabel}>{label}</Text>
    </Pressable>
  );
}

// ===== Styles =====

const s = StyleSheet.create({
  // Botão flutuante
  bubble: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  ring: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: 'rgba(47, 107, 255, 0.18)',
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  glyph: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: '900',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '900',
  },

  // Modal painel
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'rgba(16, 16, 24, 0.92)',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primary + '55',
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  panelInner: {
    padding: spacing.l,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.m,
  },
  kicker: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  counter: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },

  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    marginBottom: spacing.s,
  },
  metric: {
    color: colors.primary,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: spacing.s,
    textShadowColor: colors.primary + '88',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.l,
  },

  minimap: {
    height: 90,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.l,
  },
  minimapHint: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },

  actionsRow: {
    flexDirection: 'row',
    gap: spacing.s,
    marginBottom: spacing.l,
  },
  pill: {
    flex: 1,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    alignItems: 'center',
    gap: 4,
  },
  pillIcon: { color: colors.textPrimary, fontSize: 16 },
  pillLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dotsRow: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.primary, width: 18 },
  nextBtn: {
    paddingVertical: 8,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  nextBtnText: {
    color: colors.textOnPrimary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },

  primaryBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
});
