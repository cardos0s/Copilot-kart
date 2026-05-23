import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { buildWeeklyRecap, RecapData } from '../src/lib/recap';
import { colors, spacing, typography } from '../src/theme';

const SLIDE_DURATION_MS = 3200;

function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export default function RecapScreen() {
  const router = useRouter();
  const [recap, setRecap] = useState<RecapData | null | 'loading'>('loading');

  const load = useCallback(async () => {
    const data = await buildWeeklyRecap();
    setRecap(data);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (recap === 'loading') {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!recap) {
    return (
      <View style={s.root}>
        <Pressable style={s.closeBtn} onPress={() => router.back()} hitSlop={10}>
          <Text style={s.closeText}>×</Text>
        </Pressable>
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.emptyTitle}>Sem dados nessa semana</Text>
          <Text style={s.emptyBody}>
            Faça pelo menos uma sessão nos últimos 7 dias pra ver o recap.
          </Text>
        </View>
      </View>
    );
  }

  return <RecapCarousel recap={recap} onClose={() => router.back()} />;
}

function RecapCarousel({ recap, onClose }: { recap: RecapData; onClose: () => void }) {
  const slides = useMemo<Slide[]>(() => buildSlides(recap), [recap]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progress bar
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: SLIDE_DURATION_MS,
      easing: Easing.linear,
    });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (currentIdx < slides.length - 1) {
        setCurrentIdx((i) => i + 1);
      } else {
        onClose();
      }
    }, SLIDE_DURATION_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentIdx, slides.length, onClose, progress]);

  const handleTapZone = (side: 'left' | 'right') => {
    if (side === 'left' && currentIdx > 0) setCurrentIdx((i) => i - 1);
    else if (side === 'right') {
      if (currentIdx < slides.length - 1) setCurrentIdx((i) => i + 1);
      else onClose();
    }
  };

  const slide = slides[currentIdx];

  return (
    <View style={s.root}>
      {/* Barras de progresso superiores */}
      <View style={s.progressBars}>
        {slides.map((_, i) => (
          <View key={i} style={s.progressBar}>
            {i < currentIdx && <View style={[s.progressFill, { width: '100%' }]} />}
            {i === currentIdx && <ProgressFill progress={progress} />}
          </View>
        ))}
      </View>

      {/* Botão fechar */}
      <Pressable style={s.closeBtn} onPress={onClose} hitSlop={10}>
        <Text style={s.closeText}>×</Text>
      </Pressable>

      {/* Conteúdo */}
      <View style={s.slideContent}>
        <SlideView slide={slide} />
      </View>

      {/* Tap zones invisíveis */}
      <Pressable style={s.tapZoneLeft} onPress={() => handleTapZone('left')} />
      <Pressable style={s.tapZoneRight} onPress={() => handleTapZone('right')} />
    </View>
  );
}

function ProgressFill({ progress }: { progress: Animated.SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));
  return <Animated.View style={[s.progressFill, style]} />;
}

// ===== Slides =====

type Slide =
  | { kind: 'kicker'; week: string }
  | { kind: 'stat'; label: string; value: string; sub?: string; tone?: 'primary' | 'cyan' | 'magenta' }
  | { kind: 'bestLap'; lapMs: number; trackName: string; delta: number | null }
  | { kind: 'tracks'; tracks: Array<{ name: string; sessions: number }> }
  | { kind: 'achievements'; count: number }
  | { kind: 'insight'; text: string }
  | { kind: 'evolution'; sessions: number; deltaMs: number | null };

function buildSlides(r: RecapData): Slide[] {
  const slides: Slide[] = [];
  slides.push({ kind: 'kicker', week: r.weekLabel });
  slides.push({
    kind: 'stat',
    label: 'SESSÕES',
    value: String(r.sessionsCount),
    sub: `nos últimos 7 dias`,
    tone: 'primary',
  });
  slides.push({
    kind: 'stat',
    label: 'VOLTAS',
    value: String(r.lapsCount),
    sub: `~${(r.totalDistanceM / 1000).toFixed(1)} km de pista`,
    tone: 'cyan',
  });
  if (r.bestLapMs != null && r.bestTrackName) {
    slides.push({
      kind: 'bestLap',
      lapMs: r.bestLapMs,
      trackName: r.bestTrackName,
      delta: r.bestLapDelta,
    });
  }
  if (r.topTracks.length > 0) {
    slides.push({ kind: 'tracks', tracks: r.topTracks });
  }
  if (r.achievementsThisWeek > 0) {
    slides.push({ kind: 'achievements', count: r.achievementsThisWeek });
  }
  slides.push({
    kind: 'evolution',
    sessions: r.sessionsCount,
    deltaMs: r.bestLapDelta,
  });
  slides.push({ kind: 'insight', text: r.insight });
  return slides;
}

