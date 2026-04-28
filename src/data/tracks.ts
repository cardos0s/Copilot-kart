export type TrackRef = {
  id: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  lengthM: number;
};

/** Kartódromos pré-cadastrados do Brasil. Coordenadas aproximadas. */
export const TRACKS: TrackRef[] = [
  {
    id: 'leandro-melo',
    name: 'Kartódromo Leandro Melo',
    shortName: 'Leandro Melo',
    city: 'Vitória da Conquista',
    state: 'BA',
    lat: -14.8789,
    lng: -40.8443,
    lengthM: 780,
  },
  {
    id: 'ayrton-senna-lauro',
    name: 'Kartódromo Ayrton Senna',
    shortName: 'Ayrton Senna',
    city: 'Lauro de Freitas',
    state: 'BA',
    lat: -12.8966,
    lng: -38.3267,
    lengthM: 1200,
  },
  {
    id: 'granja-viana',
    name: 'Kartódromo Internacional Granja Viana',
    shortName: 'Granja Viana',
    city: 'Cotia',
    state: 'SP',
    lat: -23.6014,
    lng: -46.8431,
    lengthM: 1150,
  },
  {
    id: 'interlagos',
    name: 'Kartódromo Ayrton Senna (Interlagos)',
    shortName: 'Interlagos',
    city: 'São Paulo',
    state: 'SP',
    lat: -23.7038,
    lng: -46.6988,
    lengthM: 1150,
  },
  {
    id: 'speedland',
    name: 'Speedland Tatuapé',
    shortName: 'Speedland',
    city: 'São Paulo',
    state: 'SP',
    lat: -23.5427,
    lng: -46.5587,
    lengthM: 500,
  },
  {
    id: 'aldeia-serra',
    name: 'Kartódromo Internacional Aldeia da Serra',
    shortName: 'Aldeia da Serra',
    city: 'Barueri',
    state: 'SP',
    lat: -23.4872,
    lng: -46.8794,
    lengthM: 1100,
  },
  {
    id: 'speed-park',
    name: 'Speed Park',
    shortName: 'Speed Park',
    city: 'Birigui',
    state: 'SP',
    lat: -21.2895,
    lng: -50.3401,
    lengthM: 1300,
  },
  {
    id: 'beto-carrero',
    name: 'Kartódromo Beto Carrero',
    shortName: 'Beto Carrero',
    city: 'Penha',
    state: 'SC',
    lat: -26.7745,
    lng: -48.6408,
    lengthM: 1050,
  },
];

export function findTrackById(id: string): TrackRef | undefined {
  return TRACKS.find((t) => t.id === id);
}

/** Distância haversine em km */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const DEG = Math.PI / 180;
  const dLat = (lat2 - lat1) * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}