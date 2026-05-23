import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  StoredCredential,
  clearStoredCredential,
  getStoredCredential,
  maskApiKey,
  setStoredCredential,
  testCredential,
} from '../src/storage/apiKey';
import { refreshAiEnabled } from '../src/lib/aiAnalysis';
import {
  DEFAULT_PROVIDER,
  LLMProvider,
  PROVIDERS,
  ProviderMeta,
  getClient,
} from '../src/lib/llm';
import { Card, PillTabs, ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export default function AiKeyScreen() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [stored, setStored] = useState<StoredCredential | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>(DEFAULT_PROVIDER);
  const [input, setInput] = useState('');
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    (async () => {
      const c = await getStoredCredential();
      setStored(c);
      if (c) setSelectedProvider(c.provider);
      setLoaded(true);
    })();
  }, []);

  const meta: ProviderMeta = getClient(selectedProvider).meta;

  const handleSave = async () => {
    const key = input.trim();
    if (!key) {
      setStatus({ kind: 'error', message: 'Cole a key antes de salvar.' });
      return;
    }
    if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
      setStatus({
        kind: 'error',
        message: `Keys da ${meta.displayName} começam com "${meta.keyPrefix}". Confere se copiou inteira e do provider certo.`,
      });
      return;
    }
    setStatus({ kind: 'testing' });
    const result = await testCredential({ provider: selectedProvider, apiKey: key });
    if (result.kind === 'ok') {
      await setStoredCredential({ provider: selectedProvider, apiKey: key });
      await refreshAiEnabled();
      setStored({ provider: selectedProvider, apiKey: key });
      setInput('');
      setStatus({ kind: 'ok' });
    } else if (result.kind === 'unauthorized') {
      setStatus({
        kind: 'error',
        message: `${meta.displayName} rejeitou a key. Confere se ela tá ativa no console e se você não escolheu o provider errado.`,
      });
    } else if (result.kind === 'network') {
      setStatus({
        kind: 'error',
        message: 'Sem internet — conecta no Wi-Fi/4G e tenta de novo.',
      });
    } else if (result.kind === 'rate_limited') {
      setStatus({
        kind: 'error',
        message: 'Limite de uso atingido nessa key. Tenta em alguns minutos.',
      });
    } else {
      setStatus({ kind: 'error', message: result.detail });
    }
  };

  const handleRemove = () => {
    Alert.alert(
      'Remover credencial?',
      'O Coach IA fica desligado até você colar outra. Os dados de telemetria continuam aqui.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            await clearStoredCredential();
            await refreshAiEnabled();
            setStored(null);
            setStatus({ kind: 'idle' });
          },
        },
      ]
    );
  };

  if (!loaded) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isCurrentProvider = stored?.provider === selectedProvider;

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="COACH IA"
        subtitle="Escolhe o provider e cola a key"
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.huge }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.intro}>
          <Text style={s.introTitle}>Como funciona?</Text>
          <Text style={s.introBody}>
            O Coach IA roda direto do seu app chamando o provider que você escolher.
            Cada piloto usa a própria key — o app não tem chave compartilhada. O
            consumo é cobrado da sua conta, não da gente.
          </Text>
        </View>

        <View style={s.providerTabs}>
          <PillTabs<LLMProvider>
            value={selectedProvider}
            onChange={(p) => {
              setSelectedProvider(p);
              setStatus({ kind: 'idle' });
              setInput('');
            }}
            options={PROVIDERS.map((p) => ({ value: p.id, label: p.displayName }))}
          />
        </View>

        <View style={s.providerCard}>
          <Text style={s.providerTagline}>{meta.tagline}</Text>
          <Text style={s.providerCost}>{meta.costHint}</Text>
          <Pressable
            onPress={() => Linking.openURL(meta.consoleUrl).catch(() => {})}
            style={({ pressed }) => [s.helpLink, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.helpLinkText}>Abrir console pra gerar key</Text>
          </Pressable>
        </View>

        {stored && isCurrentProvider && (
          <Card variant="elevated" padding="l" style={s.savedCard}>
            <Text style={s.savedLabel}>KEY ATIVA · {meta.displayName.toUpperCase()}</Text>
            <Text style={[s.savedValue, typography.mono]}>{maskApiKey(stored.apiKey)}</Text>
            <Pressable onPress={handleRemove} style={s.removeBtn}>
              <Text style={s.removeBtnText}>Remover key</Text>
            </Pressable>
          </Card>
        )}

        {stored && !isCurrentProvider && (
          <View style={s.switchHint}>
            <Text style={s.switchHintText}>
              Atualmente ativo: {getClient(stored.provider).meta.displayName}. Salvar uma
              nova key abaixo vai substituir.
            </Text>
          </View>
        )}

        <View style={s.formCard}>
          <Text style={s.formLabel}>
            {stored && isCurrentProvider ? 'Substituir por outra key' : 'Cole a key aqui'}
          </Text>
          <View style={s.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={meta.keyPlaceholder}
              placeholderTextColor={colors.textMuted}
              style={[s.input, typography.mono]}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              secureTextEntry={!reveal}
              multiline={false}
            />
            <Pressable
              onPress={() => setReveal((p) => !p)}
              style={({ pressed }) => [s.revealBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.revealBtnText}>{reveal ? 'Ocultar' : 'Mostrar'}</Text>
            </Pressable>
          </View>

          {status.kind === 'error' && (
            <Text style={s.errText}>{status.message}</Text>
          )}
          {status.kind === 'ok' && (
            <Text style={s.okText}>Key validada e salva. Coach IA pronto.</Text>
          )}

          <Pressable
            onPress={handleSave}
            disabled={status.kind === 'testing'}
            style={({ pressed }) => [
              s.saveBtn,
              status.kind === 'testing' && { opacity: 0.6 },
              pressed && { opacity: 0.75 },
            ]}
          >
            {status.kind === 'testing' ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={s.saveBtnText}>
                {stored && isCurrentProvider ? 'Substituir' : 'Validar e salvar'}
              </Text>
            )}
          </Pressable>
          <Text style={s.disclaimer}>
            A key fica guardada criptografada no Keychain (iOS) ou SharedPreferences
            cifrada (Android). Não sai do seu aparelho.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  intro: { padding: spacing.l },
  introTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.s,
  },
  introBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },

  providerTabs: { paddingHorizontal: spacing.l, marginBottom: spacing.m },

  providerCard: {
    marginHorizontal: spacing.l,
    marginBottom: spacing.m,
    padding: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  providerTagline: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  providerCost: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.s,
  },
  helpLink: { alignSelf: 'flex-start' },
  helpLinkText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },

  savedCard: { marginHorizontal: spacing.l, marginBottom: spacing.m },
  savedLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  savedValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.m,
  },
  removeBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  removeBtnText: { color: colors.danger, fontWeight: '700', fontSize: 13 },

  switchHint: {
    marginHorizontal: spacing.l,
    marginBottom: spacing.m,
    padding: spacing.m,
    borderRadius: radius.m,
    backgroundColor: 'rgba(255,165,2,0.08)',
    borderWidth: 1,
    borderColor: colors.warning + '55',
  },
  switchHintText: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },

  formCard: {
    margin: spacing.l,
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: spacing.s,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    color: colors.textPrimary,
    fontSize: 13,
  },
  revealBtn: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  revealBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },

  saveBtn: {
    marginTop: spacing.l,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  saveBtnText: { color: colors.textOnPrimary, fontSize: 14, fontWeight: '800' },

  errText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.s,
    lineHeight: 17,
  },
  okText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
    marginTop: spacing.s,
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.m,
    lineHeight: 16,
  },
});
