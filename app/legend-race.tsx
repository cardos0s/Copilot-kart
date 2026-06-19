import { useEffect, useRef, useState } from 'react';
import { Alert, InteractionManager, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Circle, Path } from 'react-native-svg';
import { RACE_TRACK } from '../src/lib/raceTrack';
import { legendById, LEGENDS } from '../src/data/legends';
import { useLapRecorder } from '../src/hooks/useLapRecorder';
import { useLockLandscape } from '../src/hooks/useLockLandscape';
import { markDefeated } from '../src/storage/legendsDefeated';
import { colors, radius, spacing } from '../src/theme';

const BLUE = colors.racingBlue;
const MAX_KMH = 110;

function fmtSec(ms: number) {
  return (ms / 1000).toFixed(2);
}

// Posição (x,y) no viewBox 340x250 pra uma fração de volta p∈[0,1).
function trackPos(p: number): { x: number; y: number } {
  const xs = RACE_TRACK.xs;
  const ys = RACE_TRACK.ys;
  const n = xs.length;
  const f = ((p % 1) + 1) % 1;
  const idx = f * (n - 1);
  const i = Math.floor(idx);
  const t = idx - i;
  const j = Math.min(i + 1, n - 1);
  return { x: xs[i] + (xs[j] - xs[i]) * t, y: ys[i] + (ys[j] - ys[i]) * t };
}

