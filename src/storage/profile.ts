import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const KEY = '@copilot:profile';

export type PilotProfile = {
  name: string;
  nickname: string | null;
  category: string;
  homeTrackId: string | null;
  createdAt: number;
  /** URI local da foto salva em documentDirectory. Null = usar iniciais. */
  photoUri?: string | null;
  /** Número de competição. Default: null. */
  kartNumber?: string | null;
  /** Equipe / time. Default: null. */
  team?: string | null;
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

/**
 * Copia a foto selecionada (que pode estar em cache temporário) para o
 * documentDirectory do app, retornando a URI estável. Sem isso a foto pode
 * sumir quando o iOS limpa o cache.
 */
export async function persistProfilePhoto(sourceUri: string): Promise<string> {
  const docsDir = (FileSystem as any).documentDirectory ?? '';
  const filename = `profile_${Date.now()}.jpg`;
  const destUri = `${docsDir}${filename}`;
  await (FileSystem as any).copyAsync({ from: sourceUri, to: destUri });
  return destUri;
}
