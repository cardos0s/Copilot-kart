import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { clearProfile, getProfile, PilotProfile } from '../src/storage/profile';
import { getStoredCredential } from '../src/storage/apiKey';
import { getClient } from '../src/lib/llm';
import {
  useCoachFloatingEnabled,
  getCloudSyncEnabled,
  setCloudSyncEnabled,
} from '../src/storage/preferences';
import {
  BrandMark,
  Card,
  Icon,
  ScreenHeader,
} from '../src/components/ui';
import { colors, radius, spacing } from '../src/theme';

type SettingsState = {
  unit: 'metric' | 'imperial';
  notifications: boolean;
  theme: 'dark' | 'track';
};

const APP_VERSION = '0.1.0';

export default function Settings() {
  const router = useRouter();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [aiProviderLabel, setAiProviderLabel] = useState<string | null>(null);
  const [coachFloatingEnabled, setCoachFloatingEnabled] = useCoachFloatingEnabled();
  const [cloudSync, setCloudSync] = useState(true);
  const [state, setState] = useState<SettingsState>({
    unit: 'metric',
    notifications: true,
    theme: 'dark',
  });

  useFocusEffect(
    useCallback(() => {
      getProfile().then(setProfile);
      getStoredCredential().then((c) =>
        setAiProviderLabel(c ? getClient(c.provider).meta.displayName : null)
      );
      getCloudSyncEnabled().then(setCloudSync);
    }, [])
  );

  const handleCloudSyncChange = (v: boolean) => {
    setCloudSync(v);
    setCloudSyncEnabled(v);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sair da conta?',
      'Seus dados locais permanecem, mas você terá que refazer o onboarding.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: async () => {
            await clearProfile();
            router.replace('/welcome');
          },
        },
      ]
    );
  };

  return (
    <View style={s.root}>
      <ScreenHeader title="CONFIGURAÇÕES" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.huge }}
        showsVerticalScrollIndicator={false}
      >
        {/* Geral */}
        <SectionLabel>GERAL</SectionLabel>
        <Card variant="default" padding="none" style={s.sectionCard}>
          <Row
            label="Unidade de medida"
            value={state.unit === 'metric' ? 'Métrico (km)' : 'Imperial (mi)'}
            onPress={() =>
              setState((p) => ({
                ...p,
                unit: p.unit === 'metric' ? 'imperial' : 'metric',
              }))
            }
          />
          <Divider />
          <RowToggle
            icon="cloud-sync"
            label="Sincronizar dados"
            sub="Última sincronização: nunca"
            value={false}
            onChange={() =>
              Alert.alert('Em breve', 'Sincronização em nuvem ainda não está disponível.')
            }
          />
          <Divider />
          <RowToggle
            icon="bell"
            label="Notificações"
            value={state.notifications}
            onChange={(next) => setState((p) => ({ ...p, notifications: next }))}
          />
          <Divider />
          <Row
            label="Tema do app"
            value={state.theme === 'dark' ? 'Escuro' : 'Track Mode'}
            onPress={() =>
              setState((p) => ({
                ...p,
                theme: p.theme === 'dark' ? 'track' : 'dark',
              }))
            }
          />
        </Card>

        {/* Kart */}
        <SectionLabel>KART</SectionLabel>
        <Card variant="default" padding="none" style={s.sectionCard}>
          <Row
            label="Setups do kart"
            value="Gerenciar"
            onPress={() => router.push('/kart-setups' as any)}
            chevron
          />
        </Card>

        {/* IA */}
        <SectionLabel>COACH IA</SectionLabel>
        <Card variant="default" padding="none" style={s.sectionCard}>
          <Row
            label="Provider e API key"
            value={aiProviderLabel ?? 'Não configurado'}
            onPress={() => router.push('/ai-key' as any)}
            chevron
          />
          <Divider />
          <RowToggle
            label="Botão flutuante"
            sub="Aparece em todas as telas com insights novos"
            value={coachFloatingEnabled}
            onChange={setCoachFloatingEnabled}
          />
        </Card>

        {/* Privacidade / backup */}
        <SectionLabel>BACKUP NA NUVEM</SectionLabel>
        <Card variant="default" padding="none" style={s.sectionCard}>
          <RowToggle
            label="Sincronizar sessões"
            sub="Backup anônimo dos seus tempos de volta. Sem login. Não envia a telemetria completa, só os tempos."
            value={cloudSync}
            onChange={handleCloudSyncChange}
          />
        </Card>

        {/* Conta */}
        {profile && (
          <>
            <SectionLabel>CONTA</SectionLabel>
            <Card variant="default" padding="none" style={s.sectionCard}>
              <Row label="Nome" value={profile.name} />
              <Divider />
              <Row label="Categoria" value={profile.category} />
              {profile.nickname && (
                <>
                  <Divider />
                  <Row label="Nickname" value={profile.nickname} />
                </>
              )}
            </Card>
            <Pressable onPress={handleSignOut} style={s.signOut}>
              <Text style={s.signOutText}>Sair da conta</Text>
            </Pressable>
          </>
        )}

        {/* Sobre */}
        <SectionLabel>SOBRE</SectionLabel>
        <Card variant="default" padding="none" style={s.sectionCard}>
          <Row label="Versão do app" value={APP_VERSION} />
          <Divider />
          <Row label="Termos de uso" onPress={() => Alert.alert('Em breve')} chevron />
          <Divider />
          <Row label="Política de privacidade" onPress={() => Alert.alert('Em breve')} chevron />
        </Card>

        <View style={s.footer}>
          <BrandMark variant="stacked" />
          <Text style={s.copyText}>© 2026 Cortex Tech. Todos os direitos reservados.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

function Row({
  label,
  value,
  onPress,
  chevron,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const content = (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {value && <Text style={s.rowValue}>{value}</Text>}
        {(chevron || onPress) && (
          <Icon name="chevron-right" size={18} color={colors.textMuted} />
        )}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

function RowToggle({
  icon,
  label,
  sub,
  value,
  onChange,
}: {
  icon?: any;
  label: string;
  sub?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={s.row}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m, flex: 1 }}>
        {icon && <Icon name={icon} size={18} color={colors.textSecondary} />}
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>{label}</Text>
          {sub && <Text style={s.rowSub}>{sub}</Text>}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={value ? colors.textOnPrimary : colors.textSecondary}
      />
    </View>
  );
}

function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: spacing.l,
    marginBottom: spacing.s,
    paddingHorizontal: spacing.l + spacing.s,
  },
  sectionCard: { marginHorizontal: spacing.l },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.l,
    paddingHorizontal: spacing.l,
  },
  rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.textMuted, fontSize: 11, fontWeight: '500', marginTop: 2 },
  rowValue: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.l,
  },

  signOut: {
    marginHorizontal: spacing.l,
    marginTop: spacing.m,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  signOutText: { color: colors.danger, fontSize: 14, fontWeight: '700' },

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
