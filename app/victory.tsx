import { useEffect, useMemo } from 'react';
import { Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '../src/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const LIME = colors.accentLime;
const BLUE = colors.racingBlue;
const CONFETTI_COLORS = [LIME, BLUE, colors.accentMagenta, colors.accentCyan, '#F5C84B', '#FFFFFF'];

// Raios do sunburst (atrás do avatar).
const SUN = Array.from({ length: 16 }, (_, k) => {
  const a = (k * 22.5 * Math.PI) / 180;
  return {
    x1: 70 + 46 * Math.cos(a),
    y1: 70 + 46 * Math.sin(a),
    x2: 70 + 64 * Math.cos(a),
    y2: 70 + 64 * Math.sin(a),
    color: k % 2 === 0 ? LIME : BLUE,
  };
});

function ConfettiPiece({ cfg }: { cfg: { x: number; color: string; size: number; delay: number; duration: number; drift: number } }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(cfg.delay, withRepeat(withTiming(1, { duration: cfg.duration, easing: Easing.linear }), -1, false));
  }, [t, cfg.delay, cfg.duration]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: -30 + t.value * (SCREEN_H * 0.75) },
      { translateX: Math.sin(t.value * Math.PI * 3) * cfg.drift },
      { rotate: `${t.value * 720}deg` },
    ],
    opacity: t.value < 0.08 ? t.value / 0.08 : t.value > 0.88 ? (1 - t.value) / 0.12 : 1,
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', left: cfg.x, top: 0, width: cfg.size, height: cfg.size * 0.6, backgroundColor: cfg.color, borderRadius: 2 }, style]}
    />
  );
}

