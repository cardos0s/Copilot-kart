import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeSmartInsights, InsightsBundle, SmartInsight } from '../../src/lib/insights';
import { AiChatThreadSummary, listAiChatThreads } from '../../src/storage/db';
import { getClient } from '../../src/lib/llm';
import { Card, DecorativeSplash, Gauge, Icon, PillTabs } from '../../src/components/ui';
import { colors, radius, spacing, typography } from '../../src/theme';

type Tab = 'trends' | 'coach';

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / (1000 * 60));
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d atrás`;
  const date = new Date(ms);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function Insights() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('trends');

  return (
    <View style={s.root}>
      <DecorativeSplash position="top-right" intensity="normal" />
      <View style={{ paddingTop: insets.top + spacing.s, paddingHorizontal: spacing.l }}>
        <Text style={s.title}>INSIGHTS</Text>
        <View style={{ marginTop: spacing.m }}>
          <PillTabs<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'trends', label: 'Tendências' },
              { value: 'coach', label: 'Coach IA' },
            ]}
          />
        </View>
      </View>
      {tab === 'trends' ? <TrendsTab /> : <CoachTab />}
    </View>
  );
}

// ===== Quick actions (atalhos gamification) =====

function QuickActions() {
  const router = useRouter();
  return (
    <View style={s.quickActions}>
      <QuickCard
        label="Carreira"
        emoji="◆"
        onPress={() => router.push('/career' as any)}
      />
      <QuickCard
        label="Desafios"
        emoji="🔥"
        onPress={() => router.push('/challenges' as any)}
      />
      <QuickCard
        label="Recap"
        emoji="✦"
        onPress={() => router.push('/recap' as any)}
      />
    </View>
  );
}

function QuickCard({
  label,
  emoji,
  onPress,
}: {
  label: string;
  emoji: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.quickCard, pressed && { opacity: 0.7 }]}
    >
      <Text style={s.quickEmoji}>{emoji}</Text>
      <Text style={s.quickLabel}>{label}</Text>
    </Pressable>
  );
}

// ===== Aba Tendências =====

function TrendsTab() {
  const insets = useSafeAreaInsets();
  const [bundle, setBundle] = useState<InsightsBundle | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await computeSmartInsights({ window: 3 });
      setBundle(result);
    } catch {
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: spacing.m,
        paddingBottom: insets.bottom + 120,
        paddingHorizontal: spacing.l,
      }}
      showsVerticalScrollIndicator={false}
    >
      <QuickActions />

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
          <View style={s.gaugeWrap}>
            <Gauge value={bundle.score} size={200} thickness={14} />
          </View>

          <View style={s.breakdownRow}>
            <BreakdownPill label="CONSISTÊNCIA" value={bundle.scoreBreakdown.consistency} />
            <BreakdownPill label="PACE" value={bundle.scoreBreakdown.pace} />
            <BreakdownPill label="VOLTA LIMPA" value={bundle.scoreBreakdown.cleanLap} />
          </View>

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

          <View style={{ marginTop: spacing.xl, gap: spacing.m }}>
            {bundle.insights.map((ins, i) => (
              <InsightCard key={i} ins={ins} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ===== Aba Coach IA =====

function CoachTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [threads, setThreads] = useState<AiChatThreadSummary[] | null>(null);

  const load = useCallback(async () => {
    const t = await listAiChatThreads(50);
    setThreads(t);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (threads === null) {
    return (
      <View style={[s.loading, { flex: 1 }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (threads.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.l,
          paddingBottom: insets.bottom + 120,
        }}
      >
        <View style={s.empty}>
          <Icon name="bolt" size={48} color={colors.textDim} />
          <Text style={s.emptyTitle}>Sem conversas ainda</Text>
          <Text style={s.emptySub}>
            Abra qualquer sessão, escolha uma volta e toque em "Perguntar pra IA" pra
            começar. As conversas ficam aqui pra você reabrir depois.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: spacing.m,
        paddingBottom: insets.bottom + 120,
        paddingHorizontal: spacing.l,
        gap: spacing.s,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={s.subtitle}>CONVERSAS RECENTES</Text>
      <View style={{ marginTop: spacing.m, gap: spacing.s }}>
        {threads.map((t) => (
          <ThreadCard
            key={t.cacheKey}
            thread={t}
            onPress={() =>
              router.push({
                pathname: '/coach' as any,
                params: { sessionId: t.sessionId, lapId: t.lapId },
              })
            }
          />
        ))}
      </View>
    </ScrollView>
  );
}

function ThreadCard({
  thread,
  onPress,
}: {
  thread: AiChatThreadSummary;
  onPress: () => void;
}) {
  const providerName = (() => {
    try {
      return getClient(thread.provider as any).meta.displayName;
    } catch {
      return thread.provider;
    }
  })();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.threadCard, pressed && { opacity: 0.7 }]}
    >
      <View style={s.threadHeader}>
        <Text style={s.threadTrack} numberOfLines={1}>
          {thread.trackName ?? 'Sessão removida'}
        </Text>
        <Text style={s.threadTime}>{relativeTime(thread.updatedAt)}</Text>
      </View>
      <View style={s.threadMetaRow}>
        {thread.lapDurationMs != null && (
          <Text style={[s.threadLap, typography.mono]}>{fmtLap(thread.lapDurationMs)}</Text>
        )}
        <View style={s.threadProvider}>
          <Text style={s.threadProviderText}>{providerName}</Text>
        </View>
        <Text style={s.threadMsgCount}>
          {Math.max(0, Math.floor((thread.messageCount - 1) / 2))} pergunta{thread.messageCount > 3 ? 's' : ''}
        </Text>
      </View>
      <Text style={s.threadPreview} numberOfLines={2}>
        {thread.preview}
      </Text>
    </Pressable>
  );
}

// ===== Componentes reutilizados (TrendsTab) =====

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

  threadCard: {
    padding: spacing.m,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s,
  },
  threadTrack: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  threadTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  threadMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
  },
  threadLap: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  threadProvider: {
    backgroundColor: colors.accentPurple + '22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  threadProviderText: {
    color: colors.accentPurple,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  threadMsgCount: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  threadPreview: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },

  quickActions: {
    flexDirection: 'row',
    gap: spacing.s,
    marginBottom: spacing.l,
  },
  quickCard: {
    flex: 1,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.l,
    alignItems: 'center',
  },
  quickEmoji: { fontSize: 22, marginBottom: 4 },
  quickLabel: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
