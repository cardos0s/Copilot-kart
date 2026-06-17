import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingShell } from '../../src/components/OnboardingShell';
import { colors, spacing, radius, typography } from '../../src/theme';
import { saveProfile, getProfile } from '../../src/storage/profile';

export default function OnboardingName() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');

  const canContinue = name.trim().length >= 2;

  const handleContinue = async () => {
    const existing = await getProfile();
    await saveProfile({
      name: name.trim(),
      nickname: nickname.trim() || null,
      category: existing?.category ?? '',
      homeTrackId: existing?.homeTrackId ?? null,
      createdAt: existing?.createdAt ?? Date.now(),
    });
    router.push('/onboarding/category');
  };

  return (
    <OnboardingShell
      step={1}
      title="Como você se chama?"
      subtitle="Assim a gente personaliza suas sessões"
      onContinue={handleContinue}
      continueDisabled={!canContinue}
    >
      <Text style={s.label}>NOME DO PILOTO</Text>
      <TextInput
        style={[s.input, name.length > 0 && s.inputActive]}
        value={name}
        onChangeText={setName}
        placeholder="Seu nome"
        placeholderTextColor={colors.textMuted}
        autoFocus
        autoCapitalize="words"
        maxLength={40}
      />

      <Text style={[s.label, { marginTop: spacing.l }]}>
        APELIDO <Text style={s.labelOptional}>(OPCIONAL)</Text>
      </Text>
      <TextInput
        style={s.input}
        value={nickname}
        onChangeText={setNickname}
        placeholder="ex: @enzokart"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        maxLength={30}
      />

      <View style={s.tip}>
        <Text style={s.tipLabel}>DICA</Text>
        <Text style={s.tipText}>
          Seus dados ficam só no seu celular. Nada vai pra nuvem.
        </Text>
      </View>
    </OnboardingShell>
  );
}

const s = StyleSheet.create({
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: spacing.s,
  },
  labelOptional: {
    color: colors.textMuted,
    fontWeight: '500',
  },
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
  inputActive: {
    borderColor: colors.racingBlue,
  },
  tip: {
    marginTop: spacing.xl,
    padding: spacing.m,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipLabel: {
    color: colors.racingBlue,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  tipText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
});