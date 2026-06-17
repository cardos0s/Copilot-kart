// Lendas do automobilismo — tempos de F1 "convertidos" pra kart (estimativa
// pra fins de desafio). Cada lenda tem um ritmo diferente (lapMs).

export type LegendLevel = 'Lendário' | 'Difícil' | 'Médio';

export type Legend = {
  id: string;
  name: string;
  short: string;
  country: string;
  level: LegendLevel;
  /** Cor do capacete (marcador + sotaque). */
  helmet: string;
  /** Volta convertida pra kart, em ms. */
  lapMs: number;
};

export const LEGENDS: Legend[] = [
  { id: 'senna', name: 'Ayrton Senna', short: 'Senna', country: 'BRA', level: 'Lendário', helmet: '#F4E13B', lapMs: 38210 },
  { id: 'verstappen', name: 'Max Verstappen', short: 'Verstappen', country: 'NED', level: 'Difícil', helmet: '#FF6A00', lapMs: 38740 },
  { id: 'hamilton', name: 'Lewis Hamilton', short: 'Hamilton', country: 'GBR', level: 'Difícil', helmet: '#8A63E8', lapMs: 38900 },
  { id: 'prost', name: 'Alain Prost', short: 'Prost', country: 'FRA', level: 'Médio', helmet: '#3B7BFF', lapMs: 39010 },
  { id: 'antonelli', name: 'A. Antonelli', short: 'Antonelli', country: 'ITA', level: 'Médio', helmet: '#2FAE60', lapMs: 39400 },
];

export function legendById(id: string | undefined): Legend | undefined {
  return LEGENDS.find((l) => l.id === id);
}

export const LEVEL_COLOR: Record<LegendLevel, string> = {
  'Lendário': '#F4E13B',
  'Difícil': '#FF6A00',
  'Médio': '#3DDCFF',
};