export default function Victory() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{
    name?: string; kart?: string; position?: string; lap?: string; points?: string; bateria?: string; track?: string;
  }>();

  const name = p.name ?? 'JU SANTOS';
  const kart = p.kart ?? '219';
  const position = p.position ?? 'P1';
  const lap = p.lap ?? '42.18';
  const points = p.points ?? '+128';
  const bateria = p.bateria ?? 'Bateria 3';
  const track = p.track ?? 'Speedland';

  const burstRot = useSharedValue(0);
  const avatarScale = useSharedValue(0);
  const titleScale = useSharedValue(1.35);
  const titleOpacity = useSharedValue(0);

  useEffect(() => {
    burstRot.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.linear }), -1, false);
    titleOpacity.value = withDelay(150, withTiming(1, { duration: 300 }));
    titleScale.value = withDelay(150, withTiming(1, { duration: 420, easing: Easing.out(Easing.back(1.6)) }));
    avatarScale.value = withDelay(350, withSpring(1, { damping: 9, stiffness: 130 }));
  }, [burstRot, avatarScale, titleScale, titleOpacity]);

  const pieces = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        x: Math.random() * SCREEN_W,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 7,
        delay: Math.random() * 1600,
        duration: 2400 + Math.random() * 2000,
        drift: 18 + Math.random() * 46,
      })),
    []
  );

  const burstStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${burstRot.value * 360}deg` }] }));
  const avatarStyle = useAnimatedStyle(() => ({ transform: [{ scale: avatarScale.value }] }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value, transform: [{ scale: titleScale.value }] }));

  const handleShare = () => {
    Share.share({
      message: `Venci a ${bateria} em ${track}! 🏆 ${position} · melhor volta ${lap} · ${points} pts. — ${name} #${kart} no Cockpit 🏁`,
    }).catch(() => {});
  };

  return (
    <View style={s.root}>
      {/* Bandeira quadriculada no topo */}
      <View style={[s.flag, { height: insets.top + 18 }]} pointerEvents="none">
        {Array.from({ length: 22 }).map((_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: i % 2 === 0 ? '#0c0c10' : '#e8e8e8' }} />
        ))}
      </View>

      {/* Confete */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {pieces.map((cfg, i) => (
          <ConfettiPiece key={i} cfg={cfg} />
        ))}
      </View>

      <View style={[s.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + spacing.l }]}>
        <Text style={s.kicker}>{bateria.toUpperCase()} · {track.toUpperCase()}</Text>
        <Animated.Text style={[s.title, titleStyle]}>VOCÊ VENCEU!</Animated.Text>

        {/* Sunburst + avatar com coroa */}
        <View style={s.avatarArea}>
          <Animated.View style={[StyleSheet.absoluteFill, s.burstWrap, burstStyle]}>
            <Svg width={140} height={140} viewBox="0 0 140 140">
              {SUN.map((l, i) => (
                <Line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={3} strokeLinecap="round" />
              ))}
            </Svg>
          </Animated.View>
          <Animated.View style={avatarStyle}>
            <Svg width={120} height={120} viewBox="0 0 120 120">
              {/* corpo */}
              <Path d="M34 60 Q34 36 60 36 Q86 36 86 60 L86 82 Q86 96 72 96 L48 96 Q34 96 34 82 Z" fill="#0d1322" stroke="#22314f" strokeWidth={2} />
              {/* visor */}
              <Path d="M44 58 Q60 50 78 58 L78 68 Q60 62 44 68 Z" fill={BLUE} />
              {/* coroa */}
              <Path d="M42 34 L49 20 L60 30 L71 20 L78 34 Z" fill="#F5C84B" stroke="#caa23a" strokeWidth={1.5} strokeLinejoin="round" />
              <Rect x={42} y={33} width={36} height={6} rx={2} fill="#F5C84B" />
              <Circle cx={60} cy={30} r={3} fill={LIME} />
            </Svg>
          </Animated.View>
        </View>

        <Text style={s.name}>
          {name.toUpperCase()} <Text style={s.kart}>#{kart}</Text>
        </Text>

        {/* 3 cards */}
        <Animated.View style={s.cards} entering={FadeInDown.delay(600).duration(450)}>
          <Stat label="POSIÇÃO" value={position} color={LIME} />
          <Stat label="MELHOR VOLTA" value={lap} color={colors.textPrimary} />
          <Stat label="PONTOS" value={points} color={colors.success} />
        </Animated.View>

        <View style={{ flex: 1 }} />

        {/* Ações */}
        <Animated.View entering={FadeInDown.delay(800).duration(450)} style={s.actions}>
          <Pressable style={({ pressed }) => [s.shareBtn, pressed && { opacity: 0.9 }]} onPress={handleShare}>
            <Text style={s.shareText}>COMPARTILHAR VITÓRIA</Text>
          </Pressable>
          <View style={s.secondaryRow}>
            <Pressable style={s.secBtn} onPress={() => router.back()}>
              <Text style={s.secText}>↻ Repetir</Text>
            </Pressable>
            <Pressable style={s.secBtn} onPress={() => router.back()}>
              <Text style={s.secText}>Ver ranking</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0e1a' },
  flag: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', zIndex: 2 },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl },
  kicker: { color: BLUE, fontSize: 11, fontWeight: '800', letterSpacing: 3 },
  title: { color: colors.textPrimary, fontSize: 38, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, marginTop: spacing.s, textTransform: 'uppercase' },
  avatarArea: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl },
  burstWrap: { alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', fontStyle: 'italic', marginTop: spacing.l, letterSpacing: 0.5 },
  kart: { color: LIME },
  cards: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.xl, alignSelf: 'stretch' },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.m, paddingVertical: spacing.m, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  statLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  statValue: { fontSize: 22, fontWeight: '900', fontStyle: 'italic', marginTop: 5, fontVariant: ['tabular-nums'] },
  actions: { alignSelf: 'stretch', gap: spacing.s },
  shareBtn: { backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 16, alignItems: 'center', shadowColor: BLUE, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  shareText: { color: '#fff', fontSize: 14, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  secondaryRow: { flexDirection: 'row', gap: spacing.s },
  secBtn: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: radius.m, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  secText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
});
