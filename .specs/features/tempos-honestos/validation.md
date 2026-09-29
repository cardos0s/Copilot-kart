## Validation (rodada 3): tempos honestos — FAIL ❌

**Data**: 2026-09-29
**Spec**: `.specs/features/tempos-honestos/spec.md` (TMP-01 a TMP-14, edge cases, Success Criteria)
**Decisão**: AD-006 (`.specs/STATE.md`)
**Faixa de commits**: `13c72ab..c6cb802` (branch `feat/tempos-honestos`). A correção desta rodada é a T26 (`c6cb802`), depois do relatório da rodada 2 (`4d8824e`).
**Verificador**: sub-agente independente da rodada 3 (autor ≠ verificador). Re-derivou tudo do zero; o relatório da rodada 2 serviu só para saber o que foi reprovado. Não alterou código, testes nem commits; só este arquivo.

**Motivo do FAIL, em uma linha**: a lacuna da rodada 2 fechou (comparação × sessão: 0 ms a 10 Hz e a 5 Hz em 1.000 casos com fix ruim), os gates passam e 14 dos 15 mutantes morreram, mas o mutante M04 sobreviveu: a tela de sessão pode voltar a medir S1/S2/S3 sobre `cleanSamples(10)` e nenhum teste falha, e essa troca reabre a divergência de até 280 ms (10 Hz) e 424 ms (5 Hz) contra o ao vivo e a comparação (TMP-07 AC 3).

---

## Lacuna da rodada 2

| # | Lacuna | Tarefa | Situação | Evidência |
| - | ------ | ------ | -------- | --------- |
| 1 | "Comparar voltas" media S1/S2/S3 sobre pontos limpos por `cleanSamples(10)` (65 a 260 ms da sessão) | T26 | ✅ **Fechada** | `src/lib/lapCompare.ts:151-152` (`sectorSplits(sectorLapSamples(saved.a/b), ruler)`), `app/lap-compare.tsx:80-81,111` (as voltas do banco vão como `saved`), `src/lib/sectors.ts:44-46` (`sectorLapSamples` = reparo de timestamp, sem filtro). Testes: `test/lapCompare.test.ts:132-133` (`Math.abs(row.aMs - ea) <= 20`, 10 Hz com fix de 15 m deslocada 5 m em 1/3 e 2/3; 5 Hz com 8 m) e `test/lapCompareScreen.test.ts:15,22`. Sonda própria abaixo: 0 ms |

**Sonda comparação × sessão × ao vivo** (scratch, fora da suíte). Pista sintética de 37.699 ms com traçado, gravação começando andando, 4 voltas. Fixes ruins injetadas na gravação crua da 2ª volta, antes do `sliceLaps`: 1 ou 2 fixes perto de 1/3, de 2/3, de 1/3 e 2/3 juntas, e colados na linha (0,1 % e 99,9 % da volta), com deslocamento de ±5 a ±10 m ao longo da pista e 0 ou 8 m de lado, precisão de 15 m e de 25 m, com cinco posições em volta de cada limite. São 500 casos por taxa. Cada caminho foi montado como no app: ao vivo como o hook (`sliceLaps` do poll seguinte ao cruzamento, régua `referenceFromLayout`); sessão como `app/session/[id].tsx` (voltas depois de ida e volta em JSON, `sectorLapSamples`, régua do traçado com reparo); comparação como `app/lap-compare.tsx` (`forTrace`, `buildReferenceLap` do traçado reparado, `detectCorners`, `saved`).

| Taxa | Comparação × sessão (máx.) | Ao vivo × sessão (máx.) | Caminho antigo (sem `saved`) × sessão | Soma S1+S2+S3 ≠ duração (> 1 ms) |
| ---- | -------------------------- | ----------------------- | ------------------------------------- | -------------------------------- |
| 10 Hz | **0 ms** | 0 ms | 280 ms | 0 de 500 |
| 5 Hz | **0 ms** | 0 ms | 424 ms | 0 de 500 |

A coluna do caminho antigo mostra que a sonda discrimina: sem `saved`, a mesma volta dá até 424 ms de diferença.

