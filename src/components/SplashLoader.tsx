import { useEffect } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  onFinish?: () => void;
  durationMs?: number;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const BG = '#000000';
const BLUE = '#1C8FE5';
const WHITE = '#F4F4F4';

export function SplashLoader({ onFinish, durationMs = 2600 }: Props) {
  // Logo: slam-in (entra grande, assenta com leve overshoot).
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(1.25);

  // Flash azul no impacto.
  const flashOpacity = useSharedValue(0);

  // Acento azul (linha que cresce sob o COCKPIT).
  const accentScaleX = useSharedValue(0);

  // "219" entra logo depois do impacto.
  const subOpacity = useSharedValue(0);

  // Speed lines azuis (4 trilhas diagonais em loop).
  const streak1 = useSharedValue(-SCREEN_W);
  const streak2 = useSharedValue(-SCREEN_W);
  const streak3 = useSharedValue(-SCREEN_W);
  const streak4 = useSharedValue(-SCREEN_W);

  // Barra de progresso.
  const progress = useSharedValue(0);

  useEffect(() => {
    const startStreak = (sv: typeof streak1, duration: number, delay: number) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withTiming(SCREEN_W * 1.3, { duration, easing: Easing.linear }),
          -1,
          false
        )
      );
    };
    startStreak(streak1, 850, 0);
    startStreak(streak2, 680, 150);
    startStreak(streak3, 1050, 80);
    startStreak(streak4, 760, 280);

    // Logo slam-in
    logoOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    logoScale.value = withTiming(1, { duration: 560, easing: Easing.out(Easing.back(1.6)) });

    // Flash azul no impacto
    flashOpacity.value = withSequence(
      withTiming(0.45, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) })
    );

    // Acento + "219"
    accentScaleX.value = withDelay(
      400,
      withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) })
    );
    subOpacity.value = withDelay(560, withTiming(1, { duration: 380 }));

    // Barra de progresso
    progress.value = withDelay(
      300,
      withTiming(1, { duration: durationMs - 300, easing: Easing.out(Easing.cubic) })
    );

    const t = setTimeout(() => {
      onFinish?.();
    }, durationMs);

    return () => {
      clearTimeout(t);
      cancelAnimation(logoOpacity);
      cancelAnimation(logoScale);
      cancelAnimation(flashOpacity);
      cancelAnimation(accentScaleX);
      cancelAnimation(subOpacity);
      cancelAnimation(streak1);
      cancelAnimation(streak2);
      cancelAnimation(streak3);
      cancelAnimation(streak4);
      cancelAnimation(progress);
    };
  }, [
    durationMs,
    onFinish,
    logoOpacity,
    logoScale,
    flashOpacity,
    accentScaleX,
    subOpacity,
    streak1,
    streak2,
    streak3,
    streak4,
    progress,
  ]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));
  const accentStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: accentScaleX.value }] }));
  const subStyle = useAnimatedStyle(() => ({ opacity: subOpacity.value }));
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const streak1Style = useAnimatedStyle(() => ({
    transform: [{ translateX: streak1.value }, { skewX: '-20deg' }],
  }));
  const streak2Style = useAnimatedStyle(() => ({
    transform: [{ translateX: streak2.value }, { skewX: '-20deg' }],
  }));
  const streak3Style = useAnimatedStyle(() => ({
    transform: [{ translateX: streak3.value }, { skewX: '-20deg' }],
  }));
  const streak4Style = useAnimatedStyle(() => ({
    transform: [{ translateX: streak4.value }, { skewX: '-20deg' }],
  }));

  return (
    <View style={styles.root}>
      {/* Speed lines (fundo) */}
      <View style={styles.streaksLayer} pointerEvents="none">
        <Animated.View style={[styles.streak, { top: '22%', width: 200 }, streak1Style]} />
        <Animated.View
          style={[styles.streak, { top: '40%', width: 280, opacity: 0.5 }, streak2Style]}
        />
        <Animated.View
          style={[styles.streak, { top: '64%', width: 180, opacity: 0.7 }, streak3Style]}
        />
        <Animated.View
          style={[styles.streak, { top: '80%', width: 240, opacity: 0.45 }, streak4Style]}
        />
      </View>

      {/* Logo COCKPIT 219 (texto nativo, pesado + itálico) */}
      <Animated.View style={[styles.center, logoStyle]}>
        <Text style={styles.word}>COCKPIT</Text>
        <Animated.View style={[styles.accent, accentStyle]} />
        <Animated.View style={[styles.row, subStyle]}>
          <Text style={styles.chev}>‹‹‹</Text>
          <Text style={styles.num}>219</Text>
          <Text style={styles.chev}>›››</Text>
        </Animated.View>
      </Animated.View>

      {/* Flash azul no impacto */}
      <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none" />

      {/* Barra de progresso */}
      <View style={styles.barWrapper} pointerEvents="none">
        <View style={styles.barTrack}>
          <Animated.View style={[styles.barFill, fillStyle]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  streaksLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  streak: {
    position: 'absolute',
    left: 0,
    height: 3,
    backgroundColor: BLUE,
    opacity: 0.6,
    shadowColor: BLUE,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  center: {
    alignItems: 'center',
  },
  word: {
    color: WHITE,
    fontSize: 56,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -2,
    textShadowColor: 'rgba(28,143,229,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  accent: {
    width: 200,
    height: 4,
    backgroundColor: BLUE,
    marginTop: 10,
    borderRadius: 2,
    shadowColor: BLUE,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 12,
  },
  chev: {
    color: BLUE,
    fontSize: 22,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -2,
  },
  num: {
    color: BLUE,
    fontSize: 30,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 2,
    textShadowColor: 'rgba(28,143,229,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BLUE,
  },
  barWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: SCREEN_H * 0.08,
    alignItems: 'center',
  },
  barTrack: {
    width: '52%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: BLUE,
    borderRadius: 2,
  },
});
