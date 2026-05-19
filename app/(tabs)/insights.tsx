import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeSmartInsights, InsightsBundle, SmartInsight } from '../../src/lib/insights';
import { Card, DecorativeSplash, Gauge, Icon } from '../../src/components/ui';
import { colors, spacing, typography } from '../../src/theme';

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export default function Insights() {
  const insets = useSafeAreaInsets();
  const [bundle, setBundle] = useState<InsightsBundle | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await computeSmartInsights({ window: 3 });
    setBundle(result);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={s.root}>
      <DecorativeSplash position="top-right" intensity="normal" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.s,
          paddingBottom: 120,
          paddingHorizontal: spacing.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.title}>INSIGHTS</Text>
        <Text style={s.subtitle}>SEU DESEMPENHO · ÚLTIMAS 3 SESSÕES</Text>

        {loading ? (
          <View style={s.loading}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={s.loadingText}>Analisando suas voltas…</Text>
          </View>
        ) : !bundle ? null : bundle.stats.lapCount === 0 ? (
          <EmptyView insights={bundle.insights} />
        ) : (
          <>
            {/* Score Gauge */}
            <View style={s.gaugeWrap}>
              <Gauge value={bundle.score} size={200} thickness={14} />
            </View>

            {/* Score breakdown */}
            <View style={s.breakdownRow}>
              <BreakdownPill label="CONSISTÊNCIA" value={bundle.scoreBreakdown.consistency} />
              <BreakdownPill label="PACE" value={bundle.scoreBreakdown.pace} />
              <BreakdownPill label="VOLTA LIMPA" value={bundle.scoreBreakdown.cleanLap} />
            </View>

            {/* Stats principais */}
            <View style={s.statsRow}>
              <Stat
                label="MELHOR"
                value={bundle.stats.bestLapMs != null ? fmtLap(bundle.stats.bestLapMs) : '—'}
                tone="primary"
              />
              <Stat
                label="MÉDIA"
                value={bundle.stats.avgLapMs != null ? fmtLap(bundle.stats.avgLapMs) : '—'}
              />
              <Stat label="VOLTAS" value={String(bundle.stats.lapCount)} />
              {bundle.stats.peakKmh > 0 && (
                <Stat label="PICO" value={`${bundle.stats.peakKmh.toFixed(0)} km/h`} tone="cyan" />
              )}
            </View>

            {/* Insights */}
            <View style={{ marginTop: spacing.xl, gap: spacing.m }}>
              {bundle.insights.map((ins, i) => (
                <InsightCard key={i} ins={ins} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'primary' | 'cyan';
}) {
  const color =
    tone === 'primary' ? colors.primary : tone === 'cyan' ? colors.accentCyan : colors.textPrimary;
  return (
    <View style={{ alignItems: 'center', flex: 1, minWidth: 70 }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, typography.mono, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function BreakdownPill({ label, value }: { label: string; value: number }) {
  // Cor depende da nota
  const color =
    value >= 80 ? colors.success : value >= 60 ? colors.warning : colors.danger;
  return (
    <View style={s.breakdownPill}>
      <Text style={s.breakdownLabel}>{label}</Text>
      <Text style={[s.breakdownValue, typography.mono, { color }]}>{value}</Text>
    </View>
  );
}

function InsightCard({ ins }: { ins: SmartInsight }) {
  const cfg = insightCfg[ins.type];
  return (
    <Card variant="elevated" padding="m">
      <View style={{ flexDirection: 'row', gap: spacing.m }}>
        <View style={[s.insightDot, { backgroundColor: cfg.color }]}>
          <Icon name={cfg.icon} size={16} color={colors.textOnPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.insightTag, { color: cfg.color }]}>{cfg.tag}</Text>
          <Text style={s.insightTitle}>{ins.title}</Text>
          <Text style={s.insightBody}>{ins.body}</Text>
        </View>
      </View>
    </Card>
  );
}

function EmptyView({ insights }: { insights: SmartInsight[] }) {
  return (
    <View style={s.empty}>
      <Icon name="bolt" size={48} color={colors.textDim} />
      <Text style={s.emptyTitle}>Sem dados ainda</Text>
      {insights.map((ins, i) => (
        <Text key={i} style={s.emptySub}>{ins.body}</Text>
      ))}
    </View>
  );
}

const insightCfg: Record<SmartInsight['type'], { color: string; icon: any; tag: string }> = {
  strong: { color: colors.success, icon: 'check', tag: 'PONTO FORTE' },
  attention: { color: colors.warning, icon: 'bolt', tag: 'FOQUE AQUI' },
  opportunity: { color: colors.accentCyan, icon: 'arrow-right', tag: 'OPORTUNIDADE' },
  trend: { color: colors.accentPurple, icon: 'chart', tag: 'TENDÊNCIA' },
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 8,
  },

  loading: {
    alignItems: 'center',
    marginTop: 100,
    gap: spacing.m,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },

  gaugeWrap: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },

  breakdownRow: {
    flexDirection: 'row',
    marginTop: spacing.l,
    gap: spacing.s,
  },
  breakdownPill: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.s,
    alignItems: 'center',
  },
  breakdownLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  breakdownValue: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },

  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.l,
    gap: spacing.s,
    flexWrap: 'wrap',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  insightDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightTag: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  insightTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  insightBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },

  empty: {
    alignItems: 'center',
    marginTop: 80,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginTop: spacing.m,
  },
  emptySub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
});
