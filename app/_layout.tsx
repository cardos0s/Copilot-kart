import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getProfile } from '../src/storage/profile';
import { colors } from '../src/theme';

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Re-checa o perfil sempre que a rota muda. Isso captura o caso em que
    // o usuário termina o onboarding e salva perfil pela primeira vez.
    (async () => {
      const profile = await getProfile();
      const hasProfile = profile !== null && !!profile.name;

      const currentRoute = segments.join('/');
      const inAuthFlow =
        currentRoute === 'welcome' ||
        currentRoute.startsWith('onboarding');

      if (checking) setChecking(false);

      if (!hasProfile && !inAuthFlow) {
        router.replace('/welcome');
      }
    })();
  }, [segments, checking]);

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <AuthGate />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="new-session" options={{ title: 'Nova sessão' }} />
          <Stack.Screen name="recording" options={{ headerShown: false }} />
          <Stack.Screen name="recording-reference" options={{ headerShown: false }} />
          <Stack.Screen name="session/[id]" options={{ title: 'Sessão' }} />
        </Stack>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}