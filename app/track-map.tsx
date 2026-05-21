import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import {
  getDefaultLayoutForTrack,
  getLapsForSession,
  getLayout,
  getSession,
  TrackLayout,
} from '../src/storage/db';
import {
  cleanSamples,
  LapRecord,
  matchLapToReference,
  repairDegenerateTimestamps,
} from '../src/lib/analysis';
import { buildReferenceLap, ReferenceLap } from '../src/lib/geometry';
import { Corner, detectCorners } from '../src/lib/corners';
import { peakSpeedInSectorMs, msToKmh } from '../src/lib/speed';
import { findTrackById } from '../src/data/tracks';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

const SECTOR_COLORS = [colors.success, colors.accentCyan, colors.warning];

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

type LoadResult =
  | { kind: 'loading' }
  | { kind: 'no-data' }
  | {
      kind: 'ok';
      layout: TrackLayout;
      refLap: ReferenceLap;
      corners: Corner[];
      trackName: string;
      configLabel: string;
      sectors: Array<{
        index: number;
        sStart: number;
        sEnd: number;
        durationMs: number;
        firstCorner: number;
        lastCorner: number;
        isPb: boolean;
      }>;
      cornerSpeeds: Array<{ index: number; minKmh: number; deltaVsBest: number }>;
    };