**A T26 não mudou o comportamento da sessão**: a linha trocada (`app/session/[id].tsx:267`) passou de `repairDegenerateTimestamps(l.samples, l.durationMs, l.startedAt).samples` para `sectorLapSamples(l)`, que é a mesma expressão (`src/lib/sectors.ts:45`). Com `saved` omitido, `compareLaps` reaplica o reparo sobre pontos já reparados, o que não muda nada (o span já passa de metade da duração, `src/lib/analysis.ts:344`); os 3 testes da T21 continuam passando sem mudança.

---

## Gates

| Gate | Comando | Saída |
| ---- | ------- | ----- |
| Testes | `npm test` (árvore real) | **137 testes, 137 passam, 0 falhas, 0 pulados, 0 cancelados** |
| Typecheck | `npm run typecheck` (tsc, exit 2, árvore real) | **Só a baseline**: exatamente os 8 erros aceitos: `app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`. Nenhum erro novo |
| Contagem | antes da feature: 62; rodada 1: 126; rodada 2: 134 | agora: 137 (+3: 2 em `test/lapCompare.test.ts`, 1 em `test/lapCompareScreen.test.ts`). Nenhum teste removido, nenhuma asserção afrouxada |
| Tarefas | `tasks.md` | T1–T26 com todos os "Done when" marcados (99 `[x]`, nenhum `- [ ]`) |

---

## Checagem ancorada na spec

Legenda: ✅ a asserção mira o valor da spec · 🟡 só UAT (pendente), com o código inspecionado · ⚠️ lacuna de precisão da spec.

### P1: Tempo de volta com o milésimo real (TMP-01, TMP-02, TMP-03)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: instante por interpolação linear entre os pontos de cada lado | `t = t_a + f·(t_b − t_a)` | `test/startLine.test.ts:36-41`: `Math.abs(c.f - 0.25) < 1e-9`, `Math.abs(c.t - 10_025) < 1e-6`, ponto interpolado sobre a linha | ✅ |
| AC2: 10 Hz, \|duração − D\| ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:105-107`: 6 voltas, `assertLapsWithin(..., D, '10 Hz')` com `TOL_MS = 20` | ✅ |
| AC3: 5 Hz, ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:113-115` | ✅ |
| AC4 (TMP-02): 1ª volta pela mesma regra | ≤ 20 ms, inclusive a 1ª | `test/lapDetector.test.ts:106,114` (a 1ª volta entra no laço), `:136` (com traçado, 10 e 5 Hz) | ✅ |
| AC5: passar perto sem cruzar | `null` | `test/startLine.test.ts:59-60` | ✅ |
| AC6: contramão não fecha | `null` / 0 voltas | `test/startLine.test.ts:47`; `test/lapDetector.test.ts:194` | ✅ |
| AC7: 300 m, 25–180 s, uma volta por cruzamento | limites exatos | `test/lapDetector.test.ts:224` (`>= 25_000`), `:237` (`>= 300`); 180 s: `test/liveLapClock.test.ts:141`, `test/recovery.test.ts:191`; um cruzamento: `test/lapDetector.test.ts:178,313` | ✅ |
| Meia-largura de 15 m (Assumptions) | 16 m não cruza, 14 m cruza | `test/startLine.test.ts:51-55` | ✅ |
| Independent test: 37.699 ms a 10 Hz | ± 20 ms em todas | `test/lapDetector.test.ts:105-107` | ✅ |

