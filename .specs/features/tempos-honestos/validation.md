## Validation (rodada 4): tempos honestos — FAIL ❌

**Data**: 2026-10-03
**Spec**: `.specs/features/tempos-honestos/spec.md` (TMP-01 a TMP-14, edge cases, Success Criteria e a Assumption de 30/09 sobre "ATUALIZAR REFERÊNCIA")
**Decisão**: AD-006 (`.specs/STATE.md`)
**Faixa de commits**: `13c72ab..c9c6ebf` (branch `feat/tempos-honestos`). As correções desta rodada são a T27 (`1989599`) e a T28 (`c9c6ebf`), da Phase 6 de `tasks.md`.
**Verificador**: sub-agente independente da rodada 4, autorizada pela Julia depois de a rodada 3 escalar (autor ≠ verificador). Re-derivou tudo do zero; o relatório da rodada 3 serviu só para saber o que foi reprovado. Não alterou código, testes nem commits; só este arquivo.

**Motivo do FAIL, em uma linha**: as duas reprovações da rodada 3 fecharam no caminho principal (o M04 morre, e "ATUALIZAR REFERÊNCIA" cria um traçado novo e deixa o anterior intacto), e os gates passam. Mas 3 de 22 mutantes sobrevivem: uma variante do M04 na sessão (M02), a mutação do traçado de entrada (M06) e o handler que torna padrão o traçado antigo (M09). Além disso, a sessão gravada sem `layoutId` (as sessões anteriores à migração v1 e o "Velocímetro (demo)") segue o traçado padrão da pista, e a T28 troca esse padrão. Essas sessões não ficam presas ao traçado com que foram gravadas, como pede a Assumption de 30/09.

---

## O que a rodada 3 reprovou

| # | Item | Tarefa | Situação | Evidência |
| - | ---- | ------ | -------- | --------- |
| 1 | Mutante M04: a sessão pode medir S1/S2/S3 sobre `cleanSamples(10)` sem que a suíte falhe | T27 | ✅ **Morto** (aqui é o M01) | `test/sessionScreen.test.ts:34-37` (`savedSamples[l.id] = sectorLapSamples(l)`), `:38` (nenhum `cleanSamples` no argumento), `:41` (`sectorSplits(sectorSamples[selected.id]`). O mapa detalhado tem a mesma guarda (`test/trackMapScreen.test.ts:28-29`, `app/track-map.tsx:118-119`), e a variante no mapa também morre (M03). **Uma variante na sessão sobrevive (M02, defeito 1a)** |
| 2 | "ATUALIZAR REFERÊNCIA" sobrescrevia o traçado e mudava de 75 a 139 ms os setores já vistos | T28 | ✅ **Caminho principal ok** · ❌ caminho de sessão sem `layoutId` (defeito 2) | `src/lib/referenceLayout.ts:29-47` (id `layout_<id da volta>`, nome com a data, `isDefault: true`, pontos com fronteiras); `app/recording.tsx:916-919` (`saveLayout(next)` + `setDefaultLayout(next.trackId, next.id)`). Testes: `test/referenceLayout.test.ts:54-61`, `:72`, `:75-82`; `test/recordingScreen.test.ts:46-50` |

**Assumption de 30/09, item por item** (traçado novo com id novo, padrão da pista, nome com data, sessões antigas no traçado antigo, pontos com fronteiras):

| Item | Código | Teste | Situação |
| ---- | ------ | ----- | -------- |
| Traçado **novo** (id diferente do anterior) | `src/lib/referenceLayout.ts:37` | `test/referenceLayout.test.ts:54` (`notEqual(next.id, reference.id)`); M04 morto | ✅ |
| Vira o **padrão** da pista | `src/lib/referenceLayout.ts:45`; `app/recording.tsx:919` | `test/referenceLayout.test.ts:57` (`isDefault === true`; M05 morto). Handler: `test/recordingScreen.test.ts:49` só confere que `setDefaultLayout(` existe, **não os argumentos: M09 sobrevive** | ✅ função · ❌ guarda do handler |
| **Nome** = anterior + data | `src/lib/referenceLayout.ts:14,17-21,35,39` | `test/referenceLayout.test.ts:56` (`'Layout principal · 30/09'`), `:72` (troca a data em vez de empilhar) | ✅ (ver observação 3) |
| O traçado **anterior não muda** | a função não escreve na entrada; o handler grava só `next` | `test/referenceLayout.test.ts:75-82`, mas o fixture `reference` é compartilhado e o 1º teste já o passou para a função: **uma mutação idempotente da entrada sobrevive (M06)**. Handler: `test/recordingScreen.test.ts:47` (`saveLayout({ ...reference` ausente; M08 morto) | ❌ guarda da função |
| **Sessões antigas** presas ao traçado com que foram gravadas | sessão com `layoutId` lê o próprio traçado (`app/session/[id].tsx:229-230`), que a T28 não toca; **sessão com `layoutId` nulo cai no padrão** (`app/session/[id].tsx:232-233`) | – (o caminho com `layoutId` nulo não tem teste) | ✅ com `layoutId` · ❌ sem `layoutId` (defeito 2) |
| Pontos com as **fronteiras sintéticas** (AD-006) | `src/lib/referenceLayout.ts:40` (`[...best.samples]`; `best` vem de `outcome.saved.laps`, `app/recording.tsx:499-505`, que é o `sliceLaps` sem filtro, `src/recording/finishSession.ts:62-71`) | `test/referenceLayout.test.ts:59-61` (`deepEqual` com a volta, `synthetic` nas duas pontas); M07 morto | ✅ |

