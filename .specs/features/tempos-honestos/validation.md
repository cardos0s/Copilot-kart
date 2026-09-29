## Validation (rodada 2): tempos honestos — FAIL ❌

**Data**: 2026-09-29
**Spec**: `.specs/features/tempos-honestos/spec.md` (TMP-01 a TMP-14, edge cases, Success Criteria)
**Decisão**: AD-006 (`.specs/STATE.md`)
**Faixa de commits**: `13c72ab..fcd58e5` (branch `feat/tempos-honestos`). As correções desta rodada são T21–T25: `81a8065`, `6c95ada`, `7c942a0`, `04e4bbb`, `fcd58e5` (e `6aa0141`, docs).
**Verificador**: sub-agente independente da rodada 2 (autor ≠ verificador). Re-derivou tudo do zero; a rodada 1 serviu só para saber o que foi reprovado. Não alterou código, testes nem commits; só este arquivo.

**Motivo do FAIL, em uma linha**: os gates passam, os 14 mutantes morreram e 4 das 5 lacunas da rodada 1 fecharam, mas a tela "Comparar voltas" continua a mostrar, para a mesma volta, S1/S2/S3 que diferem do ao vivo e da sessão em mais de 20 ms (medido: 65 a 260 ms) quando há uma fix de precisão entre 10 e 30 m perto de um limite de terço, porque mede sobre pontos filtrados por `cleanSamples(10)` e não sobre os pontos salvos (TMP-07 AC 3).

---

## Lacunas da rodada 1

| # | Lacuna | Tarefa | Situação | Evidência |
| - | ------ | ------ | -------- | --------- |
| 1 | "Comparar voltas" pela régua 7/7/6, com setor negativo | T21 | ⚠️ **Parcialmente fechada** | A régua agora é `sectorSplits` (`src/lib/lapCompare.ts:147-148`), sem 7/7/6 e sem setor negativo (`test/lapCompare.test.ts:35-71`). Mas a tela passa pontos limpos por `cleanSamples(10)` (`app/lap-compare.tsx:81-83`), e a sessão e o ao vivo medem sobre os pontos salvos (`app/session/[id].tsx:267,363`; `src/hooks/useLapRecorder.ts:569-571,625-627`). Diferença medida acima de 20 ms: defeito 1 |
| 2 | Delta não reinicia depois do box | T22 | ✅ Fechada | `src/recording/liveLapClock.ts:52-58` (`lapOpened`), `src/hooks/useLapRecorder.ts:516-519`; `test/liveLapClock.test.ts:212-235` (5 aberturas exatas, nenhuma durante o box), `:237-246` (`sNormalized < 0.05` no 1º poll pós-box), `:248-253` (estático, `resetLap` só sob `lapOpened`) |
| 3 | Cockpit/publicação com o tempo da sessão antes do 1º cruzamento | T23 | ✅ Fechada no app | `app/recording.tsx:322` (`?? undefined` → `publishSample` grava `null`, `src/lib/liveSession.ts:178`), `:599` e `:738` ("—"); `test/recordingScreen.test.ts:36-44`. O painel web ainda mostra 0 (observação 1) |
| 4 | Mapa detalhado com régua própria | T24 | ✅ Fechada | `app/track-map.tsx:116-124` (`referenceFromLayout` + `sectorSplits` sobre os pontos salvos, como a sessão); `test/trackMapScreen.test.ts:13-22` |
| 5 | Precisão do GPX (`some`) | T25 | ✅ Fechada | `test/lapDetector.test.ts:255-258` com `every`. Discrimina: com o mutante M06 (só a 1ª volta presa a 100 ms), o teste com `every` falha e a versão antiga com `some` passaria (conferido no scratch) |

---

## Gates