### P1: Uma linha só por traçado (TMP-04, TMP-05, TMP-06)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-04): com traçado, 1º ponto e rumo do traçado | ponto = `layout[0]`, rumo ± 1° | `test/startLine.test.ts:83-86` | ✅ |
| AC2 (TMP-04): sem traçado, ponto de ritmo e rumo do movimento | idem | `test/startLine.test.ts:92-95` | ✅ |
| AC3 (TMP-05): começa andando, 1ª volta no 1º cruzamento | trecho anterior não é volta | `test/lapDetector.test.ts:129-136` (`laps.length === 3` com 4 passagens, `startCross` a ≤ 20 ms do 1º cruzamento); relógio `null` antes: `test/liveLapClock.test.ts:42-51`; tela e publicação sem o tempo da sessão: `test/recordingScreen.test.ts:36-44` | ✅ (+ 🟡 tela) |
| Independent test: gravações que começam em pontos diferentes | mesmo cruzamento e tempo ± 20 ms | `test/lapDetector.test.ts:149-152` | ✅ |
| AC4 (TMP-06): mesma linha no ao vivo, no "Encerrar" e na recuperação | a linha do traçado | Recuperação: `test/recovery.test.ts:241-263`; "Encerrar": `test/finishRecording.test.ts:139`; diário antigo: `test/recovery.test.ts:265`; hook (estático): `test/lapRecorderHook.test.ts:24-31`. Código: `src/hooks/useLapRecorder.ts:363` fixa a linha no `start()`, usada no diário (`:372`), no poll (`:475-477`) e no `stop()` (`:730-731`) | ✅ (+ 🟡 hook) |

### P1: S1/S2/S3 iguais em todo lugar (TMP-07, TMP-08, TMP-09, TMP-10)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-07): terços do comprimento do traçado | D/3 ± 20 ms; por distância | `test/sectors.test.ts:42-54` (10 e 5 Hz); velocidade variável: `:130-135` (16.667 / 13.333 / 10.000). Consumidores: comparação `test/lapCompare.test.ts:35-58`, mapa `test/trackMapScreen.test.ts:13-22`, sessão `test/sessionScreen.test.ts:18-29` | ✅ |
| AC2 (TMP-07): ao vivo pelo instante interpolado, não pelo poll | sem marcação por poll | `src/lib/sectors.ts:75-86`; `test/lapRecorderHook.test.ts:18-22` (sem `sectorBoundaryTsRef`); `test/liveLapClock.test.ts:169-171` (volta em curso por `openCross`) | ✅ (+ 🟡 HUD) |
| AC3 (TMP-07): análise ≤ 20 ms do ao vivo | ≤ 20 ms | Função: `test/sectors.test.ts:102` (`Math.abs(va - vb) <= TOL_MS`). Comparação: `test/lapCompare.test.ts:132-133` (`<= 20`, 10 e 5 Hz com fixes ruins) e `test/lapCompareScreen.test.ts:15,22`. Sessão: correta por construção (`app/session/[id].tsx:267,363` e o hook `src/hooks/useLapRecorder.ts:569-571` medem os mesmos pontos; sonda: 0 ms), **mas sem teste que guarde a origem dos pontos: o mutante M04 sobrevive (defeito 1)** | ✅ comportamento · ❌ discriminação na sessão |
| Independent test: S1+S2+S3 = duração ± 1 ms | ± 1 ms | `test/sectors.test.ts:64`; volta limpa: `test/analysis.test.ts:67`; comparação: `test/lapCompare.test.ts:56-57` | ✅ |
| AC4 (TMP-08): publicar os mesmos S1/S2/S3 | os do fechamento | `src/hooks/useLapRecorder.ts:568-572` → `lastClosedLapSectors` → `app/recording.tsx:368-378` (`publishLap`) | 🟡 só UAT (roteiro, passo 2) |
| AC5 (TMP-09): sem traçado, análise pela melhor volta; ao vivo sem setores | régua = melhor volta | Análise: `test/sectors.test.ts:108-135`, `test/sessionScreen.test.ts:24-29`. Ao vivo: `src/hooks/useLapRecorder.ts:476` (`sectorRef` só com linha) | ✅ análise · 🟡 ao vivo |
| AC6 (TMP-10): delta projeta o 1º ponto em s ≈ 0 | `sNormalized < 0,05` | Função: `test/realtimeDelta.test.ts:30`. Hook, inclusive depois do box: `test/liveLapClock.test.ts:245` e `:248-253` (estático, `resetLap` só sob `lapOpened`) | ✅ (+ 🟡 hook) |

