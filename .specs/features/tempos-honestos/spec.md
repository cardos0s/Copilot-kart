# Tempos honestos — Specification

## Problem Statement

Os números que o piloto vê hoje têm quatro problemas:

1. **O milésimo do tempo de volta é falso.** A 5–10 Hz, o refino do cruzamento
   (`lapDetector.ts:153-191`) fica preso no ponto mais próximo da linha. Os tempos grudam
   em múltiplos de ~100 ms (49.600 / 50.000 ms no GPX de bancada).
2. **A primeira volta sai 0,4 a 0,9 s curta.** Ela pode virar PB falso, e o app oferece
   trocar o traçado de referência por essa volta truncada (`recording.tsx:602`).
3. **A linha de chegada é inventada a cada sessão.** Os S1/S2/S3 ao vivo usam outra régua
   que a análise (terços geográficos × 7/7/6 mini-setores) e são marcados no ritmo do poll
   de 500 ms. Piloto e equipe veem números diferentes dos que a análise mostra depois.
4. **O "máx" de velocidade é o máximo bruto.** Uma fix ruim infla o valor, e esse valor
   vai para a IA. Além disso, os insights recorrentes usam voltas sem limpeza, e a volta
   descartada continua no denominador da média.

Um app de telemetria cujo milésimo é inventado não deveria ir para a loja.

## Goals

- [ ] Tempo de volta com erro de no máximo 20 ms contra a duração real, em GPS sintético a 5 e a 10 Hz, inclusive na 1ª volta.
- [ ] Com traçado gravado, a mesma linha de chegada em todas as sessões daquele traçado.
- [ ] S1/S2/S3 iguais, dentro de 20 ms, no cockpit, no painel da equipe e na análise, para a mesma volta.
- [ ] Pico de velocidade e insights imunes a uma fix ruim isolada.
- [ ] O núcleo da telemetria coberto pela suíte `npm test`.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| 10 Hz no iOS | O CoreLocation decide a taxa; o `timeInterval` só vale no Android. A precisão tem que se sustentar na taxa que vier |
| Recalcular os tempos de sessões antigas | Ver Assumptions |
| `src/lib/insights.ts` ("pior setor recorrente" lendo `track_references`) | Ninguém importa esse módulo. É código morto, e a remoção entra em `produto-limpo` |
| Largura da pista e altimetria | Continuam fora do modelo (`telemetria.md` §11) |
| Pareamento de relógio IMU × GPS | A IMU não entra em nenhum tempo mostrado. É detecção de trompo, sem efeito nos números desta feature |
| Linha de chegada marcada à mão pelo piloto | É feature nova, não correção |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| De onde vem a linha quando há traçado | Do primeiro ponto do traçado de referência, com a direção do traçado nesse ponto | Decidido pela Julia em 25/09 | y |
| Régua de S1/S2/S3 | Terços exatos do comprimento do traçado, no ao vivo e na análise; os 20 mini-setores ficam só como régua interna | Decidido pela Julia em 25/09 | y |
| Forma da linha | Um segmento perpendicular à direção de passagem, com 15 m para cada lado do ponto (o `lineRadius` atual). A volta fecha no instante interpolado em que a trajetória cruza esse segmento | É o que torna o instante independente da taxa do GPS | y |
| Sentido | Só conta cruzamento no mesmo sentido da linha (direção de passagem a menos de 90° da direção da linha) | Evita contar o piloto que volta na contramão pelo box ou por um trecho paralelo | y |
| Sem traçado | Linha inferida como hoje (ponto onde o ritmo começou), com a direção do movimento nesse ponto | Primeira sessão numa pista nova ainda não tem traçado | y |
| Sessões antigas | Ficam com os tempos salvos, sem recálculo | Recalcular muda PBs e o ranking já publicado, e o último cruzamento de cada sessão não está nos pontos guardados. Só as sessões novas saem com o tempo exato | y |
| Precisão exigida | Erro de no máximo 20 ms em GPS sintético (pista circular, velocidade constante) a 5 e a 10 Hz | É mensurável em teste e está duas ordens abaixo do erro atual (100–900 ms) | y |
| Pico de velocidade | Percentil 99 da velocidade dos pontos com precisão de até 10 m | É a correção de uma linha que o `telemetria.md` §6 já propõe. Um ponto fora da curva em ~500 por volta não chega ao p99 | y |
| Sessão que começa já andando, com traçado | A primeira volta começa no primeiro cruzamento da linha, e o trecho antes dele não é volta | Com a linha fixa, o trecho até o primeiro cruzamento é parcial | y |