| Gate | Comando | Saída |
| ---- | ------- | ----- |
| Testes | `npm test` (árvore real) | **134 testes, 134 passam, 0 falhas, 0 pulados, 0 cancelados** |
| Typecheck | `npm run typecheck` (tsc, exit 2, árvore real) | **Só a baseline**: exatamente os 8 erros aceitos: `app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`. Nenhum erro novo |
| Contagem | antes da feature: 62; rodada 1: 126 | agora: 134 (+8 desde a rodada 1: 3 em `test/lapCompare.test.ts`, 3 em `test/liveLapClock.test.ts`, 1 em `test/recordingScreen.test.ts`, 1 em `test/trackMapScreen.test.ts`). Nenhum teste removido; a única asserção alterada (`test/lapDetector.test.ts:256`, `some` → `every`) ficou mais rigorosa |
| Tarefas | `tasks.md` | T1–T25 com todos os "Done when" marcados; nenhum `- [ ]` restante |

---

## Checagem ancorada na spec

Legenda: ✅ a asserção mira o valor da spec · 🟡 só UAT (pendente), com o código inspecionado · ❌ caminho alcançável que viola o AC.

### P1: Tempo de volta com o milésimo real (TMP-01, TMP-02, TMP-03)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: instante por interpolação linear entre os pontos de cada lado | `t = t_a + f·(t_b − t_a)` | `test/startLine.test.ts:36-41`: `Math.abs(c.f - 0.25) < 1e-9`, `Math.abs(c.t - 10_025) < 1e-6`, ponto interpolado sobre a linha | ✅ |
| AC2: 10 Hz, \|duração − D\| ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:105-107`: 6 voltas, `assertLapsWithin(..., D, '10 Hz')` com `TOL_MS = 20` | ✅ |
| AC3: 5 Hz, ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:113-115` | ✅ |
| AC4 (TMP-02): 1ª volta pela mesma regra | ≤ 20 ms, inclusive a 1ª | `test/lapDetector.test.ts:106,114` (1ª volta sem traçado entra no laço), `:136` (com traçado, 10 e 5 Hz) | ✅ |
| AC5: passar perto sem cruzar | `null` | `test/startLine.test.ts:59-60` | ✅ |
| AC6: contramão não fecha | `null` / 0 voltas | `test/startLine.test.ts:47`; `test/lapDetector.test.ts:194` | ✅ |
| AC7: 300 m, 25–180 s, uma volta por cruzamento | limites exatos | `test/lapDetector.test.ts:224` (`>= 25_000`), `:237` (`>= 300`); 180 s: `test/liveLapClock.test.ts:141`, `test/recovery.test.ts:191`; um cruzamento: `test/lapDetector.test.ts:178,313` | ✅ |
| Meia-largura de 15 m (Assumptions) | 16 m não cruza, 14 m cruza | `test/startLine.test.ts:51-55` | ✅ |

### P1: Uma linha só por traçado (TMP-04, TMP-05, TMP-06)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-04): com traçado, 1º ponto e rumo do traçado | ponto = `layout[0]`, rumo ± 1° | `test/startLine.test.ts:83-86` | ✅ |
| AC2 (TMP-04): sem traçado, ponto de ritmo e rumo do movimento | idem | `test/startLine.test.ts:92-95` | ✅ |
| AC3 (TMP-05): começa andando, 1ª volta no 1º cruzamento | trecho anterior não é volta | `test/lapDetector.test.ts:129-136` (`laps.length === 3` com 4 passagens; `startedAt` a ≤ 20 ms do 1º cruzamento); relógio `null` antes: `test/liveLapClock.test.ts:42-51`; tela e publicação sem o tempo da sessão: `test/recordingScreen.test.ts:36-44` | ✅ (+ 🟡 tela) |
| Independent test: gravações que começam em pontos diferentes | mesmo cruzamento e tempo ± 20 ms | `test/lapDetector.test.ts:149-152` | ✅ |
| AC4 (TMP-06): mesma linha no ao vivo, no "Encerrar" e na recuperação | a linha da meta | Recuperação: `test/recovery.test.ts:241-263`; "Encerrar": `test/finishRecording.test.ts:139`; diário antigo: `test/recovery.test.ts:265`; hook (estático): `test/lapRecorderHook.test.ts:24-35`. Código: `src/hooks/useLapRecorder.ts:363` fixa a linha no `start()`, usada na meta (`:372`), no poll (`:475`) e no `stop()` (`:726`) | ✅ (+ 🟡 hook) |