export default function TrackMapScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { sessionId, lapId } = useLocalSearchParams<{
    sessionId?: string;
    lapId?: string;
  }>();
  const [state, setState] = useState<LoadResult>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    if (!sessionId || !lapId) {
      setState({ kind: 'no-data' });
      return;
    }
    const session = await getSession(sessionId);
    if (!session) return setState({ kind: 'no-data' });

    let layout: TrackLayout | null = null;
    if (session.layoutId) layout = await getLayout(session.layoutId);
    if (!layout && session.trackId) layout = await getDefaultLayoutForTrack(session.trackId);
    if (!layout || layout.samples.length < 5) {
      return setState({ kind: 'no-data' });
    }

    const laps = await getLapsForSession(sessionId);
    const lap = laps.find((l) => l.id === lapId);
    if (!lap) return setState({ kind: 'no-data' });

    // Repara e limpa amostras antes de analisar
    const cleanedRef = cleanSamples(layout.samples, 10);
    const { samples: refSamples } = repairDegenerateTimestamps(cleanedRef, layout.durationMs);
    const refLap = buildReferenceLap(refSamples, {
      lat: refSamples[0].lat,
      lng: refSamples[0].lng,
    });
    const corners = detectCorners(refLap);

    const cleanedLap = cleanSamples(lap.samples, 10);
    const { samples: lapSamples } = repairDegenerateTimestamps(
      cleanedLap,
      lap.durationMs,
      lap.startedAt
    );
    const matched = matchLapToReference(
      { ...lap, samples: lapSamples },
      refLap
    );

    // Setores S1/S2/S3 — divide a pista em 3 partes IGUAIS por distância e
    // pega o tempo da volta atual em cada uma.
    const sectorLen = refLap.totalLength / 3;
    const sectors = [0, 1, 2].map((i) => {
      const sStart = i * sectorLen;
      const sEnd = (i + 1) * sectorLen;
      const tStart = interpolateT(matched.points, sStart) ?? 0;
      const tEnd = interpolateT(matched.points, sEnd) ?? lap.durationMs;
      const durationMs = Math.max(0, tEnd - tStart);
      // Corners que caem nesse setor
      const cornersInside = corners.filter((c) => c.sStart >= sStart && c.sEnd <= sEnd);
      const firstCorner = cornersInside[0]?.index ?? 0;
      const lastCorner = cornersInside[cornersInside.length - 1]?.index ?? firstCorner;
      // PB: o setor mais rápido vira badge "PB" (MVP — sem comparar com histórico)
      return {
        index: i,
        sStart,
        sEnd,
        durationMs,
        firstCorner: firstCorner + 1,
        lastCorner: lastCorner + 1,
        isPb: false, // setado depois
      };
    });
    // Marca o setor com menor durationMs como "PB"
    const bestSecIdx = sectors.reduce(
      (b, sec, i) => (sec.durationMs < sectors[b].durationMs ? i : b),
      0
    );
    sectors[bestSecIdx].isPb = true;

    // Velocidade mínima por curva — útil pra ver onde travou freada
    const cornerSpeeds = corners.map((c) => {
      let minMs = Infinity;
      for (const p of matched.points) {
        if (p.s >= c.sStart && p.s <= c.sEnd) {
          if (p.speed < minMs) minMs = p.speed;
        }
      }
      const minKmh = msToKmh(Number.isFinite(minMs) ? minMs : 0);
      return { index: c.index + 1, minKmh, deltaVsBest: 0 };
    });
    // delta vs corner mais rápida
    const bestCornerKmh = cornerSpeeds.reduce(
      (b, c) => Math.max(b, c.minKmh),
      0
    );
    for (const c of cornerSpeeds) {
      c.deltaVsBest = c.minKmh - bestCornerKmh;
    }

    const track = session.trackId ? findTrackById(session.trackId) : null;
    setState({
      kind: 'ok',
      layout,
      refLap,
      corners,
      trackName: track?.shortName ?? session.trackName,
      configLabel: layout.name,
      sectors,
      cornerSpeeds,
    });
  }, [sessionId, lapId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (state.kind === 'loading') {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (state.kind === 'no-data') {
    return (
      <View style={s.root}>
        <ScreenHeader title="MAPA" onBack={() => router.back()} />
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.empty}>Sem dados pra mostrar o mapa dessa volta.</Text>
        </View>
      </View>
    );
  }

  const mapSize = width - spacing.l * 2;
  const totalLengthM = state.refLap.totalLength;
  const totalCorners = state.corners.length;

  return (
    <View style={s.root}>
      <ScreenHeader
        title={state.trackName.toUpperCase()}
        subtitle={`${totalLengthM.toFixed(0)} m · ${totalCorners} curvas · ${state.configLabel}`}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Mapa principal */}
        <View style={s.mapCard}>
          <TrackSvg
            refLap={state.refLap}
            corners={state.corners}
            sectors={state.sectors}
            size={mapSize}
          />
          <View style={s.legend}>
            {state.sectors.map((sec, i) => (
              <View key={i} style={s.legendItem}>
                <View
                  style={[s.legendDot, { backgroundColor: SECTOR_COLORS[i] }]}
                />
                <Text style={s.legendText}>S{sec.index + 1}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Cards dos setores */}
        <View style={s.sectorsRow}>
          {state.sectors.map((sec) => (
            <View
              key={sec.index}
              style={[s.sectorCard, sec.isPb && s.sectorCardPb]}
            >
              <View style={s.sectorHeader}>
                <Text style={[s.sectorLabel, { color: SECTOR_COLORS[sec.index] }]}>
                  S{sec.index + 1}
                </Text>
                {sec.isPb && (
                  <View style={s.pbBadge}>
                    <Text style={s.pbBadgeText}>● PB</Text>
                  </View>
                )}
              </View>
              <Text style={[s.sectorTime, typography.mono]}>
                {(sec.durationMs / 1000).toFixed(3)}
              </Text>
              <Text style={s.sectorMeta}>
                Curvas {sec.firstCorner}–{sec.lastCorner}
              </Text>
            </View>
          ))}
        </View>

        {/* Lista curva a curva */}
        <View style={s.cornersCard}>
          <View style={s.cornersHeader}>
            <Text style={s.cornersTitle}>CURVA A CURVA</Text>
            <Text style={s.cornersSubtitle}>VEL. MÍN</Text>
          </View>
          {state.cornerSpeeds.map((c) => {
            const bestKmh = Math.max(...state.cornerSpeeds.map((x) => x.minKmh));
            const ratio = bestKmh > 0 ? c.minKmh / bestKmh : 0;
            const isBest = c.minKmh === bestKmh;
            return (
              <View key={c.index} style={s.cornerRow}>
                <Text style={s.cornerIndex}>T{c.index}</Text>
                <View style={s.cornerBarTrack}>
                  <View
                    style={[
                      s.cornerBarFill,
                      {
                        width: `${ratio * 100}%`,
                        backgroundColor: ratio > 0.7 ? colors.success : ratio > 0.5 ? colors.warning : colors.danger,
                      },
                    ]}
                  />
                </View>
                <Text style={[s.cornerSpeed, typography.mono]}>
                  {c.minKmh.toFixed(0)}{' '}
                  <Text style={s.cornerUnit}>km/h</Text>
                </Text>
                {!isBest && c.deltaVsBest < 0 && (
                  <Text style={s.cornerDelta}>
                    {c.deltaVsBest.toFixed(0)} km/h
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ===== Helpers =====

/** Tempo (ms) no ponto s da matched lap. Versão simplificada da lib analysis. */
function interpolateT(
  points: Array<{ s: number; tMs: number }>,
  s: number
): number | null {
  if (points.length < 2) return null;
  if (s <= points[0].s) return points[0].tMs;
  if (s >= points[points.length - 1].s) return points[points.length - 1].tMs;
  for (let i = 1; i < points.length; i++) {
    if (points[i].s >= s) {
      const a = points[i - 1];
      const b = points[i];
      const ratio = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
      return a.tMs + ratio * (b.tMs - a.tMs);
    }
  }
  return points[points.length - 1].tMs;
}

// ===== SVG do mapa da pista =====

function TrackSvg({
  refLap,
  corners,
  sectors,
  size,
}: {
  refLap: ReferenceLap;
  corners: Corner[];
  sectors: { sStart: number; sEnd: number; index: number }[];
  size: number;
}) {
  // Projeta XY dos pontos no quadrado [0, size]
  const { points, projectS } = useMemo(() => {
    const pts = refLap.points;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const padding = 30;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const scale = Math.min((size - padding * 2) / w, (size - padding * 2) / h);
    const offsetX = (size - w * scale) / 2 - minX * scale;
    const offsetY = (size - h * scale) / 2 + maxY * scale; // y invertido pra SVG
    const projected = pts.map((p) => ({
      x: p.x * scale + offsetX,
      y: -p.y * scale + offsetY,
    }));

    // Função pra projetar um `s` (distância) em XY
    const projectS = (s: number): { x: number; y: number } => {
      const cum = refLap.cumulativeDist;
      for (let i = 1; i < cum.length; i++) {
        if (cum[i] >= s) {
          const a = projected[i - 1];
          const b = projected[i];
          const t = cum[i] === cum[i - 1] ? 0 : (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
          return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        }
      }
      return projected[projected.length - 1];
    };

    return { points: projected, projectS };
  }, [refLap, size]);

  // Background do traçado (sombra cinza)
  const bgPath = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ');

  // Setores tracejados coloridos (S1/S2/S3)
  const sectorPaths = sectors.map((sec) => {
    const cum = refLap.cumulativeDist;
    const pathPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] >= sec.sStart && cum[i] <= sec.sEnd) {
        pathPoints.push(points[i]);
      }
    }
    return {
      index: sec.index,
      d: pathPoints
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(' '),
    };
  });

  // Linha de start/finish (s=0)
  const sfPoint = projectS(0);

  return (
    <Svg width={size} height={size}>
      {/* Track shadow (cinza, mais largo) */}
      <Path
        d={bgPath}
        stroke={colors.bgElevated}
        strokeWidth={28}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Setores coloridos tracejados */}
      {sectorPaths.map((sp) => (
        <Path
          key={sp.index}
          d={sp.d}
          stroke={SECTOR_COLORS[sp.index]}
          strokeWidth={3}
          fill="none"
          strokeDasharray="6,4"
          strokeLinecap="round"
        />
      ))}

      {/* Marker de start/finish */}
      <Path
        d={`M ${sfPoint.x - 2} ${sfPoint.y - 12} L ${sfPoint.x - 2} ${sfPoint.y + 12} M ${sfPoint.x + 2} ${sfPoint.y - 12} L ${sfPoint.x + 2} ${sfPoint.y + 12}`}
        stroke={colors.success}
        strokeWidth={2}
      />
      <SvgText
        x={sfPoint.x + 10}
        y={sfPoint.y + 4}
        fontSize="10"
        fontWeight="700"
        fill={colors.success}
      >
        S/F
      </SvgText>

      {/* Números das curvas */}
      {corners.map((c) => {
        const p = projectS(c.sApex);
        return (
          <React.Fragment key={c.index}>
            <Circle cx={p.x} cy={p.y} r={11} fill={colors.bg} stroke={colors.textPrimary} strokeWidth={1.5} />
            <SvgText
              x={p.x}
              y={p.y + 3}
              fontSize="10"
              fontWeight="900"
              fill={colors.textPrimary}
              textAnchor="middle"
            >
              {c.index + 1}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, paddingBottom: spacing.huge, gap: spacing.s },

  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },

  mapCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
    marginBottom: spacing.m,
    alignItems: 'center',
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.m,
    marginTop: spacing.s,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.s,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },

  sectorsRow: {
    flexDirection: 'row',
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  sectorCard: {
    flex: 1,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectorCardPb: {
    borderColor: colors.primary,
  },
  sectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectorLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pbBadge: {
    backgroundColor: colors.primary + '22',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  pbBadgeText: { color: colors.primary, fontSize: 9, fontWeight: '900' },
  sectorTime: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  sectorMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },

  cornersCard: {
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cornersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.m,
    paddingHorizontal: 4,
  },
  cornersTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  cornersSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  cornerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: spacing.s,
  },
  cornerIndex: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
    width: 30,
  },
  cornerBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bg,
    borderRadius: 3,
    overflow: 'hidden',
  },
  cornerBarFill: { height: '100%' },
  cornerSpeed: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    minWidth: 70,
    textAlign: 'right',
  },
  cornerUnit: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  cornerDelta: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 60,
    textAlign: 'right',
  },
});
