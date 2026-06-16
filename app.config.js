/**
 * Configuração do app — convertida de app.json pra .js pra poder ler
 * tokens secret do env (Mapbox precisa de 2 tokens: um secret pra
 * download do SDK no build, outro público pra runtime).
 *
 * Tokens devem vir de:
 *   - EAS dashboard (Project Settings → Environment Variables), OU
 *   - .env local pro npx expo run/start
 *
 * Variáveis esperadas:
 *   MAPBOX_DOWNLOADS_TOKEN: token sk.* (secret, scope Downloads:Read).
 *     Usado pelo plugin do Mapbox pra baixar o SDK Android da repo
 *     privada deles durante o gradle build.
 *   EXPO_PUBLIC_MAPBOX_TOKEN: token pk.* (público, scope Styles+Tiles).
 *     Embarcado no bundle JS. Expo restringe via URL HTTP referrer
 *     ou bundle ID — configure no dashboard do Mapbox.
 *
 * Sem esses tokens setados, build do Android falha no gradle.
 */

const mapboxDownloadsToken = process.env.MAPBOX_DOWNLOADS_TOKEN ?? '';

module.exports = {
  expo: {
    name: 'Copilot',
    slug: 'kartlap',
    version: '0.1.0',
    orientation: 'default',
    scheme: 'kartlap',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    icon: './assets/icon.png',
    ios: {
      supportsTablet: false,
      usesAppleSignIn: true,
      package: 'com.cortextech.copilot',
      config: {
        // App usa apenas criptografia padrão (HTTPS/TLS) — isenta.
        // Evita o aviso "Faltam dados de conformidade" a cada build no TestFlight.
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        UIBackgroundModes: ['location', 'location'],
        NSLocationWhenInUseUsageDescription:
          'O KartLap usa sua localização para gravar a trajetória na pista.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'O KartLap precisa da localização em segundo plano para continuar gravando quando a tela estiver apagada.',
        NSMotionUsageDescription:
          'O KartLap usa sensores de movimento para melhorar a precisão da trajetória.',
        NSPhotoLibraryUsageDescription:
          'Selecione uma foto da galeria para usar no seu perfil.',
        NSCameraUsageDescription: 'Tire uma foto para usar no seu perfil.',
      },
      bundleIdentifier: 'com.cortextech.copilot',
    },
    android: {
      package: 'com.cortextech.copilot',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#151D2F',
      },
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
        'WAKE_LOCK',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
      ],
    },
    plugins: [
      'expo-router',
      'expo-apple-authentication',
      [
        'expo-splash-screen',
        {
          // Frame nativo: wordmark COCKPIT 219 (branco+azul) sobre preto.
          // Mesmo logo usado no SplashLoader (JS) → handoff preto→preto perfeito.
          image: './assets/splash-logo-f1.png',
          imageWidth: 300,
          resizeMode: 'contain',
          backgroundColor: '#000000',
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'O KartLap precisa da localização em segundo plano para gravar a volta completa.',
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
        },
      ],
      'expo-secure-store',
      'expo-font',
      [
        '@rnmapbox/maps',
        {
          // Token secret usado no BUILD ANDROID pra baixar o Mapbox SDK
          // do repo privado deles. Sem isso, gradle falha com 401.
          // String vazia em dev local é OK (não builda Android nativo).
          RNMapboxMapsDownloadToken: mapboxDownloadsToken,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: '290688e3-7d00-42d8-ab7b-05455cfb380f',
      },
    },
  },
};
