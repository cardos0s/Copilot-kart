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
import { Icon, PillTabs, tabBarSpace } from '../../src/components/ui';
import { colors, fonts, radius, spacing } from '../../src/theme';

const BLUE = colors.racingBlue;
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

type Filter = 'all' | 'month' | 'year';

type Row =
  | { kind: 'session'; session: SessionWithStats }
  | { kind: 'empty'; title: string; count: number };

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
/** Cabeçalho de grupo: "27 JUL". */
function fmtDay(ts: number) {
  return new Date(ts)
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    .toUpperCase()
    .replace('.', '');
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

  /** Datas com o grupo de sessões sem volta aberto. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const sections = useMemo(() => {
    const now = new Date();
    const filtered = items.filter((s) => {
      if (filter === 'month') return isInMonth(s.startedAt, now);
      if (filter === 'year') return isInYear(s.startedAt, now);
      return true;
    });
    const byDay = new Map<string, SessionWithStats[]>();
    for (const it of filtered) {
      const key = fmtDay(it.startedAt);
      const arr = byDay.get(key) ?? [];
      arr.push(it);
      byDay.set(key, arr);
    }

    // Sessão sem volta registrada é ruído no histórico — o piloto abriu e não
    // rodou. Elas somem numa linha só por dia, que abre se ele quiser ver.
    return Array.from(byDay.entries()).map(([title, list]) => {
      const withLaps = list.filter((x) => x.lapCount > 0);
      const empty = list.filter((x) => x.lapCount === 0);
      const isOpen = expanded.has(title);
      const data: Row[] = withLaps.map((session) => ({ kind: 'session' as const, session }));
      if (empty.length > 0) {
        data.push({ kind: 'empty' as const, title, count: empty.length });
        if (isOpen) {
          for (const session of empty) data.push({ kind: 'session' as const, session });
        }
      }
      return { title, data };
    });
  }, [items, filter, expanded]);

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
        <Text style={s.title}>Sessões</Text>
      </View>

      <View style={s.stats}>
        <View style={s.statCol}>
          <Text style={s.statLabel}>RECORDE</Text>
          <Text style={[s.statValue, { color: colors.blueSoft }]}>
            {recordMs != null ? fmtShort(recordMs) : '—'}
          </Text>
        </View>
        <View style={s.statRule} />
        <View style={s.statCol}>
          <Text style={s.statLabel}>SESSÕES</Text>
          <Text style={s.statValue}>{items.length}</Text>
        </View>
        <View style={s.statRule} />
        <View style={s.statCol}>
          <Text style={s.statLabel}>ESTE MÊS</Text>
          <Text style={s.statValue}>{monthCount}</Text>
        </View>
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
        keyExtractor={(row) => (row.kind === 'session' ? row.session.id : `empty-${row.title}`)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.gutter,
          paddingBottom: tabBarSpace(insets.bottom, 24),
        }}
        renderSectionHeader={({ section }) => (
          <Text style={s.sectionLabel}>{section.title}</Text>
        )}
        renderItem={({ item: row }) =>
          row.kind === 'empty' ? (
            <Pressable
              onPress={() => toggleExpanded(row.title)}
              style={({ pressed }) => [s.emptyRow, pressed && { opacity: 0.7 }]}
            >
              <View style={s.emptyDot} />
              <Text style={s.emptyRowText}>
                {row.count} {row.count === 1 ? 'sessão' : 'sessões'} sem voltas registradas
              </Text>
              <Text style={s.chevron}>{expanded.has(row.title) ? '⌄' : '›'}</Text>
            </Pressable>
          ) : (
            <SessionRow
              item={row.session}
              isRecord={row.session.id === recordId}
              matchesRecord={
                row.session.id !== recordId &&
                row.session.bestLapMs != null &&
                recordMs != null &&
                row.session.bestLapMs === recordMs
              }
              deltaMs={
                row.session.bestLapMs != null && recordMs != null
                  ? row.session.bestLapMs - recordMs
                  : null
              }
              onPress={() => router.push(`/session/${row.session.id}`)}
              onDelete={() => handleDelete(row.session)}
            />
          )
        }
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
  matchesRecord,
  deltaMs,
  onPress,
  onDelete,
}: {
  item: SessionWithStats;
  isRecord: boolean;
  /** Bateu o mesmo tempo do recorde, mas não é a sessão que o marcou. */
  matchesRecord: boolean;
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
      containerStyle={{}}
    >
      <Pressable
        style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
        onPress={onPress}
      >
        <View style={s.rowShape}>
          {item.bestSamples && item.bestSamples.length > 1 ? (
            <TrackSilhouette samples={item.bestSamples} width={62} height={52} strokeWidth={2} />
          ) : (
            <Icon name="map" color={colors.textDim} size={22} />
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.nameRow}>
            <Text style={s.rowTrack} numberOfLines={1}>
              {track?.shortName ?? item.trackName}
            </Text>
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
          <Text style={[s.bigLap, isRecord && { color: colors.blueSoft }]}>
            {item.bestLapMs != null ? fmtShort(item.bestLapMs) : '—'}
          </Text>
          {isRecord ? (
            <Text style={s.tagBest}>SUA MELHOR</Text>
          ) : matchesRecord ? (
            <Text style={s.tagTie}>IGUALA O RECORDE</Text>
          ) : deltaMs != null ? (
            <Text style={s.delta}>{fmtDelta(deltaMs)}</Text>
          ) : null}
        </View>

        <Text style={s.chevron}>›</Text>
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
  stats: {
    flexDirection: 'row',
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.xxl,
  },
  statCol: { flex: 1 },
  statRule: { width: 1, backgroundColor: colors.line, marginHorizontal: spacing.l },
  statLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1.2, color: colors.muted },
  statValue: {
    fontFamily: fonts.monoMedium,
    fontSize: 28,
    letterSpacing: -0.8,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.l,
    paddingVertical: spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowShape: { width: 62, alignItems: 'center' },
  rightCol: { alignItems: 'flex-end' },
  tagBest: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.9,
    color: colors.blueSoft,
    marginTop: 4,
  },
  tagTie: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.9,
    color: colors.muted,
    marginTop: 4,
  },
  chevron: { fontFamily: fonts.regular, fontSize: 22, color: colors.dim },

  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.l,
    paddingVertical: spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  emptyDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    backgroundColor: colors.surfaceRail,
    marginLeft: 28,
  },
  emptyRowText: { flex: 1, fontFamily: fonts.regular, fontSize: 15.5, color: colors.muted },

  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xl },
  title: { fontFamily: fonts.bold, fontSize: 34, letterSpacing: -1, color: colors.text },
  filterRow: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xl, flexDirection: 'row' },


  sectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.muted,
    marginTop: spacing.xxl,
    marginBottom: spacing.s,
  },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  rowTrack: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  badge: { backgroundColor: colors.blue, borderRadius: radius.xs, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.9, color: '#fff' },
  rowMeta: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 3 },
  bigLap: {
    fontFamily: fonts.monoMedium,
    fontSize: 26,
    letterSpacing: -0.8,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  delta: {
    fontFamily: fonts.monoMedium,
    fontSize: 15,
    color: colors.danger,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },

  empty: { paddingTop: 80, alignItems: 'center', paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  emptySub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 19 },

  swipeAction: { width: 88, justifyContent: 'center', paddingLeft: spacing.s },
  swipeActionInner: { flex: 1, backgroundColor: colors.danger, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
});
