import { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  onFinish?: () => void;
  durationMs?: number;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const LIME = '#D4FF3A';
const WHITE = '#FFFFFF';
const BG = '#000000';

export function SplashLoader({ onFinish, durationMs = 2400 }: Props) {
  // "COPI" entra da esquerda; "LOT" entra da direita.
  const copiX = useSharedValue(-SCREEN_W);
  const copiSkew = useSharedValue(-25);
  const copiOpacity = useSharedValue(0);

  const lotX = useSharedValue(SCREEN_W);
  const lotSkew = useSharedValue(25);
  const lotOpacity = useSharedValue(0);

  // Acento lime sob o texto (cresce da esquerda).
  const accentScaleX = useSharedValue(0);

  // Subtítulo fade-in.
  const subOpacity = useSharedValue(0);

  // Speed lines (4 trilhas diagonais) — translação contínua em loop.
  const streak1 = useSharedValue(-SCREEN_W);
  const streak2 = useSharedValue(-SCREEN_W);
  const streak3 = useSharedValue(-SCREEN_W);
  const streak4 = useSharedValue(-SCREEN_W);

  // Barra de progresso.
  const progress = useSharedValue(0);

  useEffect(() => {
    // === Speed lines em loop (fundo) ===
    const startStreak = (sv: typeof streak1, duration: number, delay: number) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withTiming(SCREEN_W * 1.2, {
            duration,
            easing: Easing.linear,
          }),
          -1,
          false
        )
      );
    };
    startStreak(streak1, 900, 0);
    startStreak(streak2, 700, 150);
    startStreak(streak3, 1100, 80);
    startStreak(streak4, 800, 300);

    // === Texto COPI (esquerda) ===
    copiX.value = withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) });
    copiSkew.value = withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) });
    copiOpacity.value = withTiming(1, { duration: 280 });

    // === Texto LOT (direita) — chega um pouco depois ===
    lotX.value = withDelay(120, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }));
    lotSkew.value = withDelay(120, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }));
    lotOpacity.value = withDelay(120, withTiming(1, { duration: 280 }));

    // === Acento lime cresce ===
    accentScaleX.value = withDelay(
      680,
      withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) })
    );

    // === Subtítulo ===
    subOpacity.value = withDelay(900, withTiming(1, { duration: 420 }));

    // === Barra de progresso ===
    progress.value = withDelay(
      300,
      withTiming(1, { duration: durationMs - 300, easing: Easing.out(Easing.cubic) })
    );

    // Dispara o onFinish via setTimeout — mais robusto.
    const t = setTimeout(() => {
      onFinish?.();
    }, durationMs);

    return () => {
      clearTimeout(t);
      cancelAnimation(copiX);
      cancelAnimation(copiSkew);
      cancelAnimation(copiOpacity);
      cancelAnimation(lotX);
      cancelAnimation(lotSkew);
      cancelAnimation(lotOpacity);
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
    copiX,
    copiSkew,
    copiOpacity,
    lotX,
    lotSkew,
    lotOpacity,
    accentScaleX,
    subOpacity,
    streak1,
    streak2,
    streak3,
    streak4,
    progress,
  ]);

  const copiStyle = useAnimatedStyle(() => ({
    opacity: copiOpacity.value,
    transform: [{ translateX: copiX.value }, { skewX: `${copiSkew.value}deg` }],
  }));
  const lotStyle = useAnimatedStyle(() => ({
    opacity: lotOpacity.value,
    transform: [{ translateX: lotX.value }, { skewX: `${lotSkew.value}deg` }],
  }));
  const accentStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: accentScaleX.value }],
  }));
  const subStyle = useAnimatedStyle(() => ({ opacity: subOpacity.value }));
  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

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
        <Animated.View style={[styles.streak, { top: '20%', width: 180 }, streak1Style]} />
        <Animated.View
          style={[styles.streak, { top: '38%', width: 240, opacity: 0.5 }, streak2Style]}
        />
        <Animated.View
          style={[styles.streak, { top: '62%', width: 160, opacity: 0.7 }, streak3Style]}
        />
        <Animated.View
          style={[styles.streak, { top: '78%', width: 200, opacity: 0.45 }, streak4Style]}
        />
      </View>

      {/* Logo COPILOT */}
      <View style={styles.logoWrap}>
        <View style={styles.logoRow}>
          <Animated.Text style={[styles.logoText, styles.logoWhite, copiStyle]}>
            COPI
          </Animated.Text>
          <Animated.Text style={[styles.logoText, styles.logoLime, lotStyle]}>LOT</Animated.Text>
        </View>
        <Animated.View style={[styles.accent, accentStyle]} />
        <Animated.Text style={[styles.subtitle, subStyle]}>
          SEU MELHOR TEMPO. NOSSO PROPÓSITO.
        </Animated.Text>
      </View>

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
    backgroundColor: LIME,
    opacity: 0.6,
    shadowColor: LIME,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  logoWrap: {
    alignItems: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -2,
    fontStyle: 'italic',
  },
  logoWhite: {
    color: WHITE,
    textShadowColor: 'rgba(255,255,255,0.25)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  logoLime: {
    color: LIME,
    textShadowColor: LIME,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  accent: {
    width: 220,
    height: 3,
    backgroundColor: LIME,
    marginTop: 14,
    borderRadius: 2,
    shadowColor: LIME,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  subtitle: {
    color: '#E8E8E8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 4,
    marginTop: 18,
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
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: LIME,
    borderRadius: 2,
  },
});