### P1: S1/S2/S3 iguais em todo lugar (TMP-07, TMP-08, TMP-09, TMP-10)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-07): terços do comprimento do traçado | D/3 ± 20 ms; por distância | `test/sectors.test.ts:42-54` (10 e 5 Hz); velocidade variável: `:108-135`. Consumidores: comparação `test/lapCompare.test.ts:35-58`, mapa `test/trackMapScreen.test.ts:13-22`, sessão `test/sessionScreen.test.ts:18-29` | ✅ |
| AC2 (TMP-07): ao vivo pelo instante interpolado, não pelo poll | sem marcação por poll | `src/lib/sectors.ts:64-75`; `test/lapRecorderHook.test.ts:18-22` (sem `sectorBoundaryTsRef`); `test/liveLapClock.test.ts:170` (volta em curso por `openCross`) | ✅ (+ 🟡 HUD) |
| AC3 (TMP-07): análise ≤ 20 ms do ao vivo | ≤ 20 ms | Função: `test/sectors.test.ts:102` (`Math.abs(va - vb) <= TOL_MS`). Sessão: por construção, `app/session/[id].tsx:267,363` e o hook `src/hooks/useLapRecorder.ts:569-571` chamam `sectorSplits` sobre os mesmos pontos salvos. **"Comparar voltas": `app/lap-compare.tsx:81-83` mede sobre `cleanSamples(10)`; diferença medida de 65 a 260 ms (defeito 1)** | ✅ sessão · ❌ comparação |
| Independent test: S1+S2+S3 = duração ± 1 ms | ± 1 ms | `test/sectors.test.ts:64`; volta limpa: `test/analysis.test.ts:67`; comparação: `test/lapCompare.test.ts:55-57` | ✅ |
| AC4 (TMP-08): publicar os mesmos S1/S2/S3 | os do fechamento | `src/hooks/useLapRecorder.ts:565-571` → `lastClosedLapSectors` → `app/recording.tsx:368-378` (`publishLap`) | 🟡 só UAT (roteiro, passo 2) |
| AC5 (TMP-09): sem traçado, análise pela melhor volta; ao vivo sem setores | régua = melhor volta | Análise: `test/sectors.test.ts:108-135`, `test/sessionScreen.test.ts:24`. Ao vivo: `src/hooks/useLapRecorder.ts:476` (`sectorRef` só com linha) | ✅ análise · 🟡 ao vivo |
| AC6 (TMP-10): delta projeta o 1º ponto em s ≈ 0 | `sNormalized < 0,05` | Função: `test/realtimeDelta.test.ts:30`. Hook, inclusive depois do box: `test/liveLapClock.test.ts:245` (`sNormalized < 0.05` no 1º poll pós-box) e `:248-253` (estático) | ✅ (+ 🟡 hook) |

### P2: Pico de velocidade (TMP-11)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: p99 dos pontos com precisão ≤ 10 m | nearest-rank; 10 m entra, 10,5 m não | `test/speed.test.ts:39,41` (`=== 198`, `=== 149`), `:50` (`=== 20`) | ✅ |
| AC2: um ponto a 150 km/h em ~80 km/h | < 81 km/h | `test/speed.test.ts:33` (`msToKmh(peak) < 81`) | ✅ |
| AC3: mesmo cálculo na sessão, home, pós-salvamento e insights | p99 em todos | `test/postSave.test.ts:185`; `test/lapInsight.test.ts:171`; `test/homeScreen.test.ts:21`; `test/sessionScreen.test.ts:31` | ✅ |
| AC4: sem ponto bom, `null` e "—" | `null`, "—" | `test/speed.test.ts:51-52,60-61`; `test/postSave.test.ts:175`; `test/homeScreen.test.ts:21`; `test/sessionScreen.test.ts:31` | ✅ (+ 🟡 telas) |

