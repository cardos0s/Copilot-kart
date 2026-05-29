/**
 * Ranking da competição in-app — o piloto vê sua posição entre voltas
 * (no box, num momento de respiro). Mesma fonte de dados do web
 * /event/[code], mas nativo.
 *
 * Resolve o código → evento → ranking agregado, e assina realtime pra
 * atualizar a cada volta nova de qualquer piloto.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  findEventByCode,
  loadEventRanking,
  subscribeEventLaps,
  type EventInfo,
  type EventRankingRow,
} from '../../src/lib/liveSession';
import { colors, spacing, typography } from '../../src/theme';

function fmtLap(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export default function RankingScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [ranking, setRanking] = useState<EventRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const ev = await findEventByCode(code);
      if (cancelled) return;
      if (!ev) {
        setError(`Competição "${code}" não encontrada.`);
        setLoading(false);
        return;
      }
      setEvent(ev);
      const rows = await loadEventRanking(ev.id);
      if (cancelled) return;
      setRanking(rows);
      setLoading(false);

      // Realtime: nova volta → reload debounced
      unsubscribe = subscribeEventLaps(ev.id, () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(async () => {
          const fresh = await loadEventRanking(ev.id);
          if (!cancelled) setRanking(fresh);
        }, 600);
      });
    })();

    return () => {
      cancelled = true;
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      unsubscribe?.();
    };
  }, [code]);

  const leaderBest = ranking.find((r) => r.bestLapMs != null)?.bestLapMs ?? null;

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.title}>🏁 RANKING</Text>
          <Text style={s.sub}>
            {event?.code ?? code} · {ranking.length} piloto(s)
          </Text>
        </View>
        <View style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.loadingTxt}>Carregando ranking…</Text>
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorTxt}>{error}</Text>
        </View>
      ) : ranking.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTxt}>Aguardando pilotos fecharem voltas…</Text>
        </View>
      ) : (
        <FlatList
          data={ranking}
          keyExtractor={(r, i) => `${r.pilotName}-${i}`}
          contentContainerStyle={{
            paddingHorizontal: spacing.l,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          renderItem={({ item, index }) => {
            const gap =
              item.bestLapMs != null && leaderBest != null && item.bestLapMs > leaderBest
                ? item.bestLapMs - leaderBest
                : null;
            const isLeader = index === 0 && item.bestLapMs != null;
            return (
              <View style={[s.row, isLeader && s.rowLeader]}>
                <Text style={[s.pos, isLeader && { color: colors.primary }]}>
                  {index + 1}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.pilot} numberOfLines={1}>
                    {item.pilotName}
                    {item.kartNumber ? `  #${item.kartNumber}` : ''}
                  </Text>
                  <Text style={s.last}>
                    última {item.lastLapMs != null ? fmtLap(item.lastLapMs) : '—'} ·{' '}
                    {item.lapCount} vlt
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.best, typography.mono]}>
                    {item.bestLapMs != null ? fmtLap(item.bestLapMs) : '—'}
                  </Text>
                  {gap != null && (
                    <Text style={[s.gap, typography.mono]}>
                      +{(gap / 1000).toFixed(3)}
                    </Text>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: colors.textPrimary, fontSize: 30, fontWeight: '300' },
  title: { color: colors.textPrimary, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  sub: { color: colors.textMuted, fontSize: 11, marginTop: 2, ...typography.mono },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingTxt: { color: colors.textSecondary, marginTop: spacing.m, fontSize: 14 },
  errorTxt: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  emptyTxt: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: 12,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    marginBottom: spacing.s,
  },
  rowLeader: {
    backgroundColor: colors.primary + '14',
    borderColor: colors.primary + '66',
  },
  pos: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: '900',
    width: 28,
    textAlign: 'center',
  },
  pilot: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  last: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  best: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  gap: { color: colors.danger, fontSize: 11, fontWeight: '700', marginTop: 2 },
});
