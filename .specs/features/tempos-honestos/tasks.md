# Tempos honestos — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Regras do repo que valem aqui:
- Commits em Conventional Commits, em português, com a descrição em minúscula. **Sem `Co-Authored-By` e sem nenhuma referência a IA** no histórico.
- Branch `feat/tempos-honestos`, criada a partir de `feat/gravacao-sem-perda`. Nada de push sem autorização explícita.
- **Não rodar build nativo, prebuild, `expo start` nem `eas`.** Trava a máquina.
- AD-006 (`STATE.md`): a volta começa e termina em pontos sintéticos na linha. Nenhuma tarefa pode quebrar isso.

---

**Design**: `.specs/features/tempos-honestos/design.md`
**Status**: Approved (27/09)

---

## Test Coverage Matrix

> Segue a matriz da `gravacao-sem-perda`, aprovada em 24/09. Diretrizes: não há `AGENTS.md`, `CONTRIBUTING.md` nem config de cobertura, então valem os defaults fortes. Os testes existentes (62, `test/*.test.ts`) são o piso de estilo.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Lógica pura (`src/lib/*.ts`, `src/recording/*.ts`) | unit | Todos os ramos; 1:1 com os ACs de TMP-01 a TMP-14; todo edge case listado tem teste; valores numéricos da spec (≤ 20 ms, < 81 km/h) assertados exatamente | `test/*.test.ts` | `npm test` |
| Invariantes estáticas das telas (fonte da régua, `—` no pico) | unit (estático, lê o fonte) | Uma asserção por AC que só a tela cobre | `test/*.test.ts` | `npm test` |
| Hook e telas React Native | none | Build gate mais a UAT no aparelho, ao fim | – | build gate + UAT |
| Documentação (`docs/telemetria.md`) | none | Build gate | – | build gate |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Tarefas com teste unitário | `npm test` |
| Full | Igual ao Quick | `npm test` |
| Build | Tarefas sem teste, e o fim de cada fase | `npm test && npm run typecheck` |

**Baseline do typecheck:** os mesmos 8 erros da `gravacao-sem-perda`:
- `app/career.tsx:195`
- `app/leaderboard.tsx:125`, `:141`, `:166`
- `app/recap.tsx:131`
- `app/onboarding/email.tsx:31`, `:34`
- `app/onboarding/mode.tsx:39`

O gate passa só se aparecerem exatamente esses. O `tsc` demora mais de 2 min: rodar com timeout de 600000 ms.

**Contagem de testes:** hoje são 62. Ela só pode crescer. Cada tarefa registra no "Done when" o número real depois dela.

---

## Execution Plan

### Phase 1: Núcleo puro (testado em Node)

```
T1 -> T2
T2 -> T16
T16 -> T3
T2 -> T3
T3 -> T4
```

T5, T6, T7 e T8 não dependem de nenhuma tarefa da fase. A T16 entrou depois da T2, por decisão da Julia em 29/09, e roda antes da T3.

### Phase 2: Fiação

```
T9 -> T10
```

T11, T12, T13, T14, T15 e T17 não dependem de nenhuma tarefa da fase. Todas as da fase dependem da fase 1.

### Phase 3: Correções achadas pelo lote 2 (AD-006)

```
T18 -> T19
T19 -> T20
```

### Phase 4: Correções do Verificador (iteração 1)

```
T21
T22 -> T23
```

T24 e T25 não dependem de nenhuma tarefa da fase.

---

## Task Breakdown

### Phase 1: Núcleo puro (testado em Node)

#### T1: Linha de chegada e teste de cruzamento

