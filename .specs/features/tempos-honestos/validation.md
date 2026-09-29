## Validation: tempos honestos — FAIL ❌

**Data**: 2026-09-29
**Spec**: `.specs/features/tempos-honestos/spec.md` (TMP-01 a TMP-14, edge cases, Success Criteria)
**Decisão**: AD-006 (`.specs/STATE.md`)
**Faixa de commits**: `13c72ab..43c26e4` (branch `feat/tempos-honestos`, 24 commits: T1, T2, T16, T3–T8, T9–T15, T17, T18, T19, T20 e docs)
**Verificador**: sub-agente independente (autor ≠ verificador). Não alterou código, testes nem commits; só este arquivo.

**Motivo do FAIL, em uma linha**: todo AC testável em Node tem evidência e os 21 mutantes morreram, mas a inspeção achou dois caminhos alcançáveis que violam a spec e a AD-006: o S1/S2/S3 da tela "Comparar voltas" ainda sai da régua 7/7/6, e o delta ao vivo casa no fim do traçado na volta depois de um box.

---

## Gates

| Gate | Comando | Resultado |
| ---- | ------- | --------- |
| Testes | `npm test` | **126 testes, 126 passam, 0 falhas, 0 pulados** |
| Typecheck | `npm run typecheck` (tsc, exit 2) | **Só a baseline**: exatamente os 8 erros aceitos: `app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`. Nenhum erro novo |
| Contagem | antes da feature: 62 (tasks.md) | depois: 126 (+64). Nenhum teste removido. Uma asserção alterada com autorização registrada (T3, `test/finishSession.test.ts:67`, 29/09), e ela ficou mais forte (confere também as fronteiras) |
| Tarefas | `tasks.md` | T1–T20 marcadas `[x]`; nenhum `- [ ]` restante |

---

## Checagem ancorada na spec

Legenda: ✅ a asserção mira o valor da spec · 🟡 só UAT (pendente), com a linha do código inspecionada · ⚠️ lacuna de precisão · ❌ violação achada na inspeção.

### P1: Tempo de volta com o milésimo real (TMP-01, TMP-02, TMP-03)

