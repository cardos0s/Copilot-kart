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

/**
 * Kartódromos pré-cadastrados do Brasil.
 *
 * Coordenadas aproximadas — muitas em nível de cidade. São usadas SÓ pra
 * ordenar por distância na escolha de pista; o traçado real vem da volta
 * de referência gravada por GPS. lengthM é estimativa quando não
 * documentado (não é usado em cálculo nenhum).
 *
 * IDs dos 8 primeiros são históricos — sessões antigas referenciam por id,
 * NÃO renomear.
 */
export const TRACKS: TrackRef[] = [
  // ==== Originais (ids estáveis) ====
  {
    id: 'leandro-melo',
    name: 'Kartódromo Leandro Merlo',
    shortName: 'Leandro Merlo',
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
    lengthM: 1200,
  },

  // ==== São Paulo ====
  { id: 'san-marino', name: 'Kartódromo Internacional San Marino', shortName: 'San Marino', city: 'Paulínia', state: 'SP', lat: -22.7611, lng: -47.1542, lengthM: 1100 },
  { id: 'nova-odessa', name: 'Kartódromo MMOA Nova Odessa', shortName: 'Nova Odessa', city: 'Nova Odessa', state: 'SP', lat: -22.7776, lng: -47.2958, lengthM: 1400 },
  { id: 'schincariol-itu', name: 'Kartódromo Schincariol', shortName: 'Itu', city: 'Itu', state: 'SP', lat: -23.2637, lng: -47.2992, lengthM: 1240 },
  { id: 'italia-kart', name: 'Itália Kart', shortName: 'Itália Kart', city: 'Valinhos', state: 'SP', lat: -22.9698, lng: -46.9974, lengthM: 900 },
  { id: 'premium-abc', name: 'Kart Premium ABC', shortName: 'Premium ABC', city: 'Santo André', state: 'SP', lat: -23.6639, lng: -46.5383, lengthM: 310 },
  { id: 'ecpa-piracicaba', name: 'ECPA — Esporte Clube Piracicabano de Automobilismo', shortName: 'ECPA', city: 'Piracicaba', state: 'SP', lat: -22.7253, lng: -47.6492, lengthM: 1000 },
  { id: 'kart-in-jaguare', name: 'Kart In Jaguaré', shortName: 'Kart In', city: 'São Paulo', state: 'SP', lat: -23.5462, lng: -46.7422, lengthM: 500 },
  { id: 'k1-guarulhos', name: 'K1 Kart Indoor', shortName: 'K1 Guarulhos', city: 'Guarulhos', state: 'SP', lat: -23.4628, lng: -46.5333, lengthM: 450 },
  { id: 'speed-hunters-sbc', name: 'Speed Hunters', shortName: 'Speed Hunters', city: 'São Bernardo do Campo', state: 'SP', lat: -23.6914, lng: -46.5646, lengthM: 500 },
  { id: 'kart-atibaia', name: 'Kartódromo de Atibaia', shortName: 'Atibaia', city: 'Atibaia', state: 'SP', lat: -23.1171, lng: -46.5563, lengthM: 900 },
  { id: 'kart-limeira', name: 'Kartódromo de Limeira', shortName: 'Limeira', city: 'Limeira', state: 'SP', lat: -22.5641, lng: -47.4014, lengthM: 900 },
  { id: 'kart-guaratingueta', name: 'Kartódromo de Guaratinguetá', shortName: 'Guaratinguetá', city: 'Guaratinguetá', state: 'SP', lat: -22.8166, lng: -45.1927, lengthM: 900 },
  { id: 'kart-caragua', name: 'Kartódromo de Caraguatatuba', shortName: 'Caraguá', city: 'Caraguatatuba', state: 'SP', lat: -23.6201, lng: -45.4130, lengthM: 800 },
  { id: 'kart-praia-grande', name: 'Kartódromo Municipal de Praia Grande', shortName: 'Praia Grande', city: 'Praia Grande', state: 'SP', lat: -24.0058, lng: -46.4028, lengthM: 900 },
  { id: 'kart-ourinhos', name: 'Kartódromo Fernando Luiz Quagliato', shortName: 'Ourinhos', city: 'Ourinhos', state: 'SP', lat: -22.9797, lng: -49.8697, lengthM: 1000 },
  { id: 'toca-coruja-bauru', name: 'Kartódromo Toca da Coruja', shortName: 'Bauru', city: 'Bauru', state: 'SP', lat: -22.3145, lng: -49.0587, lengthM: 900 },
  { id: 'kart-registro', name: 'Kartódromo de Registro', shortName: 'Registro', city: 'Registro', state: 'SP', lat: -24.4877, lng: -47.8436, lengthM: 800 },

  // ==== Rio de Janeiro ====
  { id: 'kart-guapimirim', name: 'Kartódromo Internacional de Guapimirim', shortName: 'Guapimirim', city: 'Guapimirim', state: 'RJ', lat: -22.5372, lng: -42.9822, lengthM: 1000 },
  { id: 'kart-volta-redonda', name: 'Kartódromo de Volta Redonda', shortName: 'Volta Redonda', city: 'Volta Redonda', state: 'RJ', lat: -22.5231, lng: -44.1041, lengthM: 1250 },
  { id: 'top-kart-barra', name: 'Top Kart Indoor Barra', shortName: 'Top Kart Barra', city: 'Rio de Janeiro', state: 'RJ', lat: -22.9990, lng: -43.3652, lengthM: 400 },
  { id: 'top-kart-norte', name: 'Top Kart Indoor Norte Shopping', shortName: 'Top Kart Norte', city: 'Rio de Janeiro', state: 'RJ', lat: -22.8880, lng: -43.2919, lengthM: 400 },
  { id: 'speed-racer-petropolis', name: 'Speed Racer Kart Indoor', shortName: 'Petrópolis', city: 'Petrópolis', state: 'RJ', lat: -22.5112, lng: -43.1779, lengthM: 400 },

  // ==== Minas Gerais ====
  { id: 'kart-betim', name: 'Kartódromo Internacional de Betim', shortName: 'Betim', city: 'Betim', state: 'MG', lat: -19.9668, lng: -44.1983, lengthM: 1110 },
  { id: 'rbc-racing', name: 'Kartódromo RBC Racing', shortName: 'RBC Racing', city: 'Vespasiano', state: 'MG', lat: -19.6919, lng: -43.9233, lengthM: 1000 },
  { id: 'serra-verde-bh', name: 'Kartódromo Serra Verde', shortName: 'Serra Verde', city: 'Belo Horizonte', state: 'MG', lat: -19.9167, lng: -43.9345, lengthM: 800 },
  { id: 'kart-ipatinga', name: 'Kart Clube Ipatinga', shortName: 'Ipatinga', city: 'Ipatinga', state: 'MG', lat: -19.4703, lng: -42.5476, lengthM: 900 },

  // ==== Espírito Santo ====
  { id: 'kart-serra-es', name: 'Kartódromo Internacional da Serra', shortName: 'Serra', city: 'Serra', state: 'ES', lat: -20.1289, lng: -40.3078, lengthM: 1000 },

  // ==== Paraná ====
  { id: 'raceland', name: 'Kartódromo Internacional Raceland', shortName: 'Raceland', city: 'Pinhais', state: 'PR', lat: -25.4429, lng: -49.1926, lengthM: 1250 },
  { id: 'luigi-borghesi', name: 'Kartódromo Luigi Borghesi', shortName: 'Londrina', city: 'Londrina', state: 'PR', lat: -23.3103, lng: -51.1628, lengthM: 1000 },
  { id: 'kart-cascavel', name: 'Kartódromo Delci Damian', shortName: 'Cascavel', city: 'Cascavel', state: 'PR', lat: -24.9578, lng: -53.4595, lengthM: 1000 },
  { id: 'kart-park-sjp', name: 'Kart Park', shortName: 'Kart Park', city: 'São José dos Pinhais', state: 'PR', lat: -25.5313, lng: -49.2036, lengthM: 720 },
  { id: 'kart-irati', name: 'Kartódromo Ildefons Zanetti', shortName: 'Irati', city: 'Irati', state: 'PR', lat: -25.4697, lng: -50.6514, lengthM: 900 },

  // ==== Santa Catarina ====
  { id: 'kart-joinville', name: 'Kartódromo Internacional de Joinville', shortName: 'Joinville', city: 'Joinville', state: 'SC', lat: -26.3045, lng: -48.8487, lengthM: 1000 },
  { id: 'kart-floripa-daux', name: 'Kartódromo Ronaldo Couto Daux', shortName: 'Florianópolis', city: 'Florianópolis', state: 'SC', lat: -27.4302, lng: -48.4021, lengthM: 900 },
  { id: 'kart-sapiens', name: 'Kartódromo Sapiens Parque', shortName: 'Sapiens Parque', city: 'Florianópolis', state: 'SC', lat: -27.4361, lng: -48.4433, lengthM: 800 },
  { id: 'kart-lages', name: 'Kartódromo de Lages', shortName: 'Lages', city: 'Lages', state: 'SC', lat: -27.8154, lng: -50.3259, lengthM: 900 },
  { id: 'kart-cacador', name: 'Kartódromo Municipal de Caçador', shortName: 'Caçador', city: 'Caçador', state: 'SC', lat: -26.7757, lng: -51.0122, lengthM: 800 },
  { id: 'kart-xanxere', name: 'Kartódromo Jean Paulo Picinatto', shortName: 'Xanxerê', city: 'Xanxerê', state: 'SC', lat: -26.8768, lng: -52.4037, lengthM: 900 },

  // ==== Rio Grande do Sul ====
  { id: 'velopark', name: 'Kartódromo Velopark', shortName: 'Velopark', city: 'Nova Santa Rita', state: 'RS', lat: -29.8296, lng: -51.2792, lengthM: 1000 },
  { id: 'kart-taruma', name: 'Kartódromo de Tarumã', shortName: 'Tarumã', city: 'Viamão', state: 'RS', lat: -30.0533, lng: -50.9819, lengthM: 900 },
  { id: 'kart-farroupilha', name: 'Kartódromo Internacional César Francischini', shortName: 'Farroupilha', city: 'Farroupilha', state: 'RS', lat: -29.2225, lng: -51.3477, lengthM: 1000 },
  { id: 'kart-gramado', name: 'Kartódromo Tomasini', shortName: 'Gramado', city: 'Gramado', state: 'RS', lat: -29.3789, lng: -50.8740, lengthM: 800 },
  { id: 'kart-pelotas', name: 'KartPel', shortName: 'Pelotas', city: 'Pelotas', state: 'RS', lat: -31.7654, lng: -52.3376, lengthM: 800 },
  { id: 'kart-venancio', name: 'Kartódromo de Venâncio Aires', shortName: 'Venâncio Aires', city: 'Venâncio Aires', state: 'RS', lat: -29.6143, lng: -52.1932, lengthM: 900 },

  // ==== Centro-Oeste ====
  { id: 'ferrari-kart-bsb', name: 'Ferrari Kart', shortName: 'Ferrari Kart', city: 'Brasília', state: 'DF', lat: -15.7942, lng: -47.8822, lengthM: 1100 },
  { id: 'kart-goiania', name: 'Kartódromo Ricardo Santos', shortName: 'Goiânia', city: 'Goiânia', state: 'GO', lat: -16.6864, lng: -49.2643, lengthM: 1000 },
  { id: 'kart-anapolis', name: 'Kartódromo Internacional de Anápolis', shortName: 'Anápolis', city: 'Anápolis', state: 'GO', lat: -16.3281, lng: -48.9530, lengthM: 1000 },
  { id: 'kart-itumbiara', name: 'Kartódromo Internacional Dr. Henrique Santillo', shortName: 'Itumbiara', city: 'Itumbiara', state: 'GO', lat: -18.4192, lng: -49.2150, lengthM: 1000 },
  { id: 'kart-rio-verde', name: 'Kartódromo de Rio Verde', shortName: 'Rio Verde', city: 'Rio Verde', state: 'GO', lat: -17.7923, lng: -50.9192, lengthM: 900 },
  { id: 'kart-campo-grande', name: 'Kartódromo Ayrton Senna', shortName: 'Campo Grande', city: 'Campo Grande', state: 'MS', lat: -20.4428, lng: -54.6464, lengthM: 1000 },
  { id: 'kart-varzea-grande', name: 'Kartódromo Municipal Jaime Campos', shortName: 'Várzea Grande', city: 'Várzea Grande', state: 'MT', lat: -15.6467, lng: -56.1325, lengthM: 900 },

  // ==== Nordeste ====
  { id: 'paladino', name: 'Circuito Internacional Paladino', shortName: 'Paladino', city: 'Conde', state: 'PB', lat: -7.2597, lng: -34.9075, lengthM: 1400 },
  { id: 'kart-imperatriz', name: 'Kartódromo Internacional de Imperatriz', shortName: 'Imperatriz', city: 'Imperatriz', state: 'MA', lat: -5.5261, lng: -47.4757, lengthM: 1200 },
  { id: 'kart-eusebio', name: 'Kartódromo Internacional Júlio Ventura', shortName: 'Eusébio', city: 'Eusébio', state: 'CE', lat: -3.8901, lng: -38.4506, lengthM: 1000 },
  { id: 'kart-monaco-fortaleza', name: 'Kart Mônaco', shortName: 'Kart Mônaco', city: 'Fortaleza', state: 'CE', lat: -3.7319, lng: -38.5267, lengthM: 850 },
  { id: 'gki-recife', name: 'GKI Kart Indoor', shortName: 'GKI Recife', city: 'Recife', state: 'PE', lat: -8.0538, lng: -34.9059, lengthM: 400 },
  { id: 'club-kart-alagoas', name: 'Club Kart Alagoas', shortName: 'Maceió', city: 'Maceió', state: 'AL', lat: -9.6499, lng: -35.7089, lengthM: 600 },
  { id: 'kart-aracaju', name: 'Kartódromo Emerson Fittipaldi', shortName: 'Aracaju', city: 'Aracaju', state: 'SE', lat: -10.9472, lng: -37.0731, lengthM: 900 },

  // ==== Norte ====
  { id: 'amazon-kart-manaus', name: 'Amazon Kart Indoor', shortName: 'Manaus', city: 'Manaus', state: 'AM', lat: -3.1019, lng: -60.0250, lengthM: 400 },
  { id: 'kart-vila-olimpica-manaus', name: 'Kartódromo da Vila Olímpica de Manaus', shortName: 'Vila Olímpica', city: 'Manaus', state: 'AM', lat: -3.0891, lng: -60.0217, lengthM: 800 },
  { id: 'kart-porto-velho', name: 'Kartódromo de Porto Velho', shortName: 'Porto Velho', city: 'Porto Velho', state: 'RO', lat: -8.7608, lng: -63.9004, lengthM: 800 },
  { id: 'kart-ji-parana', name: 'Kartódromo de Ji-Paraná', shortName: 'Ji-Paraná', city: 'Ji-Paraná', state: 'RO', lat: -10.8777, lng: -61.9322, lengthM: 800 },
  { id: 'kart-vilhena', name: 'Kartódromo de Vilhena', shortName: 'Vilhena', city: 'Vilhena', state: 'RO', lat: -12.7404, lng: -60.1458, lengthM: 800 },
  { id: 'kart-palmas', name: 'Kartódromo Internacional de Palmas', shortName: 'Palmas', city: 'Palmas', state: 'TO', lat: -10.2399, lng: -48.3558, lengthM: 1000 },
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