### P2: Insights (TMP-12, TMP-13)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-12): `cleanSamples(10)` e `repairDegenerateTimestamps` | reparada ± 20 ms; fix > 10 m fora | `test/lapInsight.test.ts:104` (`<= 20`), `:121-130` | ✅ |
| AC2 (TMP-12): volta inválida fora do denominador | média exata das 3 boas | `test/lapInsight.test.ts:97` (`Math.abs(loss - mean) < 1e-6`) | ✅ |
| AC3 (TMP-13): só voltas do mesmo traçado | `layoutId` da âncora | `test/lapInsight.test.ts:149-152`; tela: `test/insightsScreen.test.ts:12` | ✅ |

### P3: Timestamp no segundo cheio (TMP-14)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: fix em .000 num lote com sub-segundo mantém o original | …49.900, …50.000, …50.100 | `test/locationHandler.test.ts:165` (`deepEqual` exato) | ✅ |
| AC2: tudo quantizado mantém o horário de chegada a 100 ms | `NOW − 200, NOW − 100, NOW…` | `test/locationHandler.test.ts:184-185` | ✅ |
| AC3: estritamente crescente | `t[i] > t[i−1]` | `test/locationHandler.test.ts:194,201,204` | ✅ |

**ACs testáveis em Node**: 28/28 com evidência que mira o valor da spec. O ❌ não é falta de teste na função: é um consumidor (a tela "Comparar voltas") que alimenta a régua certa com outros pontos.

---

## Edge cases

- [x] **Parar na linha e sair de novo**: um cruzamento só. `test/lapDetector.test.ts:178` e `:313` (60 s parado, jitter de ±3 m que soma > 300 m; trava de 30 m em `src/lib/lapDetector.ts:191`).
- [x] **GPS perde sinal no cruzamento (> 2 s)**: `test/startLine.test.ts:64-67` (2001 ms nulo, 2000 ms cruza); `test/lapDetector.test.ts:210-216`; acima de 180 s: `test/recovery.test.ts:191`, `test/liveLapClock.test.ts:141`.
- [x] **Traçado com menos de 5 pontos ou comprimento zero**: `test/startLine.test.ts:70-74`, `test/sectors.test.ts:139`.
- [x] **1ª volta é a melhor**: sem regra especial (`test/lapDetector.test.ts:106,114`).

## Success Criteria

- [x] **GPX de bancada sem tempos em 00 ms**: `test/lapDetector.test.ts:255-258`, agora com `every`: as 3 voltas fora dos múltiplos de 100 ms.
- [ ] **Setores do cockpit, do painel e da análise batem até 20 ms**: provado na função (`test/sectors.test.ts:102`) e por construção no hook, na sessão e no mapa; o painel é UAT. A tela "Comparar voltas" diverge com fixes ruins (defeito 1).
- [x] **`docs/telemetria.md` com as regras novas**: sentido (`docs/telemetria.md:109-114`), interpolação (`:135-149`), terços (`:203`), p99.

---

## AD-006 nos consumidores

Grep amplo em `app/` e `src/` por agrupamento de setores (`Math.ceil(.../3)`, `slice` de setores, `groupThirds`, 7/7/6), por máximos brutos de velocidade (`Math.max(...speed)`, laços de pico) e por recortes `startIdx..endIdx`.