**What**: Criar `lineFromLayout`, `lineFromMotion` e `crossing(a, b, line, halfWidthM = 15)`, com o segmento perpendicular ao rumo e sentido obrigatório. Estender `test/helpers/syntheticTrack.ts` com taxa (Hz), fase inicial e duração real conhecida.
**Where**: `src/lib/startLine.ts`
**Depends on**: None
**Reuses**: `makeLocalProjector`, `haversine`
**Requirement**: TMP-01 (AC 1), TMP-03 (AC 5, 6), TMP-04, edge cases do traçado curto e do buraco de 2 s

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: um par a e b que atravessa a linha no sentido certo devolve `t = t_a + f·(t_b − t_a)` com o `f` geométrico exato (um caso com `f = 0,25` conhecido).
- [x] Teste: o mesmo par invertido (contramão) devolve `null`.
- [x] Teste: um par que passa a 16 m do ponto (fora da meia-largura de 15 m) devolve `null`; a 14 m, cruza.
- [x] Teste: um par que chega perto sem atravessar (`u_a` e `u_b` do mesmo lado) devolve `null`.
- [x] Teste: um par com `t_b − t_a` de 2001 ms devolve `null`.
- [x] Teste: `lineFromLayout` com 4 pontos ou comprimento zero devolve `null`; com um traçado válido, o rumo aponta para o primeiro ponto a 5 m ou mais (± 1°).
- [x] Gate: `npm test`, contagem registrada: 70 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(tempos): linha de chegada com sentido e cruzamento interpolado`

---

#### T2: Detector de voltas pelo cruzamento da linha

**What**: Reescrever o miolo de `detectLaps` sobre `crossing`, com a opção `line`. `DetectedLap` ganha `startCross`/`endCross`, e duração e `startedAt` saem deles. Saem a trava `justCrossed` e o raio em torno do ponto. As regras de 300 m e de 25–180 s continuam.
**Where**: `src/lib/lapDetector.ts`
**Depends on**: T1
**Reuses**: `findRitmoStart`, `DEFAULTS`
**Requirement**: TMP-01, TMP-02, TMP-03, TMP-04, TMP-05, edge cases de parar na linha e do buraco

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Os 5 casos atuais de `test/lapDetector.test.ts` continuam passando, sem mudar o que afirmam.
- [x] Teste: pista sintética a 10 Hz com duração real D, com todas as voltas (inclusive a 1ª) dentro de |duração − D| ≤ 20 ms.
- [x] Teste: a mesma a 5 Hz, também ≤ 20 ms.
- [x] Teste: com `line` do traçado e a gravação começando no meio da pista já andando, o trecho antes do 1º cruzamento não vira volta, e as voltas saem ≤ 20 ms.
- [x] Teste: duas gravações no mesmo traçado, começando em pontos diferentes, dão o mesmo tempo (± 20 ms).
- [x] Teste: o piloto para na linha e o jitter faz ir e voltar, mas o resultado é um cruzamento só (nenhuma volta extra).
- [x] Teste: um trajeto na contramão sobre a linha não fecha volta.
- [x] Teste: um buraco de mais de 2 s exatamente no cruzamento não fecha a volta ali.
- [x] Teste: `scripts/bench-leandro-melo-3laps.gpx` (parse com `fast-xml-parser`, já em devDependencies) dá 3 voltas, e pelo menos uma com `durationMs % 100 !== 0`.
- [x] Gate: `npm test`, contagem registrada: 79 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(tempos): volta fecha no cruzamento interpolado da linha`

---

#### T16: Trava de saída da linha (kart parado não fecha volta)

**What**: Um cruzamento só fecha volta se, desde o cruzamento anterior, o piloto se afastou mais de `2 × lineRadius` (30 m) do ponto da linha. É a regra do `justCrossed` antigo, agora junto com o teste de segmento e sentido. Aprovado pela Julia em 29/09 depois que o lote 1 apontou o risco.
**Where**: `src/lib/lapDetector.ts`
**Depends on**: T2
**Reuses**: `crossing` (T1) e `DEFAULTS.lineRadius`
**Requirement**: TMP-03 e o edge case "parar na linha e sair de novo"

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: o kart para em cima da linha por 60 s a 10 Hz, com jitter de ±3 m que cruza a linha para a frente várias vezes e soma mais de 300 m de "distância", e o resultado é **nenhuma** volta extra.
- [x] Teste: depois da parada, o piloto sai e completa uma volta normal, que é contada com erro de no máximo 20 ms.
- [x] Os testes de precisão da T2 (10 e 5 Hz, com e sem traçado) continuam passando.
- [x] Gate: `npm test`, contagem registrada: 80 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(tempos): kart parado na linha não fecha volta`

---

#### T3: Volta com pontos de fronteira

**What**: `sliceLaps(samples, imu, line?)` monta cada volta como `[startCross synthetic, pontos internos, endCross synthetic]` e recorta a IMU por `[startCross.t, endCross.t]`. `GpsSample` ganha o campo opcional `synthetic?: true`.
**Where**: `src/recording/finishSession.ts`
**Depends on**: T2, T16
**Reuses**: `sliceLaps` atual
**Requirement**: TMP-06 (base), AD-006

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: em cada volta, `samples[0].t === startCross.t`, `samples[last].t === endCross.t`, os dois têm `synthetic: true` e `durationMs === round(last.t − first.t)`.
- [x] Teste: o `endCross` da volta N é igual ao `startCross` da volta N+1 (mesma lat/lng/t).
- [x] Teste: nenhum ponto interno fica fora de `(startCross.t, endCross.t)`.
- [x] Teste: a IMU da volta fica toda dentro de `[startCross.t, endCross.t]`.
- [x] Os testes existentes de `finishSession` e `recovery` continuam passando. **Exceção autorizada pela Julia em 29/09:** o teste "sliceLaps: recorta a IMU pela janela de tempo de cada volta" passa a comparar `lap.samples.slice(1, -1)` com os pontos crus de `samples.slice(d.startIdx, d.endIdx + 1)` que caem em `startCross.t < t < endCross.t`, e ganha a checagem das duas fronteiras sintéticas. A parte da IMU fica igual.
- [x] Gate: `npm test`, contagem registrada: 84 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(tempos): volta começa e termina na linha de chegada`