### P2: Pico de velocidade (TMP-11)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: p99 dos pontos com precisão ≤ 10 m | nearest-rank; 10 m entra, 10,5 m não | `test/speed.test.ts:39,41` (`=== 198`, `=== 149`), `:50` (`=== 20`) | ✅ |
| AC2: um ponto a 150 km/h em ~80 km/h | < 81 km/h | `test/speed.test.ts:33` (`msToKmh(peak) < 81`) | ✅ |
| AC3: mesmo cálculo na sessão, home, pós-salvamento e insights | p99 em todos | `test/postSave.test.ts:185-186`; `test/lapInsight.test.ts:171`; `test/homeScreen.test.ts:21-24`; `test/sessionScreen.test.ts:31-39` | ✅ |
| AC4: sem ponto bom, `null` e "—" | `null`, "—" | `test/speed.test.ts:51-52,60-61`; `test/postSave.test.ts:182`; `test/homeScreen.test.ts:21-24`; `test/sessionScreen.test.ts:38` | ✅ (+ 🟡 telas) |

### P2: Insights (TMP-12, TMP-13)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-12): `cleanSamples(10)` e `repairDegenerateTimestamps` | reparada ± 20 ms; fix > 10 m fora | `test/lapInsight.test.ts:104` (`<= 20`), `:121-130` | ✅ |
| AC2 (TMP-12): volta inválida fora do denominador | média exata das 3 boas | `test/lapInsight.test.ts:97` (`Math.abs(loss - mean) < 1e-6`) | ✅ |
| AC3 (TMP-13): só voltas do mesmo traçado | `layoutId` da âncora | `test/lapInsight.test.ts:149-152`; tela: `test/insightsScreen.test.ts:12-14` | ✅ |

### P3: Timestamp no segundo cheio (TMP-14)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: fix em .000 num lote com sub-segundo mantém o original | …49.900, …50.000, …50.100 | `test/locationHandler.test.ts:165` (`deepEqual` exato) | ✅ |
| AC2: tudo quantizado mantém o horário de chegada a 100 ms | `NOW − 200, NOW − 100, NOW…` | `test/locationHandler.test.ts:184-185` | ✅ |
| AC3: estritamente crescente | `t[i] > t[i−1]` | `test/locationHandler.test.ts:194,201,204` | ✅ |

**ACs testáveis em Node**: 28/28 com evidência que mira o valor da spec. O ❌ não é falta de teste de função nem erro de comportamento: é a origem dos pontos da sessão, que nenhum teste guarda (defeito 1).

---

## Edge cases

- [x] **Parar na linha e sair de novo**: um cruzamento só. `test/lapDetector.test.ts:178` e `:313` (60 s parado, jitter de ±3 m que soma mais de 300 m; trava de 30 m em `src/lib/lapDetector.ts:191`).
- [x] **GPS perde sinal no cruzamento (> 2 s)**: `test/startLine.test.ts:64-67` (2001 ms dá nulo, 2000 ms cruza); `test/lapDetector.test.ts:210-216`; acima de 180 s: `test/recovery.test.ts:191`, `test/liveLapClock.test.ts:141`.
- [x] **Traçado com menos de 5 pontos ou comprimento zero**: `test/startLine.test.ts:70-74`, `test/sectors.test.ts:139`. (Na comparação, veja a observação 6.)
- [x] **1ª volta é a melhor**: sem regra especial (`test/lapDetector.test.ts:106,114`).

## Success Criteria

- [x] **GPX de bancada sem tempos em 00 ms**: `test/lapDetector.test.ts:255-258`, com `every`. Discrimina: o mutante M15 (só a 3ª volta presa a 100 ms) morre por ele.
- [x] **Setores do cockpit, do painel e da análise batem até 20 ms**: na função (`test/sectors.test.ts:102`), na comparação (`test/lapCompare.test.ts:132-133`) e, pela sonda, 0 ms entre ao vivo, sessão e comparação a 10 e a 5 Hz. O painel é UAT (passo 2). Ressalva: o caso de "ATUALIZAR REFERÊNCIA" (lacuna de precisão, abaixo).
- [x] **`docs/telemetria.md` com as regras novas**: sentido (`docs/telemetria.md:109-114`), interpolação (`:135-149`), terços (`:203-206`), p99 (`:299`).