| Consumidor | Onde | Situação |
| ---------- | ---- | -------- |
| Detector e recorte | `src/lib/lapDetector.ts`, `src/recording/finishSession.ts:43-48` | ✅ único recorte por `startIdx..endIdx`, filtrado por `(t0, t1)` e fechado com os dois pontos `synthetic` |
| "Encerrar" e recuperação | `src/hooks/useLapRecorder.ts:726-731`, `src/recording/recovery.ts` | ✅ linha da meta |
| Cronômetro ao vivo | `src/recording/liveLapClock.ts:35-44` | ✅ conta de `openCross` |
| Reset do delta | `src/hooks/useLapRecorder.ts:516-519` | ✅ sob `lapOpened`, inclusive depois do box |
| Setores ao vivo e publicação | hook `:565-571,619-630`; `app/recording.tsx:368-378` | ✅ `sliceLaps` + `sectorSplits` |
| Análise da sessão | `app/session/[id].tsx:356-366` | ✅ `sectorSplits` sobre os pontos salvos. `:1125` (`Math.ceil(sectors.length / 3)`) só escolhe o mini-setor do toque, não soma tempo |
| Mapa detalhado | `app/track-map.tsx:116-124` | ✅ `sectorSplits` sobre os pontos salvos (sem rota que chegue a ela hoje) |
| **Comparar voltas** | `src/lib/lapCompare.ts:147-148` com `app/lap-compare.tsx:81-83` | ⚠️ régua certa, pontos diferentes dos da sessão e do ao vivo (defeito 1) |
| Pico (sessão, mapa, home, IA, insights) | `app/session/[id].tsx:581,1332`; `app/(tabs)/index.tsx:77`; `src/recording/postSave.ts:143`; `src/lib/lapInsight.ts` | ✅ p99. `app/track-map.tsx:273` é o máximo das velocidades mínimas por curva, não pico |
| Limpeza de pontos | `src/lib/analysis.ts:307-308` | ✅ preserva `synthetic` |
| Coach (prompt da IA) | `src/lib/coachContext.ts:133`, `src/lib/analysisPrompt.ts:231` | ✅ usa os 20 mini-setores só como régua interna (zonas), sem S1/S2/S3 |
| `src/lib/insights.ts` | `:115,376-379` | fora do escopo (código morto, vai para `produto-limpo`); já usa `peakSpeedMs` |

---

## Discrimination Sensor

**Scratch**: `git worktree add --detach` em `…/scratchpad/sensor-wt2` (HEAD `fcd58e5`), com symlink de `node_modules`. Cada mutação aplicada por troca exata de texto (ou `git checkout 6aa0141 -- <arquivo>` para voltar à versão anterior à correção), `npm test` completo no scratch e `git checkout HEAD -- <arquivo>` no scratch. Baseline do scratch: 134/134. Sem `git stash`.

| # | `arquivo:linha` | Mutação | Testes que falharam | Morto? |
| - | --------------- | ------- | ------------------- | ------ |
| M01 | `src/lib/lapCompare.ts` (inteiro, versão `6aa0141`) | `compareLaps` volta à soma 7/7/6 dos mini-setores | 3 (`test/lapCompare.test.ts`) | ✅ |
| M02 | `src/lib/lapCompare.ts:142` | régua errada: ignora o traçado e mede pela volta A | 1 (sem traçado, régua = volta B) | ✅ |
| M03 | `src/recording/liveLapClock.ts:56-57` | `lapOpened` sempre falsa | 2 (abertura pós-box e `sNormalized < 0,05`) | ✅ |
| M04 | `app/recording.tsx:322` | publicação volta a `?? info.elapsedMs` | 1 (estático) | ✅ |
| M05 | `app/track-map.tsx` (inteiro, versão `6aa0141`) | mapa volta ao `interpolateT` próprio, sem `sectorSplits` | 1 (estático) | ✅ |
| M06 | `src/lib/lapDetector.ts:202` | só a 1ª volta presa a múltiplo de 100 ms, as outras certas | 2 (GPX com `every`; `sliceLaps`). Com o teste antigo em `some`, o GPX passaria | ✅ |
| M07 | `src/lib/startLine.ts:89` | `crossing` aceita os dois sentidos | 2 (contramão) | ✅ |
| M08 | `src/lib/lapDetector.ts:191` | sem a trava de saída de 30 m | 1 (kart parado 60 s) | ✅ |
| M09 | `src/lib/lapDetector.ts:215` | `openCross` = fim da última volta fechada (ignora o box) | 3 | ✅ |
| M10 | `src/recording/finishSession.ts:48` | `sliceLaps` fecha a volta no ponto cru depois da linha | 8 | ✅ |
| M11 | `src/lib/sectors.ts:66` | limites em 7/20 e 14/20 | 4 | ✅ |
| M12 | `src/lib/speed.ts:29` | pico = máximo bruto em vez do p99 | 5 | ✅ |
| M13 | `src/recording/locationHandler.ts:56` | `trustsRaw` nunca liga | 6 | ✅ |
| M14 | `src/lib/analysis.ts:308` | `cleanSamples` descarta os pontos sintéticos de fronteira | 2 | ✅ |

