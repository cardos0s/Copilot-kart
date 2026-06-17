import { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingShell } from '../../src/components/OnboardingShell';
import { colors, spacing, radius } from '../../src/theme';
import { saveProfile, getProfile } from '../../src/storage/profile';

type Category = {
  id: string;
  name: string;
  sub: string;
};

// Categorias relevantes no Brasil. Organizadas por popularidade/frequência.
const CATEGORIES: Category[] = [
  { id: 'honda-400', name: 'Honda 400', sub: 'Sem marchas' },
  { id: 'rd', name: 'RD', sub: '5 marchas' },
  { id: 'cadete', name: 'Cadete', sub: '8-10 anos' },
  { id: 'junior', name: 'Júnior', sub: '11-14 anos' },
  { id: 'senior', name: 'Sênior', sub: '15+ anos' },
  { id: 'rental', name: 'Rental', sub: 'Locação' },
  { id: 'rotax', name: 'Rotax', sub: 'Max / Junior' },
  { id: 'shifter', name: 'Shifter', sub: '125cc marchas' },
];

export default function OnboardingCategory() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    // Pre-seleciona se já escolheu antes
    getProfile().then((p) => {
      if (p?.category) {
        const match = CATEGORIES.find((c) => c.id === p.category);
        if (match) setSelected(match.id);
        else setCustom(true);
      }
    });
  }, []);

  const canContinue = selected !== null || custom;

  const handleContinue = async () => {
    const existing = await getProfile();
    if (!existing) return;
    await saveProfile({
      ...existing,
      category: selected ?? 'outra',
    });
    router.push('/onboarding/track');
  };

  return (
    <OnboardingShell
      step={2}
      title="Qual sua categoria?"
      subtitle="Ajuda a comparar com tempos de referência"
      onContinue={handleContinue}
      continueDisabled={!canContinue}
    >
      <View style={s.grid}>
        {CATEGORIES.map((cat) => {
          const isActive = selected === cat.id;
          return (
            <Pressable
              key={cat.id}
              onPress={() => {
                setSelected(cat.id);
                setCustom(false);
              }}
              style={({ pressed }) => [
                s.chip,
                isActive && s.chipActive,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[s.chipTitle, isActive && s.chipTitleActive]}>{cat.name}</Text>
              <Text style={[s.chipSub, isActive && s.chipSubActive]}>{cat.sub}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => {
          setCustom(true);
          setSelected(null);
        }}
        style={({ pressed }) => [
          s.otherChip,
          custom && s.otherChipActive,
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={[s.otherText, custom && s.otherTextActive]}>
          Minha categoria não está aí
        </Text>
      </Pressable>
    </OnboardingShell>
  );
}

const s = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    width: '48%',
    padding: spacing.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
  },
  chipActive: {
    backgroundColor: 'rgba(47, 107, 255, 0.10)',
    borderColor: colors.racingBlue,
    borderWidth: 1.5,
  },
  chipTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  chipTitleActive: {
    color: colors.racingBlue,
    fontWeight: '800',
  },
  chipSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  chipSubActive: {
    color: '#8FB0F0',
  },
  otherChip: {
    marginTop: spacing.m,
    padding: spacing.m,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.m,
    alignItems: 'center',
  },
  otherChipActive: {
    borderColor: colors.racingBlue,
    backgroundColor: 'rgba(47, 107, 255, 0.06)',
    borderStyle: 'solid',
  },
  otherText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  otherTextActive: {
    color: colors.racingBlue,
  },
});