---

## Gates

| Gate | Comando | Saída |
| ---- | ------- | ----- |
| Testes | `npm test` (árvore real) | **143 testes, 143 passam, 0 falhas, 0 pulados, 0 cancelados** (exit 0) |
| Typecheck | `npm run typecheck` (tsc, árvore real, exit 2) | **Só a baseline**: exatamente os 8 erros aceitos: `app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`. Nenhum erro novo |
| Contagem | antes da feature: 62; rodada 1: 126; rodada 2: 134; rodada 3: 137 | agora: 143 (+6: 2 da T27 em `test/sessionScreen.test.ts` e `test/trackMapScreen.test.ts`; 4 da T28, 3 em `test/referenceLayout.test.ts` e 1 em `test/recordingScreen.test.ts`). Nenhum teste removido, nenhuma asserção afrouxada (`git diff c6cb802..HEAD -- test` só adiciona linhas) |
| Tarefas | `tasks.md` | T1–T28 com todos os "Done when" marcados (107 `[x]`, nenhum `- [ ]`) |

---

## Checagem ancorada na spec

Legenda: ✅ a asserção mira o valor da spec · 🟡 só UAT (pendente), com o código inspecionado · ⚠️ lacuna de precisão da spec. Os testes fora de `sessionScreen`, `trackMapScreen`, `recordingScreen` e `referenceLayout` não mudaram desde a rodada 3 (`git diff c6cb802..HEAD -- test`); as linhas abaixo foram conferidas de novo no arquivo.

### P1: Tempo de volta com o milésimo real (TMP-01, TMP-02, TMP-03)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: instante por interpolação linear entre os pontos de cada lado | `t = t_a + f·(t_b − t_a)` | `test/startLine.test.ts:36-41`: `Math.abs(c.f - 0.25) < 1e-9`, `Math.abs(c.t - 10_025) < 1e-6`, ponto interpolado sobre a linha | ✅ |
| AC2: 10 Hz, \|duração − D\| ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:104-107`: 6 voltas, `assertLapsWithin(..., D, '10 Hz')` com `TOL_MS = 20` | ✅ |
| AC3: 5 Hz, ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:112-115` | ✅ |
| AC4 (TMP-02): 1ª volta pela mesma regra | ≤ 20 ms, inclusive a 1ª | `test/lapDetector.test.ts:106,114` (a 1ª volta entra no laço), `:136` (com traçado, 10 e 5 Hz) | ✅ |
| AC5: passar perto sem cruzar | `null` | `test/startLine.test.ts:59-60` | ✅ |
| AC6: contramão não fecha | `null` / 0 voltas | `test/startLine.test.ts:47`; `test/lapDetector.test.ts:194` | ✅ |
| AC7: 300 m, 25–180 s, uma volta por cruzamento | limites exatos | `test/lapDetector.test.ts:224` (`>= 25_000`), `:237` (`>= 300`); 180 s: `test/liveLapClock.test.ts:141-148`, `test/recovery.test.ts:191`; um cruzamento: `test/lapDetector.test.ts:178,313` | ✅ |
| Meia-largura de 15 m (Assumptions) | 16 m não cruza, 14 m cruza | `test/startLine.test.ts:51-55` | ✅ |
| Independent test: 37.699 ms a 10 Hz | ± 20 ms em todas | `test/lapDetector.test.ts:104-107` | ✅ |

### P1: Uma linha só por traçado (TMP-04, TMP-05, TMP-06)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-04): com traçado, 1º ponto e rumo do traçado | ponto = `layout[0]`, rumo ± 1° | `test/startLine.test.ts:83-86` | ✅ |
| AC2 (TMP-04): sem traçado, ponto de ritmo e rumo do movimento | idem | `test/startLine.test.ts:92-95` | ✅ |
| AC3 (TMP-05): começa andando, 1ª volta no 1º cruzamento | trecho anterior não é volta | `test/lapDetector.test.ts:129-136` (`laps.length === 3` com 4 passagens, `startCross` a ≤ 20 ms do 1º cruzamento); relógio `null` antes: `test/liveLapClock.test.ts:42-51`; tela e publicação: `test/recordingScreen.test.ts:36-44` | ✅ (+ 🟡 tela) |
| Independent test: gravações que começam em pontos diferentes | mesmo cruzamento e tempo ± 20 ms | `test/lapDetector.test.ts:149-152` | ✅ |
| AC4 (TMP-06): mesma linha no ao vivo, no "Encerrar" e na recuperação | a linha do traçado | Recuperação: `test/recovery.test.ts:241-263`; "Encerrar": `test/finishRecording.test.ts:139`; diário antigo: `test/recovery.test.ts:265`; hook (estático): `test/lapRecorderHook.test.ts:24-31`. O hook não mudou desde a rodada 3 | ✅ (+ 🟡 hook) |