**Open questions:** none. As decisões da Julia estão marcadas `y`. As outras, padrões meus, foram aprovadas pela Julia em 25/09 junto com a spec.

---

## User Stories

### P1: Tempo de volta com o milésimo real ⭐ MVP

**User Story**: Como piloto, quero que o tempo da volta seja o tempo de verdade até o milésimo, para comparar voltas que diferem por centésimos.

**Why P1**: É o número central do app, e hoje ele é arredondado ao ritmo do GPS.

**Acceptance Criteria**:

1. WHEN uma volta cruza a linha de chegada THEN the detector SHALL fixar o instante do cruzamento por interpolação linear entre os dois pontos que ficam um de cada lado da linha.
2. WHEN o GPS sintético a 10 Hz percorre voltas de duração real D THEN `detectLaps` SHALL devolver cada volta com |duração − D| ≤ 20 ms.
3. WHEN o GPS sintético a 5 Hz percorre voltas de duração real D THEN `detectLaps` SHALL devolver cada volta com |duração − D| ≤ 20 ms.
4. WHEN a primeira volta da sessão fecha THEN the detector SHALL medi-la com a mesma regra das outras, com |duração − D| ≤ 20 ms.
5. IF a trajetória passa perto da linha sem cruzá-la THEN the detector SHALL NOT fechar volta.
6. IF a trajetória cruza a linha no sentido contrário ao da linha THEN the detector SHALL NOT fechar volta.
7. The detector SHALL manter as regras de validade atuais: distância mínima de 300 m, duração entre 25 s e 180 s e uma volta por cruzamento.

**Independent Test**: `detectLaps` sobre a pista sintética de 37,699 s a 10 Hz devolve 37,699 ± 0,020 s em todas as voltas, inclusive na primeira. Hoje devolve 37.100 / 37.700.

---

### P1: Uma linha só por traçado ⭐ MVP

**User Story**: Como piloto, quero que a linha de chegada seja sempre a mesma no mesmo traçado, para que o tempo de hoje seja comparável com o da semana passada.

**Why P1**: Sem isso, a comparação entre sessões carrega o desvio da linha inventada, e os setores ao vivo não se alinham com o traçado.

**Acceptance Criteria**:

1. WHERE a sessão tem traçado de referência the detector SHALL usar como linha o primeiro ponto do traçado, com a direção do traçado nesse ponto.
2. WHERE a sessão não tem traçado the detector SHALL inferir a linha no ponto onde o ritmo começou, com a direção do movimento nesse ponto.
3. WHERE a sessão tem traçado, WHEN a gravação começa com o piloto já andando THEN the detector SHALL começar a primeira volta no primeiro cruzamento da linha, sem contar o trecho anterior como volta.
4. The app SHALL usar a mesma linha no ao vivo (hook), no "Encerrar" e na recuperação de gravação interrompida.

**Independent Test**: duas gravações sintéticas no mesmo traçado, começando em pontos diferentes da pista, devolvem voltas com o mesmo instante de cruzamento na volta e o mesmo tempo (± 20 ms).

---

### P1: S1/S2/S3 iguais em todo lugar ⭐ MVP

**User Story**: Como piloto e como equipe, queremos ver os mesmos S1/S2/S3 na pista, no painel e na análise, para confiar no setor em que o tempo foi perdido.

