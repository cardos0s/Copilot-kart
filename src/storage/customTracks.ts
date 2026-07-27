/**
 * Pistas personalizadas criadas pelo usuário quando a dele não está no
 * catálogo estático (src/data/tracks.ts). Persistidas em AsyncStorage como
 * JSON — volume minúsculo (poucas pistas por usuário).
 *
 * O id leva prefixo "custom-": telas que fazem findTrackById não acham e
 * caem no fallback `session.trackName`, que já existe em todas. Layouts e
 * sessões referenciam o id por string no SQLite normalmente.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TrackRef } from '../data/tracks';

const KEY = '@copilot:custom_tracks';

export async function listCustomTracks(): Promise<TrackRef[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Cria e persiste uma pista personalizada. `lat/lng` idealmente vêm da
 * posição atual do usuário (ele costuma estar NA pista ao cadastrar);
 * quando indisponíveis ficam 0,0 e a ordenação por distância ignora.
 */
export async function addCustomTrack(input: {
  name: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<TrackRef> {
  const name = input.name.trim();
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const track: TrackRef = {
    id: `custom-${slug}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    shortName: name.length > 22 ? `${name.slice(0, 20)}…` : name,
    city: '',
    state: '',
    lat: input.lat ?? 0,
    lng: input.lng ?? 0,
    lengthM: 0,
  };
  const existing = await listCustomTracks();
  await AsyncStorage.setItem(KEY, JSON.stringify([track, ...existing]));
  return track;
}

export async function removeCustomTrack(id: string): Promise<void> {
  const existing = await listCustomTracks();
  await AsyncStorage.setItem(KEY, JSON.stringify(existing.filter((t) => t.id !== id)));
}
