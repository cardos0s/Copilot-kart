/**
 * Tarefa de localização em segundo plano. Fica fora do hook e é importada no
 * topo de `app/_layout.tsx`, para existir mesmo quando o sistema relança o app
 * em segundo plano. Toda a lógica está em `handleLocations`.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { GpsSample, ImuSample } from '../lib/geometry';
import { handleLocations, type LocationTaskDeps } from './locationHandler';

export const BG_TASK = 'KARTLAP_BG_LOCATION';

type Buffer = { samples: GpsSample[]; imu: ImuSample[] };

/** Buffer que a UI drena a cada poll. Global para sobreviver a reload em dev. */
export const buf: Buffer = (globalThis as any).__kartlapBuf ?? { samples: [], imu: [] };
if (!buf.imu) buf.imu = [];
(globalThis as any).__kartlapBuf = buf;

let journal: LocationTaskDeps['journal'] = null;

/** O hook de gravação liga o diário aqui ao começar e desliga ao terminar. */
export function setLocationTaskJournal(j: LocationTaskDeps['journal']): void {
  journal = j;
}

async function stopLocationUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_TASK)) {
      await Location.stopLocationUpdatesAsync(BG_TASK);
    }
  } catch (e) {
    console.warn('[Copilot BG] falha ao parar a tarefa:', e);
  }
}

TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[Copilot BG] erro:', error);
    return;
  }
  const { locations } = (data as any) ?? {};
  if (!locations) return;
  await handleLocations(locations, {
    buf,
    journal,
    stopLocationUpdates,
    now: Date.now,
  });
});