---

#### T4: Régua única de S1/S2/S3

**What**: Criar `sectorSplits(lapSamples, ref)`, `referenceFromLayout(samples)` e `referenceFromLap(lap)`.
**Where**: `src/lib/sectors.ts`
**Depends on**: T3
**Reuses**: `buildReferenceLap`, `matchLapToReference`, `interpolateTimeAtS`
**Requirement**: TMP-07, TMP-09

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa volta sintética com fronteiras, S1, S2 e S3 correspondem aos terços do comprimento do traçado (em velocidade constante, cada um é D/3 ± 20 ms).
- [x] Teste: `s1 + s2 + s3 === durationMs` (± 1 ms).
- [x] Teste: numa volta em curso que ainda não chegou a 2/3, `s2Ms` e `s3Ms` são `null` e `s1Ms` é número.
- [x] Teste: a mesma volta, calculada como "em curso" no fechamento e como "fechada", dá os mesmos S1/S2/S3 (diferença ≤ 20 ms).
- [x] Teste: sem traçado, `referenceFromLap(melhorVolta)` é usado e os terços saem do comprimento dessa volta.
- [x] Gate: `npm test`, contagem registrada: 90 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(tempos): uma régua só para S1, S2 e S3`

---

#### T5: Delta ao vivo começa no início do traçado

**What**: `DeltaTracker.resetLap()` põe o hint no segmento 0.
**Where**: `src/lib/realtimeDelta.ts`
**Depends on**: None
**Reuses**: `DeltaTracker`
**Requirement**: TMP-10

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: depois de `resetLap()`, o primeiro ponto em cima da linha (que também coincide com o fim da polilinha) casa com `sCurrent < 5 % do comprimento`.
- [x] Gate: `npm test`, contagem registrada: 91 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(tempos): delta da volta nova casa no início do traçado`

---

#### T6: Pico de velocidade pelo percentil 99

**What**: `peakSpeedMs` e `peakSpeedMsOfLaps` passam a devolver o p99 (nearest-rank) dos pontos com precisão de até 10 m, ou `null`.
**Where**: `src/lib/speed.ts`
**Depends on**: None
**Reuses**: nada
**Requirement**: TMP-11 (AC 1, 2, 4)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa volta com cerca de 500 pontos a ~80 km/h e um único ponto a 150 km/h, o pico fica abaixo de 81 km/h.
- [x] Teste: o p99 bate com o nearest-rank calculado à mão num conjunto pequeno conhecido.
- [x] Teste: pontos com precisão acima de 10 m são ignorados; sem nenhum ponto bom, o resultado é `null`.
- [x] Gate: `npm test`, contagem registrada: 95 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(tempos): pico de velocidade ignora fix ruim isolado`

---

#### T7: Insights com dados limpos e média correta

**What**: `buildLapInsight` aplica `cleanSamples(10)` e `repairDegenerateTimestamps` em cada volta, e divide a média de cada curva só pelas voltas válidas naquela curva. Criar também `lapsForInsight(sessions, anchor)`, que filtra pelo traçado da sessão âncora.
**Where**: `src/lib/lapInsight.ts`
**Depends on**: None
**Reuses**: `cleanSamples`, `repairDegenerateTimestamps`
**Requirement**: TMP-12, TMP-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: 3 voltas boas e 1 com a curva 2 inválida dão, na curva 2, a média exata das 3 boas.
- [x] Teste: uma volta com timestamps degenerados é reparada antes de entrar (o resultado bate com o da mesma volta com timestamps corretos, ± 20 ms na perda da curva).
- [x] Teste: fixes acima de 10 m não entram.
- [x] Teste: `lapsForInsight` com sessões de dois traçados na mesma pista devolve só as do traçado da âncora.
- [x] Gate: `npm test`, contagem registrada: 99 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(insights): mesma limpeza da análise e média só com voltas válidas`

---

#### T8: Timestamp do GPS confiável no segundo cheio

