import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import {
  getDefaultLayoutForTrack,
  getLapsForSession,
  getLayout,
  getSession,
} from '../src/storage/db';
import {
  cleanSamples,
  LapRecord,
  repairDegenerateTimestamps,
} from '../src/lib/analysis';
import { buildReferenceLap } from '../src/lib/geometry';
import { detectCorners } from '../src/lib/corners';
import { compareLaps, CompareResult } from '../src/lib/lapCompare';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

function fmtLap(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDelta(ms: number) {
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; result: CompareResult; lapA: LapRecord; lapB: LapRecord; lapALabel: string; lapBLabel: string };

export default function LapCompareScreen() {
  const router = useRouter();
  const { sessionA, lapA, sessionB, lapB } = useLocalSearchParams<{
    sessionA?: string;
    lapA?: string;
    sessionB?: string;
    lapB?: string;
  }>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    (async () => {
      if (!sessionA || !lapA || !sessionB || !lapB) {
        setState({ kind: 'error', message: 'Faltando parâmetros (sessionA/lapA/sessionB/lapB).' });
        return;
      }
      try {
        const [sA, sB] = await Promise.all([getSession(sessionA), getSession(sessionB)]);
        if (!sA || !sB) {
          setState({ kind: 'error', message: 'Sessão não encontrada.' });
          return;
        }
        if (sA.trackId !== sB.trackId) {
          setState({
            kind: 'error',
            message: 'As duas voltas precisam ser da mesma pista pra comparar.',
          });
          return;
        }

        const [lapsA, lapsB] = await Promise.all([
          getLapsForSession(sessionA),
          getLapsForSession(sessionB),
        ]);
        const findLap = (laps: LapRecord[], id: string) => {
          const raw = laps.find((l) => l.id === id);
          if (!raw) return null;
          const cleaned = cleanSamples(raw.samples, 10);
          const { samples } = repairDegenerateTimestamps(cleaned, raw.durationMs, raw.startedAt);
          return { ...raw, samples };
        };
        const lapARec = findLap(lapsA, lapA);
        const lapBRec = findLap(lapsB, lapB);
        if (!lapARec || !lapBRec) {
          setState({ kind: 'error', message: 'Volta não encontrada.' });
          return;
        }

        // Layout: usa o layoutId da sessão A; se não tiver, default da pista
        let layout = sA.layoutId ? await getLayout(sA.layoutId) : null;
        if (!layout && sA.trackId) layout = await getDefaultLayoutForTrack(sA.trackId);
        if (!layout || layout.samples.length < 5) {
          setState({ kind: 'error', message: 'Sem referência de pista pra comparar.' });
          return;
        }
        const { samples: refSamples } = repairDegenerateTimestamps(
          layout.samples,
          layout.durationMs
        );
        const refLap = buildReferenceLap(refSamples, {
          lat: refSamples[0].lat,
          lng: refSamples[0].lng,
        });
        const corners = detectCorners(refLap);

        const result = compareLaps(lapARec, lapBRec, refLap, corners);
        const labelA = labelForLap(lapsA, lapARec);
        const labelB = labelForLap(lapsB, lapBRec);
        setState({ kind: 'ok', result, lapA: lapARec, lapB: lapBRec, lapALabel: labelA, lapBLabel: labelB });
      } catch (err: any) {
        setState({ kind: 'error', message: err?.message ?? 'Erro inesperado.' });
      }
    })();
  }, [sessionA, lapA, sessionB, lapB]);

  if (state.kind === 'loading') {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={s.root}>
        <ScreenHeader title="COMPARAÇÃO" onBack={() => router.back()} />
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.errorTitle}>Não foi possível comparar</Text>
          <Text style={s.errorBody}>{state.message}</Text>
        </View>
      </View>
    );
  }

  const { result, lapALabel, lapBLabel } = state;
  const aFaster = result.totalDeltaMs < 0;

  return (
    <View style={s.root}>
      <ScreenHeader
        title="COMPARAÇÃO"
        subtitle={`${lapALabel} vs ${lapBLabel}`}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Cards de tempo */}
        <View style={s.row}>
          <View style={[s.timeCard, { borderColor: colors.success }]}>
            <Text style={[s.timeLabel, { color: colors.success }]}>● VOLTA A</Text>
            <Text style={[s.timeValue, typography.mono]}>{fmtLap(result.aTotalMs)}</Text>
            <Text style={s.timeSub}>{lapALabel}</Text>
          </View>
          <View style={s.vsCircle}>
            <Text style={s.vsText}>vs</Text>
          </View>
          <View style={[s.timeCard, { borderColor: colors.accentPurple }]}>
            <Text style={[s.timeLabel, { color: colors.accentPurple }]}>● VOLTA B</Text>
            <Text style={[s.timeValue, typography.mono]}>{fmtLap(result.bTotalMs)}</Text>
            <Text style={s.timeSub}>{lapBLabel}</Text>
          </View>
        </View>

        {/* Delta ao longo da volta */}
        <View style={s.deltaCard}>
          <View style={s.deltaHeader}>
            <Text style={s.section}>DELTA AO LONGO DA VOLTA</Text>
            <Text
              style={[
                s.deltaTotal,
                typography.mono,
                { color: aFaster ? colors.success : colors.danger },
              ]}
            >
              {fmtDelta(result.totalDeltaMs)}
            </Text>
          </View>
          <TrechosChart trechos={result.trechos} />
        </View>

        {/* Setores */}
        <Text style={s.section}>POR SETOR</Text>
        {result.sectors.map((sec) => (
          <View key={sec.index} style={s.sectorRow}>
            <Text style={s.sectorIdx}>S{sec.index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.sectorLabel}>{sec.label}</Text>
              <Text style={[s.sectorTimes, typography.mono]}>
                {sec.aMs != null ? fmtLap(sec.aMs) : '—'}  ·  {sec.bMs != null ? fmtLap(sec.bMs) : '—'}
              </Text>
            </View>
            <Text
              style={[
                s.sectorDelta,
                typography.mono,
                {
                  color:
                    sec.deltaMs == null
                      ? colors.textMuted
                      : sec.deltaMs > 0
                        ? colors.danger
                        : colors.success,
                },
              ]}
            >
              {sec.deltaMs != null ? fmtDelta(sec.deltaMs) : '—'}
            </Text>
          </View>
        ))}

        {/* Overlay velocidade */}
        <Text style={s.section}>VELOCIDADE · OVERLAY</Text>
        <View style={s.speedCard}>
          <SpeedOverlay
            speedsA={result.traceA.speedValues}
            speedsB={result.traceB.speedValues}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function labelForLap(laps: LapRecord[], lap: LapRecord): string {
  const idx = laps.findIndex((l) => l.id === lap.id);
  return idx >= 0 ? `L${idx + 1}` : 'lap';
}

