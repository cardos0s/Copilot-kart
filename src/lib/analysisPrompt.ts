/**
 * Monta o prompt pra análise de volta via Claude API.
 *
 * Decisões importantes:
 * 1. Função PURA — sem IO, sem side effects. Testável com self-test.js.
 * 2. Consome o output de analyzeLap (analysis.ts) sem modificá-lo.
 * 3. Pré-processa 20 setores em "zonas" de perda/ganho consecutivos,
 *    porque LLM lida melhor com 4-6 pontos resumidos que com 20 linhas.
 * 4. Retorna system + user separados (formato Anthropic API).
 * 5. Estima tokens (rough: 1 token ≈ 4 chars em PT-BR) pra evitar surpresa.
 */

import { LapAnalysis, Sector } from './analysis';

export type AnalysisInput = {
  /** Análise cruzada de uma volta contra a referência. */
  analysis: LapAnalysis;
  /** Tempo total da volta analisada, em ms. */
  lapDurationMs: number;
  /** Tempo total da volta de referência, em ms. */
  referenceDurationMs: number;
  /** Nome da pista, pra contextualizar. */
  trackName: string;
};

export type AnalysisPrompt = {
  systemPrompt: string;
  userPrompt: string;
  estimatedInputTokens: number;
};

type Zone = {
  sectorStart: number;
  sectorEnd: number;
  totalDeltaMs: number;
  avgSpeedCurrent: number;
  avgSpeedRef: number;
  avgSpeedDiffKmh: number;
  kind: 'loss' | 'gain';
};

/**
 * Agrupa setores consecutivos do mesmo "sinal" (perda ou ganho)
 * em zonas maiores. Reduz ruído e ajuda a LLM a ver padrões reais.
 *
 * Threshold: ignora setores com |delta| < 20ms — ruído de GPS/interpolação.
 */
function groupSectorsIntoZones(sectors: Sector[]): Zone[] {
  const NOISE_THRESHOLD_MS = 20;
  const zones: Zone[] = [];
  let current: Zone | null = null;

  for (const sector of sectors) {
    const isNoise = Math.abs(sector.deltaMs) < NOISE_THRESHOLD_MS;
    if (isNoise) {
      if (current) {
        zones.push(current);
        current = null;
      }
      continue;
    }

    const kind: 'loss' | 'gain' = sector.deltaMs > 0 ? 'loss' : 'gain';

    if (!current || current.kind !== kind) {
      if (current) zones.push(current);
      current = {
        sectorStart: sector.index,
        sectorEnd: sector.index,
        totalDeltaMs: sector.deltaMs,
        avgSpeedCurrent: sector.avgSpeedCurrent,
        avgSpeedRef: sector.avgSpeedRef,
        avgSpeedDiffKmh: (sector.avgSpeedCurrent - sector.avgSpeedRef) * 3.6,
        kind,
      };
    } else {
      const nSoFar = current.sectorEnd - current.sectorStart + 1;
      current.sectorEnd = sector.index;
      current.totalDeltaMs += sector.deltaMs;
      current.avgSpeedCurrent =
        (current.avgSpeedCurrent * nSoFar + sector.avgSpeedCurrent) / (nSoFar + 1);
      current.avgSpeedRef =
        (current.avgSpeedRef * nSoFar + sector.avgSpeedRef) / (nSoFar + 1);
      current.avgSpeedDiffKmh =
        (current.avgSpeedCurrent - current.avgSpeedRef) * 3.6;
    }
  }

  if (current) zones.push(current);
  return zones;
}