export default function LegendRace() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; simulate?: string }>();
  const legend = legendById(params.id) ?? LEGENDS[0];
  const isDemo = params.simulate === '1';

  // Cockpit: força landscape (suporte). Trava robusta + layout responsivo.
  useLockLandscape();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { state, info, start, stop } = useLapRecorder();

  const [phase, setPhase] = useState<'ready' | 'racing' | 'done'>('ready');
  const [nowMs, setNowMs] = useState(0);
  const [bestMs, setBestMs] = useState<number | null>(null);
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 });

  const startRef = useRef(0);
  const lastSeenLapRef = useRef(0);

  // ---- Detecta voltas fechadas pra guardar a melhor ----
  useEffect(() => {
    const closed = info.lastClosedLap;
    if (closed && closed.lapNumber !== lastSeenLapRef.current) {
      lastSeenLapRef.current = closed.lapNumber;
      setBestMs((b) => (b == null ? closed.durationMs : Math.min(b, closed.durationMs)));
    }
  }, [info.lastClosedLap]);

  // ---- Ticker (move o fantasma da lenda) — só enquanto corre ----
  useEffect(() => {
    if (phase !== 'racing') return;
    let id: ReturnType<typeof setInterval> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      id = setInterval(() => setNowMs(Date.now()), 80);
    });
    return () => {
      task.cancel();
      if (id) clearInterval(id);
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      // Garante que o GPS pare se sair no meio.
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    try {
      await start({ simulate: isDemo });
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Falha ao iniciar GPS');
      return;
    }
    startRef.current = Date.now();
    setNowMs(Date.now());
    setPhase('racing');
  };

  const handleEnd = () => {
    stop();
    setPhase('done');
    // Venceu a lenda? Registra na coleção (mantém o melhor tempo).
    if (bestMs != null && bestMs < legend.lapMs) {
      markDefeated(legend.id, bestMs).catch(() => {});
    }
    // Corrida acabou: libera a orientação (resultado segue o device).
    ScreenOrientation.unlockAsync().catch(() => {});
  };

  // ---- Derivados da corrida ----
  const elapsed = phase === 'racing' ? Math.max(0, nowMs - startRef.current) : 0;
  const ghostTotal = elapsed / legend.lapMs;
  const yourTotal = info.lapsCompleted + Math.min(0.999, (info.currentLapElapsedMs ?? 0) / legend.lapMs);
  const gapMs = (yourTotal - ghostTotal) * legend.lapMs; // + = na frente
  const ahead = gapMs >= 0;
  const speed = Math.round(info.lastSpeedKmh);
  const speedFrac = Math.max(0, Math.min(1, info.lastSpeedKmh / MAX_KMH));
  const curLapMs = info.currentLapElapsedMs ?? 0;

  const yourPos = trackPos(yourTotal);
  const ghostPos = trackPos(ghostTotal);

  // ===== Resultado: venceu ou perdeu por X =====
  if (phase === 'done') {
    const beat = bestMs != null && bestMs < legend.lapMs;
    const marginMs = bestMs != null ? Math.abs(bestMs - legend.lapMs) : 0;
    return (
      <View style={[s.root, { paddingTop: insets.top + spacing.s, paddingLeft: insets.left + spacing.l, paddingRight: insets.right + spacing.l, paddingBottom: insets.bottom + spacing.s }]}>
        <View style={s.resultBackdrop}>
          <View style={s.resultCard}>
            <View style={[s.helmetDotBig, { backgroundColor: legend.helmet }]} />
            <Text style={[s.resultTitle, { color: beat ? colors.success : colors.textPrimary }]}>
              {bestMs == null ? 'SEM VOLTA' : beat ? 'VOCÊ VENCEU!' : 'VOCÊ PERDEU'}
            </Text>
            <Text style={s.resultSub}>
              {bestMs == null
                ? `Você não completou uma volta contra o ${legend.short}.`
                : beat
                  ? `Você bateu o ${legend.short} por ${fmtSec(marginMs)}s! 🏆`
                  : `Você perdeu pro ${legend.short} por ${fmtSec(marginMs)}s.`}
            </Text>
            <View style={s.resultTimes}>
              <View style={s.resultTime}>
                <Text style={s.rtLabel}>VOCÊ</Text>
                <Text style={[s.rtValue, { color: BLUE }]}>{bestMs == null ? '—' : fmtSec(bestMs)}</Text>
              </View>
              <View style={s.resultTime}>
                <Text style={s.rtLabel}>{legend.short.toUpperCase()}</Text>
                <Text style={[s.rtValue, { color: legend.helmet }]}>{fmtSec(legend.lapMs)}</Text>
              </View>
            </View>
            <Pressable style={({ pressed }) => [s.resultBtn, pressed && { opacity: 0.85 }]} onPress={() => router.back()}>
              <Text style={s.resultBtnText}>SAIR</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s, paddingLeft: insets.left + spacing.l, paddingRight: insets.right + spacing.l, paddingBottom: insets.bottom + spacing.s }]}>
      <Pressable onPress={() => router.back()} hitSlop={16} style={[s.close, { top: insets.top + spacing.xs }]}>
        <Text style={s.backIcon}>‹</Text>
      </Pressable>

      <View style={[s.body, !isLandscape && { flexDirection: 'column', justifyContent: 'center' }]}>
        {/* ===== ESQUERDA: mapa (você + lenda) ===== */}
        <View style={s.left}>
          <View style={s.head}>
            <View style={s.liveTag}>
              <View style={[s.helmetDot, { backgroundColor: legend.helmet }]} />
              <Text style={s.vsTitle}>VS {legend.name.toUpperCase()}{isDemo ? ' · DEMO' : ''}</Text>
            </View>
            <Text style={s.recorde}>recorde {fmtSec(legend.lapMs)}</Text>
          </View>

          <View
            style={s.mapWrap}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              setMapSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
            }}
          >
            {mapSize.w > 0 && mapSize.h > 0 && (
              <Svg width={mapSize.w} height={mapSize.h} viewBox="0 0 340 250">
                <Path d={RACE_TRACK.d} stroke="#23232e" strokeWidth={20} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                <Path d={RACE_TRACK.d} stroke="#3a3a48" strokeWidth={1.5} fill="none" strokeDasharray="2 10" />
                {phase === 'racing' && (
                  <Circle cx={ghostPos.x} cy={ghostPos.y} r={8} fill="none" stroke={legend.helmet} strokeWidth={3} />
                )}
                <Circle cx={phase === 'racing' ? yourPos.x : 170} cy={phase === 'racing' ? yourPos.y : 28} r={8} fill={BLUE} stroke="#fff" strokeWidth={2.5} />
              </Svg>
            )}
          </View>

          <View style={s.legendRow}>
            <View style={s.legendItem}><View style={[s.ldot, { backgroundColor: BLUE }]} /><Text style={s.ltext}>VOCÊ</Text></View>
            <View style={s.legendItem}><View style={[s.ldot, { backgroundColor: legend.helmet }]} /><Text style={s.ltext}>{legend.short.toUpperCase()}</Text></View>
          </View>
        </View>

        <View style={[s.divider, !isLandscape && { width: '100%', height: 1, marginVertical: spacing.m }]} />

        {/* ===== DIREITA: velocímetro + gap ===== */}
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
              <Text style={s.gapLabel}>GAP PRA LENDA</Text>
              <Text style={[s.gapValue, { color: ahead ? colors.success : colors.danger }]}>
                {ahead ? '+' : '−'}{Math.abs(gapMs / 1000).toFixed(2)}s
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.gapLabel}>{ahead ? 'NA FRENTE DO' : 'ATRÁS DO'}</Text>
              <Text style={s.gapWho}>{legend.short}</Text>
            </View>
          </View>

          <View style={s.statsRow}>
            <View style={s.stat}>
              <Text style={s.statLabel}>VOLTA ATUAL</Text>
              <Text style={s.statValue}>{phase === 'racing' ? fmtSec(curLapMs) : '0.00'}</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statLabel}>SUA MELHOR</Text>
              <Text style={[s.statValue, { color: colors.accentLime }]}>{bestMs == null ? '—' : fmtSec(bestMs)}</Text>
            </View>
          </View>

          {phase === 'ready' ? (
            <Pressable
              style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }, state === 'requesting' && { opacity: 0.5 }]}
              onPress={handleStart}
              disabled={state === 'requesting'}
            >
              <Text style={s.ctaText}>{state === 'requesting' ? 'ABRINDO GPS…' : '🏁 DAR LARGADA'}</Text>
            </Pressable>
          ) : (
            <Pressable style={({ pressed }) => [s.endBtn, pressed && { opacity: 0.85 }]} onPress={handleEnd}>
              <Text style={s.endBtnText}>ENCERRAR</Text>
            </Pressable>
          )}
        </View>
      </View>
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
  helmetDotBig: { width: 28, height: 28, borderRadius: 14, marginBottom: spacing.s },

  mapWrap: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 150 },

  speedRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  speedNumWrap: { flexDirection: 'row', alignItems: 'flex-end' },
  speedNum: { color: colors.textPrimary, fontSize: 88, fontWeight: '900', letterSpacing: -3, lineHeight: 92, fontVariant: ['tabular-nums'] },
  speedUnit: { color: colors.textSecondary, fontSize: 20, fontWeight: '700', marginBottom: 14, marginLeft: 6 },
  speedLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: spacing.s },

  legendRow: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.s },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ldot: { width: 8, height: 8, borderRadius: 4 },
  ltext: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },

  gapCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.l, backgroundColor: colors.surface, borderRadius: radius.l },
  gapLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  gapValue: { fontSize: 30, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, marginTop: 2, fontVariant: ['tabular-nums'] },
  gapWho: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 4 },

  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.m, padding: spacing.m, alignItems: 'center' },
  statLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  statValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },

  cta: { backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  endBtn: { backgroundColor: colors.danger, borderRadius: radius.m, paddingVertical: 16, alignItems: 'center' },
  endBtnText: { color: '#fff', fontSize: 15, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },

  resultBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: spacing.l },
  resultCard: { width: '100%', maxWidth: 440, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  resultTitle: { fontSize: 28, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.5 },
  resultSub: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: spacing.s, lineHeight: 20 },
  resultTimes: { flexDirection: 'row', gap: spacing.xxl, marginTop: spacing.l },
  resultTime: { alignItems: 'center' },
  rtLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  rtValue: { fontSize: 26, fontWeight: '900', fontStyle: 'italic', marginTop: 4, fontVariant: ['tabular-nums'] },
  resultBtn: { alignSelf: 'stretch', backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 15, alignItems: 'center', marginTop: spacing.xl },
  resultBtnText: { color: '#fff', fontSize: 14, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
});