// ===== Gráfico de barras dos trechos =====

function TrechosChart({ trechos }: { trechos: { label: string; deltaMs: number }[] }) {
  const W = 320;
  const H = 90;
  const barW = (W - 20) / trechos.length;
  const maxAbs = Math.max(...trechos.map((t) => Math.abs(t.deltaMs)), 50);
  const scaleY = (H / 2 - 10) / maxAbs;
  const midY = H / 2;
  return (
    <View>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <Line x1={0} y1={midY} x2={W} y2={midY} stroke={colors.border} strokeWidth={1} strokeDasharray="2,3" />
        {trechos.map((t, i) => {
          const x = 10 + i * barW;
          const h = Math.abs(t.deltaMs) * scaleY;
          const y = t.deltaMs > 0 ? midY : midY - h;
          const color = t.deltaMs > 0 ? colors.danger : colors.success;
          return (
            <Path
              key={i}
              d={`M ${x + 2} ${y} L ${x + 2} ${y + h} L ${x + barW - 4} ${y + h} L ${x + barW - 4} ${y} Z`}
              fill={color}
              opacity={0.85}
            />
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row', paddingHorizontal: 10, marginTop: 4 }}>
        {trechos.map((t, i) => (
          <View key={i} style={{ width: `${100 / trechos.length}%`, alignItems: 'center' }}>
            <Text style={s.trechoLabel}>{t.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ===== Overlay de velocidade =====

function SpeedOverlay({ speedsA, speedsB }: { speedsA: number[]; speedsB: number[] }) {
  if (speedsA.length === 0 || speedsB.length === 0) {
    return <Text style={{ color: colors.textMuted, padding: spacing.m }}>Sem dados de velocidade.</Text>;
  }
  const W = 320;
  const H = 100;
  const all = [...speedsA, ...speedsB];
  const minV = Math.min(...all);
  const maxV = Math.max(...all);
  const range = maxV - minV || 1;
  const len = speedsA.length;
  const toPoints = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = (i / (len - 1)) * W;
        const y = H - ((v - minV) / range) * (H - 10) - 5;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      <Polyline
        points={toPoints(speedsB)}
        fill="none"
        stroke={colors.accentPurple}
        strokeWidth={2}
        opacity={0.85}
      />
      <Polyline
        points={toPoints(speedsA)}
        fill="none"
        stroke={colors.success}
        strokeWidth={2}
      />
    </Svg>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, gap: spacing.s },

  errorTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.m,
  },
  errorBody: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  timeCard: {
    flex: 1,
    padding: spacing.m,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  timeLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 4 },
  timeValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  timeSub: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 4 },
  vsCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsText: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  section: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: spacing.l,
    marginBottom: spacing.s,
  },

  deltaCard: {
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.m,
  },
  deltaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.s,
  },
  deltaTotal: { fontSize: 18, fontWeight: '900' },
  trechoLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },

  sectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
  },
  sectorIdx: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    width: 28,
  },
  sectorLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  sectorTimes: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 },
  sectorDelta: { fontSize: 15, fontWeight: '900' },

  speedCard: {
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