---

## AD-006 nos consumidores

Grep em `app/` e `src/` por `sectorSplits`, `sectorLapSamples`, `s1Ms`, agrupamento de mini-setores (`Math.ceil(.../3)`, `groupThirds`, 7/7/6), `analyzeLap(` e `.sectors`, e pelas telas que mostram "S1".

| Consumidor | Onde | Pontos | Régua | Situação |
| ---------- | ---- | ------ | ----- | -------- |
| Detector e recorte | `src/lib/lapDetector.ts`, `src/recording/finishSession.ts:43-54` | fronteiras `synthetic` no cruzamento | linha única | ✅ |
| "Encerrar" e recuperação | `src/hooks/useLapRecorder.ts:730-731`, `src/recording/recovery.ts` | `sliceLaps` | linha da meta | ✅ |
| Cronômetro e reset do delta | `src/recording/liveLapClock.ts:35-58`, `src/hooks/useLapRecorder.ts:516-519` | `openCross` | – | ✅ |
| Setores ao vivo (fechamento e publicação) | `src/hooks/useLapRecorder.ts:568-572`; `app/recording.tsx:368-378` | `sliceLaps` do poll, crus | `referenceFromLayout` (`:784`) | ✅ |
| Setores da volta em curso | `src/hooks/useLapRecorder.ts:624-627` | `openCross` + crus | idem | ✅ |
| Sessão | `app/session/[id].tsx:267,358-364` | `sectorLapSamples` (salvos + reparo) | `referenceFromLayout` do traçado da sessão; sem ele, a melhor volta | ✅ comportamento (sem guarda: defeito 1) |
| Comparar voltas | `app/lap-compare.tsx:80-111`, `src/lib/lapCompare.ts:151-152` | `sectorLapSamples(saved)` | traçado da sessão A, reparado (mesma geometria da sessão) | ✅ |
| Mapa detalhado | `app/track-map.tsx:116-123` | salvos + reparo, inline (equivalente a `sectorLapSamples`) | `referenceFromLayout` | ✅ (sem rota; observação 4) |
| Pico (sessão, mapa, home, IA, insights) | `app/session/[id].tsx`, `app/(tabs)/index.tsx`, `src/recording/postSave.ts`, `src/lib/lapInsight.ts` | p99 | – | ✅ |
| Limpeza de pontos | `src/lib/analysis.ts:307-308` | preserva `synthetic` | – | ✅ |
| Coach e prompt da IA | `src/lib/coachContext.ts:133`, `src/lib/analysisPrompt.ts:231` | 20 mini-setores só como zonas, sem S1/S2/S3 | – | ✅ |
| Celebração de PB | `src/components/celebrations/PbUnlocked.tsx:38` | a sessão não passa `sectors` (`app/session/[id].tsx:716-723`) | – | ✅ (não mostra setores) |
| `src/lib/insights.ts` | `:333-334` | – | – | fora do escopo (código morto, vai para `produto-limpo`) |

Nenhum consumidor viola a AD-006 no comportamento. A única falha é de guarda (defeito 1).

---

## Discrimination Sensor

**Scratch**: `git worktree add --detach` em `…/scratchpad/sensor-wt3` (HEAD `c6cb802`), com symlink de `node_modules`. Cada mutação por troca exata de texto (uma ocorrência, conferida), `npm test` completo no scratch e `git checkout HEAD -- <arquivo>` no scratch. Baseline do scratch: 137/137. Sem `git stash`.

São 15 mutações, uma acima do teto de 14 pedido: as 14 da lista do orquestrador e a M04, que testa a regressão que a T26 poderia trazer à sessão (a linha que a T26 mexeu).

