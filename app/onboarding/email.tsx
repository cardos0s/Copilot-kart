import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInOrUpWithEmail } from '../../src/lib/auth';
import { colors, spacing, radius } from '../../src/theme';

const BLUE = colors.racingBlue;

export default function OnboardingEmail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = email.includes('@') && password.length >= 6 && !loading;

  const handleSubmit = async () => {
    setLoading(true);
    const r = await signInOrUpWithEmail(email, password);
    setLoading(false);
    if (r.ok && !r.needsConfirm) {
      router.replace('/onboarding/name');
    } else if (r.ok && r.needsConfirm) {
      Alert.alert(
        'Confirme seu e-mail',
        'Enviamos um link de confirmação. Confirme e entre de novo para sincronizar.',
        [{ text: 'OK', onPress: () => router.replace('/onboarding/name') }]
      );
    } else if (r.reason === 'no-supabase') {
      Alert.alert('Indisponível', 'Sincronização não está configurada nesta versão.');
    } else {
      Alert.alert('Não deu', r.message ?? 'Tente novamente.');
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.s }]}>
      <Pressable onPress={() => router.back()} hitSlop={16} style={s.back}>
        <Text style={s.backIcon}>‹</Text>
      </Pressable>

      <View style={s.body}>
        <Text style={s.title}>Continuar com e-mail</Text>
        <Text style={s.subtitle}>Entre ou crie sua conta para sincronizar entre aparelhos.</Text>

        <Text style={s.label}>E-MAIL</Text>
        <TextInput
          style={[s.input, email.length > 0 && s.inputActive]}
          value={email}
          onChangeText={setEmail}
          placeholder="voce@email.com"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          autoFocus
        />

        <Text style={[s.label, { marginTop: spacing.l }]}>SENHA</Text>
        <TextInput
          style={[s.input, password.length > 0 && s.inputActive]}
          value={password}
          onChangeText={setPassword}
          placeholder="Mínimo 6 caracteres"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoComplete="password"
        />
      </View>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        <Pressable
          disabled={!canSubmit}
          onPress={handleSubmit}
          style={({ pressed }) => [s.btn, !canSubmit && s.btnDisabled, pressed && canSubmit && { opacity: 0.85 }]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.btnText}>Continuar</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
  back: { width: 36, height: 36, justifyContent: 'center' },
  backIcon: { color: colors.textSecondary, fontSize: 30, fontWeight: '400' },
  body: { flex: 1, marginTop: spacing.l },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.s, marginBottom: spacing.xl },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: spacing.s },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.l,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '500',
  },
  inputActive: { borderColor: BLUE },
  footer: { paddingTop: spacing.m },
  btn: { backgroundColor: BLUE, borderRadius: radius.m, paddingVertical: 16, alignItems: 'center' },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
