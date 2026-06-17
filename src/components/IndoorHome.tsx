import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchLeaderboard, LeaderboardEntry } from '../lib/leaderboard';
import { TRACKS, findTrackById } from '../data/tracks';
import { getProfile } from '../storage/profile';
import { Icon } from './ui';
import { colors, radius, spacing } from '../theme';

const BLUE = colors.racingBlue;

function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const POS_COLORS = ['#F5C84B', '#C9D2DE', '#D98A4B']; // ouro / prata / bronze

export function IndoorHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [trackId, setTrackId] = useState<string>(TRACKS[0].id);
  const [mode, setMode] = useState<'today' | 'all'>('today');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [myName, setMyName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const prof = await getProfile();
    setMyName(prof?.name ?? null);
    const since = mode === 'today' ? startOfTodayMs() : undefined;
    const data = await fetchLeaderboard(trackId, null, 30, since);
    setEntries(data);
    setLoading(false);
  }, [trackId, mode]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const track = findTrackById(trackId);
  const trackName = track?.shortName ?? track?.name ?? 'Pista';
  const myIndex = myName ? entries.findIndex((e) => e.pilotName === myName) : -1;

  const handleShare = () => {
    const my = myIndex >= 0 ? entries[myIndex] : null;
    const msg = my
      ? `Tô em #${myIndex + 1} de ${entries.length} em ${trackName} no Cockpit 🏁 Melhor volta: ${fmtLap(my.bestLapMs)}. Vem me pegar!`
      : `Ranking de ${trackName} no Cockpit 🏁 Bora competir!`;
    Share.share({ message: msg }).catch(() => {});
  };

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.l }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.huge * 2, paddingHorizontal: spacing.l }}
        showsVerticalScrollIndicator={false}
      >
        {/* Cabeçalho */}
        <Text style={s.kicker}>MODO INDOOR · COMPETIÇÃO</Text>
        <View style={s.headerRow}>
          <Text style={s.title}>RANKING</Text>
          <Pressable style={s.shareBtn} hitSlop={8} onPress={handleShare}>
            <Text style={s.shareIcon}>↗</Text>
          </Pressable>
        </View>

        {/* Seletor de pista */}
        <Pressable style={s.trackChip} onPress={() => setPickerOpen(true)}>
          <Icon name="map" size={16} color={BLUE} />
          <Text style={s.trackChipText} numberOfLines={1}>{trackName}</Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </Pressable>

        {/* Hoje / Geral */}
        <View style={s.segment}>
          {(['today', 'all'] as const).map((m) => (
            <Pressable
              key={m}
              style={[s.segItem, mode === m && s.segItemActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[s.segText, mode === m && s.segTextActive]}>
                {m === 'today' ? 'Hoje' : 'Geral'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Sua posição */}
        {!loading && (
          <View style={s.youCard}>
            {myIndex >= 0 ? (
              <Text style={s.youText}>
                Você é <Text style={s.youHi}>#{myIndex + 1}</Text> de {entries.length}
                {'  ·  '}
                <Text style={s.youHi}>{fmtLap(entries[myIndex].bestLapMs)}</Text>
              </Text>
            ) : (
              <Text style={s.youTextMuted}>
                {mode === 'today'
                  ? 'Você ainda não marcou tempo hoje. Bora pra pista!'
                  : 'Marque um tempo aqui pra entrar no ranking.'}
              </Text>
            )}
          </View>
        )}

        {/* Lista */}
        {loading ? (
          <ActivityIndicator color={BLUE} style={{ marginTop: spacing.xxl }} />
        ) : entries.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Sem tempos {mode === 'today' ? 'hoje' : 'ainda'}</Text>
            <Text style={s.emptyText}>Seja o primeiro a cravar uma volta em {trackName}.</Text>
          </View>
        ) : (
          entries.map((e, i) => {
            const isMe = myName != null && e.pilotName === myName;
            return (
              <View key={e.id} style={[s.row, isMe && s.rowMe]}>
                <View style={[s.pos, i < 3 && { backgroundColor: POS_COLORS[i] }]}>
                  <Text style={[s.posText, i < 3 && { color: '#08080C' }]}>{i + 1}</Text>
                </View>
                <View style={s.rowBody}>
                  <Text style={[s.rowName, isMe && s.rowNameMe]} numberOfLines={1}>
                    {e.pilotName ?? 'Piloto'} {isMe && '(você)'}
                  </Text>
                  {e.pilotKartNumber ? (
                    <Text style={s.rowKart}>Kart #{e.pilotKartNumber}</Text>
                  ) : null}
                </View>
                <Text style={[s.rowTime, isMe && s.rowTimeMe]}>{fmtLap(e.bestLapMs)}</Text>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Gravar volta */}
      <View style={[s.fabWrap, { paddingBottom: insets.bottom + 84 }]} pointerEvents="box-none">
        <Pressable style={s.fab} onPress={() => router.push('/new-session' as any)}>
          <Icon name="bolt" size={20} color="#fff" />
          <Text style={s.fabText}>Gravar volta</Text>
        </Pressable>
      </View>

      {/* Picker de pista */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.modalBg} onPress={() => setPickerOpen(false)}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + spacing.l }]}>
            <Text style={s.modalTitle}>Escolha o kartódromo</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {TRACKS.map((t) => (
                <Pressable
                  key={t.id}
                  style={[s.trackRow, t.id === trackId && s.trackRowActive]}
                  onPress={() => {
                    setTrackId(t.id);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={[s.trackRowName, t.id === trackId && { color: BLUE }]}>
                    {t.shortName ?? t.name}
                  </Text>
                  <Text style={s.trackRowCity}>{t.city}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  kicker: { color: BLUE, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 34, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.5 },
  shareBtn: {
    width: 40, height: 40, borderRadius: radius.m, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  shareIcon: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  trackChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.l,
    paddingVertical: 12, paddingHorizontal: spacing.l, backgroundColor: colors.bgElevated,
    borderRadius: radius.m, borderWidth: 1, borderColor: colors.border,
  },
  trackChipText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  segment: {
    flexDirection: 'row', marginTop: spacing.l, backgroundColor: colors.bgElevated,
    borderRadius: radius.m, padding: 4, gap: 4,
  },
  segItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.s },
  segItemActive: { backgroundColor: BLUE },
  segText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  segTextActive: { color: '#fff' },
  youCard: {
    marginTop: spacing.l, padding: spacing.l, backgroundColor: 'rgba(47,107,255,0.10)',
    borderRadius: radius.m, borderWidth: 1, borderColor: BLUE,
  },
  youText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  youTextMuted: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  youHi: { color: BLUE, fontWeight: '900' },
  empty: { marginTop: spacing.xxl, alignItems: 'center', gap: 6 },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginTop: spacing.s,
    padding: spacing.m, backgroundColor: colors.bgElevated, borderRadius: radius.m,
    borderWidth: 1, borderColor: colors.border,
  },
  rowMe: { borderColor: BLUE, backgroundColor: 'rgba(47,107,255,0.07)' },
  pos: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  posText: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowNameMe: { color: BLUE },
  rowKart: { color: colors.textMuted, fontSize: 11, marginTop: 1, fontWeight: '600' },
  rowTime: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rowTimeMe: { color: BLUE },
  fabWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  fab: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingVertical: 14, paddingHorizontal: spacing.xxl,
    backgroundColor: BLUE, borderRadius: radius.pill,
    shadowColor: BLUE, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.l },
  modalTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: spacing.m },
  trackRow: { paddingVertical: 14, paddingHorizontal: spacing.m, borderRadius: radius.m },
  trackRowActive: { backgroundColor: 'rgba(47,107,255,0.10)' },
  trackRowName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  trackRowCity: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
