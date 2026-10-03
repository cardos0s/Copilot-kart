## Validation (rodada 5): tempos honestos — PASS ✅

**Data**: 2026-10-03
**Spec**: `.specs/features/tempos-honestos/spec.md` (TMP-01 a TMP-14, edge cases, Success Criteria e as Assumptions de 30/09 e de 03/10)
**Decisão**: AD-006 (`.specs/STATE.md`)
**Faixa de commits**: `13c72ab..7b42ae5` (branch `feat/tempos-honestos`). As correções desta rodada são a T29 (`1542c5f`), a T30 (`bb88b38`), a T31 (`40e7add`) e a T32 (`7b42ae5`), da Phase 7 de `tasks.md`.
**Verificador**: sub-agente independente da rodada 5, autorizada pela Julia em 03/10 (autor ≠ verificador). Re-derivou tudo do zero; o relatório da rodada 4 serviu só para saber o que tinha sido reprovado. Não alterou código, testes nem commits; só este arquivo.

**Veredito em uma linha**: as reprovações da rodada 4 fecharam. M02, M06 e M09 morrem, e as variantes do M09 dentro de `promoteReferenceLayout` também. A sessão sem `layoutId` no parâmetro grava o traçado que usou, o traçado novo herda o PB, e as três escritas vão pelo `txn`. Os 28 mutantes do sensor morrem e os gates passam. Ficam a UAT no aparelho (7 passos) e observações não bloqueantes.

---

## O que a rodada 4 reprovou

| # | Item | Tarefa | Situação | Evidência |
| - | ---- | ------ | -------- | --------- |
| 1a | M02: o laço dos setores da sessão podia percorrer `cleanedLaps` | T29 | ✅ **Morto** (S01) | `test/sessionScreen.test.ts:41-44`: regex do laço inteiro `for (const l of lapsRaw) { savedSamples[l.id] = sectorLapSamples(l); }`. Código: `app/session/[id].tsx:265-267`. O M04 da rodada 3 (S02) segue morto |
| 1b | M06: a função podia alterar o traçado de entrada | T29 | ✅ **Morto** (S03, e a variante do nome, S04) | `test/referenceLayout.test.ts:29-42` (`makeReference()`, um objeto novo por teste), `:86-96` (`deepEqual(reference, snapshot)` com nome datado, para que gravar o nome sem a data também apareça) |
| 1c | M09: o padrão podia ir para o traçado antigo | T29 → T32 | ✅ **Morto** no handler (S06) e dentro de `promoteReferenceLayout` (S07) | Handler: `test/recordingScreen.test.ts:51` (`await promoteReferenceLayout(next, pb);` exato). Função: `test/promoteReferenceLayout.test.ts:29` (`await setDefaultLayoutOn(txn, layout.trackId, layout.id);` exato) |
| 2 | Sessão gravada sem `layoutId` no parâmetro (velocímetro demo) ficava com `null` e mudava de régua depois de "ATUALIZAR REFERÊNCIA" | T30 | ✅ | `app/recording.tsx:227` (meta do `start()`, que vai ao diário e à recuperação) e `:427` (`finishRecording`): `normalizeId(params.layoutId) ?? reference?.id ?? null`. Teste: `test/recordingScreen.test.ts:64-70` (exatamente 2 ocorrências, nenhum `layoutId` cru). S15 e S16 mortos. As sessões legadas sem `layout_id` ficam fora da regra pela Assumption de 03/10 e seguem o padrão atual (`app/session/[id].tsx:229-234`) |
| Obs. 1 | PB zerado no traçado novo ("nova PB" falsa) | T31 | ✅ | `src/lib/referenceLayout.ts:57-73` (`inheritedPb`); `app/recording.tsx:920`. Testes: `test/referenceLayout.test.ts:109-125`, `:127-130`, `:132-154`; `test/recordingScreen.test.ts:56-62`. S11 a S14 mortos |
| Obs. 2 | `saveLayout` e `setDefaultLayout` não atômicos | T32 | ✅ | `src/storage/db.ts:1092-1102`: `withExclusiveTransactionAsync`, com `saveLayoutOn(txn, …)`, `setDefaultLayoutOn(txn, …)` e `savePbRecordOn(txn, …)`. Teste: `test/promoteReferenceLayout.test.ts:20-33`. S08, S09 e S10 mortos |

### A troca de asserções da T32 enfraquece a cobertura?

Não. Antes (T29), `test/recordingScreen.test.ts` exigia `await saveLayout(next);` e `await setDefaultLayout(next.trackId, next.id);`. Agora a cadeia tem dois elos, e os dois são exatos:

1. O handler passa o traçado novo inteiro: `await promoteReferenceLayout(next, pb);` (`test/recordingScreen.test.ts:51`), sem `saveLayout(` nem `setDefaultLayout(` em lugar nenhum do arquivo (`:52-53`).
2. A função grava o traçado, marca como padrão **o mesmo** `layout.id` e grava o PB, tudo pelo `txn` (`test/promoteReferenceLayout.test.ts:27-30`), e não escreve pela conexão principal (`:32`).