### P1: S1/S2/S3 iguais em todo lugar (TMP-07, TMP-08, TMP-09, TMP-10)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-07): terços do comprimento do traçado | D/3 ± 20 ms; por distância | `test/sectors.test.ts:42-54` (10 e 5 Hz); velocidade variável: `:130-135` (16.667 / 13.333 / 10.000). Consumidores: comparação `test/lapCompare.test.ts:35-58`, mapa `test/trackMapScreen.test.ts:13-30`, sessão `test/sessionScreen.test.ts:18-42` | ✅ |
| AC2 (TMP-07): ao vivo pelo instante interpolado, não pelo poll | sem marcação por poll | `src/lib/sectors.ts:75-86`; `test/lapRecorderHook.test.ts:18-22` (sem `sectorBoundaryTsRef`); `test/liveLapClock.test.ts:170` (volta em curso por `openCross`) | ✅ (+ 🟡 HUD) |
| AC3 (TMP-07): análise ≤ 20 ms do ao vivo | ≤ 20 ms | Função: `test/sectors.test.ts:102` (`Math.abs(va - vb) <= TOL_MS`). Comparação: `test/lapCompare.test.ts:132-133` (`<= 20`, 10 e 5 Hz com fixes ruins) e `test/lapCompareScreen.test.ts:13-23`. Sessão: `test/sessionScreen.test.ts:31-42` (M01 morto), **mas a variante M02 sobrevive (defeito 1a)**. Mapa: `test/trackMapScreen.test.ts:17,24-30` (M03 morto). Depois de "ATUALIZAR REFERÊNCIA", a sessão com `layoutId` mede contra o traçado antigo, o mesmo do ao vivo; **sem `layoutId`, mede contra o novo (defeito 2)** | ✅ comportamento no caminho principal · ❌ discriminação na sessão · ❌ sessão sem `layoutId` |
| Independent test: S1+S2+S3 = duração ± 1 ms | ± 1 ms | `test/sectors.test.ts:64`; volta limpa: `test/analysis.test.ts:67`; comparação: `test/lapCompare.test.ts:56-57` | ✅ |
| AC4 (TMP-08): publicar os mesmos S1/S2/S3 | os do fechamento | `src/hooks/useLapRecorder.ts:568-573` → `app/recording.tsx:368-378` (`publishLap`) | 🟡 só UAT (passo 2) |
| AC5 (TMP-09): sem traçado, análise pela melhor volta; ao vivo sem setores | régua = melhor volta | Análise: `test/sectors.test.ts:108-135`, `test/sessionScreen.test.ts:24-29`. Ao vivo: `src/hooks/useLapRecorder.ts:476` (`sectorRef` só com linha) | ✅ análise · 🟡 ao vivo |
| AC6 (TMP-10): delta projeta o 1º ponto em s ≈ 0 | `sNormalized < 0,05` | Função: `test/realtimeDelta.test.ts:30`. Hook, inclusive depois do box: `test/liveLapClock.test.ts:237-246` e `:248` (estático, `resetLap` só sob `lapOpened`) | ✅ (+ 🟡 hook) |

### P2: Pico de velocidade (TMP-11)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: p99 dos pontos com precisão ≤ 10 m | nearest-rank; 10 m entra, 10,5 m não | `test/speed.test.ts:39,41` (`=== 198`, `=== 149`), `:50` (`=== 20`) | ✅ |
| AC2: um ponto a 150 km/h em ~80 km/h | < 81 km/h | `test/speed.test.ts:33` (`msToKmh(peak) < 81`) | ✅ |
| AC3: mesmo cálculo na sessão, home, pós-salvamento e insights | p99 em todos | `test/postSave.test.ts:185`; `test/lapInsight.test.ts:171`; `test/homeScreen.test.ts:21-24`; `test/sessionScreen.test.ts:44-52` | ✅ |
| AC4: sem ponto bom, `null` e "—" | `null`, "—" | `test/speed.test.ts:51-52,60-61`; `test/postSave.test.ts:175`; `test/homeScreen.test.ts:21-24`; `test/sessionScreen.test.ts:51` | ✅ (+ 🟡 telas) |

### P2: Insights (TMP-12, TMP-13)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-12): `cleanSamples(10)` e `repairDegenerateTimestamps` | reparada ± 20 ms; fix > 10 m fora | `test/lapInsight.test.ts:104` (`<= 20`), `:124-130` | ✅ |
| AC2 (TMP-12): volta inválida fora do denominador | média exata das 3 boas | `test/lapInsight.test.ts:97` (`Math.abs(loss - mean) < 1e-6`) | ✅ |
| AC3 (TMP-13): só voltas do mesmo traçado | `layoutId` da âncora | `test/lapInsight.test.ts:149-152`; tela: `test/insightsScreen.test.ts:12` | ✅ |

