import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { getProfile, PilotProfile } from '../../src/storage/profile';
import { computePilotStats, PilotStats } from '../../src/lib/pilotStats';
import { getGamificationState, listUnlockedAchievements } from '../../src/storage/db';
import { ACHIEVEMENTS, levelForXp, xpProgressInLevel } from '../../src/lib/gamification';
import { findTrackById } from '../../src/data/tracks';
import { Icon } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/theme';

const LIME = colors.accentLime;
const BLUE = colors.racingBlue;

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function fmtMonthYear(ts: number) {
  return new Date(ts)
    .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
    .replace('.', '')
    .replace(' de ', ' ');
}
function divisionFor(levelIndex: number): { name: string; color: string } {
  if (levelIndex <= 2) return { name: 'Bronze', color: '#CD7F4B' };
  if (levelIndex <= 4) return { name: 'Prata', color: '#C9D2DE' };
  return { name: 'Ouro', color: '#F5C84B' };
}

function Helmet({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 44 44">
      <Circle cx={22} cy={22} r={20} fill="#0d1322" />
      <Path d="M9 26 A13 13 0 0 1 35 26 L35 29 Q35 31 32 31 L12 31 Q9 31 9 29 Z" fill="#22314f" />
      <Path d="M13 21 Q22 16 32 21 L32 25 Q22 21.5 13 25 Z" fill={LIME} />
    </Svg>
  );
}

