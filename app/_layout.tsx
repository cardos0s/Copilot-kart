import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_400Regular_Italic,
  useFonts,
} from '@expo-google-fonts/playfair-display';
import { getProfile } from '../src/storage/profile';
import { SplashLoader } from '../src/components/SplashLoader';
import { colors } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {
  /* já escondida — ok */
});

/**
 * Esconde a barra de navegação do Android (3 botões) globalmente.
 * Comportamento "inset-swipe": o usuário pode trazer de volta com swipe da
 * borda inferior, mas ela some sozinha logo depois — modo imersivo sticky.
 *
 * iOS não tem barra equivalente, então o módulo não faz nada lá.
 */
async function hideAndroidNavBar() {
  if (Platform.OS !== 'android') return;
  try {
    const NavigationBar = await import('expo-navigation-bar');
    await NavigationBar.setVisibilityAsync('hidden');
    await NavigationBar.setBehaviorAsync('inset-swipe');
    await NavigationBar.setBackgroundColorAsync(colors.bg);
  } catch {
    // Falha silenciosa — alguns devices Android não permitem
  }
}

// Flag de cold start: resetada quando o JS bundle recarrega. Garante que
// a Welcome screen apareça em toda inicialização fria, independentemente
// de já ter perfil salvo.
let coldStartHandled = false;

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    (async () => {
      const profile = await getProfile();
      const hasProfile = profile !== null && !!profile.name;

      const currentRoute = segments.join('/');
      const inAuthFlow =
        currentRoute === 'welcome' ||
        currentRoute.startsWith('onboarding');

      // Cold start: força welcome screen mesmo com perfil já criado.
      if (!coldStartHandled) {
        coldStartHandled = true;
        if (!inAuthFlow) {
          router.replace('/welcome');
          return;
        }
      }

      // Sem perfil + não está em fluxo de auth → redireciona pra welcome.
      if (!hasProfile && !inAuthFlow) {
        router.replace('/welcome');
      }
    })();
  }, [segments]);

  return null;
}

export default function RootLayout() {
  const [profileReady, setProfileReady] = useState(false);
  const [barFinished, setBarFinished] = useState(false);
  // Carrega Playfair Display pras telas de celebração (Level Up, Achievements).
  // Se falhar carregar, a app cai pro system font sem quebrar.
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_400Regular_Italic,
  });
  const ready = profileReady && barFinished && fontsLoaded;

  useEffect(() => {
    // Pré-checa o perfil em paralelo à animação da barra, pra que a transição
    // pra rota correta seja imediata quando a splash sair.
    (async () => {
      try {
        await getProfile();
      } finally {
        setProfileReady(true);
      }
    })();
    // Esconde nav bar Android assim que o app monta
    hideAndroidNavBar();
  }, []);

  const handleSplashAnimationFinish = useCallback(() => {
    setBarFinished(true);
  }, []);

  useEffect(() => {
    // Esconde o splash NATIVO assim que o JS pinta o primeiro frame, pra
    // REVELAR o SplashLoader animado. (Antes escondia só quando `ready`, ou
    // seja, depois da animação acabar — então a animação rodava invisível
    // atrás do frame nativo estático.)
    const id = requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch(() => {
        /* já escondida — ok */
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <AuthGate />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="welcome" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="new-session" options={{ title: 'Nova sessão' }} />
            <Stack.Screen name="recording" options={{ headerShown: false }} />
            <Stack.Screen name="recording-reference" options={{ headerShown: false }} />
            <Stack.Screen name="session/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="ai-key" options={{ headerShown: false }} />
            <Stack.Screen name="coach" options={{ headerShown: false }} />
            <Stack.Screen name="track-layouts-picker" options={{ headerShown: false }} />
            <Stack.Screen name="kart-setups" options={{ headerShown: false }} />
            <Stack.Screen name="kart-setup-edit" options={{ headerShown: false }} />
            <Stack.Screen name="preflight" options={{ headerShown: false }} />
            <Stack.Screen name="lap-compare" options={{ headerShown: false }} />
            <Stack.Screen name="career" options={{ headerShown: false }} />
            <Stack.Screen name="recap" options={{ headerShown: false, presentation: 'modal' }} />
            <Stack.Screen name="challenges" options={{ headerShown: false }} />
            <Stack.Screen name="leaderboard" options={{ headerShown: false }} />
            <Stack.Screen name="track-map" options={{ headerShown: false }} />
            <Stack.Screen name="profile-edit" options={{ headerShown: false }} />
          </Stack>
          {!ready && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <SplashLoader onFinish={handleSplashAnimationFinish} />
            </View>
          )}
        </View>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
