import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { KartMark } from './ui/KartMark';
import { colors, fonts } from '../theme';

type Props = {
  /** Quando o app terminou de carregar. A splash cobre o carregamento — não o alonga. */
  appReady?: boolean;
  onFinish?: () => void;
};

/** O design foi medido sobre uma tela de 390 × 844. */
const DESIGN_W = 390;
const DESIGN_H = 844;

/**
 * Ajuste fino do conjunto kart + nome. 1 é o tamanho do handoff; baixar daqui
 * encolhe os dois juntos e mantém a relação entre eles. É o único número a
 * mexer se a composição ainda parecer grande no device.
 */
const COMPOSITION_SCALE = 1;

const KART_W = Math.round(176 * COMPOSITION_SCALE);
const KART_H = Math.round(KART_W * (456 / 659));
const WORDMARK_SIZE = Math.round(46 * COMPOSITION_SCALE);
const KART_TOP = 306;
const GROUND_TOP = 424;
/**
 * Derivado, não fixado à parte: travar os dois valores separadamente já causou
 * sobreposição quando a arte trocou.
 */
const NAME_TOP = KART_TOP + KART_H + 22;

/** Fim da sequência. Depois disso a splash sai de qualquer jeito. */
const SEQUENCE_MS = 2300;
/**
 * Piso de exibição. O handoff pede que a splash não atrase a abertura, mas
 * cortar assim que o perfil e as fontes resolvem (~300 ms) engoliria a entrada
 * do kart. 1,6 s é a duração que o próprio handoff nomeia: o kart já chegou,
 * freou e o nome está na tela.
 */
const MIN_VISIBLE_MS = 1600;
/** Troca de tela. */
const EXIT_MS = 220;

const SMOKE_STOP_MS = 1150;
const NAME_DELAY_MS = 1020;
/** De quanto o lockup sobe ao entrar. */
const NAME_RISE = 14;

const EASE_KART = Easing.bezier(0.2, 0.75, 0.28, 1);
const EASE_IN = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * Seis baforadas em ciclo contínuo, emitidas atrás da roda traseira.
 * Os valores são deliberadamente irregulares: se as seis compartilharem
 * duração, o conjunto pulsa em bloco e denuncia que é animação.
 */
const PUFFS = [
  { size: 54, dx: -74, dy: -30, duration: 1300, delay: 0 },
  { size: 40, dx: -58, dy: -17, duration: 1100, delay: 160 },
  { size: 64, dx: -92, dy: -40, duration: 1550, delay: 320 },
  { size: 44, dx: -66, dy: -9, duration: 1200, delay: 480 },
  { size: 58, dx: -84, dy: -28, duration: 1400, delay: 640 },
  { size: 36, dx: -52, dy: -20, duration: 1000, delay: 800 },
];

function Puff({ size, dx, dy, duration, delay }: (typeof PUFFS)[number]) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false)
    );
    return () => cancelAnimation(t);
  }, [t, duration, delay]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.12, 1], [0, 0.5, 0]),
    transform: [
      { translateX: interpolate(t.value, [0, 1], [0, dx]) },
      { translateY: interpolate(t.value, [0, 1], [0, dy]) },
      { scale: interpolate(t.value, [0, 1], [0.28, 1]) },
    ],
  }));

  const gradientId = `puff${size}`;

  return (
    <Animated.View
      style={[{ position: 'absolute', left: -size / 2, top: -size / 2 }, style]}
      pointerEvents="none"
    >
      <Svg width={size} height={size}>
        <Defs>
          {/* radial-gradient(circle at 42% 40%, …) — o raio 0.834 é a distância
              até o canto mais distante, que é o padrão do CSS. */}
          <RadialGradient id={gradientId} cx="0.42" cy="0.40" r="0.834">
            <Stop offset="0" stopColor="#78808C" stopOpacity="0.72" />
            <Stop offset="0.46" stopColor="#78808C" stopOpacity="0.34" />
            <Stop offset="0.72" stopColor="#78808C" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
}

