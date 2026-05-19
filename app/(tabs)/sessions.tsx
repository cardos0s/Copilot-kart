import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listSessions, Session, getLapsForSession } from '../../src/storage/db';
import { findTrackById } from '../../src/data/tracks';
import { TrackSilhouette } from '../../src/components/TrackSilhouette';
import { Card, DecorativeSplash, Icon, PillTabs } from '../../src/components/ui';
import { colors, spacing, typography } from '../../src/theme';

type Filter = 'all' | 'month' | 'year';

type SessionWithStats = Session & {
  bestLapMs: number | null;
  lapCount: number;
  bestSamples: any[] | null;
};

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isInMonth(ts: number, ref: Date) {
  const d = new Date(ts);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function isInYear(ts: number, ref: Date) {
  return new Date(ts).getFullYear() === ref.getFullYear();
}

export default function Sessions() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SessionWithStats[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    const list = await listSessions();
    const enriched = await Promise.all(
      list.map(async (sess) => {
        const laps = await getLapsForSession(sess.id);
        const best = laps.length ? laps.reduce((a, b) => (a.durationMs < b.durationMs ? a : b)) : null;
        return {
          ...sess,
          bestLapMs: best?.durationMs ?? null,
          lapCount: laps.length,
          bestSamples: best?.samples ?? null,
        };
      })
    );
    setItems(enriched);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const now = new Date();
    return items.filter((s) => {
      if (filter === 'month') return isInMonth(s.startedAt, now);
      if (filter === 'year') return isInYear(s.startedAt, now);
      return true;
    });
  }, [items, filter]);

  return (
    <View style={s.root}>
      <DecorativeSplash position="top-left" intensity="subtle" palette={['magenta', 'purple']} />
      <View style={[s.header, { paddingTop: insets.top + spacing.s }]}>
        <Text style={s.title}>HISTÓRICO DE SESSÕES</Text>
      </View>

      <View style={s.filterRow}>
        <PillTabs<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'month', label: 'Este mês' },
            { value: 'year', label: 'Este ano' },
          ]}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{
          paddingHorizontal: spacing.l,
          paddingBottom: 120,
          gap: spacing.m,
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>
              {filter === 'all' ? 'Sem sessões ainda' : 'Sem sessões nesse período'}
            </Text>
            <Text style={s.emptySub}>
              {filter === 'all'
                ? 'Inicie uma sessão pela home pra começar a registrar suas voltas.'
                : 'Tente alterar o filtro.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => <SessionRow item={item} onPress={() => router.push(`/session/${item.id}`)} />}
      />
    </View>
  );
}

function SessionRow({ item, onPress }: { item: SessionWithStats; onPress: () => void }) {
  const track = item.trackId ? findTrackById(item.trackId) : null;
  return (
    <Card variant="elevated" padding="m" onPress={onPress}>
      <View style={{ flexDirection: 'row', gap: spacing.m, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTrack} numberOfLines={1}>
            {track?.shortName ?? item.trackName}
          </Text>
          <Text style={s.rowDate}>
            {fmtDate(item.startedAt)} · {fmtTime(item.startedAt)}
          </Text>
          <View style={{ marginTop: spacing.s }}>
            <Text style={s.rowMetricLabel}>MELHOR VOLTA</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.s }}>
              <Text style={[s.rowMetric, typography.mono]}>
                {item.bestLapMs != null ? fmtLap(item.bestLapMs) : '—'}
              </Text>
              <Text style={s.rowLaps}>
                {item.lapCount} {item.lapCount === 1 ? 'volta' : 'voltas'}
              </Text>
            </View>
          </View>
        </View>

        {item.bestSamples && item.bestSamples.length > 1 ? (
          <View style={s.thumb}>
            <TrackSilhouette samples={item.bestSamples} width={86} height={70} strokeWidth={2} />
          </View>
        ) : (
          <View style={s.thumbEmpty}>
            <Icon name="map" color={colors.textDim} size={24} />
          </View>
        )}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
    alignItems: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  filterRow: {
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
    flexDirection: 'row',
  },
  rowTrack: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  rowDate: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  rowMetricLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  rowMetric: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  rowLaps: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  thumb: {
    width: 90,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmpty: {
    width: 90,
    height: 70,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  emptySub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
});