### P3: Timestamp no segundo cheio (TMP-14)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: fix em .000 num lote com sub-segundo mantém o original | …49.900, …50.000, …50.100 | `test/locationHandler.test.ts:165` (`deepEqual` exato) | ✅ |
| AC2: tudo quantizado mantém o horário de chegada a 100 ms | `NOW − 200, NOW − 100, NOW…` | `test/locationHandler.test.ts:184-185` | ✅ |
| AC3: estritamente crescente | `t[i] > t[i−1]` | `test/locationHandler.test.ts:194,201,204` | ✅ |

**ACs testáveis em Node**: 28/28 com evidência que mira o valor da spec. Os ❌ não são falta de teste de função: são guardas que deixam passar mutantes (defeito 1) e o caminho da sessão sem `layoutId` (defeito 2).

---

## Edge cases

- [x] **Parar na linha e sair de novo**: um cruzamento só. `test/lapDetector.test.ts:178` e `:313` (60 s parado, jitter de ±3 m que soma mais de 300 m; trava de 30 m em `src/lib/lapDetector.ts:191`; M12 morto).
- [x] **GPS perde sinal no cruzamento (> 2 s)**: `test/startLine.test.ts:64-67` (2001 ms dá nulo, 2000 ms cruza); `test/lapDetector.test.ts:209-216`; acima de 180 s: `test/recovery.test.ts:191`, `test/liveLapClock.test.ts:141`.
- [x] **Traçado com menos de 5 pontos ou comprimento zero**: `test/startLine.test.ts:70-74`, `test/sectors.test.ts:139-140`.
- [x] **1ª volta é a melhor**: sem regra especial (`test/lapDetector.test.ts:106,114`).

## Success Criteria

- [x] **GPX de bancada sem tempos em 00 ms**: `test/lapDetector.test.ts:255-258`, com `every`. Discrimina: o M22 (só a 3ª volta presa a 100 ms) morre.
- [x] **Setores do cockpit, do painel e da análise batem até 20 ms**: na função (`test/sectors.test.ts:102`), na comparação (`test/lapCompare.test.ts:132-133`) e na sessão com `layoutId` mesmo depois de "ATUALIZAR REFERÊNCIA". Ressalvas: o painel é UAT (passo 2), e a sessão sem `layoutId` muda de régua depois da troca (defeito 2).
- [x] **`docs/telemetria.md` com as regras novas**: sentido (`docs/telemetria.md:109-114`), interpolação (`:135-149`), terços (`:203-206`), p99 (`:299`).

---

## AD-006 nos consumidores

Grep em `app/` e `src/` por `sectorSplits(`, `sectorLapSamples(`, `s1Ms`, `cleanSamples`, `saveLayout(`, `setDefaultLayout`, `getDefaultLayoutForTrack`. Desde a rodada 3, só mudaram `app/track-map.tsx`, `app/recording.tsx` e o novo `src/lib/referenceLayout.ts`.

| Consumidor | Onde | Pontos | Régua | Situação |
| ---------- | ---- | ------ | ----- | -------- |
| Detector e recorte | `src/lib/lapDetector.ts`, `src/recording/finishSession.ts:40-54` | fronteiras `synthetic` no cruzamento | linha única | ✅ |
| "Encerrar" e recuperação | `src/hooks/useLapRecorder.ts`, `src/recording/recovery.ts` | `sliceLaps` | linha da meta | ✅ |
| Cronômetro e reset do delta | `src/recording/liveLapClock.ts:35-58` | `openCross` | – | ✅ |
| Setores ao vivo (fechamento e publicação) | `src/hooks/useLapRecorder.ts:568-573`; `app/recording.tsx:368-378` | `sliceLaps` do poll, crus | `referenceFromLayout` | ✅ |
| Sessão | `app/session/[id].tsx:265-272,358-364` | `sectorLapSamples(l)` sobre `lapsRaw` | traçado da sessão; sem `layoutId`, o padrão da pista; sem traçado, a melhor volta | ✅ comportamento · guarda incompleta (M02) · ❌ sem `layoutId` (defeito 2) |
| Comparar voltas | `app/lap-compare.tsx:80-111`, `src/lib/lapCompare.ts:151-152` | `sectorLapSamples(saved)` | traçado da sessão A (só compara voltas da mesma sessão, `app/session/[id].tsx:541-547`) | ✅ |
| Mapa detalhado | `app/track-map.tsx:115-119` | `sectorLapSamples(lap)` (T27; o inline saiu) | `referenceFromLayout` | ✅ (sem rota; observação 6) |
| **Traçado novo ("ATUALIZAR REFERÊNCIA")** | `src/lib/referenceLayout.ts:40`, `app/recording.tsx:916-919` | os pontos da melhor volta salva, com as fronteiras | – | ✅ (pontos) · guarda do handler incompleta (M09) |
| Pico (sessão, home, IA, insights) | `app/session/[id].tsx`, `app/(tabs)/index.tsx`, `src/recording/postSave.ts`, `src/lib/lapInsight.ts` | p99 | – | ✅ |
| Limpeza de pontos | `src/lib/analysis.ts:307-308` | preserva `synthetic` | – | ✅ |
| Coach e prompt da IA | `src/lib/coachContext.ts`, `src/lib/analysisPrompt.ts` | 20 mini-setores só como zonas | – | ✅ |
| `src/lib/insights.ts` | – | – | – | fora do escopo (código morto, vai para `produto-limpo`) |

