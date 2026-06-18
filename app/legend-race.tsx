import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { RACE_TRACK, RACE_IN } from '../src/lib/raceTrack';
import { legendById, LEGENDS } from '../src/data/legends';
import { useLockLandscape } from '../src/hooks/useLockLandscape';
import { colors, radius, spacing } from '../src/theme';

const BLUE = colors.racingBlue;
const DOT = 16;
const GHOST = 24;

function fmtSec(ms: number) {
  return (ms / 1000).toFixed(2);
}

export default function LegendRace() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const legend = legendById(params.id) ?? LEGENDS[0];

  useLockLandscape();

  // Pace do piloto: às vezes ganha de raspão, geralmente perde por pouco.
  const yourLapMs = useMemo(() => {
    const win = Math.random() < 0.3;
    return Math.round(legend.lapMs + (win ? -(50 + Math.random() * 170) : 180 + Math.random() * 520));
  }, [legend.id]);

  const youT = useSharedValue(0);
  const legT = useSharedValue(0);

  const [phase, setPhase] = useState<'ready' | 'countdown' | 'racing' | 'done'>('ready');
  const [count, setCount] = useState(3);
  const [gapMs, setGapMs] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [lapMs, setLapMs] = useState(0);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  const youStyle = useAnimatedStyle(() => {
    const p = youT.value % 1;
    return { transform: [{ translateX: interpolate(p, RACE_IN, RACE_TRACK.xs) - DOT / 2 }, { translateY: interpolate(p, RACE_IN, RACE_TRACK.ys) - DOT / 2 }] };
  });
  const legStyle = useAnimatedStyle(() => {
    const p = legT.value % 1;
    return { transform: [{ translateX: interpolate(p, RACE_IN, RACE_TRACK.xs) - GHOST / 2 }, { translateY: interpolate(p, RACE_IN, RACE_TRACK.ys) - GHOST / 2 }] };
  });

  const beginCountdown = () => {
    setPhase('countdown');
    setCount(3);
    let c = 3;
    const tick = () => {
      c -= 1;
      if (c > 0) {
        setCount(c);
        setTimeout(tick, 800);
      } else {
        setCount(0); // "GO"
        setTimeout(() => startRace(), 600);
      }
    };
    setTimeout(tick, 800);
  };

  const startRace = () => {
    setPhase('racing');
    startRef.current = Date.now();
    let lastText = 0;
    const loop = () => {
      const el = Date.now() - startRef.current;
      youT.value = el / yourLapMs;
      legT.value = el / legend.lapMs;
      if (el - lastText > 80) {
        lastText = el;
        const gap = (legT.value - youT.value) * legend.lapMs;
        setGapMs(gap);
        setLapMs(el);
        const p = youT.value % 1;
        setSpeed(Math.round(50 + Math.abs(Math.sin(p * Math.PI * 4)) * 42));
      }
      if (youT.value >= 1) {
        setPhase('done');
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const reset = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    youT.value = 0;
    legT.value = 0;
    setGapMs(0);
    setSpeed(0);
    setLapMs(0);
    setPhase('ready');
  };

  const marginMs = yourLapMs - legend.lapMs;
  const beat = marginMs < 0;

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s, paddingLeft: insets.left + spacing.l, paddingRight: insets.right + spacing.l, paddingBottom: insets.bottom + spacing.s }]}>
      <Pressable onPress={() => router.back()} hitSlop={16} style={[s.close, { top: insets.top + spacing.xs }]}>
        <Text style={s.backIcon}>‹</Text>
      </Pressable>

      <View style={s.body}>
        {/* ===== ESQUERDA: mapa (você + lenda) ===== */}
        <View style={s.left}>
          <View style={s.head}>
            <View style={s.liveTag}>
              <View style={[s.helmetDot, { backgroundColor: legend.helmet }]} />
              <Text style={s.vsTitle}>VS {legend.name.toUpperCase()}</Text>
            </View>
            <Text style={s.recorde}>recorde {fmtSec(legend.lapMs)}</Text>
          </View>

          <View style={s.mapWrap}>
            <View style={s.mapBox}>
              <Svg width={340} height={250} viewBox="0 0 340 250">
                <Path d={RACE_TRACK.d} stroke="#23232e" strokeWidth={20} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                <Path d={RACE_TRACK.d} stroke="#3a3a48" strokeWidth={1.5} fill="none" strokeDasharray="2 10" />
              </Svg>
              <Animated.View style={[s.ghostDot, { borderColor: legend.helmet }, legStyle]} />
              <Animated.View style={[s.dot, { backgroundColor: BLUE }, youStyle]} />
            </View>
          </View>

          <View style={s.legendRow}>
            <View style={s.legendItem}><View style={[s.ldot, { backgroundColor: BLUE }]} /><Text style={s.ltext}>VOCÊ</Text></View>
            <View style={s.legendItem}><View style={[s.ldot, { backgroundColor: legend.helmet }]} /><Text style={s.ltext}>{legend.short.toUpperCase()}</Text></View>
          </View>
        </View>

        <View style={s.divider} />

        {/* ===== DIREITA: velocímetro + gap pro recorde ===== */}
        <View style={s.right}>
          <View style={s.speedRow}>
            <View style={s.speedNumWrap}>
              <Text style={s.speedNum}>{speed}</Text>
              <Text style={s.speedUnit}>km/h</Text>
            </View>
            <Text style={s.speedLabel}>VELOCIDADE</Text>
          </View>

          <View style={s.gapCard}>
            <View>
              <Text style={s.gapLabel}>GAP PRO RECORDE</Text>
              <Text style={[s.gapValue, { color: gapMs <= 0 ? colors.success : colors.danger }]}>
                {gapMs <= 0 ? '−' : '+'}{Math.abs(gapMs / 1000).toFixed(2)}s
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.gapLabel}>{gapMs <= 0 ? 'NA FRENTE DE' : 'ATRÁS DE'}</Text>
              <Text style={s.gapWho}>{legend.short}</Text>
            </View>
          </View>

          <View style={s.statsRow}>
            <View style={s.stat}>
              <Text style={s.statLabel}>SUA VOLTA</Text>
              <Text style={s.statValue}>{fmtSec(lapMs)}</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statLabel}>SEU RITMO</Text>
              <Text style={[s.statValue, { color: colors.accentLime }]}>{fmtSec(yourLapMs)}</Text>
            </View>
          </View>

          {(phase === 'ready' || phase === 'racing') && (
            <Pressable
              disabled={phase === 'racing'}
              style={({ pressed }) => [s.cta, phase === 'racing' && { opacity: 0.5 }, pressed && { opacity: 0.9 }]}
              onPress={beginCountdown}
            >
              <Text style={s.ctaText}>{phase === 'racing' ? 'CORRENDO…' : '🏁 DAR LARGADA'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Countdown */}
      {phase === 'countdown' && (
        <View style={s.overlay} pointerEvents="none">
          <Text style={s.countNum}>{count > 0 ? count : 'GO!'}</Text>
        </View>
      )}

      {/* Resultado */}
      {phase === 'done' && (
        <View style={s.overlay}>
          <View style={s.resultCard}>
            <Text style={[s.resultTitle, { color: beat ? colors.success : colors.textPrimary }]}>
              {beat ? 'VOCÊ BATEU!' : 'QUASE LÁ'}
            </Text>
            <Text style={s.resultSub}>
              {beat
                ? `Você bateu o tempo do ${legend.short} por ${Math.abs(marginMs / 1000).toFixed(2)}s! 🏆`
                : `Faltou ${(marginMs / 1000).toFixed(2)}s pro ${legend.short}.`}
            </Text>
            <View style={s.resultTimes}>
              <View style={s.resultTime}>
                <Text style={s.rtLabel}>VOCÊ</Text>
                <Text style={[s.rtValue, { color: BLUE }]}>{fmtSec(yourLapMs)}</Text>
              </View>
              <View style={s.resultTime}>
                <Text style={s.rtLabel}>{legend.short.toUpperCase()}</Text>
                <Text style={[s.rtValue, { color: legend.helmet }]}>{fmtSec(legend.lapMs)}</Text>
              </View>
            </View>
            <Pressable style={s.resultBtn} onPress={reset}>
              <Text style={s.resultBtnText}>CORRER DE NOVO</Text>
            </Pressable>
            <Pressable style={s.resultSecBtn} onPress={() => router.back()}>
              <Text style={s.resultSecText}>Trocar lenda</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, color ? { color } : null]}>
        {value}{unit ? <Text style={s.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  close: { position: 'absolute', left: spacing.s, zIndex: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { color: colors.textSecondary, fontSize: 30, fontWeight: '400' },

  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.l },
  left: { flex: 1.1, alignItems: 'center', justifyContent: 'center', gap: spacing.s },
  right: { flex: 1, justifyContent: 'center', gap: spacing.m },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginVertical: spacing.l },

  head: { alignItems: 'center' },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vsTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  recorde: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 2 },
  helmetDot: { width: 14, height: 14, borderRadius: 7 },

  mapWrap: { alignItems: 'center' },
  mapBox: { width: 340, height: 250 },

  speedRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  speedNumWrap: { flexDirection: 'row', alignItems: 'flex-end' },
  speedNum: { color: colors.textPrimary, fontSize: 88, fontWeight: '900', letterSpacing: -3, lineHeight: 92, fontVariant: ['tabular-nums'] },
  speedUnit: { color: colors.textSecondary, fontSize: 20, fontWeight: '700', marginBottom: 14, marginLeft: 6 },
  speedLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: spacing.s },
  dot: { position: 'absolute', left: 0, top: 0, width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: colors.bg },
  ghostDot: { position: 'absolute', left: 0, top: 0, width: GHOST, height: GHOST, borderRadius: GHOST / 2, borderWidth: 3, backgroundColor: 'transparent' },
  legendRow: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.s },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ldot: { width: 8, height: 8, borderRadius: 4 },
  ltext: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },

  gapCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.l, padding: spacing.l, backgroundColor: colors.surface, borderRadius: radius.l },
  gapLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  gapValue: { fontSize: 30, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, marginTop: 2, fontVariant: ['tabular-nums'] },
  gapWho: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 4 },

  stats: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.m, padding: spacing.m, alignItems: 'center' },
  statLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  statValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  statUnit: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },

  footer: { paddingTop: spacing.s },
  cta: { backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,15,0.82)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  countNum: { color: '#fff', fontSize: 96, fontWeight: '900', fontStyle: 'italic' },
  resultCard: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  resultTitle: { fontSize: 26, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.5 },
  resultSub: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: spacing.s, lineHeight: 20 },
  resultTimes: { flexDirection: 'row', gap: spacing.xxl, marginTop: spacing.l },
  resultTime: { alignItems: 'center' },
  rtLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  rtValue: { fontSize: 26, fontWeight: '900', fontStyle: 'italic', marginTop: 4, fontVariant: ['tabular-nums'] },
  resultBtn: { alignSelf: 'stretch', backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 15, alignItems: 'center', marginTop: spacing.xl },
  resultBtnText: { color: '#fff', fontSize: 14, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  resultSecBtn: { paddingVertical: spacing.m },
  resultSecText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
});
