/**
 * Preferências locais simples (toggle de features, etc). Persistidas em
 * AsyncStorage. Não são credencial — pode ficar em plain text.
 *
 * Cada preferência tem default razoável e o getter retorna o default se o
 * AsyncStorage falhar/não tiver valor.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const PREFIX = '@copilot:pref:';

async function getBool(key: string, fallback: boolean): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

async function setBool(key: string, value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, value ? 'true' : 'false');
  } catch {
    /* ignora */
  }
}

// ===== Toggle: Coach IA flutuante =====

const COACH_FLOATING_KEY = 'coach_floating_enabled';

export const getCoachFloatingEnabled = () => getBool(COACH_FLOATING_KEY, true);
export const setCoachFloatingEnabled = (v: boolean) => setBool(COACH_FLOATING_KEY, v);

// ===== Toggle: sync de sessões na nuvem (backup anônimo por device_id) =====
// Default ON — backup + visibilidade dev na fase de teste. Opt-out nas
// configurações pra respeitar privacidade (LGPD: usuário pode recusar).
// Sincroniza só metadata + tempos (não samples brutos).

const CLOUD_SYNC_KEY = 'cloud_sync_enabled';

export const getCloudSyncEnabled = () => getBool(CLOUD_SYNC_KEY, true);
export const setCloudSyncEnabled = (v: boolean) => setBool(CLOUD_SYNC_KEY, v);

/**
 * Hook React que mantém o estado reativo do toggle. Componentes podem usar
 * pra esconder o botão quando o piloto desativar nas configurações.
 */
const listeners = new Set<(enabled: boolean) => void>();

export function useCoachFloatingEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCoachFloatingEnabled().then((v) => {
      if (!cancelled) setEnabled(v);
    });
    const l = (v: boolean) => setEnabled(v);
    listeners.add(l);
    return () => {
      cancelled = true;
      listeners.delete(l);
    };
  }, []);

  const update = useCallback(async (v: boolean) => {
    setEnabled(v);
    await setCoachFloatingEnabled(v);
    for (const l of listeners) l(v);
  }, []);

  return [enabled, update];
}
