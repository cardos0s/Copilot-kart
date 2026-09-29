/**
 * Lógica da tarefa de localização em segundo plano, sem nada nativo: o
 * `defineTask` em `locationTask.ts` só chama `handleLocations`.
 *
 * Filtra o fix pela precisão (30 m), resolve o timestamp e entrega o ponto ao
 * buffer da UI e, se houver, ao diário. Sem diário ativo e sem tela de gravação
 * ligada no processo, a tarefa para a si mesma, para o GPS nunca ficar ligado
 * sem uma gravação na tela. As telas que gravam sem diário (Corrida contra a
 * lenda, Competição) recebem os pontos só no buffer.
 */
import type { LocationObject } from 'expo-location';
import type { GpsSample } from '../lib/geometry';
import type { RecordingJournal } from './journal';

export type LocationLike = Pick<LocationObject, 'timestamp'> & {
  coords: Pick<
    LocationObject['coords'],
    'latitude' | 'longitude' | 'speed' | 'accuracy' | 'heading' | 'altitude' | 'altitudeAccuracy'
  >;
};

export type LocationTaskDeps = {
  buf: { samples: GpsSample[] };
  journal: Pick<RecordingJournal, 'recordingId' | 'appendGps' | 'flushIfDue'> | null;
  /** Alguma tela de gravação ligou o GPS neste processo. */
  uiActive: boolean;
  stopLocationUpdates(): Promise<void>;
  now(): number;
  /**
   * Estado do relógio da gravação, zerado a cada gravação pelo `locationTask`.
   * `trustsRaw` liga no primeiro fix com sub-segundo e vale até o fim; `lastT`
   * é o último `t` emitido.
   */
  clock: { trustsRaw: boolean; lastT: number };
};

export const MAX_ACCURACY_M = 30;

export async function handleLocations(locations: LocationLike[], deps: LocationTaskDeps): Promise<void> {
  const journal = deps.journal?.recordingId ? deps.journal : null;
  if (!journal && !deps.uiActive) {
    await deps.stopLocationUpdates();
    return;
  }

  // Timestamp dos samples: fonte de verdade do tempo de volta. Alguns Android
  // entregam loc.timestamp quantizado a segundos cheios, o que arredondava
  // as voltas. Então:
  //   - o aparelho que já entregou um timestamp com sub-segundo (% 1000 != 0)
  //     tem relógio GNSS confiável: o timestamp cru vale, mesmo em .000;
  //   - senão (quantizado, 0 ou ausente) → now() espalhado ~100 ms por
  //     sample, retroativo (GPS ~10 Hz), para o lote não cair num único t;
  //   - todo t emitido é max(t, lastT + 1): estritamente crescente.
  const { clock } = deps;
  if (!clock.trustsRaw && locations.some((l) => l.timestamp > 0 && l.timestamp % 1000 !== 0)) {
    clock.trustsRaw = true;
  }
  const arrivalNow = deps.now();
  const n = locations.length;
  const samples: GpsSample[] = [];
  for (let i = 0; i < n; i++) {
    const loc = locations[i];
    if ((loc.coords.accuracy ?? 999) > MAX_ACCURACY_M) continue;
    const rawTs = loc.timestamp;
    const t0 = clock.trustsRaw && rawTs > 0 ? rawTs : arrivalNow - (n - 1 - i) * 100;
    const t = Math.max(t0, clock.lastT + 1);
    clock.lastT = t;
    samples.push({
      t,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      speed: loc.coords.speed ?? 0,
      accuracy: loc.coords.accuracy ?? 999,
      heading: loc.coords.heading ?? undefined,
      altitude: loc.coords.altitude ?? undefined,
      altitudeAccuracy: loc.coords.altitudeAccuracy ?? undefined,
    });
  }
  if (samples.length === 0) return;

  deps.buf.samples.push(...samples);
  if (!journal) return;
  journal.appendGps(samples);
  await journal.flushIfDue(arrivalNow);
}