Toda substituição do M09 nos dois elos morre: id antigo no handler (S06), id errado dentro da função (S07), padrão pela conexão principal (S09). A única coisa que a cadeia não pega é uma chamada **a mais**, inserida ao lado da certa (observação 1). A guarda da T29 também não pegava esse caso, então a T32 não perdeu nada.

### O `require.cache` vazio em `test/referenceLayout.test.ts` esconde comportamento?

Não. `test/referenceLayout.test.ts:16-18` registra `{}` no lugar de `src/storage/db` só para carregar `src/lib/gamification.ts` em Node. O teste usa `processSessionMilestones` (`src/lib/gamification.ts:115-167`), que é pura: não chama nada do banco, e a regra de PB (`:119-120`, `previousPbMs == null || bestLapMs < previousPbMs`) é a real, não uma cópia. Se um dia a função passar a usar o banco, o `{}` faz o teste falhar com `TypeError`; ele não passa em silêncio. O `node --test` roda cada arquivo num processo próprio, então o stub não vaza para outros testes.

O que esse teste **não** prova é a ligação no aparelho. A próxima sessão no traçado novo lê o PB por `getCurrentPb(trackId, layoutId)` (`src/recording/postSave.ts:60-62`, SQL em `src/storage/db.ts:1043-1063`), e essa sessão tem o `layoutId` do traçado novo graças à T30. Isso é adaptador SQLite, que a matriz põe em UAT (passo 7).

---

## Gates

| Gate | Comando | Saída |
| ---- | ------- | ----- |
| Testes | `npm test` (árvore real, HEAD `7b42ae5`) | **149 testes, 149 passam, 0 falhas, 0 pulados, 0 cancelados** (exit 0) |
| Typecheck | `npm run typecheck` (tsc, árvore real; exit 2 por causa da baseline) | **Só a baseline**: exatamente os 8 erros aceitos: `app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`. Nenhum erro novo |
| Contagem | antes da feature: 62; rodada 4: 143 | agora: 149 (+6: 3 da T31 em `test/referenceLayout.test.ts`, 1 da T30 e 1 da T32 em `test/recordingScreen.test.ts`, 1 da T32 em `test/promoteReferenceLayout.test.ts`; a T29 só fortaleceu asserções). Nenhum teste removido. As asserções que a T32 trocou foram substituídas por outras exatas (ver acima) |
| Tarefas | `tasks.md` | T1–T32 com os "Done when" marcados (119 `[x]`, nenhum `- [ ]`); passo 7 no Roteiro de UAT |

---

## Checagem ancorada na spec

Legenda: ✅ a asserção mira o valor da spec · 🟡 só UAT (pendente), com o código inspecionado. Fora de `sessionScreen`, `recordingScreen`, `referenceLayout` e do novo `promoteReferenceLayout`, nenhum teste mudou desde a rodada 4 (`git diff c9c6ebf..HEAD -- test`). As linhas abaixo foram conferidas de novo nos arquivos.

