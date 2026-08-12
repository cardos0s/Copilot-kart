import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import {
  listSessions,
  Session,
  getLapsForSession,
  deleteSession,
} from '../../src/storage/db';
import { findTrackById } from '../../src/data/tracks';
import { TrackSilhouette } from '../../src/components/TrackSilhouette';
import { Icon, PillTabs } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/theme';

const BLUE = colors.racingBlue;
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

type Filter = 'all' | 'month' | 'year';

type SessionWithStats = Session & {
  bestLapMs: number | null;
  lapCount: number;
  bestSamples: any[] | null;
};

/** Tempo curto: "42.999" (<1min) ou "1:02.500". */
function fmtShort(ms: number) {
  if (ms < 60000) return (ms / 1000).toFixed(3);
  const m = Math.floor(ms / 60000);
  return `${m}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}
/** Recorde: "00:41.000". */
function fmtRecord(ms: number) {
  const m = Math.floor(ms / 60000);
  return `${String(m).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}
function fmtDelta(ms: number) {
  return `+${(ms / 1000).toFixed(3)}`;
}
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dayLabel(ts: number) {
  const today = startOfDay(Date.now());
  const d = startOfDay(ts);
  if (d === today) return 'HOJE';
  if (today - d === 86400000) return 'ONTEM';
  const dt = new Date(ts);
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
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

  // Recorde absoluto (entre todas as sessões) — define o delta de cada row.
  const { recordMs, recordId, recordTrack } = useMemo(() => {
    let rMs: number | null = null;
    let rId: string | null = null;
    let rTrack = '';
    for (const it of items) {
      if (it.bestLapMs != null && (rMs == null || it.bestLapMs < rMs)) {
        rMs = it.bestLapMs;
        rId = it.id;
        rTrack = findTrackById(it.trackId ?? '')?.shortName ?? it.trackName;
      }
    }
    return { recordMs: rMs, recordId: rId, recordTrack: rTrack };
  }, [items]);

  const monthCount = useMemo(() => {
    const now = new Date();
    return items.filter((s) => isInMonth(s.startedAt, now)).length;
  }, [items]);

  const sections = useMemo(() => {
    const now = new Date();
    const filtered = items.filter((s) => {
      if (filter === 'month') return isInMonth(s.startedAt, now);
      if (filter === 'year') return isInYear(s.startedAt, now);
      return true;
    });
    const groups = new Map<number, SessionWithStats[]>();
    for (const it of filtered) {
      const k = startOfDay(it.startedAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([k, data]) => ({ title: dayLabel(k), data }));
  }, [items, filter]);

  const handleDelete = useCallback(
    (sess: SessionWithStats) => {
      Alert.alert(
        'Excluir sessão?',
        `${sess.trackName} · ${fmtDate(sess.startedAt)}\n\nEssa ação não pode ser desfeita. As ${sess.lapCount} volta(s) serão apagadas.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Excluir', style: 'destructive', onPress: async () => { await deleteSession(sess.id); await load(); } },
        ]
      );
    },
    [load]
  );

  return (
    <View style={s.root}>
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

      <SectionList
        sections={sections}
        keyExtractor={(it) => it.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: spacing.l, paddingBottom: 120 }}
        ListHeaderComponent={
          <View style={s.summaryRow}>
            <View style={s.recordCard}>
              <View style={s.recordTop}>
                <Text style={s.trophy}>🏆</Text>
                <Text style={s.recordLabel}>RECORDE</Text>
              </View>
              <Text style={s.recordTime}>{recordMs != null ? fmtRecord(recordMs) : '—'}</Text>
              <Text style={s.recordTrack} numberOfLines={1}>{recordTrack || '—'}</Text>
            </View>
            <View style={s.summaryCol}>
              <View style={s.miniCard}>
                <Text style={s.miniLabel}>SESSÕES</Text>
                <Text style={s.miniValue}>{items.length}</Text>
              </View>
              <View style={s.miniCard}>
                <Text style={s.miniLabel}>ESTE MÊS</Text>
                <Text style={s.miniValue}>{monthCount}</Text>
              </View>
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={s.sectionLabel}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <SessionRow
            item={item}
            isRecord={item.id === recordId}
            deltaMs={item.bestLapMs != null && recordMs != null ? item.bestLapMs - recordMs : null}
            onPress={() => router.push(`/session/${item.id}`)}
            onDelete={() => handleDelete(item)}
          />
        )}
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
      />
    </View>
  );
}

function SessionRow({
  item,
  isRecord,
  deltaMs,
  onPress,
  onDelete,
}: {
  item: SessionWithStats;
  isRecord: boolean;
  deltaMs: number | null;
  onPress: () => void;
  onDelete: () => void;
}) {
  const track = item.trackId ? findTrackById(item.trackId) : null;
  const swipeRef = useRef<SwipeableMethods>(null);

  const handleDelete = () => {
    swipeRef.current?.close();
    onDelete();
  };

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={48}
      renderRightActions={(progress) => <RightDeleteAction progress={progress} onPress={handleDelete} />}
      overshootRight={false}
      containerStyle={{ marginBottom: spacing.m }}
    >
      <Pressable style={({ pressed }) => [s.card, isRecord && s.cardRecord, pressed && { opacity: 0.85 }]} onPress={onPress}>
        <View style={s.iconBox}>
          {item.bestSamples && item.bestSamples.length > 1 ? (
            <TrackSilhouette samples={item.bestSamples} width={48} height={40} strokeWidth={2} />
          ) : (
            <Icon name="map" color={colors.textDim} size={22} />
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.nameRow}>
            <Text style={s.rowTrack} numberOfLines={1}>{track?.shortName ?? item.trackName}</Text>
            {isRecord && (
              <View style={s.badge}>
                <Text style={s.badgeText}>RECORDE</Text>
              </View>
            )}
          </View>
          <Text style={s.rowMeta}>
            {fmtTime(item.startedAt)} · {item.lapCount} {item.lapCount === 1 ? 'volta' : 'voltas'}
          </Text>
        </View>

        <View style={s.rightCol}>
          <Text style={s.bigLap}>{item.bestLapMs != null ? fmtShort(item.bestLapMs) : '—'}</Text>
          <Text style={[s.delta, isRecord && s.deltaRecord]}>
            {isRecord ? 'sua melhor' : deltaMs != null ? fmtDelta(deltaMs) : ''}
          </Text>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function RightDeleteAction({ progress, onPress }: { progress: { value: number }; onPress: () => void }) {
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [80, 0]) }],
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.6, 1]),
  }));
  return (
    <Animated.View style={[s.swipeAction, containerStyle]}>
      <Pressable onPress={onPress} style={s.swipeActionInner}>
        <Icon name="trash" size={22} color="#fff" />
        <Text style={s.swipeActionText}>Excluir</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.l, paddingBottom: spacing.m, alignItems: 'center' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  filterRow: { paddingHorizontal: spacing.l, paddingBottom: spacing.m, flexDirection: 'row' },

  summaryRow: { flexDirection: 'row', gap: spacing.s, marginBottom: spacing.l },
  recordCard: { flex: 1.5, padding: spacing.l, borderRadius: radius.l, backgroundColor: 'rgba(37, 99, 255,0.07)', borderWidth: 1.5, borderColor: BLUE },
  recordTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trophy: { fontSize: 14 },
  recordLabel: { color: BLUE, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  recordTime: { color: colors.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: -0.5, marginTop: spacing.s, fontVariant: ['tabular-nums'] },
  recordTrack: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 4 },
  summaryCol: { flex: 1, gap: spacing.s },
  miniCard: { flex: 1, padding: spacing.m, borderRadius: radius.m, backgroundColor: colors.surface, justifyContent: 'center' },
  miniLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  miniValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', marginTop: 2 },

  sectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: spacing.m, marginBottom: spacing.s },

  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, padding: spacing.m, borderRadius: radius.l, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'transparent' },
  cardRecord: { borderColor: BLUE, backgroundColor: 'rgba(37, 99, 255,0.05)' },
  iconBox: { width: 60, height: 56, borderRadius: 14, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  rowTrack: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  badge: { backgroundColor: BLUE, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  rowMeta: { color: colors.textMuted, fontSize: 13, fontWeight: '500', marginTop: 3 },
  rightCol: { alignItems: 'flex-end' },
  bigLap: { color: BLUE, fontSize: 24, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  delta: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  deltaRecord: { color: colors.textSecondary, fontStyle: 'italic' },

  empty: { paddingTop: 80, alignItems: 'center', paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  emptySub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 19 },

  swipeAction: { width: 88, justifyContent: 'center', paddingLeft: spacing.s },
  swipeActionInner: { flex: 1, backgroundColor: colors.danger, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
});
