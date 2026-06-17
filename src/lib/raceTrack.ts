// Traçado de corrida — circuito fechado suavizado com Catmull-Rom.
// Gera o `d` do path (desenho) E uma amostragem densa de pontos pros
// marcadores seguirem a curva (substitui getPointAtLength, que o react-native-svg
// não expõe no JS).

export type BuiltTrack = { d: string; xs: number[]; ys: number[] };

export function buildTrack(pts: number[][], seg: number): BuiltTrack {
  const n = pts.length;
  const xs: number[] = [];
  const ys: number[] = [];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]}`;
    for (let strk = 0; strk < seg; strk++) {
      const t = strk / seg;
      const mt = 1 - t;
      xs.push(mt * mt * mt * p1[0] + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * p2[0]);
      ys.push(mt * mt * mt * p1[1] + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * p2[1]);
    }
  }
  d += ' Z';
  xs.push(xs[0]);
  ys.push(ys[0]);
  return { d, xs, ys };
}

// Circuito padrão do Modo Lendas (viewBox 340 x 250).
const RACE_PTS = [
  [170, 28], [248, 42], [304, 92], [292, 158], [236, 196],
  [172, 182], [120, 206], [52, 176], [38, 108], [96, 50],
];

export const RACE_TRACK = buildTrack(RACE_PTS, 11);
export const RACE_IN = RACE_TRACK.xs.map((_, i) => i / (RACE_TRACK.xs.length - 1));
// Ponto de largada (primeiro waypoint).
export const RACE_START = { x: RACE_PTS[0][0], y: RACE_PTS[0][1] };