**What**: `handleLocations` ganha `clock: { trustsRaw; lastT }`. O primeiro sub-segundo liga `trustsRaw`, e todo `t` emitido é `max(t, lastT + 1)`. O `locationTask.ts` zera o `clock` em cada gravação.
**Where**: `src/recording/locationHandler.ts`
**Depends on**: None
**Reuses**: regra atual de timestamp
**Requirement**: TMP-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: um lote com t = …49.900, …50.000, …50.100 mantém os três timestamps originais.
- [x] Teste: um aparelho que só entrega timestamps quantizados mantém o comportamento atual (horário de chegada espalhado a 100 ms).
- [x] Teste: os timestamps emitidos são estritamente crescentes entre lotes, inclusive quando um lote traz um `t` repetido.
- [x] Os testes existentes de `locationHandler` continuam passando.
- [x] Gate: `npm test`, contagem registrada: 102 testes, 0 falhas. Build do fim da fase (`npm test && npm run typecheck`): só os 8 erros da baseline.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(gravação): timestamp do GPS confiável mesmo no segundo cheio`

---

### Phase 2: Fiação

#### T9: Mesma linha no "Encerrar" e na recuperação

**What**: `RecordingMeta` ganha o campo opcional `line`, sem mudar `version`. `finishRecording` e `recover` passam `meta.line` ao `sliceLaps` e ao `summarize`. Um diário antigo sem `line` usa a linha inferida.
**Where**: `src/recording/recovery.ts`
**Depends on**: None
**Reuses**: T3
**Requirement**: TMP-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: um diário com `meta.line` recupera voltas com o mesmo tempo (± 1 ms) que o `detectLaps` com essa linha sobre os mesmos pontos.
- [x] Teste: `finishRecording` com `meta.line` salva voltas com `startCross` na linha do traçado. **Nota:** o `finishRecording` recebe as voltas já recortadas pelo `stop()` do hook e não chama `sliceLaps`. A linha chega ao "Encerrar" pelo `stop()` (T10), e o `finishRecording` não mudou. O teste grava a meta com `line` no diário e confere que as voltas salvas começam no cruzamento dessa linha.
- [x] Teste: um diário sem `line` (formato antigo) continua legível e recupera com a linha inferida.
- [x] Gate: `npm test`, contagem registrada: 105 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(tempos): a recuperação e o encerrar usam a linha da gravação`

---

#### T10: Hook usa a linha do traçado e a régua única

**What**: No `useLapRecorder`:
- `setLayoutReference` guarda a `line` via `lineFromLayout` e o `ReferenceLap` do traçado;
- o `start()` inclui `line` na meta do diário;
- o poll chama `detectLaps(all, { line })`;
- `currentSectors` e `lastClosedLapSectors` saem de `sectorSplits` sobre a volta em curso e a fechada, que passam a ser as mesmas da publicação;
- sai a marcação de limite por `last.t`;
- o `stop()` usa `sliceLaps(…, line)`.
**Where**: `src/hooks/useLapRecorder.ts`
**Depends on**: T9
**Reuses**: T1–T4
**Requirement**: TMP-05, TMP-06, TMP-07 (AC 2), TMP-08

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: o hook importa `sectorSplits` e `lineFromLayout`, e não contém mais `sectorBoundaryTsRef`. O mesmo arquivo (`test/lapRecorderHook.test.ts`) confere `detectLaps(all, { line })`, `sliceLaps(…, line)` no `stop()` e a `line` na meta do diário.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 108 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Notas da execução:**
- A linha é fixada no `start()` (`recordingLineRef`) e vale para o poll, para a meta do diário e para o `stop()`. Um traçado que chegue depois do `start()` só vale na próxima gravação.
- O setor atual (`currentSectorIdx`) e o tempo nele saem do mesmo `sectorSplits` da volta em curso. O `DeltaTracker` que só servia para projetar o setor saiu. Antes do primeiro cruzamento da linha do traçado não há volta aberta, e a barra de setores fica escondida.
- Sem traçado, não há setores ao vivo (TMP-09).

**Tests**: unit
**Gate**: build
**Commit**: `feat(tempos): cockpit usa a linha do traçado e a régua única de setores`

---

#### T11: Análise da sessão com a régua única

**What**: Na tela de sessão, S1/S2/S3 saem de `sectorSplits` contra o traçado da sessão (`getLayout(session.layoutId)`) ou, sem traçado, contra a melhor volta. Sai o `groupThirds` 7/7/6. O pico usa o `peakSpeedMs` novo (com "—" quando `null`), inclusive no marcador do mapa (`:1315-1322`).
**Where**: `app/session/[id].tsx`
**Depends on**: None
**Reuses**: T4, T6
**Requirement**: TMP-07 (AC 3), TMP-09, TMP-11 (AC 3)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: o arquivo não define `groupThirds`, importa `sectorSplits` e não calcula mais o pico por laço de máximo bruto.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 111 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Notas da execução:**
- S1/S2/S3 são medidos sobre os pontos da volta como foram salvos (só com o reparo de timestamp das sessões antigas), e não sobre os pontos já filtrados por `cleanSamples(10)`. São os mesmos pontos que o ao vivo mediu, e o filtro podia tirar o ponto de fronteira de uma volta.
- A régua é o traçado carregado pela tela (`getLayout(ses.layoutId)` e, sem ele, o traçado padrão da pista, que é o mesmo que a gravação usa) e, sem traçado, a melhor volta. A referência da comparação passa pela mesma régua.
- As props `corners` e `totalLength` de `ComparePanel` e `SectorsPanel`, que só serviam ao `groupThirds`, saíram.

