import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  deleteKartSetup,
  KartSetup,
  listKartSetups,
  setActiveKartSetup,
} from '../src/storage/db';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

export default function KartSetupsScreen() {
  const router = useRouter();
  const [setups, setSetups] = useState<KartSetup[] | null>(null);

  const load = useCallback(async () => {
    setSetups(await listKartSetups());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSetActive = async (id: string) => {
    await setActiveKartSetup(id);
    await load();
  };

  const handleDelete = (setup: KartSetup) => {
    Alert.alert(
      `Apagar "${setup.name}"?`,
      'Sessões antigas que usaram esse setup ficam, mas perdem a referência.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            await deleteKartSetup(setup.id);
            await load();
          },
        },
      ]
    );
  };

  if (setups === null) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="SETUPS DO KART" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.intro}>
          Configure os karts/setups que você usa. O setup ativo é o default
          quando você inicia uma nova sessão.
        </Text>

        {setups.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Nenhum setup cadastrado</Text>
            <Text style={s.emptyBody}>
              Cria o primeiro pra começar a rastrear pneus, cambagem e horas de uso.
            </Text>
          </View>
        ) : (
          setups.map((su) => (
            <Pressable
              key={su.id}
              onPress={() =>
                router.push({
                  pathname: '/kart-setup-edit' as any,
                  params: { id: su.id },
                })
              }
              onLongPress={() => handleDelete(su)}
              delayLongPress={400}
              style={({ pressed }) => [
                s.card,
                su.isActive && s.cardActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={s.cardHeader}>
                <Text style={s.cardName}>{su.name}</Text>
                {su.isActive ? (
                  <View style={s.activeBadge}>
                    <Text style={s.activeBadgeText}>ATIVO</Text>
                  </View>
                ) : (
                  <Pressable onPress={() => handleSetActive(su.id)} hitSlop={8}>
                    <Text style={s.activateLink}>Ativar</Text>
                  </Pressable>
                )}
              </View>
              {(su.chassisBrand || su.engineType) && (
                <Text style={s.cardSub}>
                  {[su.chassisBrand, su.engineType, su.engineTune]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              )}
              <View style={s.statsRow}>
                {su.tirePressureFront != null && (
                  <Stat label="DIANT" value={`${su.tirePressureFront.toFixed(2)} bar`} />
                )}
                {su.tirePressureRear != null && (
                  <Stat label="TRAS" value={`${su.tirePressureRear.toFixed(2)} bar`} />
                )}
                {su.camberDeg != null && (
                  <Stat label="CAMBER" value={`${su.camberDeg.toFixed(1)}°`} />
                )}
                {(su.gearFront != null && su.gearRear != null) && (
                  <Stat label="C/P" value={`${su.gearRear}/${su.gearFront}`} />
                )}
                {su.hours > 0 && (
                  <Stat label="HORAS" value={su.hours.toFixed(1)} />
                )}
              </View>
            </Pressable>
          ))
        )}

        <Pressable
          onPress={() => router.push('/kart-setup-edit' as any)}
          style={({ pressed }) => [s.newBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={s.newBtnText}>+ Novo setup</Text>
        </Pressable>

        {setups.length > 0 && (
          <Text style={s.hint}>Toque longo num setup pra apagar.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, typography.mono]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, gap: spacing.s },
  intro: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.m,
  },

  card: {
    padding: spacing.m,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cardActive: {
    borderColor: colors.primary,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  cardSub: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  activeBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeBadgeText: {
    color: colors.textOnPrimary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  activateLink: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },

  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.m,
    marginTop: spacing.s,
  },
  stat: {},
  statLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },

  newBtn: {
    marginTop: spacing.m,
    paddingVertical: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    alignItems: 'center',
  },
  newBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },

  emptyCard: {
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: spacing.s,
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },

  hint: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.m,
  },
});