export function SplashLoader({ appReady = false, onFinish }: Props) {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  /**
   * Layout inteiro numa caixa de design escalada — mantém as proporções
   * medidas. O teto de 1 é o que importa: as medidas do handoff são pontos
   * absolutos, então em tela maior que 390 × 844 a composição fica do tamanho
   * desenhado e sobra respiro. Sem o teto, um Pro Max inflava tudo em ~13%.
   */
  const scale = Math.min(1, screenW / DESIGN_W, screenH / DESIGN_H);
  const offsetY = (screenH - DESIGN_H * scale) / 2;

  /** O kart parado não solta fumaça: a emissão precisa parar quando ele freia. */
  const [emitting, setEmitting] = useState(true);
  const finished = useRef(false);
  const mountedAt = useRef(Date.now());

  const kartX = useSharedValue(-250);
  const kartTilt = useSharedValue(0);
  const groundOpacity = useSharedValue(1);
  const groundDraw = useSharedValue(0);
  const smokeOpacity = useSharedValue(1);
  const smokeBurst = useSharedValue(1);
  const nameY = useSharedValue(NAME_RISE);
  const nameOpacity = useSharedValue(0);
  const lockupScale = useSharedValue(0.96);
  const ruleScale = useSharedValue(0);
  const numberY = useSharedValue(NAME_RISE);
  const numberOpacity = useSharedValue(0);
  const exitOpacity = useSharedValue(1);

  useEffect(() => {
    kartX.value = withTiming(0, { duration: 1050, easing: EASE_KART });

    // Mergulho de freada: o nariz afunda quando ele para e volta assentando.
    // É o mesmo gesto que a especificação já descreve ao dizer que a emissão
    // de fumaça precisa parar "quando ele freia" — só que visível.
    kartTilt.value = withDelay(
      820,
      withSequence(
        withTiming(2.2, { duration: 190, easing: Easing.out(Easing.quad) }),
        withTiming(-0.7, { duration: 260, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 320, easing: EASE_IN })
      )
    );

    // A linha de solo é traçada pelo kart em vez de já estar lá: cresce da
    // esquerda junto com ele, e só então começa a sumir.
    groundDraw.value = withTiming(1, { duration: 1050, easing: EASE_KART });
    groundOpacity.value = withDelay(550, withTiming(0, { duration: 1600, easing: Easing.linear }));

    nameOpacity.value = withDelay(NAME_DELAY_MS, withTiming(1, { duration: 550, easing: EASE_IN }));
    nameY.value = withDelay(NAME_DELAY_MS, withTiming(0, { duration: 550, easing: EASE_IN }));
    lockupScale.value = withDelay(
      NAME_DELAY_MS,
      withTiming(1, { duration: 620, easing: EASE_IN })
    );

    ruleScale.value = withDelay(1160, withTiming(1, { duration: 450, easing: EASE_IN }));

    numberOpacity.value = withDelay(1200, withTiming(1, { duration: 500, easing: EASE_IN }));
    numberY.value = withDelay(1200, withTiming(0, { duration: 500, easing: EASE_IN }));

    // A freada chuta uma última golfada antes de a emissão parar.
    smokeBurst.value = withDelay(
      860,
      withSequence(
        withTiming(1.32, { duration: 240, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 400, easing: Easing.linear })
      )
    );

    // O que já está no ar se dissolve; a emissão para junto.
    smokeOpacity.value = withDelay(
      SMOKE_STOP_MS,
      withTiming(0, { duration: 450, easing: Easing.linear })
    );
    const stop = setTimeout(() => setEmitting(false), SMOKE_STOP_MS + 450);

    return () => {
      clearTimeout(stop);
      cancelAnimation(kartX);
      cancelAnimation(kartTilt);
      cancelAnimation(groundOpacity);
      cancelAnimation(groundDraw);
      cancelAnimation(smokeOpacity);
      cancelAnimation(smokeBurst);
      cancelAnimation(nameY);
      cancelAnimation(nameOpacity);
      cancelAnimation(lockupScale);
      cancelAnimation(ruleScale);
      cancelAnimation(numberY);
      cancelAnimation(numberOpacity);
    };
  }, [
    kartX,
    kartTilt,
    groundOpacity,
    groundDraw,
    smokeOpacity,
    smokeBurst,
    nameY,
    nameOpacity,
    lockupScale,
    ruleScale,
    numberY,
    numberOpacity,
  ]);

  // Sai no piso de exibição se o app já carregou, e no fim da sequência caso
  // contrário — o que vier depois manda.
  useEffect(() => {
    const leave = () => {
      if (finished.current) return;
      finished.current = true;
      exitOpacity.value = withTiming(
        0,
        { duration: EXIT_MS, easing: Easing.out(Easing.quad) },
        (done) => {
          if (done && onFinish) runOnJS(onFinish)();
        }
      );
    };

    const elapsed = Date.now() - mountedAt.current;
    const waitFor = appReady
      ? Math.max(0, MIN_VISIBLE_MS - elapsed)
      : Math.max(0, SEQUENCE_MS - elapsed);
    const t = setTimeout(leave, waitFor);
    return () => clearTimeout(t);
  }, [appReady, exitOpacity, onFinish]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: exitOpacity.value }));
  const kartStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: kartX.value }, { rotateZ: `${kartTilt.value}deg` }],
  }));
  const groundStyle = useAnimatedStyle(() => ({
    opacity: groundOpacity.value,
    transform: [{ scaleX: groundDraw.value }],
  }));
  const smokeStyle = useAnimatedStyle(() => ({
    opacity: smokeOpacity.value,
    transform: [{ scale: smokeBurst.value }],
  }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameY.value }],
  }));
  const lockupStyle = useAnimatedStyle(() => ({
    transform: [{ scale: lockupScale.value }],
  }));
  const ruleStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: ruleScale.value }] }));
  const numberStyle = useAnimatedStyle(() => ({
    opacity: numberOpacity.value,
    transform: [{ translateY: numberY.value }],
  }));

  return (
    <Animated.View style={[styles.root, rootStyle]}>
      {/* Linha de solo — sangra a largura toda, fora da caixa de design. */}
      <Animated.View
        style={[styles.ground, { top: offsetY + GROUND_TOP * scale }, groundStyle]}
        pointerEvents="none"
      />

      <View
        style={[
          styles.stage,
          {
            width: DESIGN_W,
            height: DESIGN_H,
            left: (screenW - DESIGN_W * scale) / 2,
            top: offsetY,
            transform: [{ scale }],
          },
        ]}
        pointerEvents="none"
      >
        <View style={[styles.centerRow, { top: KART_TOP }]}>
          <Animated.View style={[{ width: KART_W, height: KART_H }, kartStyle]}>
            {/* Emitida atrás da roda traseira. */}
            <Animated.View
              style={[styles.smokeOrigin, { top: KART_H * 0.68 }, smokeStyle]}
              pointerEvents="none"
            >
              {emitting && PUFFS.map((p, i) => <Puff key={i} {...p} />)}
            </Animated.View>
            <KartMark width={KART_W} height={KART_H} />
          </Animated.View>
        </View>

        <View style={[styles.centerRow, { top: NAME_TOP }]}>
          <Animated.View style={[styles.lockup, lockupStyle]}>
            <Animated.Text style={[styles.word, nameStyle]}>COCKPIT</Animated.Text>
            <View style={styles.numberRow}>
              <Animated.View
                style={[styles.rule, { transformOrigin: 'right center' }, ruleStyle]}
              />
              <Animated.Text style={[styles.number, numberStyle]}>219</Animated.Text>
              <Animated.View
                style={[styles.rule, { transformOrigin: 'left center' }, ruleStyle]}
              />
            </View>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  ground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.10)',
    // Cresce da esquerda, no rastro do kart.
    transformOrigin: 'left center',
  },
  stage: {
    position: 'absolute',
    transformOrigin: 'left top',
  },
  centerRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  smokeOrigin: {
    // Fica atrás do kart pela ordem de render — zIndex negativo é irregular
    // no Android.
    position: 'absolute',
    left: 10,
    width: 0,
    height: 0,
  },
  lockup: {
    alignItems: 'center',
  },
  word: {
    fontFamily: fonts.wordmark,
    fontSize: WORDMARK_SIZE,
    // Folga vertical: lineHeight igual ao fontSize corta as extremidades do
    // glifo no RN, e no Android o padding de fonte ainda come mais um pedaço.
    lineHeight: Math.round(WORDMARK_SIZE * 1.22),
    includeFontPadding: false,
    letterSpacing: WORDMARK_SIZE * -0.035,
    // O itálico avança para fora da caixa que o RN mede, e é isso que decepa
    // o T final. O padding devolve o espaço que a inclinação ocupa.
    paddingHorizontal: Math.ceil(WORDMARK_SIZE * 0.18),
    textAlign: 'center',
    color: colors.ink,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 5,
  },
  rule: {
    width: 32,
    height: 1.5,
    // Sobre branco vale o azul cheio: o azul claro dá 2,48:1 e sai lavado.
    backgroundColor: colors.blue,
  },
  number: {
    fontFamily: fonts.monoMedium,
    fontSize: 17,
    letterSpacing: 5.1, // 0.3em
    paddingLeft: 5.1, // compensa o tracking do último caractere
    color: colors.blue,
  },
});