Nenhum consumidor descarta os pontos de fronteira nem mede S1/S2/S3 sobre outra régua no caminho principal. O que falha é guarda (defeito 1) e a escolha do traçado quando a sessão não tem `layoutId` (defeito 2).

---

## Discrimination Sensor

**Scratch**: `git worktree add --detach` em `…/scratchpad/sensor-wt4` (HEAD `c9c6ebf`), com symlink de `node_modules`. Cada mutação por troca exata de texto (uma ocorrência, conferida), `npm test` completo no scratch e `git checkout HEAD -- <arquivo>` no scratch. Baseline do scratch: 143/143. Sem `git stash`.

São 22 mutações, acima da faixa de 12 a 16 pedida, porque a lista obrigatória do orquestrador já tem 20 itens. As outras duas são variantes que procuram buracos nas guardas novas: a M02 (a mesma regressão do M04 por outro caminho) e a M09 (o handler que chama `setDefaultLayout` com o id errado).

| # | `arquivo:linha` | Mutação | Testes que falharam | Morto? |
| - | --------------- | ------- | ------------------- | ------ |
| M01 | `app/session/[id].tsx:267` | M04 da rodada 3: `sectorLapSamples({ ...l, samples: cleanSamples(l.samples, 10) })` | 1 (`test/sessionScreen.test.ts`, guarda da T27) | ✅ |
| **M02** | `app/session/[id].tsx:266` | **variante do M04: o laço dos pontos dos setores percorre `cleanedLaps` em vez de `lapsRaw`** (`cleanSamples(10)` + reparo, o mesmo ponto do M04) | **0** | ❌ **Sobreviveu** |
| M03 | `app/track-map.tsx:118` | mapa detalhado sobre `cleanSamples(10)` | 1 (`test/trackMapScreen.test.ts`) | ✅ |
| M04 | `src/lib/referenceLayout.ts:37` | `nextReferenceLayout` reaproveita o id antigo (`id: reference.id`) | 1 | ✅ |
| M05 | `src/lib/referenceLayout.ts:45` | sem `isDefault` (`false`) | 1 | ✅ |
| **M06** | `src/lib/referenceLayout.ts:35` | **muta o objeto de entrada** (`reference.isDefault = false` antes do `return`) | **0** | ❌ **Sobreviveu** |
| M07 | `src/lib/referenceLayout.ts:40` | sem as fronteiras (`best.samples.filter((s) => !s.synthetic)`) | 1 | ✅ |
| M08 | `app/recording.tsx:918` | handler volta a `saveLayout({ ...reference, samples: best.samples, … })` | 1 (`test/recordingScreen.test.ts`) | ✅ |
| **M09** | `app/recording.tsx:919` | **o handler torna padrão o traçado antigo** (`setDefaultLayout(next.trackId, reference.id)`) | **0** | ❌ **Sobreviveu** |
| M10 | `src/lib/startLine.ts:89` | `crossing` aceita os dois sentidos | 2 (contramão) | ✅ |
| M11 | `src/lib/startLine.ts:97` | instante no ponto mais próximo, sem interpolação | 15 | ✅ |
| M12 | `src/lib/lapDetector.ts:191` | sem a trava de saída de 30 m | 1 (kart parado 60 s) | ✅ |
| M13 | `src/lib/lapDetector.ts:215` | `openCross` = fim da última volta fechada (ignora o box) | 3 | ✅ |
| M14 | `src/recording/finishSession.ts:48` | `sliceLaps` fecha a volta no ponto cru depois da linha | 10 | ✅ |
| M15 | `src/lib/sectors.ts:83` | `sectorSplits`: fração pelo `s` do map matching em vez da corda | 1 (volta "em curso" × "fechada") | ✅ |
| M16 | `src/lib/sectors.ts:45` | `sectorLapSamples` filtra como `cleanSamples(10)` | 2 (`test/lapCompare.test.ts`, 10 e 5 Hz) | ✅ |
| M17 | `src/lib/lapCompare.ts:151-152` | `compareLaps` ignora `saved` (setores sobre `lapA`/`lapB` limpos) | 2 (idem) | ✅ |
| M18 | `src/recording/liveLapClock.ts:57` | `lapOpened` só na 1ª abertura | 2 (abertura pós-box, `sNormalized < 0,05`) | ✅ |
| M19 | `src/lib/speed.ts:29` | pico = máximo em vez do p99 | 5 | ✅ |
| M20 | `src/recording/locationHandler.ts:56` | `trustsRaw` nunca liga | 6 | ✅ |
| M21 | `src/lib/analysis.ts:308` | `cleanSamples` descarta os pontos sintéticos | 2 | ✅ |
| M22 | `src/lib/lapDetector.ts:202` | só a 3ª volta presa a múltiplo de 100 ms (GPX com `every`) | 2 | ✅ |

