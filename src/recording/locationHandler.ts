/**
 * Lógica da tarefa de localização em segundo plano, sem nada nativo: o
 * `defineTask` em `locationTask.ts` só chama `handleLocations`.
 *
 * Filtra o fix pela precisão (30 m), resolve o timestamp e entrega o ponto ao
 * buffer da UI e ao diário. Sem gravação ativa, a tarefa para a si mesma, para
 * o GPS nunca ficar ligado sem uma gravação na tela.
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
  stopLocationUpdates(): Promise<void>;
  now(): number;
};

export const MAX_ACCURACY_M = 30;

export async function handleLocations(locations: LocationLike[], deps: LocationTaskDeps): Promise<void> {
  const journal = deps.journal;
  if (!journal || !journal.recordingId) {
    await deps.stopLocationUpdates();
    return;
  }

  // Timestamp dos samples: fonte de verdade do tempo de volta. Alguns Android
  // entregam loc.timestamp quantizado a segundos cheios, o que arredondava
  // as voltas. Então:
  //   - timestamp com precisão sub-segundo (% 1000 != 0) → confia nele;
  //   - senão (quantizado, 0 ou ausente) → now() espalhado ~100 ms por
  //     sample, retroativo (GPS ~10 Hz), para o lote não cair num único t.
  const arrivalNow = deps.now();
  const n = locations.length;
  const samples: GpsSample[] = [];
  for (let i = 0; i < n; i++) {
    const loc = locations[i];
    if ((loc.coords.accuracy ?? 999) > MAX_ACCURACY_M) continue;
    const rawTs = loc.timestamp;
    const hasSubSecond = rawTs && rawTs > 0 && rawTs % 1000 !== 0;
    samples.push({
      t: hasSubSecond ? rawTs : arrivalNow - (n - 1 - i) * 100,
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
  journal.appendGps(samples);
  await journal.flushIfDue(arrivalNow);
}