**Sensor**: 14 mutações, 14 mortas, 0 sobreviveram. Profundidade P0 (núcleo de tempo), cobrindo as 5 correções novas e o núcleo.
**Isolamento**: `git status --porcelain` antes = depois = `?? CockPit-Guia-do-Testador.pdf`. Worktree removido com `git worktree remove --force` e `git worktree prune`; `stash@{0}` da usuária intocado; HEAD da árvore real `fcd58e5`.

---

## Defeitos (em ordem de gravidade)

### 1. "Comparar voltas" mede S1/S2/S3 sobre pontos diferentes dos do ao vivo e da sessão (❌ TMP-07 AC 3; Success Criteria de setores)

- **Onde**: `app/lap-compare.tsx:81-83` passa a `compareLaps` a volta filtrada por `cleanSamples(raw.samples, 10)`; `src/lib/lapCompare.ts:147-148` roda `sectorSplits` sobre esses pontos. O ao vivo (`src/hooks/useLapRecorder.ts:569-571`) e a sessão (`app/session/[id].tsx:267,363`) medem sobre os pontos salvos, só com o reparo de timestamp. A tela abre pelo botão da sessão (`app/session/[id].tsx:542`).
- **Prova** (sonda no scratch, fora da suíte: pista sintética de 37.699 ms com traçado, régua montada como a tela monta, uma volta salva por `sliceLaps` com N fixes perto de 1/3 ou 2/3 marcadas com precisão de 15 m):
  - fix com precisão ruim mas posição exata: diferença de 0 a 1 ms (dentro);
  - 1 fix deslocada 5 m ao longo da pista: **65 a 78 ms a 10 Hz, 106 a 116 ms a 5 Hz**;
  - 1 fix deslocada 10 m: 75 a 90 ms (10 Hz), 136 a 148 ms (5 Hz);
  - 2 fixes deslocadas 8 m: até **152 ms (10 Hz) e 260 ms (5 Hz)**.
  Exemplo, 10 Hz, 1 fix a 5 m no limite de 1/3: sessão 12.481 / 12.660 / 12.558 ms; comparação 12.558 / 12.583 / 12.558 ms.
- **Por que reprova**: fix entre 10 e 30 m entra na gravação (o handler só descarta acima de 30 m) e é justamente a que costuma vir com a posição errada. A mesma volta mostra números diferentes na sessão e na comparação, que é o problema 3 da spec. A correção da rodada 1 pedia "sobre os pontos salvos (sem o `cleanSamples`, como a sessão faz)"; a T21 trocou a régua mas manteve a entrada.
- **Correção**: os setores da comparação saem dos pontos salvos (só `repairDegenerateTimestamps`), e o traço de delta pode seguir com os limpos. Por exemplo, `app/lap-compare.tsx` guarda as duas versões e `compareLaps` recebe as salvas para `sectorSplits`. Teste: uma volta com uma fix de precisão 15 m deslocada 5 m no limite de 1/3 dá, na comparação, os mesmos S1/S2/S3 de `sectorSplits` sobre os pontos salvos (≤ 20 ms).

---

## Só UAT (pendente)

| AC | Código inspecionado | Passo do roteiro |
| -- | ------------------- | ---------------- |
| TMP-05 AC 3 (cockpit "—" antes do 1º cruzamento) | `app/recording.tsx:599,738` | 1 |
| TMP-06 (ao vivo) | `src/hooks/useLapRecorder.ts:363,372,475,726` | 1 |
| TMP-07 AC 2 (HUD) | `src/hooks/useLapRecorder.ts:619-630` | 1 e 2 |
| TMP-08 | `src/hooks/useLapRecorder.ts:565-571`, `app/recording.tsx:368-378` | 2 |
| TMP-09 (ao vivo sem setores) | `src/hooks/useLapRecorder.ts:476` | 3 |
| TMP-10 (hook, inclusive volta depois do box) | `src/hooks/useLapRecorder.ts:516-519` | acrescentar ao roteiro: passar no box por mais de 180 s e conferir que o delta da volta seguinte começa perto de zero |
| TMP-11 AC 3/4 (telas) | `app/(tabs)/index.tsx:157`, `app/session/[id].tsx:581` | 5 |