function formatZone(zone: Zone, sectorMeters: number): string {
  const lengthM = (zone.sectorEnd - zone.sectorStart + 1) * sectorMeters;
  const deltaS = (zone.totalDeltaMs / 1000).toFixed(2);
  const verb = zone.kind === 'loss' ? 'perdeu' : 'ganhou';
  const speedCur = (zone.avgSpeedCurrent * 3.6).toFixed(1);
  const speedRef = (zone.avgSpeedRef * 3.6).toFixed(1);
  const speedDiff = zone.avgSpeedDiffKmh.toFixed(1);
  const speedDiffSigned = zone.avgSpeedDiffKmh >= 0 ? `+${speedDiff}` : speedDiff;

  const setoresLabel =
    zone.sectorStart === zone.sectorEnd
      ? `Setor ${zone.sectorStart + 1}`
      : `Setores ${zone.sectorStart + 1}-${zone.sectorEnd + 1}`;

  return `${setoresLabel} (~${lengthM.toFixed(0)}m): ${verb} ${Math.abs(Number(deltaS)).toFixed(2)}s · vel média ${speedCur}km/h vs ${speedRef}km/h ref (${speedDiffSigned}km/h)`;
}

function fmtLap(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function buildAnalysisPrompt(input: AnalysisInput): AnalysisPrompt {
  const { analysis, lapDurationMs, referenceDurationMs, trackName } = input;
  const sectors = analysis.sectors;
  const sectorMeters =
    sectors.length > 0 ? sectors[0].sEnd - sectors[0].sStart : 0;

  const zones = groupSectorsIntoZones(sectors);
  const losses = zones.filter((z) => z.kind === 'loss').sort((a, b) => b.totalDeltaMs - a.totalDeltaMs);
  const gains = zones.filter((z) => z.kind === 'gain').sort((a, b) => a.totalDeltaMs - b.totalDeltaMs);

  const systemPrompt = `Você é um analista técnico de kart indoor/outdoor brasileiro. Sua função é ler dados de telemetria GPS comparando uma volta do piloto com sua volta de referência (melhor volta conhecida na mesma pista), e apontar onde o piloto perdeu ou ganhou tempo.

Diretrizes obrigatórias de resposta:
1. Tom neutro em português brasileiro — equilibrado entre técnico e acessível. Sem gírias, sem formalidade excessiva.
2. Formato: lista de itens, um por zona relevante da pista. Máximo 6 itens.
3. Cada item começa com o identificador da zona (ex: "Setores 5-8:" ou "Setor 12:") seguido de dois pontos.
4. Dentro de cada item, cite o delta em segundos com 2 casas decimais e a diferença de velocidade em km/h. Sugira UMA hipótese técnica (freou antes/depois, acelerou tarde, trajetória mais aberta, etc).
5. Não invente dados que não foram fornecidos. Se o dado não permite concluir, diga "dado insuficiente pra afirmar causa".
6. Não use emojis, não use markdown, não use asteriscos. Texto corrido.
7. Após a lista, encerre com uma linha começando com "Resumo:" em no máximo 20 palavras.`;

  const lossLines = losses.slice(0, 4).map((z) => `- ${formatZone(z, sectorMeters)}`);
  const gainLines = gains.slice(0, 2).map((z) => `- ${formatZone(z, sectorMeters)}`);

  const userPrompt = `Pista: ${trackName}
Volta analisada: ${fmtLap(lapDurationMs)}
Volta de referência: ${fmtLap(referenceDurationMs)}
Delta total: ${(analysis.totalDeltaMs / 1000).toFixed(2)}s (${analysis.totalDeltaMs > 0 ? 'mais lento' : 'mais rápido'} que a referência)

A pista está dividida em ${sectors.length} mini-setores iguais de ~${sectorMeters.toFixed(0)}m cada.

ZONAS DE PERDA DE TEMPO (ordenadas do pior pro menos grave):
${lossLines.length > 0 ? lossLines.join('\n') : '- Nenhuma zona de perda significativa (>20ms por setor)'}

ZONAS DE GANHO DE TEMPO (onde foi melhor que a referência):
${gainLines.length > 0 ? gainLines.join('\n') : '- Nenhuma zona de ganho significativa'}

Analise essa volta seguindo as diretrizes do sistema.`;

  const totalChars = systemPrompt.length + userPrompt.length;
  const estimatedInputTokens = Math.ceil(totalChars / 4);

  return { systemPrompt, userPrompt, estimatedInputTokens };
}