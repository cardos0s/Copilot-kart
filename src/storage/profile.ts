import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@copilot:profile';

export type PilotProfile = {
  name: string;
  nickname: string | null;
  category: string;
  homeTrackId: string | null;
  createdAt: number;
};

export async function getProfile(): Promise<PilotProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: PilotProfile): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(profile));
}

export async function clearProfile(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}