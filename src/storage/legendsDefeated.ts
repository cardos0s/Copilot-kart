import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Uma lenda batida: o melhor tempo que você fez e quando bateu. */
export type DefeatedLegend = { id: string; yourBestMs: number; defeatedAt: number };

const KEY = '@copilot:legendsDefeated';

export async function getDefeated(): Promise<Record<string, DefeatedLegend>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, DefeatedLegend>) : {};
  } catch {
    return {};
  }
}

/** Marca a lenda como vencida. Mantém o MELHOR tempo se bater de novo. */
export async function markDefeated(id: string, yourBestMs: number): Promise<void> {
  const all = await getDefeated();
  const prev = all[id];
  if (!prev || yourBestMs < prev.yourBestMs) {
    all[id] = { id, yourBestMs, defeatedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  }
}

/** Hook reativo — recarrega sob demanda (ex.: useFocusEffect). */
export function useDefeatedLegends(): {
  defeated: Record<string, DefeatedLegend>;
  reload: () => void;
} {
  const [defeated, setDefeated] = useState<Record<string, DefeatedLegend>>({});
  const reload = useCallback(() => {
    getDefeated().then(setDefeated);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { defeated, reload };
}
