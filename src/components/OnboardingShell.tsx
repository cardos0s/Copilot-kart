import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, typography } from '../theme';

type Props = {
  step: 1 | 2 | 3;
  title: string;
  subtitle: string;
  onBack?: () => void;
  onSkip?: () => void;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
  children: React.ReactNode;
};

export function OnboardingShell({
  step,
  title,
  subtitle,
  onBack,
  onSkip,
  onContinue,
  continueDisabled,
  continueLabel = 'Continuar',
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = onBack ?? (() => router.back());
  const handleSkip = onSkip ?? (() => router.replace('/'));

  return (
    <View style={[s.container, { paddingTop: insets.top + spacing.l }]}>
      {/* Header: voltar + step indicator + pular */}
      <View style={s.header}>
        <Pressable onPress={handleBack} hitSlop={16}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <View style={s.steps}>
          <View style={[s.stepBar, s.stepBarActive]} />
          <View style={[s.stepBar, step >= 2 && s.stepBarActive]} />
          <View style={[s.stepBar, step >= 3 && s.stepBarActive]} />
        </View>
        <Pressable onPress={handleSkip} hitSlop={16}>
          <Text style={s.skip}>Pular</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.titleBlock}>
          <Text style={s.stepLabel}>PASSO {step} DE 3</Text>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>
        </View>

        <View style={s.content}>{children}</View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        <Pressable
          onPress={onContinue}
          disabled={continueDisabled}
          style={({ pressed }) => [
            s.continueBtn,
            continueDisabled && s.continueBtnDisabled,
            pressed && !continueDisabled && { opacity: 0.6 },
          ]}
        >
          <Text
            style={[
              s.continueText,
              continueDisabled && s.continueTextDisabled,
            ]}
          >
            {continueLabel}
          </Text>
          {/* arrow removida — preferência da pilota */}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.l,
    gap: spacing.m,
  },
  back: {
    color: colors.textSecondary,
    fontSize: 28,
    fontWeight: '400',
    width: 20,
  },
  steps: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  stepBar: {
    flex: 1,
    height: 3,
    backgroundColor: colors.border,
    borderRadius: 2,
  },
  stepBarActive: {
    backgroundColor: colors.primary,
  },
  skip: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  titleBlock: {
    paddingHorizontal: spacing.xl,
  },
  stepLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: spacing.s,
    lineHeight: 32,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.s,
    lineHeight: 20,
  },
  content: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.m,
    alignItems: 'center',
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  continueBtnDisabled: {
    opacity: 0.3,
  },
  continueText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  continueTextDisabled: {
    color: colors.textMuted,
  },
  continueArrow: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '800',
  },
});