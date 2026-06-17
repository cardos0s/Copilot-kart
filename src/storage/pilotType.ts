import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Modo de pilotagem: dono do próprio kart vs. indoor/locação. */
export type PilotType = 'owner' | 'indoor';

const KEY = '@copilot:pilotType';

export async function getPilotType(): Promise<PilotType | null> {
  const v = await AsyncStorage.getItem(KEY);
  return v === 'owner' || v === 'indoor' ? v : null;
}

export async function setPilotType(t: PilotType): Promise<void> {
  await AsyncStorage.setItem(KEY, t);
}

export const PILOT_TYPE_LABEL: Record<PilotType, string> = {
  owner: 'Kart próprio',
  indoor: 'Indoor',
};

/** Hook reativo com setter que persiste. */
export function usePilotType(): [PilotType | null, (t: PilotType) => void] {
  const [type, setType] = useState<PilotType | null>(null);
  useEffect(() => {
    getPilotType().then(setType);
  }, []);
  const update = (t: PilotType) => {
    setType(t);
    setPilotType(t);
  };
  return [type, update];
}
