/**
 * Modal de celebração quando o piloto bate nova PB. Composição:
 *  - Brilho radial expandindo do centro (3 ondas concêntricas, loop 2s)
 *  - 36 partículas de confete explodindo radialmente (4 cores)
 *  - Tempo de volta entra com scale 0.4 → 1 (spring com bounce)
 *  - Stagger de 200ms entre kicker, tempo, delta pill, callouts e CTAs
 *
 * Disparado a partir da tela de recording quando salva uma sessão com nova
 * melhor volta. Self-contained: sem dependência de contexto externo.
 */

import React, { useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, Share } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing, typography } from '../../theme';

type Callout = { id: string; icon: string; label: string };

export type PbUnlockedProps = {
  visible: boolean;
  onClose: () => void;
  onContinue: () => void;
  /** PB novo em ms. */
  durationMs: number;
  /** Diferença vs PB anterior (negativo = melhorou). Null se 1ª PB. */
  deltaMs: number | null;
  /** Marcos extras: streak, sub-threshold, XP ganho. */
  callouts?: Callout[];
  /** Tempos S1/S2/S3 do PB pra mostrar embaixo. */
  sectors?: Array<{ label: string; ms: number; tone: 'pb' | 'best' }>;
};

function fmtLapBig(ms: number): string {
  const totalS = ms / 1000;
  return totalS.toFixed(3);
}

function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// 36 ângulos uniformes pra confete radial
const CONFETTI_ANGLES = Array.from({ length: 36 }, (_, i) => (i / 36) * Math.PI * 2);
const CONFETTI_COLORS = [
  colors.primary,
  colors.accentCyan,
  colors.accentMagenta,
  colors.warning,
];

