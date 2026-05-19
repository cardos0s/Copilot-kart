import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ImageBackground, Pressable, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile } from '../src/storage/profile';
import { colors, spacing, radius } from '../src/theme';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    getProfile().then((p) => setHasProfile(p !== null && !!p.name));
  }, []);

  const handleStart = () => {
    if (hasProfile) {
      router.replace('/');
    } else {
      router.push('/onboarding/name');
    }
  };

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ImageBackground
        source={require('../assets/splash.png')}
        style={s.bg}
        resizeMode="cover"
      >
        {/* Gradiente base pra botão — derrete de transparente pra preto */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.95)']}
          locations={[0, 0.55, 1]}
          style={s.bottomGradient}
        />

        <View style={[s.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 }]}>
          <View style={s.middle} />

          <View style={s.bottom}>
            <Pressable
              style={({ pressed }) => [s.button, pressed && { opacity: 0.6 }]}
              onPress={handleStart}
            >
              <Text style={s.buttonText}>{hasProfile ? 'Entrar' : 'Começar'}</Text>
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