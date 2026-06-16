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

// Fundo claro pra casar com a arte (mesmo tom do splash nativo) → handoff suave.
const BG = '#F2F5F8';
// Azul de corrida da própria arte (barra de progresso).
const BLUE = '#1C8FE5';

// Arte do splash. PRECISA existir em assets/splash-cockpit219.png.
const ART = require('../../assets/splash-cockpit219.png');

export function SplashLoader({ onFinish, durationMs = 2600 }: Props) {
  // Imagem: fade-in + Ken Burns (zoom suave que vai assentando).
  // O zoom começa um pouco maior que o logo nativo (~340pt) e "abre" pra tela
  // cheia, dando continuidade ao frame estático do splash nativo.
  const imgOpacity = useSharedValue(0);
  const imgScale = useSharedValue(1.14);

  // Brilho diagonal varrendo a arte.
  const sweepX = useSharedValue(-SCREEN_W * 0.7);

  // Barra de progresso.
  const progress = useSharedValue(0);

  useEffect(() => {
    // === Imagem entra ===
    imgOpacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
    imgScale.value = withTiming(1, { duration: durationMs, easing: Easing.out(Easing.cubic) });

    // === Brilho diagonal (varre 2x) ===
    sweepX.value = withDelay(
      600,
      withRepeat(
        withTiming(SCREEN_W * 1.5, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        2,
        false
      )
    );

    // === Barra de progresso ===
    progress.value = withDelay(
      250,
      withTiming(1, { duration: durationMs - 250, easing: Easing.out(Easing.cubic) })
    );

    const t = setTimeout(() => {
      onFinish?.();
    }, durationMs);

    return () => {
      clearTimeout(t);
      cancelAnimation(imgOpacity);
      cancelAnimation(imgScale);
      cancelAnimation(sweepX);
      cancelAnimation(progress);
    };
  }, [durationMs, onFinish, imgOpacity, imgScale, sweepX, progress]);

  const imgStyle = useAnimatedStyle(() => ({
    opacity: imgOpacity.value,
    transform: [{ scale: imgScale.value }],
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweepX.value }, { skewX: '-22deg' }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View style={styles.root}>
      {/* Arte principal (cobre a tela) */}
      <Animated.Image source={ART} resizeMode="cover" style={[styles.art, imgStyle]} />

      {/* Brilho diagonal varrendo */}
      <View style={styles.sweepLayer} pointerEvents="none">
        <Animated.View style={[styles.sweep, sweepStyle]} />
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
    overflow: 'hidden',
  },
  art: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  sweepLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  sweep: {
    position: 'absolute',
    top: -SCREEN_H * 0.1,
    height: SCREEN_H * 1.2,
    width: 90,
    backgroundColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  barWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: SCREEN_H * 0.06,
    alignItems: 'center',
  },
  barTrack: {
    width: '52%',
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: BLUE,
    borderRadius: 2,
  },
});
