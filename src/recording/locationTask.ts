/**
 * Tarefa de localização em segundo plano. Fica fora do hook e é importada no
 * topo de `app/_layout.tsx`, para existir mesmo quando o sistema relança o app
 * em segundo plano. Toda a lógica está em `handleLocations`.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { GpsFrame, ImuFrame } from '../telemetry/frame';
import { handleLocations, type LocationTaskDeps } from './locationHandler';
import { createSessionClock } from './sessionClock';

export const BG_TASK = 'KARTLAP_BG_LOCATION';

type Buffer = { samples: GpsFrame[]; imu: ImuFrame[] };

/** Buffer que a UI drena a cada poll. Global para sobreviver a reload em dev. */
export const buf: Buffer = (globalThis as any).__kartlapBuf ?? { samples: [], imu: [] };
if (!buf.imu) buf.imu = [];
(globalThis as any).__kartlapBuf = buf;

let journal: LocationTaskDeps['journal'] = null;
let uiActive = false;
const clock: LocationTaskDeps['clock'] = { trustsRaw: false, session: createSessionClock(Date.now()) };

/** O hook de gravação liga o diário aqui ao começar e desliga ao terminar. */
export function setLocationTaskJournal(j: LocationTaskDeps['journal']): void {
  journal = j;
}

/**
 * O hook de gravação marca aqui que uma tela ligou o GPS neste processo. Vale
 * também para as telas que gravam sem diário. Um processo relançado pelo
 * sistema começa com `false`, e a tarefa órfã se para.
 *
 * `t0Utc` é o início da sessão (o `startedAt` do diário): o `t` dos frames é
 * contado a partir dele.
 */
export function setLocationTaskUiActive(v: boolean, t0Utc: number = Date.now()): void {
  uiActive = v;
  // Toda gravação começa aqui: o relógio do GPS é recriado.
  if (v) {
    clock.trustsRaw = false;
    clock.session = createSessionClock(t0Utc);
  }
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
    uiActive,
    stopLocationUpdates,
    now: Date.now,
    clock,
  });
});