function SlideView({ slide }: { slide: Slide }) {
  switch (slide.kind) {
    case 'kicker':
      return (
        <View style={s.slideCenter}>
          <Text style={s.kickerLabel}>RESUMO DA SEMANA</Text>
          <Text style={s.kickerWeek}>{slide.week}</Text>
        </View>
      );
    case 'stat':
      return (
        <View style={s.slideCenter}>
          <Text style={s.statLabel}>{slide.label}</Text>
          <Text
            style={[
              s.statValue,
              typography.mono,
              {
                color:
                  slide.tone === 'cyan'
                    ? colors.accentCyan
                    : slide.tone === 'magenta'
                      ? colors.accentMagenta
                      : colors.primary,
              },
            ]}
          >
            {slide.value}
          </Text>
          {slide.sub && <Text style={s.statSub}>{slide.sub}</Text>}
        </View>
      );
    case 'bestLap':
      return (
        <View style={s.slideCenter}>
          <Text style={s.statLabel}>MELHOR VOLTA</Text>
          <Text style={[s.statValue, typography.mono, { color: colors.primary }]}>
            {fmtLap(slide.lapMs)}
          </Text>
          <Text style={s.statSub}>em {slide.trackName}</Text>
          {slide.delta != null && (
            <Text
              style={[
                s.delta,
                { color: slide.delta < 0 ? colors.success : colors.danger },
              ]}
            >
              {slide.delta < 0 ? '↓ ' : '↑ '}
              {(Math.abs(slide.delta) / 1000).toFixed(3)}s vs semana anterior
            </Text>
          )}
        </View>
      );
    case 'tracks':
      return (
        <View style={s.slideCenter}>
          <Text style={s.statLabel}>PISTAS DA SEMANA</Text>
          <View style={{ marginTop: spacing.l, gap: spacing.s }}>
            {slide.tracks.map((t, i) => (
              <Text key={i} style={s.trackRow}>
                <Text style={[typography.mono, { color: colors.primary }]}>
                  {String(t.sessions).padStart(2, '0')}
                </Text>
                <Text style={{ color: colors.textMuted }}>  ·  </Text>
                {t.name}
              </Text>
            ))}
          </View>
        </View>
      );
    case 'achievements':
      return (
        <View style={s.slideCenter}>
          <Text style={s.statValue}>{slide.count}</Text>
          <Text style={s.kickerLabel}>CONQUISTAS{'\n'}DESBLOQUEADAS</Text>
        </View>
      );
    case 'evolution':
      return (
        <View style={s.slideCenter}>
          <Text style={s.statLabel}>EVOLUÇÃO</Text>
          <Text style={s.evoSessions}>{slide.sessions} sessões.</Text>
          {slide.deltaMs != null && (
            <Text
              style={[
                s.evoDelta,
                { color: slide.deltaMs < 0 ? colors.success : colors.danger },
              ]}
            >
              {slide.deltaMs > 0 ? '+' : ''}
              {(slide.deltaMs / 1000).toFixed(2)} segundos.
            </Text>
          )}
        </View>
      );
    case 'insight':
      return (
        <View style={s.slideCenter}>
          <Text style={s.statLabel}>DESCOBERTA</Text>
          <Text style={s.insight}>"{slide.text}"</Text>
        </View>
      );
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  progressBars: {
    flexDirection: 'row',
    gap: 4,
    paddingTop: 56,
    paddingHorizontal: spacing.m,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: colors.surface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.textPrimary,
  },

  closeBtn: {
    position: 'absolute',
    top: 56,
    right: spacing.l,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  closeText: { color: colors.textPrimary, fontSize: 22, lineHeight: 24 },

  slideContent: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 100, paddingBottom: 80 },
  slideCenter: { flex: 1, justifyContent: 'center' },

  kickerLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: spacing.s,
  },
  kickerWeek: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontFamily: 'PlayfairDisplay_700Bold',
  },

  statLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: spacing.m,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 96,
    fontWeight: '900',
    letterSpacing: -3,
  },
  statSub: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.s,
  },
  delta: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: spacing.m,
  },

  trackRow: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },

  evoSessions: {
    fontFamily: 'PlayfairDisplay_400Regular',
    color: colors.textPrimary,
    fontSize: 40,
    marginTop: spacing.m,
  },
  evoDelta: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 40,
  },

  insight: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: colors.textPrimary,
    fontSize: 28,
    lineHeight: 38,
    marginTop: spacing.m,
  },

  tapZoneLeft: {
    position: 'absolute',
    top: 80,
    left: 0,
    bottom: 0,
    width: '30%',
  },
  tapZoneRight: {
    position: 'absolute',
    top: 80,
    right: 0,
    bottom: 0,
    width: '70%',
  },

  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.m, textAlign: 'center' },
});