/** Mini traçado genérico (ícone do card de melhor volta). */
function MiniTrack({ active }: { active: boolean }) {
  const c = active ? BLUE : colors.textMuted;
  return (
    <Svg width={34} height={28} viewBox="0 0 34 28">
      <Path
        d="M6 18 Q2 8 12 6 Q24 4 28 12 Q31 19 21 21 Q11 23 6 18 Z"
        stroke={c}
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
      />
      {active && <Circle cx={7} cy={17} r={2.2} fill={LIME} />}
    </Svg>
  );
}

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [stats, setStats] = useState<PilotStats | null>(null);
  const [xp, setXp] = useState(0);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const flip = useSharedValue(0);

  const load = useCallback(async () => {
    const [prof, st, gam, unl] = await Promise.all([
      getProfile(),
      computePilotStats({ topN: 5 }),
      getGamificationState(),
      listUnlockedAchievements(),
    ]);
    setProfile(prof);
    setStats(st);
    setXp(gam.xp ?? 0);
    setUnlocked(new Set(unl.map((u) => u.achievementId)));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const level = levelForXp(xp);
  const prog = xpProgressInLevel(xp);
  const division = divisionFor(level.index);
  const kartNumber = profile?.kartNumber ?? '—';
  const handle = profile?.nickname ? `@${profile.nickname.replace(/^@/, '')}` : '@piloto';
  const track = profile?.homeTrackId ? findTrackById(profile.homeTrackId) : null;
  const unlockedCount = ACHIEVEMENTS.filter((a) => unlocked.has(a.id)).length;

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` }],
    backfaceVisibility: 'hidden',
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` }],
    backfaceVisibility: 'hidden',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  }));

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.l, paddingBottom: 150, paddingHorizontal: spacing.l }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>MEU PERFIL</Text>
          <View style={s.headerBtns}>
            <Pressable style={s.editBtn} hitSlop={8} onPress={() => router.push('/settings' as any)}>
              <Icon name="gear" size={18} color={colors.textSecondary} />
            </Pressable>
            <Pressable style={s.editBtn} hitSlop={8} onPress={() => router.push('/profile-edit' as any)}>
              <Text style={s.editIcon}>✎</Text>
            </Pressable>
          </View>
        </View>

        {/* Carteira de piloto (virável) */}
        <Pressable onPress={() => (flip.value = withTiming(flip.value === 0 ? 1 : 0, { duration: 450 }))}>
          <View style={s.cardWrap}>
            {/* Frente */}
            <Animated.View style={[s.card, frontStyle]}>
              <View style={s.stripe} />
              <View style={s.cardTop}>
                <Text style={s.cardKicker}>CARTEIRA DE PILOTO</Text>
                <Text style={s.cardBrand}>COCKPIT 219</Text>
              </View>
              <View style={s.cardMid}>
                <View style={s.avatar}>
                  {profile?.photoUri ? (
                    <Image source={{ uri: profile.photoUri }} style={s.avatarImg} />
                  ) : (
                    <Helmet />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardName} numberOfLines={1}>
                    {profile?.name?.toUpperCase() ?? 'PILOTO'}
                  </Text>
                  <Text style={s.cardHandle}>
                    {handle}{profile?.category ? ` · ${profile.category}` : ''}
                  </Text>
                </View>
                <View style={s.kartNumWrap}>
                  <Text style={s.kartNumLabel}>Nº</Text>
                  <Text style={s.kartNum}>{kartNumber}</Text>
                </View>
              </View>
              <View style={s.cardBottom}>
                <CardMeta label="DIVISÃO" value={division.name} />
                <CardMeta label="PISTA" value={track?.shortName ?? '—'} />
                <CardMeta label="DESDE" value={profile?.createdAt ? fmtMonthYear(profile.createdAt) : '—'} />
                <Text style={s.flipHint}>toque pra virar ›</Text>
              </View>
            </Animated.View>

            {/* Verso */}
            <Animated.View style={[s.card, s.cardBack, backStyle]}>
              <View style={s.stripe} />
              <Text style={s.cardKicker}>COCKPIT · CARTEIRA</Text>
              <View style={s.backCenter}>
                <Text style={s.backNum}>{kartNumber}</Text>
                <Text style={s.backName}>{profile?.name?.toUpperCase() ?? 'PILOTO'}</Text>
                <Text style={s.backHandle}>{handle}</Text>
              </View>
              <Text style={s.flipHint}>‹ toque pra voltar</Text>
            </Animated.View>
          </View>
        </Pressable>

        {/* Melhor volta */}
        <View style={s.bestCard}>
          <View style={s.bestIcon}>
            <MiniTrack active={stats?.bestLapMs != null} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.smallLabel}>MELHOR VOLTA</Text>
            {stats?.bestLapMs != null ? (
              <>
                <Text style={s.bestLap}>{fmtLap(stats.bestLapMs)}</Text>
                <Text style={s.bestMeta}>
                  {stats.topLaps[0]?.trackName ?? track?.shortName ?? ''}
                </Text>
              </>
            ) : (
              <Text style={s.bestEmpty}>Corra pra registrar sua marca</Text>
            )}
          </View>
        </View>

        {/* Pilot DNA — identidade técnica agregada das sessões */}
        <Pressable
          onPress={() => router.push('/pilot-dna' as any)}
          style={({ pressed }) => [s.dnaCard, pressed && { opacity: 0.85 }]}
        >
          <View style={s.dnaIcon}>
            <Text style={{ fontSize: 20 }}>🧬</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.dnaTitle}>PILOT DNA</Text>
            <Text style={s.dnaSub}>Seu estilo de pilotagem, lido das suas voltas</Text>
          </View>
          <Text style={s.dnaChevron}>›</Text>
        </Pressable>

        {/* Nível */}
        <View style={s.levelCard}>
          <View style={s.levelTop}>
            <Text style={s.levelTitle}>
              NÍVEL {level.index}{' '}
              <Text style={[s.levelDiv, { color: division.color }]}>DIVISÃO {division.name.toUpperCase()}</Text>
            </Text>
            <Text style={s.levelXp}>
              {prog.needed === 0
                ? 'MAX'
                : `${prog.earned.toLocaleString('pt-BR')} / ${prog.needed.toLocaleString('pt-BR')} XP`}
            </Text>
          </View>
          <View style={s.xpTrack}>
            <View style={[s.xpFill, { width: `${Math.round(prog.ratio * 100)}%` }]} />
          </View>
        </View>

        {/* 4 stats */}
        <View style={s.statRow}>
          <Stat label="SESSÕES" value={String(stats?.sessionCount ?? 0)} />
          <Stat label="VOLTAS" value={(stats?.lapCount ?? 0).toLocaleString('pt-BR')} />
          <Stat label="DISTÂNCIA" value={`${(stats?.totalKm ?? 0).toFixed(0)}`} unit="km" />
          <Stat label="TEMPO" value={`${Math.floor((stats?.totalTimeMs ?? 0) / 3600000)}`} unit="h" />
        </View>

        {/* 3 cards */}
        <View style={s.bigRow}>
          <BigStat label="PÓDIOS" value={stats?.podiums ?? 0} color={BLUE} />
          <BigStat label="TOP 5" value={Math.min(stats?.topLaps?.length ?? 0, 5)} color={colors.accentCyan} />
          <BigStat label="RECORDES" value={stats?.recordsByTrack?.length ?? 0} color={colors.accentMagenta} />
        </View>

        {/* Conquistas */}
        <View style={s.achHeader}>
          <Text style={s.achTitle}>CONQUISTAS</Text>
          <Text style={s.achCount}>{unlockedCount}/{ACHIEVEMENTS.length}</Text>
        </View>
        <View style={s.achGrid}>
          {ACHIEVEMENTS.slice(0, 8).map((a) => {
            const got = unlocked.has(a.id);
            return (
              <View key={a.id} style={s.achItem}>
                <View style={[s.achIconBox, got && s.achIconBoxGot]}>
                  <Text style={[s.achIcon, !got && { opacity: 0.3 }]}>{got ? a.icon : '🔒'}</Text>
                </View>
                <Text style={s.achLabel} numberOfLines={1}>{a.title}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function CardMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>
        {value}{unit ? <Text style={s.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}
function BigStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={s.bigStat}>
      <Text style={s.bigLabel}>{label}</Text>
      <Text style={[s.bigValue, { color }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerBtns: { flexDirection: 'row', gap: spacing.s },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  editBtn: { width: 36, height: 36, borderRadius: radius.m, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  editIcon: { color: colors.textSecondary, fontSize: 15 },

  cardWrap: { marginTop: spacing.l, height: 168 },
  card: {
    height: 168,
    borderRadius: radius.l,
    backgroundColor: '#101725',
    borderWidth: 1,
    borderColor: '#1e2b45',
    padding: spacing.l,
    overflow: 'hidden',
  },
  cardBack: { backgroundColor: '#0d1322', alignItems: 'center' },
  stripe: {
    position: 'absolute',
    top: -30,
    right: -10,
    width: 120,
    height: 90,
    backgroundColor: BLUE,
    opacity: 0.18,
    transform: [{ rotate: '35deg' }],
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardKicker: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  cardBrand: { color: LIME, fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  cardMid: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginTop: spacing.m },
  avatar: { width: 50, height: 50, borderRadius: 12, backgroundColor: '#0d1322', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#22314f' },
  avatarImg: { width: 50, height: 50 },
  cardName: { color: colors.textPrimary, fontSize: 19, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.3 },
  cardHandle: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  kartNumWrap: { alignItems: 'flex-end' },
  kartNumLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800' },
  kartNum: { color: LIME, fontSize: 32, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, lineHeight: 34 },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 'auto', gap: spacing.s },
  metaLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  metaValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  flipHint: { color: colors.textMuted, fontSize: 9, fontWeight: '600' },
  backCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backNum: { color: LIME, fontSize: 56, fontWeight: '900', fontStyle: 'italic', letterSpacing: -2 },
  backName: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', fontStyle: 'italic', marginTop: 4 },
  backHandle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  bestCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginTop: spacing.m, padding: spacing.l, backgroundColor: colors.surface, borderRadius: radius.l },
  bestIcon: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  smallLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  bestLap: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginTop: 2, fontVariant: ['tabular-nums'] },
  bestMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 1, fontWeight: '600' },
  bestEmpty: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },

  dnaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginTop: spacing.m,
    padding: spacing.m,
    backgroundColor: 'rgba(37, 99, 255,0.10)',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.l,
  },
  dnaIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.m,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dnaTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  dnaSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  dnaChevron: { color: colors.textMuted, fontSize: 22, fontWeight: '300' },

  levelCard: { marginTop: spacing.m, padding: spacing.l, backgroundColor: colors.surface, borderRadius: radius.l },
  levelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  levelTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900', fontStyle: 'italic' },
  levelDiv: { fontSize: 10, fontWeight: '800' },
  levelXp: { color: colors.textMuted, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  xpTrack: { height: 8, borderRadius: 4, backgroundColor: colors.bgElevated, marginTop: spacing.s, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 4, backgroundColor: LIME },

  statRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.m, padding: spacing.m },
  statLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  statValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 4, letterSpacing: -0.5 },
  statUnit: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },

  bigRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  bigStat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.m, padding: spacing.m, alignItems: 'center' },
  bigLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  bigValue: { fontSize: 26, fontWeight: '900', fontStyle: 'italic', marginTop: 6 },

  achHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.m },
  achTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 },
  achCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  achGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  achItem: { width: '22.5%', alignItems: 'center' },
  achIconBox: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  achIconBoxGot: { borderColor: BLUE, backgroundColor: 'rgba(37, 99, 255,0.08)' },
  achIcon: { fontSize: 22 },
  achLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '600', marginTop: 5, textAlign: 'center' },
});