**Tests**: unit
**Gate**: build
**Commit**: `feat(sessão): setores e pico pela mesma régua do cockpit`

---

#### T12: Pico na home

**What**: A home usa `peakSpeedMsOfLaps` novo e mostra "—" quando o valor é `null`.
**Where**: `app/(tabs)/index.tsx`
**Depends on**: None
**Reuses**: T6
**Requirement**: TMP-11 (AC 3, 4)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: o valor `null` do pico chega à UI como "—". O teste compila o `fmtKmh` da tela e confere `fmtKmh(null) === '—'`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 112 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Tests**: unit
**Gate**: build
**Commit**: `fix(home): pico de velocidade sem fix ruim`

---

#### T13: Insights só do mesmo traçado

**What**: `app/(tabs)/insights.tsx` usa `lapsForInsight` (T7) para montar o conjunto.
**Where**: `app/(tabs)/insights.tsx`
**Depends on**: None
**Reuses**: T7
**Requirement**: TMP-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: a tela chama `lapsForInsight`, e o filtro só por `trackId` saiu.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 113 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Tests**: unit
**Gate**: build
**Commit**: `fix(insights): sua volta só com o mesmo traçado`

---

#### T14: Pico nulo no prompt da IA

**What**: `runPostSaveEffects` manda `peakKmh: null` para `requestQuickInsight` quando o pico é `null`, em vez de 0.
**Where**: `src/recording/postSave.ts`
**Depends on**: None
**Reuses**: T6
**Requirement**: TMP-11 (AC 3)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa volta sem nenhum ponto de até 10 m, a IA recebe `peakKmh: null`.
- [x] Teste: numa volta com um ponto isolado a 150 km/h, a IA recebe menos de 81 km/h.
- [x] Gate: `npm test`, contagem registrada: 115 testes, 0 falhas.

**Nota da execução:** o tipo `QuickInsightInput.peakKmh` em `src/lib/aiAnalysis.ts` passou de `number` opcional para `number | null` opcional, para aceitar o `null`. O prompt já pulava a linha do pico quando ele é `null`, e não mudou.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(tempos): IA recebe o pico honesto`

---

#### T15: `telemetria.md` com as regras novas

**What**: Atualizar os §2, §4, §6, §8, §10, §12 e §13 do `docs/telemetria.md`: linha com sentido e segmento, pontos de fronteira (AD-006), terços exatos, p99, relógio `trustsRaw` e as constantes. Corrigir também os erros que o levantamento de 24/09 achou no documento.
**Where**: `docs/telemetria.md`
**Depends on**: None
**Reuses**: `docs/levantamento-loja.md` §2 ("Correções ao `telemetria.md`")
**Requirement**: Success Criteria da spec

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Cada constante do §12 aponta para o arquivo em que está hoje.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 115 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Nota da execução:** além das seções pedidas, o §1 ganhou o relógio `trustsRaw` e a ressalva dos 10 Hz só no Android; o §3, a busca global acima de 20 m; o §5, a janela fixa de ±6 m, a histerese de 0,5× e o varrido mínimo de 30°; o §7, o trompo pelo GPS; e o §11 deixou de dizer que a linha é sempre inventada. O §6 já cita a escala do "Sua volta", que a T17 faz em seguida.

**Tests**: none
**Gate**: build
**Commit**: `docs(telemetria): regras novas de linha, setores e pico`

---

#### T17: Escala de velocidade dos insights pelo pico honesto

**What**: `buildLapInsight` calcula `maxKmh` (a escala da pintura por velocidade em "Sua volta") com o `peakSpeedMs` novo, e não mais com o máximo bruto da melhor volta. O lote 1b achou essa lacuna do TMP-11 AC 3, que nenhuma tarefa cobria.
**Where**: `src/lib/lapInsight.ts`
**Depends on**: None
**Reuses**: T6
**Requirement**: TMP-11 (AC 3)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa melhor volta a ~80 km/h com um único ponto a 150 km/h, `maxKmh` fica abaixo de 81.
- [x] Gate: `npm test`, contagem registrada: 116 testes, 0 falhas. Build do fim da fase (`npm test && npm run typecheck`): só os 8 erros da baseline.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(insights): escala de velocidade sem fix ruim`

---

### Phase 3: Correções achadas pelo lote 2 (AD-006)

#### T18: `cleanSamples` preserva as fronteiras da volta

