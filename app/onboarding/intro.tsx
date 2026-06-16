import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../../src/theme';

const FEATURES: { tag: string; title: string; desc: string }[] = [
  {
    tag: '01',
    title: 'Grava suas voltas por GPS',
    desc: 'Celular no bolso do macacão. O app registra a trajetória a até 10x por segundo, com a tela apagada.',
  },
  {
    tag: '02',
    title: 'Vê onde você perde tempo',
    desc: 'Mapa da pista colorido (verde = ganhou, vermelho = perdeu) e o delta de cada setor vs. sua melhor volta.',
  },
  {
    tag: '03',
    title: 'Evolui a cada sessão',
    desc: 'Coach por IA, recordes, desafios e ranking. E tudo fica no seu celular — sem mensalidade, sem nuvem.',
  },
];

export default function OnboardingIntro() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.xl }]}>
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.brand}>
          COCKPIT <Text style={s.brandNum}>219</Text>
        </Text>
        <Text style={s.title}>Telemetria de kart no seu bolso</Text>
        <Text style={s.subtitle}>
          Transforme cada volta em dado. Veja em segundos como o melhor piloto vê.
        </Text>

        <View style={s.features}>
          {FEATURES.map((f) => (
            <View key={f.tag} style={s.feature}>
              <Text style={s.featureTag}>{f.tag}</Text>
              <View style={s.featureBody}>
                <Text style={s.featureTitle}>{f.title}</Text>
                <Text style={s.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + spacing.l }]}>
        <Pressable
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          onPress={() => router.push('/onboarding/name')}
        >
          <Text style={s.buttonText}>Começar</Text>
        </Pressable>
        <Text style={s.footnote}>Leva menos de 1 minuto pra configurar.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  brand: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 1,
    marginBottom: spacing.xl,
  },
  brandNum: {
    color: colors.accentCyan,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.m,
  },
  features: {
    marginTop: spacing.xl,
    gap: spacing.m,
  },
  feature: {
    flexDirection: 'row',
    gap: spacing.m,
    padding: spacing.l,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureTag: {
    color: colors.accentCyan,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 2,
  },
  featureBody: {
    flex: 1,
  },
  featureTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  featureDesc: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.m,
  },
  button: {
    backgroundColor: colors.accentCyan,
    borderRadius: radius.m,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '800',
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.m,
  },
});
