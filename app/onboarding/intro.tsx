import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing, radius } from '../../src/theme';

const ACCENT = '#2F6BFF';
const ACCENT_DIM = '#1E49B5';
const LIME = colors.primary;

const STEPS = [
  {
    tag: 'PASSO 1',
    title: 'Telemetria que você sente',
    desc: 'Velocidade, RPM e aceleração capturados em tempo real e traduzidos em algo que dá pra ler de relance.',
    cta: 'Continuar',
  },
  {
    tag: 'PASSO 2',
    title: 'Um copiloto que pensa por volta',
    desc: 'A IA estuda cada setor e te diz exatamente onde ganhar tempo — em segundos, não em achismo.',
    cta: 'Continuar',
  },
  {
    tag: 'PASSO 3',
    title: 'Corra contra o seu melhor',
    desc: 'O fantasma da sua melhor volta anda junto com você. Bata o recorde e veja a evolução sessão a sessão.',
    cta: 'Começar',
  },
];

// ============================================================================
// Passo 1 — velocímetro animado
// ============================================================================

function StepGauge() {
  const rot = useSharedValue(-82);
  const b1 = useSharedValue(0);
  const b2 = useSharedValue(0);
  const b3 = useSharedValue(0);
  const [kmh, setKmh] = useState(0);

  useEffect(() => {
    rot.value = withDelay(180, withTiming(36, { duration: 1000, easing: Easing.out(Easing.cubic) }));
    b1.value = withDelay(320, withTiming(0.85, { duration: 700 }));
    b2.value = withDelay(400, withTiming(0.68, { duration: 700 }));
    b3.value = withDelay(480, withTiming(0.52, { duration: 700 }));

    let raf = 0;
    const start = Date.now();
    const dur = 1000;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      setKmh(Math.round(92 * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const to = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, 180);
    return () => {
      clearTimeout(to);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rot, b1, b2, b3]);

  const needleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const bar1 = useAnimatedStyle(() => ({ width: `${b1.value * 100}%` }));
  const bar2 = useAnimatedStyle(() => ({ width: `${b2.value * 100}%` }));
  const bar3 = useAnimatedStyle(() => ({ width: `${b3.value * 100}%` }));

  return (
    <View style={g.wrap}>
      <View style={g.gaugeBox}>
        <Svg width={236} height={140} viewBox="0 0 236 140">
          <Defs>
            <LinearGradient id="ga" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={ACCENT_DIM} />
              <Stop offset="1" stopColor="#4F95FF" />
            </LinearGradient>
          </Defs>
          <Path d="M22 126 A96 96 0 0 1 214 126" stroke="#1b1b27" strokeWidth={14} fill="none" strokeLinecap="round" />
          <Path d="M22 126 A96 96 0 0 1 214 126" stroke="url(#ga)" strokeWidth={14} fill="none" strokeLinecap="round" strokeDasharray="218 400" />
          <Circle cx={118} cy={126} r={9} fill="#FFFFFF" />
          <Circle cx={118} cy={126} r={4} fill={ACCENT} />
        </Svg>
        <Animated.View style={[g.needle, needleStyle]} />
        <View style={g.readout}>
          <Text style={g.kmh}>{kmh}</Text>
          <Text style={g.unit}>km/h</Text>
        </View>
      </View>

      <View style={g.bars}>
        {[
          { label: 'RPM', s: bar1, c: ACCENT },
          { label: 'ACEL', s: bar2, c: LIME },
          { label: 'TEMP', s: bar3, c: ACCENT },
        ].map((row) => (
          <View key={row.label} style={g.barRow}>
            <Text style={g.barLabel}>{row.label}</Text>
            <View style={g.barTrack}>
              <Animated.View style={[g.barFill, { backgroundColor: row.c }, row.s]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ============================================================================
// Passo 2 — traçado + dica da IA
// ============================================================================

function StepCoach() {
  const pop = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    pop.value = withDelay(450, withTiming(1, { duration: 440, easing: Easing.out(Easing.back(1.4)) }));
    pulse.value = withRepeat(
      withSequence(withTiming(1.4, { duration: 750 }), withTiming(1, { duration: 750 })),
      -1,
      true
    );
  }, [pop, pulse]);

  const tipStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: 0.8 + pop.value * 0.2 }, { translateY: (1 - pop.value) * 12 }],
  }));
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <View style={c.wrap}>
      <Svg width={280} height={170} viewBox="0 0 280 170">
        <Defs>
          <LinearGradient id="tg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#4F95FF" />
            <Stop offset="1" stopColor={ACCENT_DIM} />
          </LinearGradient>
        </Defs>
        <Path
          d="M48 120 C20 70 70 36 120 50 C160 60 150 92 188 88 C232 84 252 40 244 96 C238 138 176 150 128 132 C88 118 76 156 48 120 Z"
          stroke="url(#tg)"
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Animated.View style={[c.dotGlow, dotStyle]} />
      <View style={c.dot} />
      <Animated.View style={[c.tip, tipStyle]}>
        <View style={c.aiChip}>
          <Text style={c.aiChipText}>IA</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={c.tipText}>Freie 12 m mais tarde na curva 4</Text>
          <Text style={c.tipGain}>−8,4s / volta</Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ============================================================================
// Passo 3 — fantasma da melhor volta
// ============================================================================

function StepGhost() {
  const enter = useSharedValue(0);
  const shimmer = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(180, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
    shimmer.value = withRepeat(
      withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })),
      -1,
      true
    );
  }, [enter, shimmer]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.86 + enter.value * 0.14 }],
  }));
  const ghostDotStyle = useAnimatedStyle(() => ({ opacity: 0.35 + shimmer.value * 0.5 }));

  return (
    <View style={gh.wrap}>
      <Animated.View style={[gh.card, cardStyle]}>
        <Text style={gh.badge}>SUA MELHOR VOLTA</Text>
        <Text style={gh.lap}>1:38.21</Text>
        <View style={gh.legend}>
          <View style={gh.legendItem}>
            <View style={[gh.legendDot, { backgroundColor: ACCENT }]} />
            <Text style={gh.legendText}>VOCÊ</Text>
          </View>
          <View style={gh.legendItem}>
            <Animated.View style={[gh.legendDot, { backgroundColor: colors.textMuted }, ghostDotStyle]} />
            <Text style={gh.legendText}>FANTASMA</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ============================================================================
// Tela principal
// ============================================================================

export default function OnboardingIntro() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);

  const goToCadastro = () => router.push('/onboarding/name');

  const advance = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else goToCadastro();
  };

  const data = STEPS[step];

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.m }]}>
      {/* Topo: dots + pular */}
      <View style={s.topBar}>
        <View style={s.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[s.dot, i === step && s.dotActive]} />
          ))}
        </View>
        <Pressable hitSlop={12} onPress={goToCadastro}>
          <Text style={s.skip}>Pular</Text>
        </Pressable>
      </View>

      {/* Ilustração (toque avança) */}
      <Pressable style={s.illuArea} onPress={advance}>
        <Animated.View key={`illu-${step}`} entering={FadeIn.duration(320)} style={s.illuInner}>
          {step === 0 && <StepGauge />}
          {step === 1 && <StepCoach />}
          {step === 2 && <StepGhost />}
        </Animated.View>
      </Pressable>

      {/* Texto */}
      <Animated.View key={`txt-${step}`} entering={FadeIn.duration(320)} style={s.textArea}>
        <Text style={s.tag}>{data.tag}</Text>
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.desc}>{data.desc}</Text>
      </Animated.View>

      {/* Botão */}
      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        <Pressable
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          onPress={advance}
        >
          <Text style={s.buttonText}>{data.cta}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 32,
  },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  dotActive: { width: 22, backgroundColor: ACCENT },
  skip: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  illuArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  illuInner: { alignItems: 'center', justifyContent: 'center' },
  textArea: { marginBottom: spacing.l },
  tag: { color: ACCENT, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    letterSpacing: -0.3,
    marginTop: spacing.s,
    lineHeight: 28,
  },
  desc: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.m },
  footer: { paddingTop: spacing.s },
  button: {
    backgroundColor: ACCENT,
    borderRadius: radius.m,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

const g = StyleSheet.create({
  wrap: { alignItems: 'center', width: 280 },
  gaugeBox: { width: 236, height: 140, alignItems: 'center', justifyContent: 'flex-start' },
  needle: {
    position: 'absolute',
    left: 116,
    top: 44,
    width: 4,
    height: 82,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    transformOrigin: '50% 100%',
  },
  readout: { position: 'absolute', top: 70, alignItems: 'center', width: '100%' },
  kmh: { color: colors.textPrimary, fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  unit: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: -2 },
  bars: { width: 220, marginTop: spacing.l, gap: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  barLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, width: 38 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.bgElevated, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
});

const c = StyleSheet.create({
  wrap: { width: 280, height: 200, alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    left: 184,
    top: 80,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: LIME,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  dotGlow: {
    position: 'absolute',
    left: 178,
    top: 74,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(212,255,58,0.25)',
  },
  tip: {
    position: 'absolute',
    left: 60,
    top: 116,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    maxWidth: 220,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.m,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  aiChip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiChipText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  tipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  tipGain: { color: LIME, fontSize: 12, fontWeight: '800', marginTop: 2 },
});

const gh = StyleSheet.create({
  wrap: { width: 280, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: 240,
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  badge: { color: LIME, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  lap: {
    color: colors.textPrimary,
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: spacing.s,
  },
  legend: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.l },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
});
