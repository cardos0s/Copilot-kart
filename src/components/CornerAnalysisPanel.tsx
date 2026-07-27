import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CornerMetric, fmtAzimuth } from '../lib/cornerAnalysis';
import { colors, radius, spacing, typography } from '../theme';

type Props = {
  metrics: CornerMetric[];
  /** True quando a volta selecionada é a própria referência (sem comparativos). */
  isReference: boolean;
  /** Toque num card → foca a curva no mapa. */
  onCornerTap?: (metric: CornerMetric) => void;
};

/**
 * Painel "Curvas" — análise profissional por curva: azimute de entrada/saída,
 * ângulo varrido, direção, velocidade de ápice e delta vs referência.
 */
export function CornerAnalysisPanel({ metrics, isReference, onCornerTap }: Props) {
  if (metrics.length === 0) {
    return (
      <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
        <Text style={p.emptyText}>
          Nenhuma curva detectada nessa volta — traçado curto demais ou GPS
          com pouco sinal.
        </Text>
      </View>
    );
  }

  const totalAngle = metrics.reduce((acc, m) => acc + m.angleDeg, 0);
  const lefts = metrics.filter((m) => m.direction === 'left').length;
  const rights = metrics.length - lefts;

  // Curva com maior perda de tempo (só entre válidas com delta)
  const worst = metrics
    .filter((m) => m.valid && m.deltaMs !== null)
    .sort((a, b) => (b.deltaMs ?? 0) - (a.deltaMs ?? 0))[0];

  return (
    <View style={{ paddingHorizontal: spacing.l, paddingTop: spacing.l }}>
      <View style={p.summaryRow}>
        <SummaryStat value={`${metrics.length}`} label="curvas" />
        <SummaryStat value={`${lefts}◀ ${rights}▶`} label="esq · dir" />
        <SummaryStat value={`${Math.round(totalAngle)}°`} label="rotação total" />
      </View>

      {worst && (worst.deltaMs ?? 0) > 100 && (
        <View style={p.insightBanner}>
          <Text style={p.insightText}>
            Maior perda: <Text style={p.insightStrong}>{worst.corner.name}</Text>
            {' '}({fmtDeltaS(worst.deltaMs!)}s). Foco aí na próxima bateria.
          </Text>
        </View>
      )}

      {metrics.map((m) => (
        <CornerCard
          key={m.corner.index}
          metric={m}
          isReference={isReference}
          onPress={onCornerTap ? () => onCornerTap(m) : undefined}
        />
      ))}

      <Text style={p.hint}>
        Azimute em graus de bússola (0° = Norte). Toque numa curva pra ver no mapa.
      </Text>
    </View>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={p.summaryStat}>
      <Text style={[p.summaryValue, typography.mono]}>{value}</Text>
      <Text style={p.summaryLabel}>{label}</Text>
    </View>
  );
}

function fmtDeltaS(ms: number): string {
  const sign = ms >= 0 ? '+' : '−';
  return `${sign}${Math.abs(ms / 1000).toFixed(2)}`;
}

/** Setinha de bússola: aponta pra cima e gira pelo azimute (horário). */
function AzimuthGlyph({ azimuthDeg, color }: { azimuthDeg: number; color: string }) {
  return (
    <Svg width={16} height={16} viewBox="-8 -8 16 16">
      <Path
        d="M0,6 L0,-6 M-3,-2.5 L0,-6 L3,-2.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        transform={`rotate(${azimuthDeg})`}
      />
    </Svg>
  );
}