**Sensor**: 22 mutações, 19 mortas, 3 sobreviveram (M02, M06, M09). Profundidade P0 (núcleo de tempo).

**Por que o M06 sobrevive** (conferido no scratch): rodando só o teste "o traçado anterior não é alterado", o M06 morre (0 passam, 1 falha). Na suíte, o 1º teste do arquivo (`test/referenceLayout.test.ts:51-53`) já passou o `reference` compartilhado pela função mutante; o `structuredClone` do 3º teste (`:76`) fotografa o objeto já alterado, e uma mutação idempotente não aparece.

**Isolamento**: `git status --porcelain` antes = depois = `?? CockPit-Guia-do-Testador.pdf`. Worktree removido com `git worktree remove --force` e `git worktree prune`; `stash@{0}` da usuária intocado; HEAD da árvore real `c9c6ebf`.

---

## Defeitos (em ordem de gravidade)

### 1. Três mutantes sobrevivem às guardas novas (TMP-07 AC 3; Assumption de 30/09)

**a) M02, variante do M04 na sessão.** `app/session/[id].tsx:266` percorre `lapsRaw`. Trocar por `cleanedLaps` (o array de `:243-252`, já com `cleanSamples(10)` e reparo) dá exatamente os pontos do M04, que a rodada 3 mediu em até **280 ms a 10 Hz e 424 ms a 5 Hz** contra o ao vivo. A guarda da T27 (`test/sessionScreen.test.ts:34-41`) confere a forma `sectorLapSamples(l)`, não de onde vem o `l`.
- **Correção (Minor, só teste)**: assertar o laço inteiro, por exemplo `/for\s*\(const l of lapsRaw\)\s*\{\s*savedSamples\[l\.id\]\s*=\s*sectorLapSamples\(\s*l\s*\)/`. Uma opção mais robusta é extrair a montagem para uma função pura testada em Node. Done when: M01 e M02 falham a suíte.

**b) M06, o traçado de entrada pode ser alterado.** O teste de `test/referenceLayout.test.ts:75-82` usa o fixture `reference` do módulo, que o 1º teste já passou para a função. Uma mutação idempotente da entrada (`reference.isDefault = false`, `reference.name = baseName`) não aparece no `structuredClone`.
- **Correção (Minor, só teste)**: congelar o fixture fundo no módulo (`deepFreeze(reference)`; a escrita lança em ESM estrito), ou criar um `reference` novo dentro de cada teste. Done when: o M06 falha a suíte inteira, não só o teste isolado.

**c) M09, o handler pode tornar padrão o traçado antigo.** `test/recordingScreen.test.ts:49` só confere `/await setDefaultLayout\(/`. Com `setDefaultLayout(next.trackId, reference.id)`, o traçado novo é gravado com `is_default = 1`, mas o `UPDATE` em seguida (`src/storage/db.ts:809-815`) zera todos e marca o antigo. O novo não vira o padrão, contra a Assumption.
- **Correção (Minor, só teste)**: assertar `await saveLayout(next);` e `await setDefaultLayout(next.trackId, next.id);` exatos. Done when: M08 e M09 falham a suíte.

### 2. Sessão sem `layoutId` não fica presa ao traçado com que foi gravada (Assumption de 30/09; TMP-07 AC 3)

- **Onde**: a sessão (`app/session/[id].tsx:229-233`), o mapa detalhado (`app/track-map.tsx:83-84`), a comparação (`app/lap-compare.tsx:95-96`) e o coach (`src/lib/coachContext.ts:93`) usam `ses.layoutId`. Quando ele é nulo, caem em `getDefaultLayoutForTrack`. A T28 chama `setDefaultLayout(next.trackId, next.id)` (`app/recording.tsx:919`), então toda sessão daquela pista com `layoutId` nulo passa a medir S1/S2/S3 contra o traçado novo.
- **Quem tem `layoutId` nulo**:
  1. As sessões anteriores à migração v1, que ficaram com `layout_id` nulo de propósito (`src/storage/db.ts:166-170`). O traçado delas virou o "Layout principal" padrão (`src/storage/db.ts:151-161`). Depois de um "ATUALIZAR REFERÊNCIA" na pista, elas passam a ser medidas contra o traçado novo.
  2. A gravação aberta sem o parâmetro `layoutId` numa pista que tem traçado padrão. A tela carrega o padrão como referência (`app/recording.tsx:153-155`), mas grava a sessão com `normalizeId(params.layoutId)` = `null` (`app/recording.tsx:227,427`). O caminho no app é "Velocímetro (demo)" em Ajustes (`app/settings.tsx:206-209`, sem `layoutId`). Se a volta bater a referência e o piloto tocar "ATUALIZAR REFERÊNCIA", a própria sessão abre (`router.replace`) medida contra o traçado novo. É o cenário que a rodada 3 mediu em **75 ms (3 m) e 139 ms (6 m)** contra o ao vivo.