### P1: Tempo de volta com o milésimo real (TMP-01, TMP-02, TMP-03)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: instante por interpolação linear entre os pontos de cada lado | `t = t_a + f·(t_b − t_a)` | `test/startLine.test.ts:36-41`: `Math.abs(c.f - 0.25) < 1e-9`, `Math.abs(c.t - 10_025) < 1e-6`, ponto interpolado sobre a linha | ✅ |
| AC2: 10 Hz, \|duração − D\| ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:105-107`: 6 voltas, `assertLapsWithin(..., D, '10 Hz')` com `TOL_MS = 20` | ✅ |
| AC3: 5 Hz, ≤ 20 ms | ≤ 20 ms | `test/lapDetector.test.ts:113-115` | ✅ |
| AC4 (TMP-02): 1ª volta pela mesma regra | ≤ 20 ms, inclusive a 1ª | `test/lapDetector.test.ts:106,114` (a 1ª volta entra no laço), `:136` (com traçado, 10 e 5 Hz) | ✅ |
| AC5: passar perto sem cruzar | `null` | `test/startLine.test.ts:59-60` | ✅ |
| AC6: contramão não fecha | `null` / 0 voltas | `test/startLine.test.ts:47`; `test/lapDetector.test.ts:194` | ✅ |
| AC7: 300 m, 25–180 s, uma volta por cruzamento | limites exatos | `test/lapDetector.test.ts:224` (`>= 25_000`), `:237` (`>= 300`); 180 s: `test/liveLapClock.test.ts:141-168`, `test/recovery.test.ts:191`; um cruzamento: `test/lapDetector.test.ts:178`, `:313` | ✅ |
| Meia-largura de 15 m (Assumptions) | 16 m não cruza, 14 m cruza | `test/startLine.test.ts:51-55` | ✅ |
| Independent test: 37.699 ms a 10 Hz | ± 20 ms em todas | `test/lapDetector.test.ts:105-107` | ✅ |

### P1: Uma linha só por traçado (TMP-04, TMP-05, TMP-06)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-04): com traçado, 1º ponto e rumo do traçado | ponto = `layout[0]`, rumo ± 1° | `test/startLine.test.ts:83-86` | ✅ |
| AC2 (TMP-04): sem traçado, ponto de ritmo e rumo do movimento | idem | `test/startLine.test.ts:92-95` | ✅ |
| AC3 (TMP-05): começa andando, 1ª volta no 1º cruzamento | trecho anterior não é volta | `test/lapDetector.test.ts:129-136` (`laps.length === 3` com 4 passagens, `startCross` a ≤ 20 ms do 1º cruzamento); relógio `null` antes: `test/liveLapClock.test.ts:42-51`; tela e publicação: `test/recordingScreen.test.ts:36-44` | ✅ (+ 🟡 tela) |
| Independent test: gravações que começam em pontos diferentes | mesmo cruzamento e tempo ± 20 ms | `test/lapDetector.test.ts:146-152` | ✅ |
| AC4 (TMP-06): mesma linha no ao vivo, no "Encerrar" e na recuperação | a linha do traçado | Recuperação: `test/recovery.test.ts:241-263`; "Encerrar": `test/finishRecording.test.ts:139`; diário antigo: `test/recovery.test.ts:265`; hook (estático): `test/lapRecorderHook.test.ts:24-31` | ✅ (+ 🟡 hook) |

### P1: S1/S2/S3 iguais em todo lugar (TMP-07, TMP-08, TMP-09, TMP-10)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-07): terços do comprimento do traçado | D/3 ± 20 ms; por distância | `test/sectors.test.ts:42-54` (10 e 5 Hz); velocidade variável: `:130-135`. Consumidores: comparação `test/lapCompare.test.ts:35-58`, mapa `test/trackMapScreen.test.ts:13-30`, sessão `test/sessionScreen.test.ts:18-47` | ✅ |
| AC2 (TMP-07): ao vivo pelo instante interpolado, não pelo poll | sem marcação por poll | `src/lib/sectors.ts:75-86`; `test/lapRecorderHook.test.ts:18-22` (sem `sectorBoundaryTsRef`); `test/liveLapClock.test.ts:170` (volta em curso por `openCross`); `test/sectors.test.ts:88-102` | ✅ (+ 🟡 HUD) |
| AC3 (TMP-07): análise ≤ 20 ms do ao vivo | ≤ 20 ms | Função: `test/sectors.test.ts:102` (`Math.abs(va - vb) <= TOL_MS`). Comparação: `test/lapCompare.test.ts:132-133` (`<= 20`, 10 e 5 Hz com fixes ruins), `test/lapCompareScreen.test.ts:13-23`. Sessão: `test/sessionScreen.test.ts:31-47` (S01 e S02 mortos). Mapa: `test/trackMapScreen.test.ts:24-30`. Régua da sessão: `app/session/[id].tsx:229-234` lê o traçado gravado; com a T30 a sessão nova sempre grava o traçado do ao vivo (`test/recordingScreen.test.ts:64-70`), e a T28 não altera o traçado anterior (`test/referenceLayout.test.ts:86-96`) | ✅ |
| Independent test: S1+S2+S3 = duração ± 1 ms | ± 1 ms | `test/sectors.test.ts:57-67`; volta limpa: `test/analysis.test.ts:67`; comparação: `test/lapCompare.test.ts:56-57` | ✅ |
| AC4 (TMP-08): publicar os mesmos S1/S2/S3 | os do fechamento | `src/hooks/useLapRecorder.ts:568-573` → `app/recording.tsx` (`publishLap`) | 🟡 só UAT (passo 2) |
| AC5 (TMP-09): sem traçado, análise pela melhor volta; ao vivo sem setores | régua = melhor volta | Análise: `test/sectors.test.ts:108-135`, `test/sessionScreen.test.ts:24-29`. Ao vivo: `src/hooks/useLapRecorder.ts:476` (`sectorRef` só com linha) | ✅ análise · 🟡 ao vivo (passo 3) |
| AC6 (TMP-10): delta projeta o 1º ponto em s ≈ 0 | `sNormalized < 0,05` | Função: `test/realtimeDelta.test.ts:12-30`. Hook, inclusive depois do box: `test/liveLapClock.test.ts:237-246`, `:248` (estático, `resetLap` só sob `lapOpened`) | ✅ (+ 🟡 hook) |

### P2: Pico de velocidade (TMP-11)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: p99 dos pontos com precisão ≤ 10 m | nearest-rank; 10 m entra, 10,5 m não | `test/speed.test.ts:36-42`, `:44-53` | ✅ |
| AC2: um ponto a 150 km/h em ~80 km/h | < 81 km/h | `test/speed.test.ts:33` (`msToKmh(peak) < 81`) | ✅ |
| AC3: mesmo cálculo na sessão, home, pós-salvamento e insights | p99 em todos | `test/postSave.test.ts:185`; `test/lapInsight.test.ts:157`; `test/homeScreen.test.ts:21-24`; `test/sessionScreen.test.ts:50` | ✅ |
| AC4: sem ponto bom, `null` e "—" | `null`, "—" | `test/speed.test.ts:51-52,60-61`; `test/postSave.test.ts:175`; `test/homeScreen.test.ts:21-24`; `test/sessionScreen.test.ts:50` | ✅ (+ 🟡 telas, passo 5) |

### P2: Insights (TMP-12, TMP-13)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1 (TMP-12): `cleanSamples(10)` e `repairDegenerateTimestamps` | reparada ± 20 ms; fix > 10 m fora | `test/lapInsight.test.ts:100-105`, `:107-138` | ✅ |
| AC2 (TMP-12): volta inválida fora do denominador | média exata das 3 boas | `test/lapInsight.test.ts:86-98` (`Math.abs(loss - mean) < 1e-6`) | ✅ |
| AC3 (TMP-13): só voltas do mesmo traçado | `layoutId` da âncora | `test/lapInsight.test.ts:140-155`; tela: `test/insightsScreen.test.ts:12` | ✅ |

### P3: Timestamp no segundo cheio (TMP-14)

| Critério | Valor da spec | `arquivo:linha` + asserção | Situação |
| -------- | ------------- | -------------------------- | -------- |
| AC1: fix em .000 num lote com sub-segundo mantém o original | …49.900, …50.000, …50.100 | `test/locationHandler.test.ts:159-175` (`deepEqual` exato) | ✅ |
| AC2: tudo quantizado mantém o horário de chegada a 100 ms | `NOW − 200, NOW − 100, NOW` | `test/locationHandler.test.ts:177-186` | ✅ |
| AC3: estritamente crescente | `t[i] > t[i−1]` | `test/locationHandler.test.ts:188-205` | ✅ |

**ACs testáveis em Node**: 28/28 com evidência que mira o valor da spec. Nenhuma lacuna.

---

## Assumptions de 30/09 e 03/10, item por item

| Assumption | Item | Código | Teste | Situação |
| ---------- | ---- | ------ | ----- | -------- |
| 30/09 | Traçado **novo** (id diferente do anterior) | `src/lib/referenceLayout.ts:39` (`layout_<id da volta>`) | `test/referenceLayout.test.ts:65` (`notEqual(next.id, reference.id)`); S05 morto | ✅ |
| 30/09 | Vira o **padrão** da pista | `src/lib/referenceLayout.ts:48`; `src/storage/db.ts:1099` | `test/referenceLayout.test.ts:68`; `test/promoteReferenceLayout.test.ts:29`; `test/recordingScreen.test.ts:51`; S06, S07 e S09 mortos | ✅ |
| 30/09 | **Nome** = anterior + data | `src/lib/referenceLayout.ts:17,37,41` | `test/referenceLayout.test.ts:67` (`'Layout principal · 30/09'`), `:83` (troca a data em vez de empilhar) | ✅ (observação 4) |
| 30/09 | O traçado **anterior não muda** | a função não escreve na entrada; o handler grava só `next` | `test/referenceLayout.test.ts:86-96` com fixture novo por teste; `test/recordingScreen.test.ts:47` (`saveLayout({ ...reference` ausente); S03 e S04 mortos | ✅ |
| 30/09 | **Sessões antigas** presas ao traçado com que foram gravadas | sessão com `layoutId` lê o próprio traçado (`app/session/[id].tsx:229-231`), que não é alterado | `test/sessionScreen.test.ts:28` (`getLayout(ses.layoutId)`); `test/referenceLayout.test.ts:86-96` | ✅ |
| 30/09 | Pontos com as **fronteiras sintéticas** (AD-006) | `src/lib/referenceLayout.ts:42` (`[...best.samples]`, a volta salva pelo `sliceLaps`) | `test/referenceLayout.test.ts:70-72` | ✅ |
| 03/10 | Sessões **sem `layout_id`** (legadas) medidas pelo padrão atual | `app/session/[id].tsx:233-234` (`getDefaultLayoutForTrack`) | `test/sessionScreen.test.ts:24-29` (régua do traçado, senão da melhor volta); o caminho é o que a Assumption pede | ✅ (comportamento declarado na spec) |
| 03/10 | A gravação **salva o traçado de referência**, inclusive no velocímetro demo | `app/recording.tsx:227`, `:427` | `test/recordingScreen.test.ts:64-70` (2 ocorrências exatas; nenhum `layoutId` cru); S15 e S16 mortos | ✅ (+ 🟡 passo 7) |
| 03/10 | O traçado novo **herda o PB** | `src/lib/referenceLayout.ts:57-73`; `app/recording.tsx:918-921`; `src/storage/db.ts:1100` | `test/referenceLayout.test.ts:116-122` (`layoutId` novo, `durationMs 49_776`, `celebrated true`, id novo), `:129` (sem PB, `null`), `:150-153` (49.900 ms não é PB nova com a herança, e seria sem ela); `test/recordingScreen.test.ts:56-62`; `test/promoteReferenceLayout.test.ts:30`; S10 a S14 mortos | ✅ (+ 🟡 passo 7) |
| T32 | Traçado, padrão e PB **numa transação só** | `src/storage/db.ts:1092-1102` | `test/promoteReferenceLayout.test.ts:20-33`; S08, S09 e S10 mortos | ✅ |

---

## Edge cases

- [x] **Parar na linha e sair de novo**: um cruzamento só. `test/lapDetector.test.ts:178` e `:313` (60 s parado, jitter de ±3 m que soma mais de 300 m; trava de 30 m em `src/lib/lapDetector.ts:174,191`; S19 morto).
- [x] **GPS perde sinal no cruzamento (> 2 s)**: `test/startLine.test.ts:63-68` (2001 ms dá nulo, 2000 ms cruza); `test/lapDetector.test.ts:197-217`; acima de 180 s: `test/recovery.test.ts:191`, `test/liveLapClock.test.ts:141`.
- [x] **Traçado com menos de 5 pontos ou comprimento zero**: `test/startLine.test.ts:70-75`, `test/sectors.test.ts:138-140`.
- [x] **1ª volta é a melhor**: sem regra especial (`test/lapDetector.test.ts:106,114`).

## Success Criteria

- [x] **GPX de bancada sem tempos em 00 ms**: `test/lapDetector.test.ts:255-258`, com `every`.
- [x] **Setores do cockpit, do painel e da análise batem até 20 ms**: função (`test/sectors.test.ts:102`), comparação (`test/lapCompare.test.ts:132-133`), sessão presa ao traçado gravado (T30). O painel é UAT (passo 2).
- [x] **`docs/telemetria.md` com as regras novas**: sentido (`docs/telemetria.md:109-114`), interpolação (`:135-149`), terços (`:203-206`), p99 (`:299-307`).

---

## AD-006 nos consumidores

Grep em `app/` e `src/` por `sectorSplits(`, `sectorLapSamples(`, `cleanSamples`, `saveLayout(`, `setDefaultLayout(`, `promoteReferenceLayout(`, `getCurrentPb(`, `savePbRecord(`. Desde a rodada 4 só mudaram `app/recording.tsx`, `src/lib/referenceLayout.ts` e `src/storage/db.ts`.

| Consumidor | Onde | Pontos | Régua | Situação |
| ---------- | ---- | ------ | ----- | -------- |
| Detector e recorte | `src/lib/lapDetector.ts`, `src/recording/finishSession.ts:39-55` | fronteiras `synthetic` no cruzamento | linha única | ✅ |
| "Encerrar" e recuperação | `src/hooks/useLapRecorder.ts`, `src/recording/recovery.ts:115` (`meta.layoutId`, agora com o fallback da T30) | `sliceLaps` | linha da meta | ✅ |
| Cronômetro e reset do delta | `src/recording/liveLapClock.ts:35-58` | `openCross` | – | ✅ |
| Setores ao vivo (fechamento e publicação) | `src/hooks/useLapRecorder.ts:568-573` | `sliceLaps` do poll, crus | `referenceFromLayout` | ✅ |
| Sessão | `app/session/[id].tsx:229-234,265-267` | `sectorLapSamples(l)` sobre `lapsRaw` | traçado gravado na sessão; sem ele, o padrão (Assumption de 03/10); sem traçado, a melhor volta | ✅ |
| Comparar voltas | `src/lib/lapCompare.ts:151-152` | `sectorLapSamples(saved)` | traçado da sessão A | ✅ |
| Mapa detalhado | `app/track-map.tsx:118-119` | `sectorLapSamples(lap)` | `referenceFromLayout` | ✅ (sem rota; observação 6) |
| Traçado novo ("ATUALIZAR REFERÊNCIA") | `src/lib/referenceLayout.ts:42`, `src/storage/db.ts:1092-1102` | os pontos da volta salva, com as fronteiras | – | ✅ |
| PB herdado | `src/lib/referenceLayout.ts:57-73` | não toca pontos | – | ✅ |
| Pico (sessão, home, IA, insights) | `src/lib/speed.ts` e consumidores | p99 | – | ✅ |
| Limpeza de pontos | `src/lib/analysis.ts:307-308` | preserva `synthetic` | – | ✅ |
| Outros escritores de traçado | `app/track-layouts-picker.tsx:140` (padrão escolhido à mão), `src/recording/finishSession.ts:181` (reconhecimento) | fora do fluxo de "ATUALIZAR REFERÊNCIA" | – | ✅ sem mudança |

Nenhum consumidor descarta os pontos de fronteira nem mede S1/S2/S3 sobre outra régua.

---

## Discrimination Sensor

**Scratch**: `git worktree add --detach` em `…/scratchpad/sensor-wt5` (HEAD `7b42ae5`), com symlink de `node_modules`. Cada mutação foi uma troca exata de texto, com uma ocorrência conferida, seguida de `npm test` completo no scratch e de `git checkout HEAD -- <arquivo>` no scratch. Baseline do scratch: 149/149. Sem `git stash`.

São 28 mutações, acima da faixa de 14 a 18 pedida, porque a lista obrigatória já soma 24 itens. Os 4 a mais são variantes que procuram buracos nas guardas novas: o M06 pelo nome (S04), o handler que lê o PB do traçado errado (S11), e o fallback do `layoutId` em cada um dos dois caminhos (S15, S16).

| # | `arquivo:linha` | Mutação | Testes que falharam | Morto? |
| - | --------------- | ------- | ------------------- | ------ |
| S01 | `app/session/[id].tsx:266` | **M02 da rodada 4**: laço dos setores sobre `cleanedLaps` | 1 (`sessionScreen`) | ✅ |
| S02 | `app/session/[id].tsx:267` | **M04 da rodada 3**: `sectorLapSamples({ ...l, samples: cleanSamples(l.samples, 10) })` | 1 (`sessionScreen`) | ✅ |
| S03 | `src/lib/referenceLayout.ts:37` | **M06 da rodada 4**: `reference.isDefault = false` na entrada | 1 (`referenceLayout`, "não é alterado") | ✅ |
| S04 | `src/lib/referenceLayout.ts:37` | variante do M06: `reference.name = baseName` na entrada | 1 (idem) | ✅ |
| S05 | `src/lib/referenceLayout.ts:39` | **M04 da rodada 4**: traçado novo reaproveita `reference.id` | 1 (`referenceLayout`) | ✅ |
| S06 | `app/recording.tsx:921` | **M09 da rodada 4 no handler**: `promoteReferenceLayout({ ...next, id: reference.id }, pb)` | 1 (`recordingScreen`) | ✅ |
| S07 | `src/storage/db.ts:1099` | **M09 dentro de `promoteReferenceLayout`**: padrão em `layout.sourceLapId ?? layout.id` | 1 (`promoteReferenceLayout`) | ✅ |
| S08 | `src/storage/db.ts:1098` | traçado gravado fora do `txn` (`saveLayoutOn(d, layout)`) | 1 (idem) | ✅ |
| S09 | `src/storage/db.ts:1099` | padrão pela conexão principal (`await setDefaultLayout(...)`, fora do `txn`) | 1 (idem) | ✅ |
| S10 | `src/storage/db.ts:1100` | PB herdado não gravado (linha removida) | 1 (idem) | ✅ |
| S11 | `app/recording.tsx:920` | PB lido do traçado novo (`getCurrentPb(reference.trackId, next.id)`, sempre vazio) | 1 (`recordingScreen`) | ✅ |
| S12 | `src/lib/referenceLayout.ts:70` | `inheritedPb`: `celebrated: false` | 1 (`referenceLayout`) | ✅ |
| S13 | `src/lib/referenceLayout.ts:66` | `inheritedPb`: `layoutId` do traçado anterior | 1 (idem) | ✅ |
| S14 | `src/lib/referenceLayout.ts:69` | `inheritedPb`: `durationMs` da volta do traçado novo | 1 (idem) | ✅ |
| S15 | `app/recording.tsx:426` | `layoutId` do `finishRecording` sem o fallback de `reference?.id` | 1 (`recordingScreen`) | ✅ |
| S16 | `app/recording.tsx:226` | `layoutId` da meta do `start()` ignora o parâmetro (`reference?.id ?? null`) | 1 (idem) | ✅ |
| S17 | `src/lib/startLine.ts:89` | `crossing` aceita os dois sentidos | 2 (contramão) | ✅ |
| S18 | `src/lib/startLine.ts:97` | instante no ponto mais próximo, sem interpolação | 15 | ✅ |
| S19 | `src/lib/lapDetector.ts:191` | sem a trava de saída de 30 m | 1 (kart parado 60 s) | ✅ |
| S20 | `src/lib/lapDetector.ts:215` | `openCross` = fim da última volta fechada (ignora o box) | 3 | ✅ |
| S21 | `src/recording/finishSession.ts:48` | `sliceLaps` fecha a volta no ponto cru | 8 | ✅ |
| S22 | `src/lib/sectors.ts:83` | `sectorSplits`: fração pelo `s` em vez da corda | 1 (volta "em curso" × "fechada") | ✅ |
| S23 | `src/lib/sectors.ts:45` | `sectorLapSamples` filtra como `cleanSamples(10)` | 2 (`lapCompare`, 10 e 5 Hz) | ✅ |
| S24 | `src/lib/lapCompare.ts:151` | `compareLaps` ignora `saved` | 2 (idem) | ✅ |
| S25 | `src/recording/liveLapClock.ts:57` | `lapOpened` só na 1ª abertura | 2 | ✅ |
| S26 | `src/lib/speed.ts:29` | pico = máximo em vez do p99 | 5 | ✅ |
| S27 | `src/recording/locationHandler.ts:56` | `trustsRaw` nunca liga | 6 | ✅ |
| S28 | `src/lib/analysis.ts:308` | `cleanSamples` descarta os pontos sintéticos | 2 | ✅ |

**Sensor depth**: P0 (núcleo de tempo e integridade do traçado/PB).
**Sensor**: 28 mutações, 28 mortas, nenhuma sobreviveu.

**Sondagem fora do sensor** (não conta no placar): inserir uma 2ª chamada errada **ao lado** da certa (`await setDefaultLayoutOn(txn, layout.trackId, layout.sourceLapId);` depois da linha 1099) passa a suíte (149/149). É um mutante de inserção, fora das classes do sensor (inverter, trocar valor, off-by-one, remover efeito). A guarda da T29 também não pegava o equivalente no handler. Ver observação 1.

**Isolamento**: `git status --porcelain` antes = depois = `?? CockPit-Guia-do-Testador.pdf`. Worktree removido com `git worktree remove --force` (sem `prune`, para não mexer nos worktrees da Julia em `.claude/worktrees/`). `stash@{0}` intocado; HEAD da árvore real `7b42ae5`.

---

## Defeitos

Nenhum defeito bloqueante. Nenhum caminho inspecionado viola um AC, uma Assumption ou a AD-006.

---

## Só UAT (pendente)

Os 7 passos do Roteiro de UAT de `tasks.md`:

| AC | Código inspecionado | Passo do roteiro |
| -- | ------------------- | ---------------- |
| TMP-05 AC 3 (cockpit "—" antes do 1º cruzamento) e TMP-01 no aparelho | `app/recording.tsx` (`currentLapMs`) | 1. Gravar 3 voltas numa pista com traçado, começando já andando. A 1ª volta só conta no 1º cruzamento, e os tempos não terminam todos em 00 |
| TMP-08 e TMP-07 AC 3 no painel | `src/hooks/useLapRecorder.ts:568-573`, `publishLap` em `app/recording.tsx` | 2. Com a equipe no painel web, o S1/S2/S3 publicado no fechamento é igual ao da análise da sessão (± 0,02 s) |
| TMP-09 (ao vivo sem setores) | `src/hooks/useLapRecorder.ts:476` | 3. Pista sem traçado: a análise mostra S1/S2/S3 pela melhor volta, e o cockpit fica sem setores |
| TMP-03 AC 6 no aparelho | `src/lib/startLine.ts:89` | 4. Passar pela linha na contramão (box): não fecha volta |
| TMP-11 AC 3/4 (telas) | `app/(tabs)/index.tsx`, `app/session/[id].tsx` | 5. A home e a sessão mostram o pico, e "—" quando não há ponto bom |
| TMP-10 e TMP-07 AC 2 (hook, volta depois do box) | `src/hooks/useLapRecorder.ts:516-519,624-640` | 6. Entrar no box por mais de 180 s e voltar: o delta e os setores da volta seguinte começam do zero |
| Assumptions de 30/09 e 03/10 | `app/recording.tsx:913-925`, `src/lib/referenceLayout.ts`, `src/storage/db.ts:1092-1102`, `src/recording/postSave.ts:58-62` | 7. Numa pista com traçado, bater a referência e tocar em ATUALIZAR REFERÊNCIA. O traçado novo ("‹nome› · dd/mm") vira o padrão no seletor e o anterior continua na lista. Uma sessão antiga desse traçado mostra os mesmos S1/S2/S3 de antes do toque. Na sessão seguinte, uma volta mais lenta que o PB do traçado anterior não vira PB (sem celebração). Vale repetir pelo "Velocímetro (demo)" em Ajustes, que grava sem `layoutId` no parâmetro |

---

## Observações não bloqueantes

1. **Guarda estática não pega chamada a mais.** `test/promoteReferenceLayout.test.ts:27-32` confere que as três linhas certas existem dentro do `txn` e que não há escrita pela conexão principal. Uma 2ª chamada `setDefaultLayoutOn(txn, …)` com outro id, inserida depois da certa, passa (sondagem acima). O efeito seria o do M09. Endurecimento barato: assertar que o corpo da transação tem exatamente as três instruções (por exemplo, comparar `inside.trim()` com o texto esperado, ou contar `setDefaultLayoutOn(` = 1). O SQL dos `*On` é o mesmo de antes da T32 (o diff só muda a assinatura), e a matriz põe o adaptador SQLite em UAT.
2. **Corrida no início da gravação.** A referência é carregada por um efeito assíncrono (`app/recording.tsx:144-158`). Se o piloto tocar em iniciar antes de ela chegar, a meta do diário sai com `layoutId: null` (`:227`). O "Encerrar" normal usa a referência já carregada (`:427`), mas a **recuperação** de uma gravação interrompida usa a meta do diário (`src/recording/recovery.ts:115`) e gravaria a sessão sem traçado. A Assumption de 03/10 trata essa sessão como "sem `layout_id`" (régua do padrão atual), então não viola a spec. A janela é de milissegundos (uma leitura SQLite local).
3. **O PB herdado é só o do traçado de referência.** `getCurrentPb(reference.trackId, reference.id)` (`app/recording.tsx:920`) não vê PBs com `layout_id` nulo (sessões legadas, ou do demo antes da T30). É a mesma semântica de PB por traçado que já existia (`src/storage/db.ts:1043-1063`).
4. **Lacuna de precisão no nome** (da rodada 4, sem mudança). A spec diz "o nome do anterior mais a data". A T28 troca a data quando o anterior já termina em ` · dd/mm` (`src/lib/referenceLayout.ts:17,37`). Duas atualizações no mesmo dia geram traçados com o mesmo nome.
5. **Painel web mostra 0 antes do 1º cruzamento, não "—"**: `web-spectator/app/live/[code]/page.tsx:52` e `web-spectator/app/team/[code]/page.tsx:122` (`lastSample?.lapElapsedMs ?? 0`). Vem da rodada 3. "Lendas" também usa `?? 0` (`app/legend-race.tsx:116,121`), anterior à feature.
6. **Mapa detalhado** sem rota que chegue a ele, e com duas geometrias (setores de `referenceFromLayout(layout.samples)`, rótulos do traçado limpo).
7. **Da rodada 1, sem mudança**: `trustsRaw` liga com um fix de sub-segundo que depois é descartado por precisão (`src/recording/locationHandler.ts:55-57`). A régua de setores do hook muda se o traçado for trocado no meio da gravação, enquanto a linha fica a do `start()`.
8. **`compareLaps(…, null, …)` não é alcançável** pela tela, e os testes da comparação calculam a "sessão" com `sectorSplits(a.samples, ref)` (`test/lapCompare.test.ts:125-126`), equivalente sem timestamps degenerados.
9. **O teste da regra de PB herdado prova a regra, não a ligação.** `test/referenceLayout.test.ts:132-154` mostra que `processSessionMilestones` não dá PB nova com `previousPbMs = 49.776`. Que a próxima sessão leia esse valor depende do SQL de `getCurrentPb` e do `layoutId` da sessão (T30). Fica para o passo 7 da UAT.

---

## Rastreabilidade (proposta; `spec.md` não foi editado)

| Requisito | Status proposto |
| --------- | --------------- |
| TMP-01, TMP-02, TMP-03, TMP-04 | ✅ Verificado |
| TMP-05, TMP-06 | ✅ Verificado (UAT pendente na tela e no hook) |
| TMP-07 | ✅ Verificado (UAT pendente no HUD e no painel) |
| TMP-08, TMP-09 | ✅ Verificado na função; UAT pendente |
| TMP-10 | ✅ Verificado (UAT pendente no hook) |
| TMP-11, TMP-12, TMP-13, TMP-14 | ✅ Verificado |
| Assumptions de 30/09 e 03/10 | ✅ Verificado em Node; UAT pendente (passo 7) |

## Summary

**Overall**: ✅ Pronto para a UAT no aparelho
**Checagem ancorada na spec**: 28/28 ACs testáveis em Node com evidência que mira o valor da spec; Assumptions de 30/09 e 03/10 cobertas item por item.
**Sensor**: 28/28 mutações mortas.
**Gate**: 149 passam, 0 falham; typecheck só com a baseline.
**O que funciona**:
- M02, M06 e M09 morrem; as variantes do M09 dentro de `promoteReferenceLayout` (id errado, conexão principal) também.
- A sessão grava o traçado que usou, inclusive sem o parâmetro `layoutId`, nos dois caminhos (meta do diário e "Encerrar").
- O traçado novo herda o PB, já celebrado, e traçado, padrão e PB vão numa transação só, todos pelo `txn`.
- O núcleo inteiro segue matando mutantes: linha, sentido, interpolação, trava, box, `sliceLaps`, `sectorSplits`, `sectorLapSamples`, `compareLaps`, `lapOpened`, p99, `trustsRaw` e `cleanSamples`.

**O que falta**: a UAT no aparelho (7 passos). O endurecimento da observação 1 é opcional.