**What**: `cleanSamples` nunca remove pontos `synthetic: true`, qualquer que seja a precisão herdada. É o que o design e a AD-006 prometem. Hoje, uma fix ruim ao lado do cruzamento tira a fronteira da volta nas curvas, nos mini-setores, no mapa, no `lapInsight`, no lap-compare e no DNA.
**Where**: `src/lib/analysis.ts`
**Depends on**: None
**Reuses**: `cleanSamples`
**Requirement**: AD-006; TMP-07 (AC 3), TMP-12 (AC 1)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa volta cujos pontos de fronteira herdaram precisão de 25 m, `cleanSamples(10)` mantém o primeiro e o último ponto (os sintéticos) e remove os pontos crus acima de 10 m.
- [x] Teste: com essa volta limpa, `sectorSplits` continua fechando `s1 + s2 + s3 === durationMs` (± 1 ms).
- [x] Gate: `npm test`, contagem registrada: 118 testes, 0 falhas.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(tempos): limpeza de pontos preserva as fronteiras da volta`

---

#### T19: Cronômetro e delta ao vivo a partir do cruzamento

**What**: Extrair do hook a função pura `liveLapClock(detection, all, nowSampleT)`. Ela devolve o instante de início da volta em curso, que é o `endCross.t` da última volta fechada ou, na 1ª volta, o `startCross` do 1º cruzamento. Sem nenhum cruzamento com traçado, devolve `null`. O `currentLapElapsedMs` e o delta passam a contar a partir desse instante. A referência do `DeltaTracker` passa a ser a volta com fronteiras (via `sliceLaps`), e não os pontos crus `startIdx..endIdx`. O hook usa a função.
**Where**: `src/recording/liveLapClock.ts`
**Depends on**: T18
**Reuses**: `detectLaps`, `sliceLaps`, `DeltaTracker`
**Requirement**: AD-006; TMP-05 (AC 3), TMP-10

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: com traçado e gravação começando andando, antes do 1º cruzamento o relógio é `null` (o cronômetro não corre).
- [x] Teste: depois do 1º cruzamento, `elapsed = t_amostra − startCross.t` exatamente.
- [x] Teste: depois de fechar uma volta, o relógio recomeça em `endCross.t` dessa volta, e não no ponto cru seguinte.
- [x] Teste: a referência do delta montada para uma volta fechada começa e termina em pontos `synthetic`.
- [x] Teste estático: o hook usa `liveLapClock` e não calcula mais o início da volta por `endIdx + 1`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 123 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Notas da execução:**
- `liveLapClock` recebe também a `line` passada ao `detectLaps` (`null` sem traçado), para saber se a 1ª volta abre no ponto de ritmo (sem traçado) ou no 1º cruzamento (com traçado). Devolve `{ lapStartT, elapsedMs }`.
- A referência do delta sai de `deltaReferenceLap(all, line, lapIdx)`, no mesmo arquivo, que é a volta do `sliceLaps`.
- O resto do hook (PB, overlay, setores pelo `sectorSplits`, diário, autosave) não mudou.

**Tests**: unit
**Gate**: build
**Commit**: `fix(tempos): cronômetro e delta ao vivo contam do cruzamento da linha`

---

#### T20: Volta em curso depois de um box (mais de 180 s)

**What**: `DetectLapsResult` passa a expor `openCross`, o cruzamento que abriu a volta em curso, inclusive quando a volta anterior foi descartada por passar de 180 s. `liveLapClock` e o `currentLapSamples` do hook (setores ao vivo) usam `openCross`, e não o `endCross` da última volta fechada. O lote 3 achou esse caso: hoje, depois de um box, o cronômetro, o delta e os setores ao vivo da volta seguinte saem errados.
**Where**: `src/lib/lapDetector.ts`
**Depends on**: T19
**Reuses**: `liveLapClock` (T19)
**Requirement**: TMP-03 (AC 7), TMP-07 (AC 2), AD-006

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: duas voltas, depois uma parada de 200 s passando pela linha, depois a volta seguinte. `openCross.t` é o cruzamento depois da parada, e `liveLapClock` conta a partir dele.
- [x] Teste: numa sessão sem box, `openCross` é igual ao `endCross` da última volta fechada, e antes da 1ª volta é o 1º cruzamento (ou `null` com traçado antes de cruzar).
- [x] Teste estático: o `currentLapSamples` do hook usa `openCross`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 126 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Notas da execução:**
- `openCross` é `CrossPoint & { idx }`, em que `idx` é o 1º ponto cru depois do cruzamento (o `startIdx` que a volta terá). O hook usa o `idx` para recortar os pontos da volta em curso. Sem box, depois de uma volta fechada, `openCross` é `{ ...endCross, idx: endIdx }` dela.
- `liveLapClock` manteve a assinatura da T19 `(detection, all, nowSampleT, line)`, porque o teste estático da T19 exige a chamada `liveLapClock(detection, all, …)`. Agora só lê `detection.openCross`; `all` e `line` ficaram sem uso.
- `currentLapSamples(all, openCross)` substituiu a busca pelo 1º cruzamento e o `endCross` da última volta, e o `crossing` saiu dos imports do hook.

**Tests**: unit
**Gate**: build
**Commit**: `fix(tempos): volta depois do box conta do cruzamento certo`

---

### Phase 4: Correções do Verificador (iteração 1)

Saídas do `validation.md` de 29/09 (FAIL).

#### T21: "Comparar voltas" pela régua única

**What**: `compareLaps` calcula S1/S2/S3 com `sectorSplits` sobre os pontos salvos das duas voltas, e a soma 7/7/6 sai. A régua é o traçado da sessão; sem traçado, a volta de referência da comparação.
**Where**: `src/lib/lapCompare.ts`
**Depends on**: None
**Reuses**: `sectorSplits`, `referenceFromLayout`, `referenceFromLap`
**Requirement**: TMP-07 (AC 1, 3), AD-006

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: na pista sintética de 37.699 ms, os S1/S2/S3 de `compareLaps` para uma volta são iguais aos de `sectorSplits` para a mesma volta (± 1 ms) e somam a duração.
- [x] Teste: nenhum setor sai negativo.
- [x] Gate: `npm test`, contagem registrada: 129 testes, 0 falhas.

**Notas da execução:**
- `compareLaps` aceita `ref: ReferenceLap | null`. Com `null`, a régua é `referenceFromLap(lapB)`, a volta de referência da comparação, e um 3º teste confere isso. A tela ainda recusa comparar sem traçado ("Sem referência de pista pra comparar."); mudar isso fica fora da T21.
- O rótulo de cada setor sai do terço do traçado (`describeSector` sobre `[k·L/3, (k+1)·L/3]`), e não mais do mini-setor do meio do grupo 7/7/6. O `analyzeLap` saiu do arquivo.
- A tela (`app/lap-compare.tsx`) não mudou: o formato de retorno é o mesmo. Ela passa os pontos já filtrados por `cleanSamples(10)`, que preserva as fronteiras (T18), então a soma dos setores continua fechando com a duração.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(comparação): setores da comparação pela régua única`