- **Por que reprova**: a Assumption de 30/09 diz que as sessões antigas continuam presas ao traçado com que foram gravadas, e esse caminho existe no app. O fluxo normal (seletor de traçado → preflight → gravação) passa o `layoutId` (`app/track-layouts-picker.tsx:313`, `app/preflight.tsx:59-65`) e está correto.
- **Correção (Minor, código; pede decisão da Julia sobre as sessões legadas)**:
  1. Gravar na sessão o traçado de fato usado: `layoutId: normalizeId(params.layoutId) ?? reference?.id ?? null` na meta do `start()` e no `finishRecording`.
  2. Para as sessões legadas, duas saídas: antes do `setDefaultLayout`, carimbar o id do traçado antigo nas sessões da pista com `layout_id` nulo; ou a Julia declara as legadas fora da Assumption e isso entra na spec.
  3. Done when: há teste de que a sessão sem `layoutId` no parâmetro sai com o id da referência carregada, e um teste ou uma decisão escrita para as legadas.

---

## Só UAT (pendente)

Passos 1 a 6 do Roteiro de UAT de `tasks.md`. O passo 7 não está no Roteiro e precisa entrar para cobrir a T28.

| AC | Código inspecionado | Passo do roteiro |
| -- | ------------------- | ---------------- |
| TMP-05 AC 3 (cockpit "—" antes do 1º cruzamento) e TMP-01 no aparelho | `app/recording.tsx:599,738` | 1. Gravar 3 voltas numa pista com traçado, começando já andando. A 1ª volta só conta no 1º cruzamento, e os tempos não terminam todos em 00 |
| TMP-08 e TMP-07 AC 3 no painel | `src/hooks/useLapRecorder.ts:568-573`, `app/recording.tsx:368-378` | 2. Com a equipe no painel web, o S1/S2/S3 publicado no fechamento é igual ao da análise da sessão (± 0,02 s) |
| TMP-09 (ao vivo sem setores) | `src/hooks/useLapRecorder.ts:476` | 3. Pista sem traçado: a análise mostra S1/S2/S3 pela melhor volta, e o cockpit fica sem setores |
| TMP-03 AC 6 no aparelho | `src/lib/startLine.ts:89` | 4. Passar pela linha na contramão (box): não fecha volta |
| TMP-11 AC 3/4 (telas) | `app/(tabs)/index.tsx`, `app/session/[id].tsx` | 5. A home e a sessão mostram o pico, e "—" quando não há ponto bom |
| TMP-10 e TMP-07 AC 2 (hook, volta depois do box) | `src/hooks/useLapRecorder.ts:516-519,624-640` | 6. Entrar no box por mais de 180 s e voltar: o delta e os setores da volta seguinte começam do zero |
| Assumption de 30/09 ("ATUALIZAR REFERÊNCIA") | `app/recording.tsx:905-925`, `src/lib/referenceLayout.ts` | 7. **(novo)** Numa pista com traçado escolhido no seletor, fazer uma volta mais rápida que a referência e tocar "ATUALIZAR REFERÊNCIA". A sessão abre com os mesmos S1/S2/S3 do cockpit e do painel. No seletor, o traçado "‹nome› · dd/mm" aparece como padrão e o anterior continua na lista. Uma sessão antiga desse traçado mostra os mesmos S1/S2/S3 de antes do toque |

---

## Observações não bloqueantes (seguem abertas)

