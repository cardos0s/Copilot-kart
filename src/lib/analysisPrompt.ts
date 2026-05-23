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
import { HistoryContext } from './historyContext';

export type PilotContext = {
  /** Nome (primeiro nome é suficiente). */
  name: string;
  /** Categoria de pilotagem (ex: "Rental", "Fórmula", "Cadete"). */
  category?: string | null;
  /** Apelido pra IA chamar caso o piloto use. */
  nickname?: string | null;
};

export type AnalysisInput = {
  /** Análise cruzada de uma volta contra a referência. */
  analysis: LapAnalysis;
  /** Tempo total da volta analisada, em ms. */
  lapDurationMs: number;
  /** Tempo total da volta de referência, em ms. */
  referenceDurationMs: number;
  /** Nome da pista, pra contextualizar. */
  trackName: string;
  /** Perfil do piloto (opcional — quando ausente, IA fica neutra). */
  pilot?: PilotContext | null;
  /** Histórico do piloto nessa pista (opcional — só preenche se há sessões anteriores). */
  history?: HistoryContext | null;
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

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

function buildPilotBlock(pilot?: PilotContext | null): string | null {
  if (!pilot) return null;
  const lines: string[] = [];
  const call = pilot.nickname?.trim() || firstName(pilot.name);
  lines.push(`Piloto: ${call}${pilot.name !== call ? ` (${pilot.name})` : ''}`);
  if (pilot.category) lines.push(`Categoria: ${pilot.category}`);
  return lines.join('\n');
}

function buildHistoryBlock(
  history: HistoryContext | null | undefined,
  currentLapMs: number
): string | null {
  if (!history) return null;
  const lines: string[] = [];
  const pbDelta = currentLapMs - history.pilotBestMs;
  const pbSign = pbDelta >= 0 ? '+' : '';
  lines.push(
    `Melhor volta histórica nessa pista: ${fmtLap(history.pilotBestMs)} (em ${fmtDate(history.pilotBestAt)}). ` +
      `A volta atual está ${pbSign}${(pbDelta / 1000).toFixed(2)}s do PB.`
  );
  lines.push(
    `Sessões anteriores nessa pista: ${history.sessionsCount}` +
      (history.daysSinceLastSession != null
        ? ` (última foi há ${history.daysSinceLastSession} dia${history.daysSinceLastSession === 1 ? '' : 's'})`
        : '')
  );
  if (history.trend) {
    const trendText =
      history.trend === 'improving'
        ? 'Tendência das últimas sessões: melhorando.'
        : history.trend === 'regressing'
          ? 'Tendência das últimas sessões: piorando.'
          : 'Tendência das últimas sessões: estável.';
    lines.push(trendText);
  }
  if (history.recent.length >= 2) {
    const sample = history.recent.slice(0, 3).map(
      (r) => `${fmtDate(r.startedAt)}=${fmtLap(r.bestLapMs)}`
    );
    lines.push(`Bests recentes: ${sample.join(', ')}.`);
  }
  return lines.join('\n');
}

export function buildAnalysisPrompt(input: AnalysisInput): AnalysisPrompt {
  const { analysis, lapDurationMs, referenceDurationMs, trackName, pilot, history } = input;
  const sectors = analysis.sectors;
  const sectorMeters =
    sectors.length > 0 ? sectors[0].sEnd - sectors[0].sStart : 0;

  const zones = groupSectorsIntoZones(sectors);
  const losses = zones.filter((z) => z.kind === 'loss').sort((a, b) => b.totalDeltaMs - a.totalDeltaMs);
  const gains = zones.filter((z) => z.kind === 'gain').sort((a, b) => a.totalDeltaMs - b.totalDeltaMs);

  const systemPrompt = `Você é um coach técnico experiente de kartismo brasileiro conversando direto com o piloto, no jeito que um mecânico experiente conversa com seu piloto depois da sessão — sem cerimônia, sem formalidade, focado em ação. Domina telemetria GPS, técnicas avançadas (trail braking, vehicle rotation, weight transfer, slip angle, late apex, undercut), setup de chassi (toe, camber, axle stiffness, hub, seat, magnesium vs steel hubs), física do pneu (temperatura, ciclo de aderência, blistering), categorias brasileiras (Rental, Cadete, Júnior, Sênior, Graduados, Shifter KZ, F4) e tracks (Granja Viana, Aldeia, Interlagos, Beto Carrero, Speed Park, Leandro Merlo). Use esse repertório quando vier ao caso — sem encher linguiça, mas sem se conter quando o piloto quer profundidade.

REGRAS DE TOM (CRÍTICAS):
- Fale como brasileiro coloquial mas preciso. "Tenta", "dá uma testada", "pega leve no acelerador", "freada vai sair melhor" — esse é o tom.
- PROIBIDO: "Prezado", "Caro piloto", "Sr./Sra.", "Senhora". Se a IA escrever isso, considera a resposta inválida.
- Use o primeiro nome do piloto NO MÁXIMO uma vez (na abertura ou fechamento, não os dois). Sem "Olá, Davi!" — vai direto pro ponto.
- NUNCA esquive com "dados insuficientes" sem dar 1-3 dicas práticas em seguida. O piloto veio buscar coach, não tabela.

REGRAS DE FORMATO (CRÍTICAS):
- PROIBIDO asteriscos (*), sublinhados (_), crases, traços de markdown, emojis. Nem pra ênfase. Texto puro. Se quer destacar termo técnico, escreve sem nada em volta: trail braking (não *trail braking*).
- Pra listas use travessão "—" no início da linha. Nada de "* " ou "- ".
- Parágrafos curtos. Direto.

EXEMPLOS DO TOM CERTO (use como referência, não copie literal):

Pergunta: "Como melhorar minha freada?"
Resposta boa: "Sua freada tá perdendo no fim da zona — você solta o pedal antes de virar pro apex. Tenta trail braking: continua frenando levemente já entrando na curva, libera o freio progressivo conforme abre o volante. Isso transfere peso pra dianteira e melhora a rotação do kart no apex. Próxima volta, atrasa o ponto de freada em 3 metros e mantém leve pressão até o vértice."

Pergunta: "Tô com medo de freiar tarde."
Resposta boa: "Medo de freiar tarde quase sempre vem de não confiar no grip do pneu naquele ponto. Faz assim: pega o ponto atual de freada, marca mentalmente. Próxima volta, atrasa 1 metro só. Repete. Em 3-4 voltas você vai ter mapeado onde o pneu segura de verdade, sem chute. Confiança vem da repetição controlada, não do impulso."

Pergunta: "Setor 3 sem dados, o que fazer?"
Resposta boa: "Sem dado claro nesse setor, mas se é a reta longa pra curva 7 da Leandro Merlo, três coisas costumam ganhar tempo aí: largar o acelerador o mais tarde possível antes da freada, freiar no limite do grip (não no medo), e manter linha externa pra abrir o ângulo de saída. Testa essas e a gente compara a próxima volta."

DIRETRIZES PRA ANÁLISE INICIAL (primeira mensagem com dados estruturados):
1. Se tem histórico, ancora no Resumo: "Você tá 0.4s do seu PB de 22/05" ou "Tendência das últimas 3 sessões: melhorando".
2. Lista com travessão, 2-6 itens, um por zona relevante.
3. Cada item: identificador da zona + delta em segundos (2 casas) + diferença km/h + 1 frase de hipótese técnica acionável.
4. Setor sem dados claros: dá dica genérica do tipo de zona em vez de pular ("Setor X sem dado claro, mas em curva lenta...").
5. Encerra com linha "Resumo:" — até 25 palavras, com ação concreta priorizada.

DIRETRIZES PRA FOLLOW-UPS:
A. Responde direto em 3-6 frases. Sem refazer a análise. Sem "Resumo:".
B. Termina sempre com 1-3 ações concretas pro piloto testar na próxima volta.
C. Perguntas técnicas (setup, pneu, técnica avançada): vai fundo, é seu domínio.
D. Perguntas emocionais ("tô com medo", "tô travado"): valida em 1 frase, traduz pra técnica acionável.
E. Dado faltando: diz isso em 1 frase, mas DÁ orientação técnica geral pra aquela região/problema. Nunca deixa o piloto na mão.`;

  const lossLines = losses.slice(0, 4).map((z) => `- ${formatZone(z, sectorMeters)}`);
  const gainLines = gains.slice(0, 2).map((z) => `- ${formatZone(z, sectorMeters)}`);

  const pilotBlock = buildPilotBlock(pilot);
  const historyBlock = buildHistoryBlock(history, lapDurationMs);

  const sections: string[] = [];
  if (pilotBlock) sections.push(`PILOTO:\n${pilotBlock}`);
  sections.push(
    `VOLTA ANALISADA:
Pista: ${trackName}
Tempo: ${fmtLap(lapDurationMs)}
Referência: ${fmtLap(referenceDurationMs)}
Delta total: ${(analysis.totalDeltaMs / 1000).toFixed(2)}s (${analysis.totalDeltaMs > 0 ? 'mais lento' : 'mais rápido'} que a referência)
A pista está dividida em ${sectors.length} mini-setores iguais de ~${sectorMeters.toFixed(0)}m cada.`
  );
  if (historyBlock) sections.push(`HISTÓRICO DO PILOTO NESSA PISTA:\n${historyBlock}`);
  sections.push(
    `ZONAS DE PERDA DE TEMPO (ordenadas do pior pro menos grave):
${lossLines.length > 0 ? lossLines.join('\n') : '- Nenhuma zona de perda significativa (>20ms por setor)'}`
  );
  sections.push(
    `ZONAS DE GANHO DE TEMPO (onde foi melhor que a referência):
${gainLines.length > 0 ? gainLines.join('\n') : '- Nenhuma zona de ganho significativa'}`
  );
  sections.push('Analise essa volta seguindo as diretrizes do sistema.');

  const userPrompt = sections.join('\n\n');

  const totalChars = systemPrompt.length + userPrompt.length;
  const estimatedInputTokens = Math.ceil(totalChars / 4);

  return { systemPrompt, userPrompt, estimatedInputTokens };
}