---

#### T22: Delta reinicia em toda abertura de volta

**What**: Criar a função pura `lapOpened(prevOpenCross, openCross): boolean`. O hook chama `tracker.resetLap()` sempre que ela é verdadeira, o que inclui a volta aberta depois de uma volta descartada por passar de 180 s, e não só quando uma volta fecha.
**Where**: `src/recording/liveLapClock.ts`
**Depends on**: None
**Reuses**: `openCross` (T20), `DeltaTracker.resetLap` (T5)
**Requirement**: TMP-10 (AC 6)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa sequência de 2 voltas, box de 200 s e volta nova, `lapOpened` é verdadeira na abertura depois do box.
- [x] Teste: repetindo os polls do hook nessa sequência com um `DeltaTracker`, o 1º poll depois da abertura casa com `sNormalized < 0,05` (e não 1,0).
- [x] Teste estático: o hook chama `resetLap` sob `lapOpened`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 132 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Notas da execução:**
- `lapOpened` é verdadeira quando o `openCross` passa a existir ou muda de `t`. O hook guarda o do poll anterior em `lastOpenCrossRef`, zerado no `start()`.
- O `resetLap()` saiu do bloco "volta fechou" e ficou só sob `lapOpened`, que também é verdadeira quando uma volta fecha. O resto do bloco (PB, overlay, setores, recarga da referência) não mudou.
- Os testes estão em `test/liveLapClock.test.ts`, que já tinha o cenário do box. Sem o reset, a sonda repete o valor do Verificador: s = 751,8 m (100 % da volta).

**Tests**: unit
**Gate**: build
**Commit**: `fix(tempos): delta reinicia também na volta depois do box`

---

#### T23: Cockpit e painel não mostram volta antes do 1º cruzamento

**What**: Em `app/recording.tsx`, onde hoje aparece `currentLapElapsedMs ?? elapsedMs` (`:322`, `:599`), o cronômetro da volta mostra "—" enquanto não houver volta aberta, e a publicação manda `lapElapsedMs: null`.
**Where**: `app/recording.tsx`
**Depends on**: T22
**Reuses**: nada
**Requirement**: TMP-05 (AC 3)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: o arquivo não contém `currentLapElapsedMs ?? info.elapsedMs` nem `currentLapElapsedMs ?? elapsedMs`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 133 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Notas da execução:**
- A publicação manda `lapElapsedMs: info.currentLapElapsedMs ?? undefined`. O tipo `LiveSample.lapElapsedMs` (`src/lib/liveSession.ts:24`) é `number` opcional, e o `publishSample` grava `lap_elapsed_ms: sample.lapElapsedMs ?? null`, então a equipe recebe `null`. Mudar o tipo para aceitar `null` mexeria fora da tela.
- O mesmo teste estático confere o "—" no cockpit e a expressão da publicação.
- Fora do escopo: o `web-spectator` mostra `lapElapsedMs ?? 0` (`web-spectator/app/live/[code]/page.tsx:52`), então o painel exibe 0 antes do 1º cruzamento, e não "—".