| # | `arquivo:linha` | Mutação | Testes que falharam | Morto? |
| - | --------------- | ------- | ------------------- | ------ |
| M01 | `src/lib/lapCompare.ts:151-152` | `compareLaps` ignora `saved`: setores sobre `lapA`/`lapB` (limpos) | 2 (`test/lapCompare.test.ts`, 10 e 5 Hz) | ✅ |
| M02 | `src/lib/sectors.ts:45` | `sectorLapSamples` filtra como `cleanSamples(10)` | 2 (idem) | ✅ |
| M03 | `app/lap-compare.tsx:111` | a tela volta a passar os pontos limpos para os setores (`{ a: lapARec, b: lapBRec }`) | 1 (`test/lapCompareScreen.test.ts`) | ✅ |
| **M04** | `app/session/[id].tsx:267` | **a sessão mede os setores sobre `cleanSamples(10)`** (`sectorLapSamples({ ...l, samples: cleanSamples(l.samples, 10) })`) | **0** | ❌ **Sobreviveu** |
| M05 | `src/lib/startLine.ts:89` | `crossing` aceita os dois sentidos | 2 (contramão) | ✅ |
| M06 | `src/lib/startLine.ts:97` | instante no ponto mais próximo, sem interpolação | 15 | ✅ |
| M07 | `src/lib/lapDetector.ts:191` | sem a trava de saída de 30 m | 1 (kart parado 60 s) | ✅ |
| M08 | `src/lib/lapDetector.ts:215` | `openCross` = fim da última volta fechada (ignora o box) | 3 | ✅ |
| M09 | `src/recording/finishSession.ts:48` | `sliceLaps` fecha a volta no ponto cru depois da linha | 8 | ✅ |
| M10 | `src/lib/sectors.ts:83` | `sectorSplits`: fração pelo `s` do map matching em vez da corda | 1 (volta "em curso" × "fechada") | ✅ |
| M11 | `src/recording/liveLapClock.ts:57` | `lapOpened` só na 1ª abertura | 2 (abertura pós-box, `sNormalized < 0,05`) | ✅ |
| M12 | `src/lib/speed.ts:29` | pico = máximo em vez do p99 | 5 | ✅ |
| M13 | `src/recording/locationHandler.ts:56` | `trustsRaw` nunca liga | 6 | ✅ |
| M14 | `src/lib/analysis.ts:308` | `cleanSamples` descarta os pontos sintéticos | 2 | ✅ |
| M15 | `src/lib/lapDetector.ts:202` | só a 3ª volta presa a múltiplo de 100 ms | 2 (GPX com `every`; `sliceLaps`) | ✅ |

**Sensor**: 15 mutações, 14 mortas, 1 sobreviveu (M04). Profundidade P0 (núcleo de tempo).
**Isolamento**: `git status --porcelain` antes = depois = `?? CockPit-Guia-do-Testador.pdf`. Worktree removido com `git worktree remove --force` e `git worktree prune`; `stash@{0}` da usuária intocado; HEAD da árvore real `c6cb802`.

---

## Defeitos (em ordem de gravidade)

### 1. A origem dos pontos dos setores da sessão não tem guarda (mutante M04 sobrevive; TMP-07 AC 3)

- **Onde**: `app/session/[id].tsx:265-268` monta `savedSamples` com `sectorLapSamples(l)`, e `:363` mede S1/S2/S3 sobre eles. O teste estático da sessão (`test/sessionScreen.test.ts:18-29`) confere o import de `sectorSplits` e a origem da régua, mas não a origem dos pontos. A comparação ganhou essa guarda na T26 (`test/lapCompareScreen.test.ts:13-23`); a sessão, não.
- **Prova**: com M04, a suíte passa inteira (137/137). O mutante é o mesmo caminho que a sonda mede como "caminho antigo" (reparo sobre `cleanSamples(10)`): até **280 ms a 10 Hz e 424 ms a 5 Hz** de diferença contra o ao vivo, a publicação e a comparação, com uma fix de 15 a 25 m perto de um limite de terço.
- **Por que reprova**: o comportamento de hoje está certo (sonda: 0 ms), mas é exatamente o defeito da rodada 2, agora do outro lado da comparação. A matriz de testes pede uma asserção estática por AC que só a tela cobre, e a análise da sessão é o lado "depois" do TMP-07 AC 3.
- **Correção (Minor, só teste)**: em `test/sessionScreen.test.ts`, assertar que `savedSamples[l.id] = sectorLapSamples(l)` (sem `cleanSamples` no argumento) e que `sectorSplits` recebe `sectorSamples[selected.id]`. Done when: M04 falha a suíte. Vale estender ao mapa detalhado (`test/trackMapScreen.test.ts:17` só confere o nome `savedSamples`), ou trocar o inline de `app/track-map.tsx:118-122` por `sectorLapSamples`, como a nota da T26 já sugere.