function CornerCard({
  metric: m,
  isReference,
  onPress,
}: {
  metric: CornerMetric;
  isReference: boolean;
  onPress?: () => void;
}) {
  const isLeft = m.direction === 'left';
  const dirColor = isLeft ? colors.accentCyan : colors.accentOrange;

  // "Entrou mais aberto/fechado" só quando o desvio supera o ruído do GPS (~6°)
  const openInsight =
    !isReference && m.entryOpenDeg !== null && Math.abs(m.entryOpenDeg) >= 6
      ? m.entryOpenDeg > 0
        ? `Entrada ${Math.round(m.entryOpenDeg)}° mais aberta que a referência`
        : `Entrada ${Math.round(-m.entryOpenDeg)}° mais fechada que a referência`
      : null;

  const speedLoss =
    m.minSpeedKmh !== null && m.refMinSpeedKmh !== null
      ? m.minSpeedKmh - m.refMinSpeedKmh
      : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [p.card, pressed && { opacity: 0.65 }]}
    >
      <View style={[p.dirBar, { backgroundColor: dirColor }]} />
      <View style={{ flex: 1 }}>
        <View style={p.cardHeader}>
          <Text style={p.cardTitle}>{m.corner.name.toUpperCase()}</Text>
          <View style={[p.dirChip, { borderColor: dirColor }]}>
            <Text style={[p.dirChipText, { color: dirColor }]}>
              {isLeft ? '◀ ESQ' : 'DIR ▶'} · {Math.round(m.angleDeg)}°
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          {!isReference && m.valid && m.deltaMs !== null && (
            <Text
              style={[
                p.cardDelta,
                typography.mono,
                { color: m.deltaMs > 0 ? colors.danger : colors.success },
              ]}
            >
              {fmtDeltaS(m.deltaMs)}
            </Text>
          )}
          {!m.valid && <Text style={p.invalidTag}>sem dados</Text>}
        </View>

        {/* Azimute entrada → saída */}
        <View style={p.azRow}>
          <AzimuthGlyph azimuthDeg={m.entryAzimuthDeg} color={colors.accentLime} />
          <Text style={[p.azText, typography.mono]}>{fmtAzimuth(m.entryAzimuthDeg)}</Text>
          <Text style={p.azArrowSep}>→</Text>
          <AzimuthGlyph azimuthDeg={m.exitAzimuthDeg} color={colors.textSecondary} />
          <Text style={[p.azText, typography.mono]}>{fmtAzimuth(m.exitAzimuthDeg)}</Text>
        </View>

        {/* Velocidade de ápice */}
        {m.minSpeedKmh !== null && (
          <Text style={p.speedRow}>
            Ápice{' '}
            <Text style={[p.speedValue, typography.mono]}>
              {m.minSpeedKmh.toFixed(0)} km/h
            </Text>
            {speedLoss !== null && Math.abs(speedLoss) >= 1 && (
              <Text
                style={{ color: speedLoss < 0 ? colors.danger : colors.success }}
              >
                {'  '}{speedLoss > 0 ? '+' : ''}{speedLoss.toFixed(0)} vs ref
              </Text>
            )}
          </Text>
        )}

        {openInsight && <Text style={p.openInsight}>{openInsight}</Text>}
      </View>
    </Pressable>
  );
}

const p = StyleSheet.create({
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  summaryStat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.m,
    alignItems: 'center',
  },
  summaryValue: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  summaryLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: 2,
  },
  insightBanner: {
    backgroundColor: colors.primaryGlow,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.borderActive,
    padding: spacing.m,
    marginBottom: spacing.m,
  },
  insightText: {
    ...typography.bodyS,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  insightStrong: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.s,
    overflow: 'hidden',
  },
  dirBar: {
    width: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingTop: spacing.m,
    paddingHorizontal: spacing.m,
  },
  cardTitle: {
    ...typography.labelL,
    color: colors.textPrimary,
  },
  dirChip: {
    borderWidth: 1,
    borderRadius: radius.s,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  dirChipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardDelta: {
    ...typography.h3,
  },
  invalidTag: {
    ...typography.label,
    color: colors.textMuted,
  },
  azRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
  },
  azText: {
    ...typography.bodyS,
    color: colors.textSecondary,
  },
  azArrowSep: {
    color: colors.textMuted,
    paddingHorizontal: 2,
  },
  speedRow: {
    ...typography.bodyS,
    color: colors.textSecondary,
    paddingHorizontal: spacing.m,
    paddingTop: spacing.xs,
    paddingBottom: spacing.m,
  },
  speedValue: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  openInsight: {
    ...typography.bodyS,
    color: colors.accentLime,
    paddingHorizontal: spacing.m,
    paddingBottom: spacing.m,
    marginTop: -spacing.xs,
  },
  hint: {
    ...typography.bodyS,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.m,
  },
});
