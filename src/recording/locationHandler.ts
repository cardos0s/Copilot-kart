/**
 * Lógica da tarefa de localização em segundo plano, sem nada nativo: o
 * `defineTask` em `locationTask.ts` só chama `handleLocations`.
 *
 * Transforma cada fix em `GpsFrame` no relógio da sessão e entrega ao buffer
 * da UI e, se houver, ao diário. Nenhuma fix é descartada (TF-03): a precisão
 * real fica no frame, e o corte de 30 m é da análise (`analysisGps`). Sem
 * diário ativo e sem tela de gravação ligada no processo, a tarefa para a si
 * mesma, para o GPS nunca ficar ligado sem uma gravação na tela. As telas que
 * gravam sem diário (Corrida contra a lenda, Competição) recebem os frames só
 * no buffer.
 */
import type { LocationObject } from 'expo-location';
import type { GpsFrame } from '../telemetry/frame';
import type { RecordingJournal } from './journal';
import type { SessionClock } from './sessionClock';

export type LocationLike = Pick<LocationObject, 'timestamp'> & {
  coords: Pick<
    LocationObject['coords'],
    'latitude' | 'longitude' | 'speed' | 'accuracy' | 'heading' | 'altitude' | 'altitudeAccuracy'
  >;
};

export type LocationTaskDeps = {
  buf: { samples: GpsFrame[] };
  journal: Pick<RecordingJournal, 'recordingId' | 'appendGps' | 'flushIfDue'> | null;
  /** Alguma tela de gravação ligou o GPS neste processo. */
  uiActive: boolean;
  stopLocationUpdates(): Promise<void>;
  now(): number;
  /**
   * Estado do relógio da gravação, recriado a cada gravação pelo `locationTask`.
   * `trustsRaw` liga no primeiro fix com sub-segundo e vale até o fim; `session`
   * é o relógio da sessão, que dá o `t` (estritamente crescente).
   */
  clock: { trustsRaw: boolean; session: SessionClock };
};

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
  //   - o t é o do relógio da sessão (`gpsT`): tempo resolvido − t0Utc,
  //     com max(t, lastT + 1), estritamente crescente;
  //   - o frame com tempo estimado leva `timeRepaired` (TF-04).
  const { clock } = deps;
  if (!clock.trustsRaw && locations.some((l) => l.timestamp > 0 && l.timestamp % 1000 !== 0)) {
    clock.trustsRaw = true;
  }
  const arrivalNow = deps.now();
  const n = locations.length;
  const samples: GpsFrame[] = [];
  for (let i = 0; i < n; i++) {
    const loc = locations[i];
    const rawTs = loc.timestamp;
    const repaired = !(clock.trustsRaw && rawTs > 0);
    const frame: GpsFrame = {
      kind: 'gps',
      source: 'PHONE',
      t: clock.session.gpsT(repaired ? arrivalNow - (n - 1 - i) * 100 : rawTs),
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      speed: loc.coords.speed ?? 0,
      accuracy: loc.coords.accuracy ?? undefined,
      heading: loc.coords.heading ?? undefined,
      altitude: loc.coords.altitude ?? undefined,
      altitudeAccuracy: loc.coords.altitudeAccuracy ?? undefined,
      // O celular não informa 2D/3D (spec, Assumptions).
      fix: 'unknown',
      gnssTime: rawTs,
    };
    if (repaired) frame.timeRepaired = true;
    samples.push(frame);
  }
  if (samples.length === 0) return;

  deps.buf.samples.push(...samples);
  if (!journal) return;
  journal.appendGps(samples);
  await journal.flushIfDue(arrivalNow);
}