### ⚠️ Lacuna de precisão da spec: "ATUALIZAR REFERÊNCIA" troca a régua da mesma volta

- **Onde**: `app/recording.tsx:915-925` grava a melhor volta por cima do traçado (`saveLayout`, `INSERT OR REPLACE`, mesmo `id`) e abre a sessão (`router.replace`). A sessão relê o traçado (`app/session/[id].tsx:229-233`) e mede S1/S2/S3 contra a geometria nova. O ao vivo e a publicação usaram a antiga.
- **Medido** (sonda, fora da suíte): a nova melhor volta corta 3 m ou 6 m por dentro entre 10 % e 30 % da volta. Os S1/S2/S3 da sessão aberta logo depois diferem **75 ms (3 m) e 139 ms (6 m)** dos do ao vivo, a 10 e a 5 Hz.
- **Por que não reprova sozinha**: o caminho é anterior à feature (não está no diff) e a spec não diz qual traçado vale depois de uma troca. O AC 1 define os terços pelo "traçado de referência", que passou a ser o novo; o AC 3 pede os números do ao vivo. Para fechar, a Julia decide entre: (a) "atualizar referência" cria um traçado novo e deixa o antigo nas sessões gravadas com ele; (b) a sessão guarda a régua (ou os S1/S2/S3) do fechamento; (c) aceitar a mudança e escrever isso na spec.

---

## Só UAT (pendente)

| AC | Código inspecionado | Passo do roteiro |
| -- | ------------------- | ---------------- |
| TMP-05 AC 3 (cockpit "—" antes do 1º cruzamento) e TMP-01 no aparelho | `app/recording.tsx:599,738` | 1. Gravar 3 voltas com traçado, começando andando: a 1ª só conta no 1º cruzamento, e os tempos não terminam todos em 00 |
| TMP-08 e TMP-07 AC 3 no painel | `src/hooks/useLapRecorder.ts:568-572`, `app/recording.tsx:368-378` | 2. Com a equipe no painel web, o S1/S2/S3 publicado no fechamento é igual ao da análise da sessão (± 0,02 s) |
| TMP-09 (ao vivo sem setores) | `src/hooks/useLapRecorder.ts:476` | 3. Pista sem traçado: a análise mostra S1/S2/S3 pela melhor volta, e o cockpit fica sem setores |
| TMP-03 AC 6 no aparelho | `src/lib/startLine.ts:89` | 4. Passar pela linha na contramão (box): não fecha volta |
| TMP-11 AC 3/4 (telas) | `app/(tabs)/index.tsx`, `app/session/[id].tsx` | 5. A home e a sessão mostram o pico, e "—" quando não há ponto bom |
| TMP-10 e TMP-07 AC 2 (hook, volta depois do box) | `src/hooks/useLapRecorder.ts:516-519,624-640` | 6. Entrar no box por mais de 180 s e voltar: o delta e os setores da volta seguinte começam do zero |

---

## Observações não bloqueantes (seguem abertas)