**Why P1**: Hoje os três mostram números diferentes para a mesma volta.

**Acceptance Criteria**:

1. The app SHALL definir S1, S2 e S3 como os terços do comprimento do traçado de referência, a partir da linha de chegada.
2. WHEN uma volta fecha ao vivo THEN the app SHALL calcular os tempos de S1, S2 e S3 pelo instante interpolado em que a trajetória passa por 1/3 e 2/3 do traçado, e não pelo instante do poll.
3. WHEN a mesma volta é analisada depois THEN the app SHALL mostrar S1, S2 e S3 que diferem no máximo 20 ms dos calculados ao vivo.
4. WHEN a volta fecha ao vivo THEN the app SHALL publicar para a equipe os mesmos S1, S2 e S3 do AC 2.
5. WHERE a sessão não tem traçado the análise SHALL usar como traçado a melhor volta da sessão, e o ao vivo SHALL continuar sem setores.
6. WHEN uma volta começa THEN o delta ao vivo SHALL projetar o primeiro ponto no início do traçado (s perto de 0), nunca no fim.

**Independent Test**: para uma volta sintética, os S1/S2/S3 da função do ao vivo e os da análise diferem no máximo 20 ms e somam o tempo da volta (± 1 ms).

---

### P2: Pico de velocidade que não mente

**User Story**: Como piloto, quero que o "máx" mostre a velocidade que eu atingi, não um salto do GPS.

**Why P2**: Hoje uma fix ruim infla o número na sessão, na home e no prompt da IA.

**Acceptance Criteria**:

1. The app SHALL calcular o pico de uma volta como o percentil 99 da velocidade dos pontos com precisão de até 10 m.
2. IF uma volta com velocidades em torno de 80 km/h tem um único ponto a 150 km/h THEN the pico SHALL ficar abaixo de 81 km/h.
3. The app SHALL usar esse mesmo cálculo na tela de sessão, na home, no efeito pós-salvamento (prompt da IA) e nos insights.
4. IF nenhum ponto da volta tem precisão de até 10 m THEN the pico SHALL ser `null` e a interface SHALL mostrar "—".

**Independent Test**: `peakSpeedMs` sobre uma volta sintética a 80 km/h com um ponto a 150 km/h devolve menos de 81 km/h.

---

### P2: Insights recorrentes com as mesmas defesas da análise

**User Story**: Como piloto, quero que "onde o tempo se repete" use os mesmos dados limpos da análise da sessão.

**Why P2**: Hoje o insight inclui volta com timestamp degenerado e fix de até 30 m, dilui a média em silêncio e mistura traçados diferentes da mesma pista.

**Acceptance Criteria**:

1. The insights SHALL aplicar `cleanSamples(10)` e `repairDegenerateTimestamps` a cada volta antes de analisá-la.
2. IF uma volta não tem tempo válido numa curva THEN ela SHALL NOT entrar no denominador da média daquela curva.
3. WHEN a tela "Sua volta" monta o conjunto de voltas THEN the app SHALL usar só voltas do mesmo traçado da sessão de referência.

**Independent Test**: `buildLapInsight` com 3 voltas boas e 1 com a curva 2 inválida devolve, para a curva 2, a média das 3 boas.

---

### P3: Timestamp confiável em fix que cai no segundo cheio

**User Story**: Como piloto, quero que um ponto do GPS não seja deslocado no tempo só porque caiu num segundo exato.

**Why P3**: A regra atual (`% 1000`) troca um timestamp legítimo pelo horário de chegada em 1 de cada 10 fixes num GNSS de 10 Hz alinhado ao segundo, e o tempo pode deixar de ser monotônico.

**Acceptance Criteria**:

