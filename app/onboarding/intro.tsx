import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
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
  },
  {
    tag: 'PASSO 2',
    title: 'Um copiloto que pensa por volta',
    desc: 'A IA estuda cada setor e te diz exatamente onde ganhar tempo — em segundos, não em achismo.',
  },
  {
    tag: 'PASSO 3',
    title: 'Corra contra o seu melhor',
    desc: 'O fantasma da sua melhor volta anda junto com você. Bata o recorde e veja a evolução sessão a sessão.',
  },
];

// ============================================================================
// Passo 1 — velocímetro (ponteiro vivo, número abaixo do arco)
// ============================================================================

function StepGauge() {
  const rot = useSharedValue(-82);
  const b1 = useSharedValue(0);
  const b2 = useSharedValue(0);
  const b3 = useSharedValue(0);
  const [kmh, setKmh] = useState(0);

  useEffect(() => {
    // Entrada + oscilação contínua (ponteiro "vivo").
    rot.value = withDelay(
      180,
      withSequence(
        withTiming(36, { duration: 900, easing: Easing.out(Easing.cubic) }),
        withRepeat(
          withSequence(
            withTiming(45, { duration: 620 }),
            withTiming(28, { duration: 720 }),
            withTiming(38, { duration: 560 })
          ),
          -1,
          false
        )
      )
    );

    const live = (sv: typeof b1, base: number) =>
      withDelay(
        320,
        withSequence(
          withTiming(base, { duration: 700, easing: Easing.out(Easing.cubic) }),
          withRepeat(
            withSequence(
              withTiming(base - 0.07, { duration: 650 }),
              withTiming(base + 0.06, { duration: 650 })
            ),
            -1,
            true
          )
        )
      );
    b1.value = live(b1, 0.85);
    b2.value = live(b2, 0.68);
    b3.value = live(b3, 0.52);

    // Contador vivo: sobe até 92, depois flutua suave.
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const e = Date.now() - start;
      if (e < 1000) {
        setKmh(Math.round(92 * (1 - Math.pow(1 - e / 1000, 3))));
      } else {
        setKmh(92 + Math.round(Math.sin(e / 240) * 3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rot, b1, b2, b3]);

  const needleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const bar1 = useAnimatedStyle(() => ({ width: `${b1.value * 100}%` }));
  const bar2 = useAnimatedStyle(() => ({ width: `${b2.value * 100}%` }));
  const bar3 = useAnimatedStyle(() => ({ width: `${b3.value * 100}%` }));

  return (
    <View style={g.wrap}>
      <View style={g.gaugeBox}>
        <Svg width={236} height={132} viewBox="0 0 236 132">
          <Defs>
            <LinearGradient id="ga" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={ACCENT_DIM} />
              <Stop offset="1" stopColor="#4F95FF" />
            </LinearGradient>
          </Defs>
          <Path d="M22 124 A96 96 0 0 1 214 124" stroke="#1b1b27" strokeWidth={14} fill="none" strokeLinecap="round" />
          <Path d="M22 124 A96 96 0 0 1 214 124" stroke="url(#ga)" strokeWidth={14} fill="none" strokeLinecap="round" strokeDasharray="214 400" />
          <Circle cx={118} cy={124} r={9} fill="#FFFFFF" />
          <Circle cx={118} cy={124} r={4} fill={ACCENT} />
        </Svg>
        <Animated.View style={[g.needle, needleStyle]} />
      </View>

      <View style={g.readout}>
        <Text style={g.kmh}>{kmh}</Text>
        <Text style={g.unit}>km/h</Text>
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
// Passo 3 — você x fantasma correndo na pista
// ============================================================================

// Circuito curvado: pontos-âncora suavizados com Catmull-Rom. Gera o path do
// desenho E uma amostragem densa de pontos pros marcadores seguirem a curva.
const TRACK_PTS = [
  [130, 26], [182, 34], [222, 68], [208, 108], [162, 126],
  [112, 120], [72, 128], [38, 96], [48, 58], [88, 40],
];

function buildTrack(pts: number[][], seg: number) {
  const n = pts.length;
  const xs: number[] = [];
  const ys: number[] = [];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]}`;
    for (let s = 0; s < seg; s++) {
      const t = s / seg;
      const mt = 1 - t;
      xs.push(mt * mt * mt * p1[0] + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * p2[0]);
      ys.push(mt * mt * mt * p1[1] + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * p2[1]);
    }
  }
  d += ' Z';
  xs.push(xs[0]);
  ys.push(ys[0]);
  return { d, xs, ys };
}

const TRACK = buildTrack(TRACK_PTS, 9);
const TRACK_X = TRACK.xs;
const TRACK_Y = TRACK.ys;
const TRACK_IN = TRACK_X.map((_, i) => i / (TRACK_X.length - 1));
const MARK = 13;

function StepGhost() {
  const t = useSharedValue(0);
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    t.value = withRepeat(withTiming(1, { duration: 4600, easing: Easing.linear }), -1, false);
  }, [t, enter]);

  const youStyle = useAnimatedStyle(() => {
    const x = interpolate(t.value, TRACK_IN, TRACK_X);
    const y = interpolate(t.value, TRACK_IN, TRACK_Y);
    return { opacity: enter.value, transform: [{ translateX: x - MARK / 2 }, { translateY: y - MARK / 2 }] };
  });
  const ghostStyle = useAnimatedStyle(() => {
    'worklet';
    let tf = t.value - 0.085;
    if (tf < 0) tf += 1;
    const x = interpolate(tf, TRACK_IN, TRACK_X);
    const y = interpolate(tf, TRACK_IN, TRACK_Y);
    return { opacity: enter.value * 0.8, transform: [{ translateX: x - MARK / 2 }, { translateY: y - MARK / 2 }] };
  });
  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.92 + enter.value * 0.08 }],
  }));

  return (
    <View style={gh.wrap}>
      <View style={gh.trackBox}>
        <Svg width={260} height={156} viewBox="0 0 260 156">
          <Path d={TRACK.d} stroke="#23232f" strokeWidth={16} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Path d={TRACK.d} stroke="#3a3a48" strokeWidth={1.5} fill="none" strokeDasharray="2 9" />
        </Svg>

        {/* Tempo no centro da pista */}
        <Animated.View style={[gh.center, cardStyle]} pointerEvents="none">
          <Text style={gh.badge}>SUA MELHOR VOLTA</Text>
          <Text style={gh.lap}>1:38.21</Text>
        </Animated.View>

        {/* Fantasma (atrás) e você (na frente) correndo */}
        <Animated.View style={[gh.marker, gh.ghost, ghostStyle]} />
        <Animated.View style={[gh.marker, gh.you, youStyle]} />
      </View>

      <View style={gh.legend}>
        <View style={gh.legendItem}>
          <View style={[gh.legendDot, { backgroundColor: ACCENT }]} />
          <Text style={gh.legendText}>VOCÊ</Text>
        </View>
        <View style={gh.legendItem}>
          <View style={[gh.legendDot, { backgroundColor: colors.textMuted }]} />
          <Text style={gh.legendText}>FANTASMA</Text>
        </View>
      </View>
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
    if (step < STEPS.length - 1) setStep((sp) => sp + 1);
    else goToCadastro();
  };

  const data = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Pressable style={[s.root, { paddingTop: insets.top + spacing.m }]} onPress={advance}>
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

      {/* Ilustração */}
      <View style={s.illuArea}>
        <Animated.View key={`illu-${step}`} entering={FadeIn.duration(320)} style={s.illuInner}>
          {step === 0 && <StepGauge />}
          {step === 1 && <StepCoach />}
          {step === 2 && <StepGhost />}
        </Animated.View>
      </View>

      {/* Texto */}
      <Animated.View key={`txt-${step}`} entering={FadeIn.duration(320)} style={s.textArea}>
        <Text style={s.tag}>{data.tag}</Text>
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.desc}>{data.desc}</Text>
      </Animated.View>

      {/* Dica de toque (no lugar do botão) */}
      <View style={[s.hintWrap, { paddingBottom: insets.bottom + spacing.l }]}>
        <Text style={s.hint}>{last ? 'Toque para começar' : 'Toque para continuar'}</Text>
      </View>
    </Pressable>
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
  hintWrap: { alignItems: 'center', paddingTop: spacing.s },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});

const g = StyleSheet.create({
  wrap: { alignItems: 'center', width: 280 },
  gaugeBox: { width: 236, height: 132 },
  needle: {
    position: 'absolute',
    left: 116,
    top: 48,
    width: 4,
    height: 76,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    transformOrigin: '50% 100%',
  },
  readout: { flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.s },
  kmh: { color: colors.textPrimary, fontSize: 40, fontWeight: '900', letterSpacing: -1, lineHeight: 42 },
  unit: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginLeft: 6, marginBottom: 6 },
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
    left: 181,
    top: 96,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: LIME,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  dotGlow: {
    position: 'absolute',
    left: 175,
    top: 90,
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
  wrap: { width: 280, alignItems: 'center' },
  trackBox: { width: 260, height: 156 },
  center: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 50,
    alignItems: 'center',
  },
  badge: { color: LIME, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  lap: { color: colors.textPrimary, fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 2 },
  marker: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  you: { backgroundColor: ACCENT },
  ghost: { backgroundColor: colors.textMuted },
  legend: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.l },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
});
