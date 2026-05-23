import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getActiveKartSetup, KartSetup } from '../src/storage/db';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

type Check = { id: string; label: string; hint?: string };

/**
 * Pre-flight: lista hardcoded de itens críticos antes de gravar. Manual
 * (sem hardware) — o piloto marca cada um quando confirma. O botão de
 * gravar só fica habilitado quando todos estão marcados.
 *
 * Não persistimos o checklist entre sessões — começa zerado cada vez,
 * forçando o piloto a confirmar de novo. É o ponto da feature: virar
 * ritual antes de pôr o capacete.
 */
const CHECKLIST: Check[] = [
  { id: 'gps', label: 'GPS calibrado', hint: 'celular com sinal ao ar livre, longe de prédio/cobertura' },
  { id: 'tires', label: 'Pneus calibrados', hint: 'pressão conferida com manômetro confiável' },
  { id: 'fuel', label: 'Combustível', hint: 'tanque com volume pra duração esperada da sessão' },
  { id: 'brakes', label: 'Freios checados', hint: 'pedal firme, sem cavar, sangrado se necessário' },
  { id: 'gear', label: 'Macacão / luvas / capacete', hint: 'EPI completo e ajustado' },
  { id: 'tools', label: 'Ferramentas guardadas', hint: 'nada solto no kart ou no chassi' },
];

export default function PreFlight() {
  const router = useRouter();
  const { trackId, trackName, layoutId } = useLocalSearchParams<{
    trackId: string;
    trackName: string;
    layoutId?: string;
  }>();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [activeSetup, setActiveSetup] = useState<KartSetup | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const su = await getActiveKartSetup();
    setActiveSetup(su);
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const allChecked = CHECKLIST.every((c) => checked[c.id]);
  const checkedCount = CHECKLIST.filter((c) => checked[c.id]).length;

  const toggle = (id: string) => setChecked((p) => ({ ...p, [id]: !p[id] }));

  const handleStart = () => {
    router.replace({
      pathname: '/recording',
      params: {
        trackId: trackId!,
        trackName: trackName!,
        layoutId: layoutId ?? '',
        kartSetupId: activeSetup?.id ?? '',
      },
    });
  };

  if (!loaded) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader
        title="PRONTO PRA RODAR?"
        subtitle={trackName}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Setup ativo */}
        <Pressable
          onPress={() => router.push('/kart-setups' as any)}
          style={({ pressed }) => [s.setupCard, pressed && { opacity: 0.7 }]}
        >
          <View style={s.setupHeader}>
            <Text style={s.setupLabel}>SETUP ATIVO</Text>
            {activeSetup && (
              <Text style={s.setupLink}>trocar</Text>
            )}
          </View>
          {activeSetup ? (
            <>
              <Text style={s.setupName}>{activeSetup.name}</Text>
              {(activeSetup.chassisBrand || activeSetup.engineType) && (
                <Text style={s.setupSub}>
                  {[activeSetup.chassisBrand, activeSetup.engineType, activeSetup.engineTune]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              )}
              <View style={s.setupStats}>
                {activeSetup.tirePressureFront != null && (
                  <SetupStat label="DIANT" value={`${activeSetup.tirePressureFront.toFixed(2)}b`} />
                )}
                {activeSetup.tirePressureRear != null && (
                  <SetupStat label="TRAS" value={`${activeSetup.tirePressureRear.toFixed(2)}b`} />
                )}
                {activeSetup.camberDeg != null && (
                  <SetupStat label="CAMBER" value={`${activeSetup.camberDeg.toFixed(1)}°`} />
                )}
                {activeSetup.gearFront != null && activeSetup.gearRear != null && (
                  <SetupStat label="C/P" value={`${activeSetup.gearRear}/${activeSetup.gearFront}`} />
                )}
              </View>
            </>
          ) : (
            <Text style={s.setupEmpty}>
              Nenhum setup ativo. Toca pra cadastrar (opcional — não bloqueia a gravação).
            </Text>
          )}
        </Pressable>

        {/* Checklist */}
        <View style={s.checklistHeader}>
          <Text style={s.section}>CHECKLIST</Text>
          <Text style={[s.section, { color: allChecked ? colors.success : colors.textMuted }]}>
            {checkedCount}/{CHECKLIST.length}
          </Text>
        </View>

        {CHECKLIST.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => toggle(c.id)}
            style={({ pressed }) => [s.checkRow, pressed && { opacity: 0.7 }]}
          >
            <View
              style={[
                s.checkbox,
                checked[c.id] && { backgroundColor: colors.success, borderColor: colors.success },
              ]}
            >
              {checked[c.id] && <Text style={s.checkmark}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.checkLabel}>{c.label}</Text>
              {c.hint && <Text style={s.checkHint}>{c.hint}</Text>}
            </View>
          </Pressable>
        ))}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      {/* Botão "Começar" fixo no rodapé */}
      <View style={s.footer}>
        <Pressable
          onPress={handleStart}
          disabled={!allChecked}
          style={({ pressed }) => [
            s.startBtn,
            !allChecked && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={s.startBtnText}>
            {allChecked ? 'COMEÇAR GRAVAÇÃO' : `MARQUE ${CHECKLIST.length - checkedCount} ITEM(NS)`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SetupStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={s.setupStatLabel}>{label}</Text>
      <Text style={[s.setupStatValue, typography.mono]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, gap: spacing.s },

  setupCard: {
    padding: spacing.m,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.l,
  },
  setupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.s,
  },
  setupLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  setupLink: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  setupName: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  setupSub: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  setupStats: {
    flexDirection: 'row',
    gap: spacing.m,
    marginTop: spacing.s,
  },
  setupStatLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  setupStatValue: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  setupEmpty: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },

  section: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  checklistHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.s,
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  checkLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  checkHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },

  footer: {
    padding: spacing.l,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  startBtn: {
    paddingVertical: 16,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  startBtnText: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
