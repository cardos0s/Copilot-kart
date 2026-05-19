import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile, PilotProfile } from '../../src/storage/profile';
import { computePilotStats, PilotStats } from '../../src/lib/pilotStats';
import {
  Avatar,
  BrandMark,
  Card,
  DecorativeSplash,
  Icon,
} from '../../src/components/ui';
import { colors, radius, spacing, typography } from '../../src/theme';

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtKm(km: number) {
  if (km < 1) return `${(km * 1000).toFixed(0)}m`;
  return `${km.toFixed(1)} km`;
}

function fmtDuration(ms: number) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m > 0 ? ` ${m}min` : ''}`;
}

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [stats, setStats] = useState<PilotStats | null>(null);

  const load = useCallback(async () => {
    const [prof, st] = await Promise.all([getProfile(), computePilotStats({ topN: 5 })]);
    setProfile(prof);
    setStats(st);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const firstName = profile?.name?.split(' ')[0]?.toUpperCase() ?? '';
  const lastName = profile?.name?.split(' ').slice(1).join(' ').toUpperCase() ?? '';

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.s,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <Text style={s.title}>MEU PERFIL</Text>
          <Pressable hitSlop={12} onPress={() => router.push('/profile-edit' as any)}>
            <Icon name="edit" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Hero card: foto + número + nome */}
        <View style={s.heroCard}>
          <DecorativeSplash position="side-right" intensity="strong" />
          <View style={s.heroInner}>
            <Pressable onPress={() => router.push('/profile-edit' as any)}>
              <Avatar
                photoUri={profile?.photoUri}
                name={profile?.name}
                size={92}
                ring
              />
            </Pressable>

            <View style={{ flex: 1 }}>
              {profile?.kartNumber && (
                <Text style={s.heroNumber}>{profile.kartNumber}</Text>
              )}
              <Text style={s.heroFirstName} numberOfLines={1}>
                {firstName || 'PILOTO'}
              </Text>
              {lastName ? (
                <Text style={s.heroLastName} numberOfLines={1}>
                  {lastName}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Meta: Categoria + Equipe + Nickname */}
        <View style={s.metaRow}>
          <View style={s.metaCell}>
            <Text style={s.metaLabel}>CATEGORIA</Text>
            <Text style={s.metaValue} numberOfLines={1}>
              {profile?.category || '—'}
            </Text>
          </View>
          <View style={s.metaCell}>
            <Text style={s.metaLabel}>EQUIPE</Text>
            <Text style={s.metaValue} numberOfLines={1}>
              {profile?.team || '—'}
            </Text>
          </View>
        </View>

        {/* Card grande: Melhor volta + sessões/voltas */}
        <Card variant="elevated" padding="l" style={{ marginHorizontal: spacing.l, marginTop: spacing.l }}>
          <Text style={s.bigLabel}>MELHOR VOLTA</Text>
          <Text style={[s.bigValue, typography.mono]}>
            {stats?.bestLapMs != null ? fmtLap(stats.bestLapMs) : '—:—:—'}
          </Text>

          <View style={s.statGrid}>
            <SmallStat label="SESSÕES" value={String(stats?.sessionCount ?? 0)} />
            <SmallStat label="VOLTAS" value={String(stats?.lapCount ?? 0)} />
            <SmallStat label="DISTÂNCIA" value={fmtKm(stats?.totalKm ?? 0)} />
            <SmallStat label="TEMPO" value={fmtDuration(stats?.totalTimeMs ?? 0)} />
          </View>
        </Card>

        {/* Pódios + Top */}
        <View style={s.achieveRow}>
          <AchieveCard label="PÓDIOS" value={stats?.podiums ?? 0} tone="primary" />
          <AchieveCard label="TOP 5" value={Math.min(stats?.topLaps?.length ?? 0, 5)} tone="cyan" />
          <AchieveCard label="RECORDES" value={stats?.recordsByTrack?.length ?? 0} tone="magenta" />
        </View>

        {/* Recordes por pista */}
        {stats && stats.recordsByTrack.length > 0 && (
          <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.l }}>
            <Text style={s.sectionTitle}>RECORDES POR PISTA</Text>
            <Card variant="default" padding="none">
              {stats.recordsByTrack.slice(0, 5).map((rec, i) => (
                <View key={rec.trackId} style={s.recordRow}>
                  <View style={s.recordRank}>
                    <Text style={s.recordRankText}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.recordTrack} numberOfLines={1}>
                      {rec.trackName}
                    </Text>
                    <Text style={s.recordDate}>
                      {new Date(rec.recordedAt).toLocaleDateString('pt-BR')}
                    </Text>
                  </View>
                  <Text style={[s.recordTime, typography.mono]}>
                    {fmtLap(rec.bestLapMs)}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Top voltas absolutas */}
        {stats && stats.topLaps.length > 0 && (
          <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.l }}>
            <Text style={s.sectionTitle}>SUAS MELHORES VOLTAS</Text>
            <Card variant="default" padding="none">
              {stats.topLaps.slice(0, 5).map((lap, i) => (
                <Pressable
                  key={lap.lapId}
                  style={({ pressed }) => [s.recordRow, pressed && { opacity: 0.6 }]}
                  onPress={() => router.push(`/session/${lap.sessionId}`)}
                >
                  <View style={[s.recordRank, i === 0 && { backgroundColor: colors.primary }]}>
                    <Text
                      style={[
                        s.recordRankText,
                        i === 0 && { color: colors.textOnPrimary },
                      ]}
                    >
                      {i + 1}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.recordTrack} numberOfLines={1}>
                      {lap.trackName}
                    </Text>
                    <Text style={s.recordDate}>
                      {new Date(lap.recordedAt).toLocaleDateString('pt-BR')}
                    </Text>
                  </View>
                  <Text style={[s.recordTime, typography.mono]}>{fmtLap(lap.durationMs)}</Text>
                </Pressable>
              ))}
            </Card>
          </View>
        )}

        {/* Settings access */}
        <View style={{ marginHorizontal: spacing.l, marginTop: spacing.xl }}>
          <Card variant="default" padding="none">
            <SettingRow
              icon="gear"
              label="Configurações"
              onPress={() => router.push('/settings')}
            />
          </Card>
        </View>

        <View style={s.footer}>
          <BrandMark variant="stacked" />
          <Text style={s.copyText}>© 2026 Cortex Tech. Todos os direitos reservados.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 70 }}>
      <Text style={s.smallLabel}>{label}</Text>
      <Text style={[s.smallValue, typography.mono]} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function AchieveCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'primary' | 'cyan' | 'magenta';
}) {
  const toneColor = {
    primary: colors.primary,
    cyan: colors.accentCyan,
    magenta: colors.accentMagenta,
  }[tone];
  return (
    <View style={s.achieveCard}>
      <Text style={s.achieveLabel}>{label}</Text>
      <Text style={[s.achieveValue, typography.mono, { color: toneColor }]}>{value}</Text>
    </View>
  );
}

function SettingRow({
  icon,
  label,
  onPress,
}: {
  icon: any;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.settingRow, pressed && { opacity: 0.6 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m, flex: 1 }}>
        <Icon name={icon} size={20} color={colors.textSecondary} />
        <Text style={s.settingLabel}>{label}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.m,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    flex: 1,
    textAlign: 'center',
    marginLeft: 32,
  },

  heroCard: {
    marginHorizontal: spacing.l,
    marginTop: spacing.s,
    minHeight: 160,
    borderRadius: 16,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.l,
    gap: spacing.l,
  },
  heroNumber: {
    color: colors.primary,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -2,
    textShadowColor: colors.primaryGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  heroFirstName: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -0.5,
    marginTop: -2,
  },
  heroLastName: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -0.5,
    marginTop: -4,
  },

  metaRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.l,
    marginTop: spacing.l,
    gap: spacing.s,
  },
  metaCell: {
    flex: 1,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  metaValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },

  bigLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  bigValue: {
    color: colors.primary,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1.2,
  },

  statGrid: {
    flexDirection: 'row',
    marginTop: spacing.l,
    gap: spacing.m,
    flexWrap: 'wrap',
  },
  smallLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  smallValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.5,
  },

  achieveRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.l,
    marginTop: spacing.m,
    gap: spacing.s,
  },
  achieveCard: {
    flex: 1,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  achieveLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  achieveValue: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1,
  },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: spacing.s,
    paddingHorizontal: spacing.s,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.m,
  },
  recordRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordRankText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
  },
  recordTrack: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  recordDate: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  recordTime: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.l,
    paddingHorizontal: spacing.l,
  },
  settingLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },

  footer: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
    gap: 8,
  },
  copyText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    marginTop: 4,
  },
});