**Tests**: unit
**Gate**: build
**Commit**: `fix(gravação): cronômetro da volta só corre depois do 1º cruzamento`

---

#### T24: Mapa detalhado pela régua única

**What**: `app/track-map.tsx` calcula os setores com `sectorSplits`, e a régua própria (`:112-121`) sai. A tela vai voltar à navegação em `produto-limpo` (decisão de 24/09).
**Where**: `app/track-map.tsx`
**Depends on**: None
**Reuses**: `sectorSplits`
**Requirement**: TMP-07 (AC 1), AD-006

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: o arquivo importa `sectorSplits` e não tem mais o cálculo próprio de setores.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline: 134 testes, 0 falhas; typecheck com os 8 erros da baseline.

**Notas da execução:**
- Como na sessão (T11), os setores são medidos sobre os pontos da volta como foram salvos, só com o reparo de timestamp, e a régua é `referenceFromLayout(layout.samples)`. O traçado limpo continua desenhando o mapa, as curvas e a velocidade mínima por curva.
- Um setor `null` (volta antiga sem fronteira que não alcança a linha) aparece como "—" e fica fora do selo de PB. O `interpolateT` local saiu.
- O teste estático está em `test/trackMapScreen.test.ts`.

**Tests**: unit
**Gate**: build
**Commit**: `fix(mapa): setores do mapa detalhado pela régua única`

---

#### T25: GPX de bancada: todas as voltas fora dos múltiplos de 100 ms

**What**: O teste do GPX de bancada troca `some` por `every`: **todas** as voltas precisam ter `durationMs % 100 !== 0`. Isso deixa o teste mais rigoroso e fecha a lacuna de precisão que o Verificador apontou.
**Where**: `test/lapDetector.test.ts`
**Depends on**: None
**Reuses**: o teste atual
**Requirement**: Success Criteria (GPX sem tempos em 00)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] O teste afirma `every`, e as 3 voltas passam.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick
**Commit**: `test(tempos): todas as voltas do GPX de bancada fora dos múltiplos de 100 ms`

---

## Phase Execution Map

Phase 1 → Phase 2. As dependências dentro de cada fase estão nos diagramas do Execution Plan.
A execução é sequencial, uma tarefa por vez, na ordem dos números.

---

## Roteiro de UAT no aparelho (depois da T15)

1. Gravar 3 voltas numa pista **com traçado**, começando já andando. A 1ª volta só conta no primeiro cruzamento da linha, e os tempos não terminam todos em 00.
2. Com a equipe no painel web, conferir que o S1/S2/S3 publicado no fechamento da volta é igual ao da análise da sessão (± 0,02 s).
3. Gravar numa pista **sem traçado**: a análise mostra S1/S2/S3 pela melhor volta, e o cockpit fica sem setores.
4. Passar pela linha na contramão (box): não fecha volta.
5. A home e a sessão mostram o pico, e "—" quando não há ponto bom.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | 3 funções da linha, mais a extensão do helper de teste | ⚠️ coeso |
| T2 | 1 função (`detectLaps`) | ✅ |
| T3 | 1 função (`sliceLaps`) | ✅ |
| T4 | 1 função e 2 construtores | ⚠️ coeso |
| T5 | 1 método | ✅ |
| T6 | 2 funções irmãs | ✅ |
| T7 | 1 função e 1 filtro | ⚠️ coeso |
| T8 | 1 handler | ✅ |
| T9 | 1 fluxo (meta → slice) | ✅ |
| T10 | 1 hook | ✅ |
| T11 | 1 tela | ✅ |
| T12 | 1 tela | ✅ |
| T13 | 1 tela | ✅ |
| T14 | 1 função | ✅ |
| T15 | 1 documento | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | – | ✅ |
| T2 | T1 | T1 → T2 | ✅ |
| T3 | T2 | T2 → T3 | ✅ |
| T4 | T3 | T3 → T4 | ✅ |
| T5–T8 | None | – | ✅ |
| T9 | None (usa a fase 1) | – | ✅ |
| T10 | T9 | T9 → T10 | ✅ |
| T11–T15 | None (usam a fase 1) | – | ✅ |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1–T9, T14 | lógica pura | unit | unit | ✅ |
| T10 | hook RN com invariante estática | unit (estático) | unit | ✅ |
| T11–T13 | tela RN com invariante estática | unit (estático) | unit | ✅ |
| T15 | documentação | none | none | ✅ |