1. IF um lote tem fixes com precisão de sub-segundo e um deles cai exatamente em .000 THEN the handler SHALL manter o timestamp original desse fix.
2. WHEN todos os fixes recentes chegam quantizados ao segundo THEN the handler SHALL manter o comportamento atual (horário de chegada espalhado a 100 ms).
3. The handler SHALL entregar timestamps estritamente crescentes dentro de uma gravação.

**Independent Test**: um lote com t = …49.900, …50.000, …50.100 mantém os três timestamps originais.

---

## Edge Cases

- WHEN o piloto para na linha e sai de novo THEN the detector SHALL contar só um cruzamento.
- IF o GPS perde sinal exatamente no cruzamento (não há ponto de um dos lados em até 2 s) THEN the detector SHALL NOT fechar a volta nesse cruzamento, e a volta seguinte segue a regra dos 180 s.
- WHEN o traçado tem menos de 5 pontos ou comprimento zero THEN the app SHALL tratar a sessão como sem traçado.
- WHEN a primeira volta seria a melhor da sessão THEN the app SHALL tratá-la como qualquer outra; ela deixa de ser truncada, e não há regra especial.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| TMP-01 | P1: Milésimo real (AC 1, 2, 3) | Design | Implementing |
| TMP-02 | P1: Milésimo real (AC 4, primeira volta) | Design | Implementing |
| TMP-03 | P1: Milésimo real (AC 5, 6, 7, validade e sentido) | Design | Implementing |
| TMP-04 | P1: Linha do traçado (AC 1, 2) | Design | Implementing |
| TMP-05 | P1: Linha do traçado (AC 3, começa andando) | Design | Implementing |
| TMP-06 | P1: Linha do traçado (AC 4, mesma linha no ao vivo, no Encerrar e na recuperação) | Design | Implementing |
| TMP-07 | P1: Setores (AC 1, 2, 3) | Design | Implementing |
| TMP-08 | P1: Setores (AC 4, publicação) | Design | Implementing |
| TMP-09 | P1: Setores (AC 5, sem traçado) | Design | Implementing |
| TMP-10 | P1: Setores (AC 6, delta no início da volta) | Design | Implementing |
| TMP-11 | P2: Pico de velocidade | Design | Implementing |
| TMP-12 | P2: Insights (AC 1, 2) | Design | Implementing |
| TMP-13 | P2: Insights (AC 3, mesmo traçado) | Design | Implementing |
| TMP-14 | P3: Timestamp no segundo cheio | Design | Implementing |

**Coverage:** 14 total, 0 mapped to tasks, 14 unmapped ⚠️ (Tasks ainda não existe)

---

## Implicit-requirement sweep

| Dimensão | Onde ficou |
| -------- | ---------- |
| Input validation & bounds | Traçado com menos de 5 pontos vira "sem traçado" (edge case); filtro de precisão de 10 m no pico (TMP-11) |
| Failure / partial-failure | GPS sem ponto de um lado da linha (edge case); pico `null` sem pontos bons (TMP-11, AC 4) |
| Idempotency / retry / duplicate | Um cruzamento só fecha uma volta (TMP-03, edge case de parar na linha) |
| Auth boundaries & rate limits | N/A: cálculo local, sem rede |
| Concurrency / ordering | Timestamps estritamente crescentes (TMP-14, AC 3) |
| Data lifecycle / expiry | Sessões antigas não são recalculadas (Assumptions) |
| Observability | N/A: não há telemetria de app nesta feature; os números saem na interface |
| External-dependency failure | N/A: a taxa do GPS varia, e os ACs a 5 e a 10 Hz cobrem isso |
| State-transition integrity | Início de volta com linha fixa e piloto já andando (TMP-05); reset do delta no início da volta (TMP-10) |

---

## Success Criteria

- [ ] O GPX de bancada deixa de dar tempos terminados em 00 ms.
- [ ] Na mesma volta, os setores do cockpit, do painel e da análise batem até 20 ms.
- [ ] `docs/telemetria.md` descreve as regras novas (linha, sentido, interpolação, terços, pico p99).