export function PbUnlocked({
  visible,
  onClose,
  onContinue,
  durationMs,
  deltaMs,
  callouts = [],
  sectors = [],
}: PbUnlockedProps) {
  // Master progress — vai de 0 → 1 quando o modal abre. Tudo é derivado dela.
  const progress = useSharedValue(0);
  // Pulso ambiente (loops infinitos)
  const ambient = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: 1400, easing: Easing.bezier(0.2, 0.7, 0.3, 1) });
      ambient.value = 0;
      ambient.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }), -1, false);
    }
  }, [visible, progress, ambient]);

  // Animações derivadas em useMemo pra reusar em vários componentes
  const kickerStyle = useStaggeredFade(progress, 0.0, 0.15);
  const timeStyle = useScaleSpring(progress, 0.1);
  const deltaStyle = useStaggeredFade(progress, 0.3, 0.45);
  const calloutsStyle = useStaggeredFade(progress, 0.5, 0.65);
  const sectorsStyle = useStaggeredFade(progress, 0.7, 0.85);
  const ctasStyle = useStaggeredFade(progress, 0.85, 1.0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          {/* Ondas radiais de fundo */}
          <RadialWaves ambient={ambient} />
          {/* Confete */}
          <ConfettiBurst progress={progress} />

          {/* Botão fechar */}
          <Pressable style={s.closeBtn} onPress={onClose} hitSlop={10}>
            <Text style={s.closeText}>×</Text>
          </Pressable>

          {/* Kicker */}
          <Animated.View style={[s.kicker, kickerStyle]}>
            <Text style={s.kickerText}>★ NOVO RECORDE PESSOAL ★</Text>
          </Animated.View>

          {/* Tempo gigante */}
          <Animated.Text style={[s.bigTime, typography.mono, timeStyle]}>
            {fmtLapBig(durationMs)}
          </Animated.Text>

          {/* Delta pill */}
          {deltaMs != null && deltaMs < 0 && (
            <Animated.View style={[s.deltaPill, deltaStyle]}>
              <Text style={s.deltaArrow}>⚡</Text>
              <Text style={[s.deltaValue, typography.mono]}>
                {(deltaMs / 1000).toFixed(3)}s
              </Text>
              <Text style={s.deltaVs}>vs PB anterior</Text>
            </Animated.View>
          )}

          {/* Callouts (sub-thresholds, streak, XP) */}
          {callouts.length > 0 && (
            <Animated.View style={[s.callouts, calloutsStyle]}>
              {callouts.map((c) => (
                <View key={c.id} style={s.callout}>
                  <Text style={s.calloutIcon}>{c.icon}</Text>
                  <Text style={s.calloutLabel}>{c.label}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          {/* Setores */}
          {sectors.length > 0 && (
            <Animated.View style={[s.sectors, sectorsStyle]}>
              <Text style={s.sectorsLabel}>SETORES</Text>
              <View style={s.sectorsRow}>
                {sectors.map((sec, i) => (
                  <View key={i} style={s.sectorCell}>
                    <Text style={s.sectorTitle}>
                      {sec.label}  <Text style={{ color: sec.tone === 'pb' ? colors.primary : colors.success }}>
                        {sec.tone === 'pb' ? '● PB' : '● PB'}
                      </Text>
                    </Text>
                    <Text style={[s.sectorTime, typography.mono]}>{fmtLap(sec.ms).replace(/^0:/, '')}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* CTAs */}
          <Animated.View style={[s.ctas, ctasStyle]}>
            <Pressable
              onPress={async () => {
                try {
                  await Share.share({
                    message: `Acabei de bater ${fmtLap(durationMs)} no Cockpit! 🏁`,
                  });
                } catch {
                  /* silencioso */
                }
              }}
              style={({ pressed }) => [s.shareBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.shareBtnText}>⇪  COMPARTILHAR</Text>
            </Pressable>
            <Pressable
              onPress={onContinue}
              style={({ pressed }) => [s.continueBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.continueBtnText}>Continuar</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

// ===== Animações reutilizáveis =====

function useStaggeredFade(progress: SharedValue<number>, start: number, end: number) {
  return useAnimatedStyle(() => {
    const local = interpolate(progress.value, [start, end], [0, 1], 'clamp');
    return {
      opacity: local,
      transform: [{ translateY: (1 - local) * 12 }],
    };
  });
}

function useScaleSpring(progress: SharedValue<number>, start: number) {
  return useAnimatedStyle(() => {
    // Quando progress passa por `start`, a entrada começa
    const t = Math.max(0, Math.min(1, (progress.value - start) / 0.3));
    // Spring caseira: overshoot pequeno
    const scale = t < 1 ? interpolate(t, [0, 0.7, 1], [0.4, 1.08, 1]) : 1;
    return {
      opacity: t,
      transform: [{ scale }],
    };
  });
}

// ===== Sub-componentes =====

function RadialWaves({ ambient }: { ambient: SharedValue<number> }) {
  const wave1 = useAnimatedStyle(() => {
    const local = (ambient.value + 0.0) % 1;
    return { transform: [{ scale: 0.5 + local * 0.8 }], opacity: 0.4 * (1 - local) };
  });
  const wave2 = useAnimatedStyle(() => {
    const local = (ambient.value + 0.33) % 1;
    return { transform: [{ scale: 0.5 + local * 0.8 }], opacity: 0.3 * (1 - local) };
  });
  const wave3 = useAnimatedStyle(() => {
    const local = (ambient.value + 0.66) % 1;
    return { transform: [{ scale: 0.5 + local * 0.8 }], opacity: 0.2 * (1 - local) };
  });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Animated.View style={[s.wave, wave1]} />
      <Animated.View style={[s.wave, wave2]} />
      <Animated.View style={[s.wave, wave3]} />
    </View>
  );
}

function ConfettiBurst({ progress }: { progress: SharedValue<number> }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
      {CONFETTI_ANGLES.map((angle, i) => (
        <ConfettiParticle key={i} angle={angle} index={i} progress={progress} />
      ))}
    </View>
  );
}

function ConfettiParticle({
  angle,
  index,
  progress,
}: {
  angle: number;
  index: number;
  progress: SharedValue<number>;
}) {
  const distance = 140 + (index % 3) * 20;
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const style = useAnimatedStyle(() => {
    // Confete explode entre progress 0.1 e 0.7
    const local = interpolate(progress.value, [0.1, 0.7], [0, 1], 'clamp');
    const r = local * distance;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const opacity = interpolate(local, [0, 0.3, 1], [0, 1, 0]);
    const rotate = local * 720;
    return {
      opacity,
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${rotate}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: 8,
          height: 4,
          backgroundColor: color,
          borderRadius: 1,
        },
        style,
      ]}
    />
  );
}

// ===== Styles =====

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.l,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bg,
    borderRadius: 28,
    padding: spacing.xl,
    paddingTop: spacing.huge,
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primary + '55',
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

  wave: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -200,
    marginTop: -200,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: colors.primary + '22',
  },

  kicker: { marginBottom: spacing.s },
  kickerText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  bigTime: {
    color: colors.textPrimary,
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -2,
    marginVertical: spacing.s,
  },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.m,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: spacing.l,
  },
  deltaArrow: { color: colors.textOnPrimary, fontSize: 13 },
  deltaValue: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '900' },
  deltaVs: { color: colors.textOnPrimary, fontSize: 11, fontWeight: '700', opacity: 0.8 },

  callouts: {
    flexDirection: 'row',
    gap: spacing.s,
    marginBottom: spacing.l,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  callout: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: 14,
    alignItems: 'center',
    minWidth: 80,
  },
  calloutIcon: { fontSize: 18, marginBottom: 2 },
  calloutLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },

  sectors: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
    padding: spacing.m,
    marginBottom: spacing.l,
  },
  sectorsLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: spacing.s,
    textAlign: 'center',
  },
  sectorsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  sectorCell: { alignItems: 'center' },
  sectorTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', marginBottom: 2 },
  sectorTime: { color: colors.primary, fontSize: 16, fontWeight: '900' },

  ctas: { flexDirection: 'row', gap: spacing.s, width: '100%' },
  shareBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  shareBtnText: { color: colors.textOnPrimary, fontWeight: '900', letterSpacing: 0.5 },
  continueBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.m,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  continueBtnText: { color: colors.textPrimary, fontWeight: '700' },
});
