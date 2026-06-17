import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { isAppleAuthAvailable, signInWithApple, type AppleAuthResult } from '../lib/auth';

type Props = {
  onResult: (r: AppleAuthResult) => void;
  style?: object;
  buttonType?: AppleAuthentication.AppleAuthenticationButtonType;
};

/**
 * Botão nativo "Sign in with Apple". Só renderiza no iOS quando disponível.
 * Em outras plataformas (ou se indisponível) não mostra nada.
 */
export function AppleSignInButton({ onResult, style, buttonType }: Props) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    isAppleAuthAvailable().then(setAvailable);
  }, []);

  if (Platform.OS !== 'ios' || !available) return null;

  return (
    <View style={style}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={buttonType ?? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={12}
        style={styles.button}
        onPress={async () => {
          const r = await signInWithApple();
          onResult(r);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: '100%', height: 50 },
});
