import { useEffect, useState } from 'react';
import { ImageBackground, Pressable, StatusBar, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { getProfile } from '../src/storage/profile';
import { colors } from '../src/theme';

export default function Welcome() {
  const router = useRouter();
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
    <Pressable style={s.container} onPress={handleStart}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ImageBackground
        source={require('../assets/welcome.png')}
        style={s.bg}
        resizeMode="cover"
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  bg: { flex: 1 },
});
