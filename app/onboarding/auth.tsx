import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import Svg, { Path, Ellipse, Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { AppleSignInButton } from '../../src/components/AppleSignInButton';
import { signOut } from '../../src/lib/auth';
import type { AppleAuthResult } from '../../src/lib/auth';
import { colors, spacing, radius } from '../../src/theme';

const LIME = colors.accentLime;
const BLUE = colors.racingBlue;

function GridArt() {
  return (
    <View style={a.artWrap}>
      <View style={a.glow} />
      <Svg width={150} height={150} viewBox="0 0 150 150">
        <Defs>
          <RadialGradient id="disc" cx="50%" cy="45%" r="60%">
            <Stop offset="0" stopColor="#15233f" />
            <Stop offset="1" stopColor="#0a0e18" />
          </RadialGradient>
        </Defs>
        <Circle cx={75} cy={70} r={56} fill="url(#disc)" stroke="#1f2b45" strokeWidth={1.5} />
        {/* base / pódio (azul) */}
        <Ellipse cx={75} cy={116} rx={46} ry={11} fill={BLUE} opacity={0.25} />
        <Ellipse cx={75} cy={112} rx={34} ry={8} fill={BLUE} opacity={0.5} />
        {/* marcador lime (chevron pra cima) */}
        <Path d="M75 44 L91 78 L75 70 L59 78 Z" fill={LIME} />
        <Circle cx={75} cy={86} r={6} fill={LIME} />
      </Svg>
    </View>
  );
}

export default function OnboardingAuth() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const goCadastro = () => router.push('/onboarding/name');

  const handleApple = (r: AppleAuthResult) => {
    if (r.ok) {
      goCadastro();
    } else if (r.reason === 'error') {
      // Se algo falhou no meio, garante que não fica meio-logado.
      signOut();
    }
  };

  return (
    <View style={[a.root, { paddingTop: insets.top + spacing.s }]}>
      <Pressable onPress={() => router.back()} hitSlop={16} style={a.back}>
        <Text style={a.backIcon}>‹</Text>
      </Pressable>

      <View style={a.body}>
        <GridArt />
        <Text style={a.title}>ENTRE PRO GRID</Text>
        <Text style={a.subtitle}>
          Salve suas voltas, sincronize entre aparelhos e personalize o app do seu jeito.
        </Text>
      </View>

      <View style={[a.actions, { paddingBottom: insets.bottom + spacing.l }]}>
        <AppleSignInButton
          onResult={handleApple}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          style={a.appleWrap}
        />

        <Pressable
          style={({ pressed }) => [a.emailBtn, pressed && { opacity: 0.8 }]}
          onPress={() => router.push('/onboarding/email')}
        >
          <Text style={a.emailIcon}>✉</Text>
          <Text style={a.emailText}>Continuar com e-mail</Text>
        </Pressable>

        <Pressable hitSlop={10} onPress={goCadastro} style={a.skip}>
          <Text style={a.skipText}>Continuar sem conta</Text>
        </Pressable>

        <Text style={a.terms}>
          Ao continuar, você concorda com os Termos e a Política de Privacidade.
        </Text>
      </View>
    </View>
  );
}

const a = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
  back: { width: 36, height: 36, justifyContent: 'center' },
  backIcon: { color: colors.textSecondary, fontSize: 30, fontWeight: '400' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  glow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: BLUE,
    opacity: 0.18,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -0.3,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.m,
    paddingHorizontal: spacing.m,
  },
  actions: { gap: spacing.m },
  appleWrap: { width: '100%' },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    height: 50,
    borderRadius: radius.m,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  emailIcon: { color: colors.textPrimary, fontSize: 16 },
  emailText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  skip: { alignItems: 'center', paddingVertical: spacing.s },
  skipText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  terms: { color: colors.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: spacing.xs },
});