1. **Painel web mostra 0 antes do 1º cruzamento, não "—"**: `web-spectator/app/live/[code]/page.tsx:52` e `web-spectator/app/team/[code]/page.tsx:122` usam `lastSample?.lapElapsedMs ?? 0`. O app já publica `null`, então o painel não mostra o tempo da sessão, mas mostra 0:00.000.
2. **"Lendas" também usa `?? 0`**: `app/legend-race.tsx:116,121` (anterior à feature). Não mostra tempo falso, mas diverge do "—" do cockpit.
3. **`compareLaps(…, null, …)` não é alcançável**: a tela recusa comparar sem traçado (`app/lap-compare.tsx:97-100`), então o ramo sem traçado (TMP-09) só existe no teste.
4. **Mapa detalhado**: sem rota que chegue a ele; duas geometrias (setores de `referenceFromLayout(layout.samples)` e rótulos do traçado limpo, `app/track-map.tsx:94-99` contra `:116`); preparação dos pontos inline em vez de `sectorLapSamples`, com teste que só confere o nome da variável.
5. **Da rodada 1, sem mudança**: `trustsRaw` liga com um fix de sub-segundo que depois é descartado por precisão (`src/recording/locationHandler.ts:55-57`); a régua de setores do hook muda se o traçado for trocado no meio da gravação (`src/hooks/useLapRecorder.ts:781-785`), enquanto a linha fica a do `start()`.
6. **Traçado com 5 pontos ou mais e comprimento zero na comparação**: `app/lap-compare.tsx:97` só recusa menos de 5 pontos. Com comprimento zero, os setores saem "—", enquanto a sessão cairia na melhor volta. Não mostra número errado e, na prática, é inalcançável (traçado vem de volta de 300 m ou mais).
7. **Os testes da comparação calculam a "sessão" com `sectorSplits(a.samples, ref)`** (`test/lapCompare.test.ts:125-126`), não com `sectorLapSamples`. É equivalente sem timestamps degenerados, que é o caso do teste.

---

## Rastreabilidade (proposta; `spec.md` não foi editado)

| Requisito | Status proposto |
| --------- | --------------- |
| TMP-01, TMP-02, TMP-03, TMP-04 | ✅ Verificado |
| TMP-05, TMP-06 | ✅ Verificado (UAT pendente na tela e no hook) |
| TMP-07 | ❌ Precisa de correção (defeito 1: guarda da origem dos pontos na sessão); ⚠️ decisão pendente sobre "ATUALIZAR REFERÊNCIA" |
| TMP-08, TMP-09 | ✅ Verificado na função; UAT pendente |
| TMP-10 | ✅ Verificado (UAT pendente no hook) |
| TMP-11, TMP-12, TMP-13, TMP-14 | ✅ Verificado |

## Fix Plans

1. **Fix 1 (Minor, só teste)**: guarda estática da origem dos pontos dos setores da sessão. Where: `test/sessionScreen.test.ts` (e, opcional, `test/trackMapScreen.test.ts` com `app/track-map.tsx` usando `sectorLapSamples`). Done when: a M04 (`sectorLapSamples({ ...l, samples: cleanSamples(l.samples, 10) })` em `app/session/[id].tsx:267`) faz a suíte falhar; `npm test && npm run typecheck` só com a baseline.
2. **Decisão da Julia**: o que vale para S1/S2/S3 de uma volta depois de "ATUALIZAR REFERÊNCIA" (opções a, b, c acima).
3. **Opcional (fora da feature)**: "—" no painel web quando `lapElapsedMs` é nulo.

## Summary

**Overall**: ❌ Not Ready
**Checagem ancorada na spec**: 28/28 ACs testáveis com evidência que mira o valor da spec; 1 lacuna de discriminação (sessão) e 1 lacuna de precisão da spec ("ATUALIZAR REFERÊNCIA").
**Sensor**: 14/15 mutações mortas; M04 sobreviveu.
**Gate**: 137 passam, 0 falham; typecheck só com a baseline.
**O que funciona**: a lacuna da rodada 2 fechou (comparação = sessão = ao vivo, 0 ms a 10 e a 5 Hz com fixes ruins); detector, linha, fronteiras, `sectorSplits`, delta pós-box, cronômetro e publicação antes do 1º cruzamento, GPX com `every`, pico p99, insights, `trustsRaw`, e a fiação da sessão, home, IA, recuperação e "Encerrar".
**O que falta**: o teste do defeito 1, a decisão sobre "ATUALIZAR REFERÊNCIA" e a UAT no aparelho (6 passos).