| Critério | Resultado da spec | `arquivo:linha` + asserção | Resultado |
| -------- | ----------------- | -------------------------- | --------- |
| AC1: instante por interpolação linear entre os dois pontos de cada lado | `t = t_a + f·(t_b − t_a)`, ponto na linha | `test/startLine.test.ts:36-41`: `Math.abs(c.f - 0.25) < 1e-9`, `Math.abs(c.t - 10_025) < 1e-6`, ponto interpolado com `x,y ≈ 0` | ✅ |
| AC2: 10 Hz, \|duração − D\| ≤ 20 ms | ≤ 20 ms em todas as voltas | `test/lapDetector.test.ts:106-107`: `assertLapsWithin(laps.map(l => l.durationMs), D, '10 Hz')` com `TOL_MS = 20` (6 voltas, D = 37.699 ms) | ✅ |
| AC3: 5 Hz, ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:114-115`: idem a 5 Hz | ✅ |
| AC4 (TMP-02): 1ª volta com a mesma regra, ≤ 20 ms | 1ª volta incluída | `test/lapDetector.test.ts:106,114` (sem traçado, a 1ª volta entra no laço) e `:136` (com traçado, 10 e 5 Hz); `test/sectors.test.ts:50` | ✅ |
| AC5: passar perto sem cruzar não fecha | `null` | `test/startLine.test.ts:59-60`: `crossing(at(0,-6), at(0,-0.5)) === null` e o simétrico | ✅ |
| AC6: contramão não fecha | `null` / 0 voltas | `test/startLine.test.ts:47`; `test/lapDetector.test.ts:194`: `detectLaps(samples, { line }).laps.length === 0` (4 voltas na contramão) | ✅ |
| AC7: 300 m, 25–180 s, uma volta por cruzamento | limites exatos | `test/lapDetector.test.ts:224` (`durationMs >= 25_000`), `:237` (`dist >= 300`); 180 s: `test/liveLapClock.test.ts:145` e `test/recovery.test.ts:191`; um cruzamento só: `test/lapDetector.test.ts:178,313` | ✅ |
| Meia-largura 15 m | 16 m não cruza, 14 m cruza | `test/startLine.test.ts:51-55` | ✅ |

### P1: Uma linha só por traçado (TMP-04, TMP-05, TMP-06)

| Critério | Resultado da spec | `arquivo:linha` + asserção | Resultado |
| -------- | ----------------- | -------------------------- | --------- |
| AC1 (TMP-04): com traçado, 1º ponto e rumo do traçado | ponto = `samples[0]`, rumo ± 1° | `test/startLine.test.ts:83-86`: `line.lat === layout[0].lat`, `Math.abs(line.headingDeg - expected) <= 1` | ✅ |
| AC2 (TMP-04): sem traçado, ponto de ritmo e rumo do movimento | idem | `test/startLine.test.ts:92-95` | ✅ |
| AC3 (TMP-05): começa andando, 1ª volta no 1º cruzamento | trecho anterior não é volta; ≤ 20 ms | `test/lapDetector.test.ts:127-136`: `laps.length === 3` com 4 passagens, `startCross.t` a ≤ 20 ms da 1ª passagem; cronômetro: `test/liveLapClock.test.ts:48` (`liveLapClock(...) === null` antes de cruzar) | ✅ |
| Independent test: duas gravações, pontos de partida diferentes | mesmo cruzamento e tempo ± 20 ms | `test/lapDetector.test.ts:149-153` | ✅ |
| AC4 (TMP-06): mesma linha no ao vivo, no "Encerrar" e na recuperação | a linha da meta | Recuperação: `test/recovery.test.ts:256,259` (± 1 ms e começa a < 1 m da linha); "Encerrar": `test/finishRecording.test.ts:175-180`; diário antigo: `test/recovery.test.ts:279`; hook: `test/lapRecorderHook.test.ts:25-27,31` (estático). Código: `src/hooks/useLapRecorder.ts:359` fixa `recordingLineRef` no `start()`, usado no poll (`:471-473`), na meta (`:368`) e no `stop()` (`:716-721`) | ✅ (+ 🟡 hook) |

### P1: S1/S2/S3 iguais em todo lugar (TMP-07, TMP-08, TMP-09, TMP-10)

| Critério | Resultado da spec | `arquivo:linha` + asserção | Resultado |
| -------- | ----------------- | -------------------------- | --------- |
| AC1 (TMP-07): terços do comprimento do traçado | D/3 ± 20 ms em velocidade constante | `test/sectors.test.ts:50-52` (10 e 5 Hz); velocidade variável prova que é distância, não tempo: `:132-134` (16.667 / 13.333 / 10.000) | ✅ na função · ❌ na tela "Comparar voltas" (defeito 1) |
| AC2 (TMP-07): ao vivo pelo instante interpolado, não pelo poll | sem marcação por `last.t` | `src/lib/sectors.ts:65-75` interpola entre os pontos; `test/lapRecorderHook.test.ts:19-21` (importa `sectorSplits`, sem `sectorBoundaryTsRef`); `test/liveLapClock.test.ts:169` (volta em curso por `openCross`) | ✅ (+ 🟡 hook) |
| AC3 (TMP-07): análise ≤ 20 ms do ao vivo | ≤ 20 ms | `test/sectors.test.ts:102`: `Math.abs(va - vb) <= TOL_MS` (em curso × fechada, 10 e 5 Hz). Por construção, o fechamento no hook (`src/hooks/useLapRecorder.ts:559-561`) e a análise (`app/session/[id].tsx:360-363`) chamam `sliceLaps` + `sectorSplits` sobre os mesmos pontos | ✅ |
| Independent test: S1+S2+S3 = duração ± 1 ms | ± 1 ms | `test/sectors.test.ts:64`; com a volta limpa por `cleanSamples(10)`: `test/analysis.test.ts:75` | ✅ |
| AC4 (TMP-08): publicar os mesmos S1/S2/S3 | os do fechamento | `src/hooks/useLapRecorder.ts:559-562` → `lastClosedLapSectors` → `app/recording.tsx:368-378` (`publishLap`). Sem teste de runtime | 🟡 só UAT (roteiro, passo 2) |
| AC5 (TMP-09): sem traçado, análise pela melhor volta; ao vivo sem setores | régua = melhor volta; hook sem setores | Análise: `test/sectors.test.ts:108-135`, `test/sessionScreen.test.ts:27`. Ao vivo: `src/hooks/useLapRecorder.ts:472,614` (`sectorRef` só com linha) | ✅ análise · 🟡 ao vivo |
| AC6 (TMP-10): delta projeta o 1º ponto em s ≈ 0, nunca no fim | s < 5 % | `test/realtimeDelta.test.ts:30`: `reading.sNormalized < 0.05` depois de `resetLap()` | ✅ na função · ❌ no hook depois de um box (defeito 2) |

### P2: Pico de velocidade (TMP-11)

| Critério | Resultado da spec | `arquivo:linha` + asserção | Resultado |
| -------- | ----------------- | -------------------------- | --------- |
| AC1: p99 dos pontos com precisão ≤ 10 m | nearest-rank; 10 m entra, 10,5 m não | `test/speed.test.ts:39` (`=== 198`), `:50` (`peakSpeedMs(mixed) === 20`, com 10 m dentro e 10,5 m fora) | ✅ |
| AC2: um ponto a 150 km/h em ~80 km/h | < 81 km/h | `test/speed.test.ts:33`: `msToKmh(peak) < 81` | ✅ |
| AC3: mesmo cálculo na sessão, home, pós-salvamento e insights | p99 em todos | Pós-salvamento: `test/postSave.test.ts:193` (`peakKmh < 81`); insights: `test/lapInsight.test.ts:171` (`maxKmh < 81`); home: `test/homeScreen.test.ts:21-29`; sessão: `test/sessionScreen.test.ts:31-38` (sem laço de máximo bruto) | ✅ |
| AC4: sem ponto bom, `null` e "—" | `null`, "—" | `test/speed.test.ts:51-52,60-61`; `test/postSave.test.ts:182` (`peakKmh === null`); `test/homeScreen.test.ts:28` (`fmtKmh(null) === '—'`); `test/sessionScreen.test.ts:38` | ✅ |

### P2: Insights (TMP-12, TMP-13)

| Critério | Resultado da spec | `arquivo:linha` + asserção | Resultado |
| -------- | ----------------- | -------------------------- | --------- |
| AC1 (TMP-12): `cleanSamples(10)` e `repairDegenerateTimestamps` | volta reparada ± 20 ms; fix > 10 m fora | `test/lapInsight.test.ts:104` (`<= 20`), `:127-130` (perdas iguais com e sem as fixes de 30 m) | ✅ |
| AC2 (TMP-12): volta inválida fora do denominador | média exata das 3 boas | `test/lapInsight.test.ts:97`: `Math.abs(loss - mean) < 1e-6` | ✅ |
| AC3 (TMP-13): só voltas do mesmo traçado | só o `layoutId` da âncora | `test/lapInsight.test.ts:149-153`; tela: `test/insightsScreen.test.ts:12-18` | ✅ |

### P3: Timestamp no segundo cheio (TMP-14)

| Critério | Resultado da spec | `arquivo:linha` + asserção | Resultado |
| -------- | ----------------- | -------------------------- | --------- |
| AC1: fix em .000 com sub-segundo no lote mantém o original | …49.900, …50.000, …50.100 | `test/locationHandler.test.ts:165` (`deepEqual` exato) | ✅ |
| AC2: tudo quantizado mantém o horário de chegada a 100 ms | `NOW − 200, NOW − 100, NOW…` | `test/locationHandler.test.ts:184` | ✅ |
| AC3: estritamente crescente na gravação | `t[i] > t[i−1]` | `test/locationHandler.test.ts:204`; reset por gravação: `src/recording/locationTask.ts:37-40`, chamado só no `start()` (`src/hooks/useLapRecorder.ts:376`) | ✅ |

**ACs testáveis em Node**: 27/27 com evidência que mira o valor da spec. Os dois ❌ são defeitos de consumidores achados na inspeção, não falta de teste nas funções.

---

## Edge cases

- [x] **Parar na linha e sair de novo**: um cruzamento só. `test/lapDetector.test.ts:178` (jitter de ±0,3 m) e `:313` (60 s parado, jitter de ±3 m que soma > 300 m, trava de 30 m em `src/lib/lapDetector.ts:174,191`).
- [x] **GPS perde sinal no cruzamento (> 2 s)**: `test/startLine.test.ts:64-67` (2001 ms nulo, 2000 ms cruza); `test/lapDetector.test.ts:210-216` (a volta segue até o próximo cruzamento, abaixo de 180 s). O ramo acima de 180 s é coberto por `test/recovery.test.ts:191` e `test/liveLapClock.test.ts:145`.
- [x] **Traçado com menos de 5 pontos ou comprimento zero**: `test/startLine.test.ts:72-74`, `test/sectors.test.ts:139`. No app, `app/recording.tsx:165` e `lineFromLayout` nulo desligam linha e setores.
- [x] **1ª volta é a melhor**: sem regra especial; a 1ª volta é medida como as outras (`test/lapDetector.test.ts:106,114`).

## Success Criteria

- [x] **GPX de bancada sem tempos em 00 ms**: `test/lapDetector.test.ts:256`. As três voltas saem 49.776, 49.968 e 50.037 ms (dt de 200 ms no GPX). ⚠️ A asserção usa `some` e não `every`: pegaria o arredondamento total, mas não uma volta isolada presa em 00 ms.
- [ ] **Setores do cockpit, do painel e da análise batem até 20 ms**: provado para a função (`test/sectors.test.ts:102`) e por construção no hook e na sessão; o painel é UAT. A tela "Comparar voltas" mostra outros números (defeito 1).
- [x] **`docs/telemetria.md` com as regras novas**: linha com sentido (`docs/telemetria.md:109-114`), interpolação (`:135-149`), terços (`:203-206`), p99.

---

## AD-006 nos consumidores

| Consumidor | Onde | Usa as fronteiras e a régua única? |
| ---------- | ---- | ---------------------------------- |
| Detector e recorte | `src/lib/lapDetector.ts`, `src/recording/finishSession.ts:39-55` | ✅ `[startCross, internos, endCross]`, ambos `synthetic` |
| "Encerrar" e recuperação | `src/hooks/useLapRecorder.ts:716-721`, `src/recording/recovery.ts:64,92` | ✅ mesma linha da meta |
| Cronômetro ao vivo | `src/recording/liveLapClock.ts:41-43`, hook `:597` | ✅ conta de `openCross` (inclusive depois do box) |
| Setores ao vivo e publicação | hook `:559-561,614-630`; `app/recording.tsx:333-335,368-378` | ✅ `sliceLaps` + `sectorSplits` |
| Referência do delta | `src/recording/liveLapClock.ts:51-57`, hook `:587-588` | ✅ volta com fronteiras |
| Reset do delta na volta nova | hook `:515-516` | ❌ só quando uma volta **fecha**; depois de um box (volta descartada por > 180 s) o `resetLap()` não roda (defeito 2) |
| Análise da sessão | `app/session/[id].tsx:358-364` | ✅ `sectorSplits` contra o traçado ou a melhor volta; `groupThirds` saiu |
| Pico na sessão, mapa, home, IA, insights | `app/session/[id].tsx:581,639-640,1332-1333`; `app/(tabs)/index.tsx:77-78`; `src/recording/postSave.ts:143-144`; `src/lib/lapInsight.ts:73-74` | ✅ p99; nenhum laço de máximo bruto restante em `app/` e `src/` (fora `peakSpeedInSectorMs`, que a spec deixa de fora) |
| Limpeza de pontos | `src/lib/analysis.ts:308` | ✅ preserva `synthetic` |
| Insights, DNA, coach | `src/lib/lapInsight.ts:47-51`, `src/lib/pilotDna.ts:114`, `src/lib/coachContext.ts:75` | ✅ via `cleanSamples`, que mantém as fronteiras |
| Replay | `app/replay/[id].tsx:186,355` | ✅ usa `durationMs` e os pontos salvos |
| **Comparar voltas** | `src/lib/lapCompare.ts:146-166`, tela `app/lap-compare.tsx:185-187` | ❌ S1/S2/S3 ainda somam 7/7/6 dos 20 mini-setores (defeito 1) |
| Mapa detalhado | `app/track-map.tsx:112-121` | ⚠️ régua própria, quebrada com as fronteiras; hoje sem rota que chegue a ela (defeito 4) |

---

## Discrimination Sensor

Scratch: `git worktree add --detach` em `…/scratchpad/sensor-wt` (HEAD `43c26e4`) com symlink de `node_modules`; cada mutação aplicada por troca exata de texto, `npm test` no scratch e `git checkout` do arquivo no scratch. Sem `git stash`. Baseline do scratch antes das mutações: 126/126.

| # | `arquivo:linha` | Mutação | Testes que falharam | Morto? |
| - | --------------- | ------- | ------------------- | ------ |
| M01 | `src/lib/startLine.ts:89` | `crossing` aceita os dois sentidos | 2 (contramão no `crossing` e no `detectLaps`) | ✅ |
| M02 | `src/lib/startLine.ts:94` | meia-largura 15 m → 17 m | 1 (16 m não cruza) | ✅ |
| M03 | `src/lib/startLine.ts:21` | buraco máximo 2 s → 2,5 s | 2 | ✅ |
| M04 | `src/lib/startLine.ts:97` | instante = `b.t` (sem interpolar) | 16 | ✅ |
| M05 | `src/lib/lapDetector.ts:191` | sem a trava de saída de 30 m | 1 (kart parado 60 s) | ✅ |
| M06 | `src/lib/lapDetector.ts:196` | regra dos 180 s vira 360 s | 2 (box e recuperação) | ✅ |
| M07 | `src/lib/lapDetector.ts:215` | `openCross` = `endCross` da última volta (ignora o box) | 1 | ✅ |
| M08 | `src/recording/finishSession.ts:48` | fim da volta = ponto cru depois da linha | 8 | ✅ |
| M09 | `src/lib/sectors.ts:66` | limites em 7/20 e 14/20 | 4 | ✅ |
| M10 | `src/lib/realtimeDelta.ts:129` | `resetLap` com hint `undefined` | 1 | ✅ |
| M11 | `src/lib/speed.ts:29` | máximo em vez do p99 | 5 (speed, postSave, lapInsight) | ✅ |
| M12 | `src/lib/speed.ts:25` | filtro de precisão 10 m → 11 m | 1 | ✅ |
| M13 | `src/lib/lapInsight.ts:114` | denominador volta a ser todas as voltas | 1 | ✅ |
| M14 | `src/lib/lapInsight.ts:48` | sem `cleanSamples(10)` | 1 | ✅ |
| M15 | `src/lib/lapInsight.ts:60` | `lapsForInsight` sem o filtro de traçado | 1 | ✅ |
| M16 | `src/recording/locationHandler.ts:56` | `trustsRaw` nunca liga | 6 | ✅ |
| M17 | `src/recording/locationHandler.ts:66` | sem `max(t, lastT + 1)` | 1 | ✅ |
| M18 | `src/lib/analysis.ts:308` | `cleanSamples` remove os sintéticos | 2 | ✅ |
| M19 | `src/recording/liveLapClock.ts:42` | relógio no 1º ponto cru depois do cruzamento | 3 | ✅ |
| M20 | `src/lib/lapDetector.ts:157` | 1ª volta sem traçado abre no ponto cru seguinte ao de ritmo | 9 | ✅ |
| M21 | `src/lib/sectors.ts:79` | S3 da volta fechada pelo map matching, não pela fronteira | 5 | ✅ |

**Sensor**: 21 mutações, 21 mortas, 0 sobreviveram. Profundidade P0 (núcleo de tempo).
**Isolamento**: `git status --porcelain` antes = depois = `?? CockPit-Guia-do-Testador.pdf`. Worktree removido com `git worktree remove --force` e `git worktree prune`; o `stash@{0}` do usuário não foi tocado.

---

## Defeitos da inspeção (em ordem de gravidade)

### 1. "Comparar voltas" ainda mostra S1/S2/S3 pela régua 7/7/6 (❌ TMP-07 AC 1, AD-006)

- **Onde**: `src/lib/lapCompare.ts:146-166`, exibido em `app/lap-compare.tsx:185-187`. A tela abre pelo botão da sessão (`app/session/[id].tsx:535-548`).
- **O que acontece**: `compareLaps` soma os 20 mini-setores de `analyzeLap` em grupos de 7/7/6, a régua que o problema 3 da spec manda aposentar ("os 20 mini-setores ficam só como régua interna"). Não usa `sectorSplits`.
- **Prova** (sonda em scratch, pista sintética de 37.699 ms com traçado): para a mesma volta, `sectorSplits` dá 12.558 / 12.583 / 12.558 ms; o "Comparar voltas" dá **13.135 / 13.209 / −26.344 ms**. O S3 negativo já existia com pontos crus (antes da feature o negativo caía no S1: −24.499 / 13.175 / 11.325), mas a diferença de régua (7/20 ≠ 1/3) é da feature não ter migrado este consumidor.
- **Correção**: `compareLaps` calcula S1/S2/S3 com `sectorSplits(lapA.samples, ref)` e `sectorSplits(lapB.samples, ref)`, sobre os pontos salvos (sem o `cleanSamples`, como a sessão faz). Teste unitário: `compareLaps(...).sectors[k].aMs` igual a `sectorSplits(...)` (≤ 20 ms) e S1+S2+S3 = duração ± 1 ms.

### 2. Volta depois do box: o delta ao vivo casa no fim do traçado (❌ TMP-10 AC 6, AD-006)

- **Onde**: `src/hooks/useLapRecorder.ts:515-516`. `tracker.resetLap()` só roda quando `detection.laps` cresce. Depois de um box, a volta anterior é descartada (> 180 s) e a nova volta abre em `openCross` (T20), mas nenhuma volta fechou, então o hint do `DeltaTracker` não volta ao segmento 0.
- **Prova** (sonda em scratch que repete a lógica do poll do hook sobre o cenário de box do `test/liveLapClock.test.ts`): nos dois primeiros polls da volta depois do box, `sCurrent = 751,8 m = L` (`sNormalized = 1,000`) e `deltaMs = null`; só no 3º poll volta a s ≈ 25 m. Com `resetLap()` quando `openCross.t` muda, o 1º poll já sai com s = 5,6 m. O cronômetro e os setores dessa volta estão certos; só o delta erra por ~1 s.
- **Correção**: no poll, chamar `tracker.resetLap()` quando `detection.openCross?.t` mudar em relação ao poll anterior (e não só quando uma volta fecha). Teste estático no `test/lapRecorderHook.test.ts`, ou extrair a decisão para uma função pura testável.

### 3. Antes do 1º cruzamento, o cockpit e o painel mostram o tempo da sessão como se fosse volta (menor, UAT)

- **Onde**: `app/recording.tsx:599` e `:322`: `info.currentLapElapsedMs ?? info.elapsedMs`. O fallback é antigo (c4a91ad), mas a T19 passou a devolver `null` durante todo o trecho antes do 1º cruzamento, com a intenção declarada de que "o cronômetro não corre". Na tela ele corre, a partir do início da sessão, e zera no cruzamento.
- **Correção**: com `currentLapElapsedMs === null`, mostrar "—" no cockpit e publicar `null` para a equipe. Entra no roteiro de UAT (passo 1).

### 4. Mapa detalhado com régua própria, quebrada pelas fronteiras (latente)

- **Onde**: `app/track-map.tsx:112-121` tem outra implementação de terços (`interpolateT` local, sem tratar o 1º ponto casado em s = L).
- **Prova** (sonda): com as voltas novas (fronteira na linha), a tela daria **0 / 0 / 51 ms**; com pontos crus, dava ~12.508 / 12.583 / 12.610. É regressão causada pelos pontos de fronteira.
- **Por que não reprova sozinho**: nenhuma rota chega a `/track-map` hoje (`onOpenDetailedMap` nunca é passado em `app/session/[id].tsx`, e não há `router.push` para ela). Migrar para `sectorSplits` ou remover na `produto-limpo`.

### Observações sem defeito

- `trustsRaw` liga se qualquer fix do lote tem sub-segundo, mesmo um que depois é descartado por precisão acima de 30 m (`src/recording/locationHandler.ts:55-57`). Sem efeito prático.
- A régua de setores do hook (`layoutSectorRefRef`) pode mudar no meio da gravação se o traçado for trocado, enquanto a linha fica a do `start()`. Só com troca de traçado durante a gravação.

---

## Só UAT (pendente)

| AC | Código inspecionado | Passo do roteiro |
| -- | ------------------- | ---------------- |
| TMP-06 (ao vivo) | `src/hooks/useLapRecorder.ts:359,368,471-473,716-721` | 1 |
| TMP-07 AC 2 (HUD) | `src/hooks/useLapRecorder.ts:614-630` | 1 e 2 |
| TMP-08 | `src/hooks/useLapRecorder.ts:559-562`, `app/recording.tsx:368-378` | 2 |
| TMP-09 (ao vivo sem setores) | `src/hooks/useLapRecorder.ts:472,614` | 3 |
| TMP-10 (hook) | `src/hooks/useLapRecorder.ts:515-516,597-604` (defeito 2) | acrescentar: volta depois do box |
| TMP-11 AC 3/4 (telas) | `app/(tabs)/index.tsx:157`, `app/session/[id].tsx:1049,1055` | 5 |
| TMP-05 AC 3 (cronômetro) | `app/recording.tsx:322,599` (defeito 3) | 1 |

---

## Rastreabilidade (proposta; `spec.md` não foi editado)

| Requisito | Status proposto |
| --------- | --------------- |
| TMP-01, TMP-02, TMP-03, TMP-04, TMP-05, TMP-06 | ✅ Verificado (UAT pendente no hook) |
| TMP-07 | ❌ Precisa de correção (defeito 1: "Comparar voltas") |
| TMP-08, TMP-09 | ✅ Verificado na função; UAT pendente |
| TMP-10 | ❌ Precisa de correção (defeito 2: box) |
| TMP-11, TMP-12, TMP-13, TMP-14 | ✅ Verificado |

---

## Fix Plans

1. **Fix 1 (Major)**: `compareLaps` pela régua única. Where: `src/lib/lapCompare.ts`. Done when: teste em `test/lapCompare.test.ts` com `sectors[k].aMs/bMs` = `sectorSplits` (≤ 20 ms) e soma = duração ± 1 ms; nenhum agrupamento 7/7/6 no arquivo.
2. **Fix 2 (Minor, mas viola AC)**: `resetLap()` quando `openCross` muda sem volta fechada. Where: `src/hooks/useLapRecorder.ts`. Done when: teste que prova que, no cenário de box, o 1º ponto da volta nova casa com `sNormalized < 0,05`.
3. **Fix 3 (Minor)**: "—" em vez de `elapsedMs` antes do 1º cruzamento. Where: `app/recording.tsx:322,599`.
4. **Fix 4 (Cosmetic/latente)**: `app/track-map.tsx` para `sectorSplits`, ou remoção na `produto-limpo`.

## Summary

**Overall**: ❌ Not Ready
**Spec-anchored check**: 27/27 ACs testáveis com evidência que mira o valor da spec; 1 lacuna de precisão menor (GPX com `some`).
**Sensor**: 21/21 mutações mortas.
**Gate**: 126 passam, 0 falham; typecheck só com a baseline.
**O que funciona**: detector, linha, fronteiras, régua `sectorSplits`, pico p99, insights, relógio `trustsRaw` e a fiação da sessão, da home, da IA, da recuperação e do "Encerrar".
**O que falta**: defeitos 1 e 2 (caminhos alcançáveis que violam TMP-07 AC 1 e TMP-10 AC 6) e a UAT no aparelho.