---

## Observações não bloqueantes

1. **Painel web mostra 0 antes do 1º cruzamento, não "—"**: `web-spectator/app/live/[code]/page.tsx:52` e `web-spectator/app/team/[code]/page.tsx:122` usam `lastSample?.lapElapsedMs ?? 0`. O app já publica `null` (T23), então o painel não mostra mais o tempo da sessão, mas mostra 0:00.000 em vez de "—". A nota da T23 cita só a página `live`; a `team` tem o mesmo padrão.
2. **"Lendas" também usa `?? 0`**: `app/legend-race.tsx:116,121` (anterior à feature) trata a volta ainda não aberta como 0 ms. Não mostra tempo falso, mas diverge do "—" do cockpit.
3. **`compareLaps(…, null, …)` não é alcançável**: a tela recusa comparar sem traçado (`app/lap-compare.tsx:95-96`), então o ramo sem traçado (TMP-09) só existe no teste.
4. **Mapa detalhado com duas réguas geométricas**: os setores saem de `referenceFromLayout(layout.samples)` (traçado cru) e os rótulos/curvas do `refLap` do traçado limpo (`app/track-map.tsx:94-99` contra `:116`). Diferença só de comprimento, e a tela não tem rota hoje.
5. **Da rodada 1, sem mudança**: `trustsRaw` liga com um fix de sub-segundo que depois é descartado por precisão (`src/recording/locationHandler.ts:55-57`); a régua de setores do hook pode mudar se o traçado for trocado no meio da gravação, enquanto a linha fica a do `start()`.
6. **Os testes da comparação usam pontos sintéticos sem fix ruim** (`test/lapCompare.test.ts:28-33`), por isso não pegam o defeito 1: nos dados limpos, `cleanSamples` não remove nada.

---

## Rastreabilidade (proposta; `spec.md` não foi editado)

| Requisito | Status proposto |
| --------- | --------------- |
| TMP-01, TMP-02, TMP-03, TMP-04 | ✅ Verificado |
| TMP-05, TMP-06 | ✅ Verificado (UAT pendente na tela e no hook) |
| TMP-07 | ❌ Precisa de correção (defeito 1: "Comparar voltas" sobre pontos limpos) |
| TMP-08, TMP-09 | ✅ Verificado na função; UAT pendente |
| TMP-10 | ✅ Verificado (UAT pendente no hook) |
| TMP-11, TMP-12, TMP-13, TMP-14 | ✅ Verificado |

## Fix Plans

1. **Fix 1 (Major)**: setores da comparação sobre os pontos salvos. Where: `app/lap-compare.tsx` (e a assinatura de `compareLaps` em `src/lib/lapCompare.ts`, se for o caminho). Done when: teste com fix de precisão 15 m deslocada no limite de 1/3 (e outro em 2/3), a 10 e a 5 Hz, em que S1/S2/S3 da comparação batem com `sectorSplits` dos pontos salvos (≤ 20 ms); `npm test && npm run typecheck` só com a baseline.
2. **Opcional (fora da feature)**: "—" no painel web quando `lapElapsedMs` é nulo (`web-spectator/app/live/[code]/page.tsx:52`, `web-spectator/app/team/[code]/page.tsx:122`).

## Summary

**Overall**: ❌ Not Ready
**Checagem ancorada na spec**: 28/28 ACs testáveis com evidência que mira o valor da spec; 1 caminho de consumidor viola o TMP-07 AC 3.
**Sensor**: 14/14 mutações mortas.
**Gate**: 134 passam, 0 falham; typecheck só com a baseline.
**O que funciona**: detector, linha, fronteiras, `sectorSplits`, delta pós-box (`lapOpened`), cronômetro e publicação antes do 1º cruzamento, mapa detalhado pela régua única, GPX com `every`, pico p99, insights, `trustsRaw`, e a fiação da sessão, home, IA, recuperação e "Encerrar".
**O que falta**: defeito 1 e a UAT no aparelho.
