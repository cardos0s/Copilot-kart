import { View, Text, StyleSheet, ImageBackground, Pressable, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../src/theme';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ImageBackground
        source={require('../assets/kart.jpg')}
        style={s.bg}
        resizeMode="cover"
        imageStyle={{ transform: [{ translateY: 40 }] }}
      >
        {/* Gradiente topo pra status bar — derrete suavemente */}
        <LinearGradient
          colors={['rgba(10,10,15,0.95)', 'rgba(10,10,15,0.4)', 'rgba(10,10,15,0)']}
          locations={[0, 0.6, 1]}
          style={s.topGradient}
        />

        {/* Gradiente base pra botão — derrete de transparente pra preto */}
        <LinearGradient
          colors={['rgba(10,10,15,0)', 'rgba(10,10,15,0.85)', 'rgba(10,10,15,0.98)']}
          locations={[0, 0.4, 1]}
          style={s.bottomGradient}
        />

        <View style={[s.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 }]}>
          <View style={s.top}>
            <Text style={s.brand}>
              <Text style={s.brandWhite}>co</Text>
              <Text style={s.brandGreen}>pilot</Text>
            </Text>
          </View>

          <View style={s.middle}>
            <Text style={s.headline}>Onde você está{'\n'}perdendo tempo?</Text>
            <Text style={s.sub}>
              Uma volta você é rápido, na outra segundos atrás. Chegou a hora de saber o que mudou.
            </Text>
          </View>

          <View style={s.bottom}>
            <Pressable
              style={({ pressed }) => [s.button, pressed && { opacity: 0.6 }]}
              onPress={() => router.push('/onboarding/name')}
            >
              <Text style={s.buttonText}>Começar</Text>
              <Text style={s.buttonArrow}>→</Text>
            </Pressable>
            <Text style={s.version}>v0.1 · Brasil</Text>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  bg: { flex: 1 },

  topGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 220,
  },

  bottomGradient: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 380,
  },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },

  top: { alignItems: 'flex-start' },
  brand: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1,
  },
  brandWhite: {
    color: colors.textPrimary,
  },
  brandGreen: {
    color: colors.primary,
    textShadowColor: 'rgba(0,255,136,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  // Empurra texto mais pra cima, longe do botão
  middle: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 60,
  },
  headline: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 38,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  sub: {
    color: '#e8e8f0',
    fontSize: 15,
    marginTop: spacing.m,
    lineHeight: 22,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  bottom: { alignItems: 'center' },
  // Botão minimalista: sem background, só texto + seta
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  buttonText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonArrow: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '800',
  },
  version: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.s,
    fontWeight: '600',
  },
});