1. **O traçado novo zera o PB, a sequência e as estatísticas.** O PB é por traçado (`src/storage/db.ts:1031-1043`, `src/recording/postSave.ts:58-62`). Depois de "ATUALIZAR REFERÊNCIA", a 1ª sessão no traçado novo não tem PB anterior. Para `processSessionMilestones`, qualquer volta vira PB nova (`src/lib/gamification.ts:119-120`), com celebração, XP e envio ao leaderboard, mesmo mais lenta que o PB do traçado antigo. Também "Sua volta" (TMP-13) e `getLayoutStats` separam o histórico entre os dois traçados. É consequência da decisão de 30/09, fora dos ACs, mas reabre um "PB falso", que o Problem Statement quer evitar. Precisa de decisão da Julia: herdar o PB, ou aceitar e registrar na spec.
2. **`saveLayout` e `setDefaultLayout` não são atômicos** (`app/recording.tsx:918-919`). Se o app morrer entre os dois, a pista fica com dois traçados `is_default = 1`, e `getDefaultLayoutForTrack` pega um deles por `LIMIT 1` (`src/storage/db.ts:769-771`).
3. **Lacuna de precisão no nome.** A spec diz "o nome do anterior mais a data". A T28 troca a data quando o anterior já termina em ` · dd/mm` (`src/lib/referenceLayout.ts:14,35`). Isso é razoável, mas é uma interpretação. Também tira o sufixo de um nome que o piloto tenha escrito nesse formato, e duas atualizações no mesmo dia geram traçados com o mesmo nome.
4. **Painel web mostra 0 antes do 1º cruzamento, não "—"**: `web-spectator/app/live/[code]/page.tsx:52` e `web-spectator/app/team/[code]/page.tsx:122` (`lastSample?.lapElapsedMs ?? 0`). Vem da rodada 3, sem mudança.
5. **"Lendas" também usa `?? 0`**: `app/legend-race.tsx:116,121`. É anterior à feature.
6. **Mapa detalhado**: não há rota que chegue a ele; ainda usa duas geometrias (setores de `referenceFromLayout(layout.samples)`, rótulos do traçado limpo, `app/track-map.tsx:94-99` contra `:116`). A preparação inline saiu na T27.
7. **Da rodada 1, sem mudança**: `trustsRaw` liga com um fix de sub-segundo que depois é descartado por precisão (`src/recording/locationHandler.ts:55-57`). A régua de setores do hook muda se o traçado for trocado no meio da gravação (`src/hooks/useLapRecorder.ts:781-785`), enquanto a linha fica a do `start()`.
8. **`compareLaps(…, null, …)` não é alcançável** (`app/lap-compare.tsx:97-100`), e o traçado com 5 pontos ou mais e comprimento zero na comparação dá "—" em vez da régua da melhor volta. Na prática, isso é inalcançável.
9. **Os testes da comparação calculam a "sessão" com `sectorSplits(a.samples, ref)`** (`test/lapCompare.test.ts:125-126`), não com `sectorLapSamples`. É equivalente sem timestamps degenerados, que é o caso do teste.

---

## Rastreabilidade (proposta; `spec.md` não foi editado)

| Requisito | Status proposto |
| --------- | --------------- |
| TMP-01, TMP-02, TMP-03, TMP-04 | ✅ Verificado |
| TMP-05, TMP-06 | ✅ Verificado (UAT pendente na tela e no hook) |
| TMP-07 | ❌ Precisa de correção (defeito 1a: guarda da sessão; defeito 2: sessão sem `layoutId` depois de "ATUALIZAR REFERÊNCIA") |
| TMP-08, TMP-09 | ✅ Verificado na função; UAT pendente |
| TMP-10 | ✅ Verificado (UAT pendente no hook) |
| TMP-11, TMP-12, TMP-13, TMP-14 | ✅ Verificado |
| Assumption de 30/09 | ❌ Precisa de correção (defeitos 1b, 1c e 2); UAT pendente (passo 7) |

## Fix Plans

1. **Fix 1 (Minor, só teste)**: fechar as três guardas. Where: `test/sessionScreen.test.ts` (laço sobre `lapsRaw`), `test/referenceLayout.test.ts` (fixture congelado ou novo por teste) e `test/recordingScreen.test.ts` (`saveLayout(next)` e `setDefaultLayout(next.trackId, next.id)` exatos). Done when: M02, M06 e M09 falham a suíte; `npm test && npm run typecheck` só com a baseline.
2. **Fix 2 (Minor, código + decisão)**: a gravação salva o id da referência de fato carregada (`app/recording.tsx:227,427`), e a Julia decide sobre as sessões legadas com `layout_id` nulo: carimbar antes do `setDefaultLayout` ou declarar fora da Assumption. Done when: há teste para a sessão sem `layoutId` no parâmetro, e as legadas têm teste ou decisão escrita na spec.
3. **Decisão da Julia**: o PB depois de "ATUALIZAR REFERÊNCIA" (observação 1).
4. **Roteiro de UAT**: incluir o passo 7.

## Summary

**Overall**: ❌ Not Ready
**Checagem ancorada na spec**: 28/28 ACs testáveis em Node com evidência que mira o valor da spec. Há 3 lacunas de discriminação (M02, M06, M09) e um caminho que viola a Assumption de 30/09 (sessão sem `layoutId`).
**Sensor**: 19/22 mutações mortas; M02, M06 e M09 sobreviveram.
**Gate**: 143 passam, 0 falham; typecheck só com a baseline.
**O que funciona**:
- O M04 da rodada 3 morre, na sessão e no mapa.
- "ATUALIZAR REFERÊNCIA" grava um traçado novo, com id novo, padrão, nome com a data e fronteiras sintéticas, sem tocar o anterior. A sessão gravada pelo seletor continua medida contra o traçado do ao vivo.
- O núcleo inteiro mata os mutantes: linha, sentido, interpolação, trava, box, `sliceLaps`, `sectorSplits`, `compareLaps`, `lapOpened`, p99, `trustsRaw`, `cleanSamples` e GPX.

**O que falta**: as três guardas do defeito 1, o `layoutId` da sessão (defeito 2), a decisão sobre o PB e a UAT no aparelho (7 passos, com o novo passo 7).
