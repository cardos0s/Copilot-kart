# Gravação sem perda — Validação

## Validation: gravação sem perda — FAIL ❌

**Data**: 2026-09-24
**Spec**: `.specs/features/gravacao-sem-perda/spec.md`
**Faixa de commits**: `de41376..HEAD` (de41376 = planejamento; `0c3d0f5`…`4a97a57` = T1–T19), branch `feat/gravacao-sem-perda`
**Verificador**: sub-agente independente (autor ≠ verificador)

Motivo do FAIL, em uma linha: todos os gates e todo o sensor passam, mas a inspeção achou um AC violado
(REC-10 AC 3: o aviso "Salvamento automático falhou" não aparece em lugar nenhum da UI) e uma
regressão grave causada pela feature (o GPS real morre na Corrida contra a lenda e na Competição).

---

## Gates

| Gate | Comando | Resultado |
| ---- | ------- | --------- |
| Testes | `npm test` | 50 testes, 50 passam, 0 falham, 0 pulados |
| Typecheck | `npm run typecheck` | Exatamente os 8 erros da baseline (`app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`); nenhum erro novo |

- Testes antes da feature: 0 no `npm test` (o runner não existia; havia só `scripts/self-test-lap-detector.js`, com 5 casos portados para `test/lapDetector.test.ts`).
- Testes depois: 50. Nenhum pulado.

## Tarefas

T1–T19 estão marcadas ✅ em `tasks.md`, uma por commit, na ordem dos números. Nenhuma está bloqueada ou parcial.

---

## Checagem ancorada na spec

Legenda: **coberto** = asserção em Node que bate com o resultado da spec · **só UAT** = só a camada RN
cobre (o `arquivo:linha` é da implementação) · **lacuna de precisão** = a spec não define o resultado
exato · **DEFEITO** = a inspeção achou um caminho que viola o AC.

### REC-01: persistência com no máximo 10 s de perda (Crash, AC 1)

| AC | Evidência (`arquivo:linha` + asserção) | Resultado da spec | Status |
| -- | -------------------------------------- | ----------------- | ------ |
| Pontos de GPS/IMU vão ao armazenamento durável, e a morte do processo perde ≤ 10 s | `test/journal.test.ts:68`: `assert.ok(worstGap <= 10_000)` (60 s a 10 Hz, com poll de 500 ms); `:38` `FLUSH_INTERVAL_MS === 5000`; `:46` nada gravado de 0 a 4,9 s; `:50-53` em t=5 s, 1 pedaço com `seq 0`, 50 GPS e 50 IMU | no máximo 10 s | coberto |
| O GPS da tarefa de localização vai ao diário | `test/locationHandler.test.ts:77-79`: `deepEqual(buf.samples, expected)` e `deepEqual(persistedGps(store, id), expected)` (payload com todos os campos) | pontos persistidos | coberto |
| As tabelas do diário existem | `test/migrations.test.ts:58-60`: `recording_active`, `recording_chunks`, `PRIMARY KEY (recording_id, seq)` | — | coberto |
| Fiação no hook: poll → `appendImu` + `flushIfDue`, e `stop()` → `flush()` | `src/hooks/useLapRecorder.ts:432,436,735`; tarefa: `src/recording/locationTask.ts:37-50` | — | só UAT (roteiro 1) |

### REC-02: oferta de recuperação (Crash, AC 2, 6 e 7)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: antes da home, mostra pista, horário de início e voltas completas, com "Recuperar" e "Descartar" | `test/recovery.test.ts:72-76`: `s.trackName === 'Kartódromo de Conquista'`, `s.startedAt === T0`, `s.laps === 3`; `test/bootCheck.test.ts:65-71`: `r.kind === 'interrupted'`, com o resumo e o diário mantido. Tela: `app/recovery.tsx:135-137,146,155`; antes da home: `app/_layout.tsx:71-81,133` | pista, horário, voltas, e 2 opções | dados cobertos; tela e rota só UAT. Lacuna de precisão: a spec não define o formato do horário |
| AC 6: sem volta completa, "Nenhuma volta completa para recuperar" e só "Descartar" | `test/recovery.test.ts:150`: `s.laps === 0`. Texto e botão único: `app/recovery.tsx:23,140,144` | texto exato e só "Descartar" | `laps = 0` coberto; o texto (confere com a spec, letra por letra) e o botão único são só UAT |
| AC 7: formato desconhecido é descartado, com "Não consegui ler a gravação interrompida" | `test/recovery.test.ts:159,161,164`: `summarize(...) === 'unreadable'` (version 2, meta quebrada, pedaço quebrado); `test/bootCheck.test.ts:94-96`: `{kind:'unreadable'}`, `store.active === null` e os pedaços apagados. Texto: `app/recovery.tsx:24,118` | descarta e informa o texto | descarte coberto; o texto (confere com a spec) é só UAT |

### REC-03: recuperar sem duplicar (Crash, AC 3, 4 e 8)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 3: sessão com as voltas do `detectLaps`, com a mesma pista, traçado, setup e modo | `test/recovery.test.ts:87-100`: `s.trackId === 'track_1'`, `trackName`, `layoutId === 'layout_7'`, `kartSetupId === 'setup_3'`, `mode === 'race'`, `startedAt === T0`, 3 voltas, e as durações iguais às de `sliceLaps(samples)` | valores da meta | coberto (a regra do payload foi respeitada) |
| AC 3 (efeitos): XP, PB, conquistas e desafios, sem IA nem leaderboard | `test/postSave.test.ts:140-145`: cada efeito do jogo chamado 1 vez, e `requestQuickInsight`, `publishLeaderboardEntry`, `ensurePilot` e `getProfile` chamados 0 vez | decisão do design | coberto |
| AC 4: selo "Recuperada" no histórico e na análise | `test/finishSession.test.ts:113`: `repo.sessions[0].recovered === true`; `test/recovery.test.ts:94`: `s.recovered === true`. Selo: `src/components/RecoveredBadge.tsx:11` ("Recuperada"), `app/(tabs)/sessions.tsx:339`, `app/session/[id].tsx:400,415,489`; leitura: `src/storage/db.ts:282,303` | texto "Recuperada" | flag coberta; o selo na tela é só UAT (roteiro 1) |
| AC 8: o app morre na recuperação, e na abertura seguinte a oferta volta sem duplicar | `test/recovery.test.ts:115-123`: depois de falhar o `deleteRecording`, `sessions.length === 1` e o diário continua; ao rodar de novo, `sessions.length === 1` e `laps.length === 3`. `test/finishSession.test.ts:58-60`: `sessions.length === 1`, `laps.length === 4`. `test/bootCheck.test.ts:81-83`: `already-saved` limpa o diário | sem duplicar | coberto |

### REC-04: limpeza (Crash, AC 5 e 9)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 5: "Descartar" apaga os pontos | `test/recovery.test.ts:170-171`: `store.active === null` e `chunks.has(id) === false`. Tela: `app/recovery.tsx:100-108` | apagado | coberto, e a tela é UAT (roteiro 2) |
| AC 9: o "Encerrar" com sucesso apaga os pontos | `test/journal.test.ts:113-115`: `store.active === null`, `chunks.has(id) === false`, `recordingId === null`. Fiação depois do commit: `app/recording.tsx:475` | apagado | `end` coberto; a fiação é só UAT |

### REC-05: "Encerrar" atômico (AC 1 e 2)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: sessão e voltas numa transação só | `test/finishSession.test.ts:48-50`: rejeita com `/disk I\/O error na volta 3/`, `sessions.length === 0` e `laps.length === 0`. Adaptador: `src/storage/sessionRepo.ts:65-70` (tudo passa pelo `txn`) | tudo ou nada | coberto (com o repositório falso); o SQLite real é UAT |
| AC 2: na falha, os pontos ficam, a tela sai e a mensagem aparece | Texto: `app/recording.tsx:80-81`, que confere com a spec letra por letra. O catch sai antes do `journal.end`: `app/recording.tsx:455-470` | mantém o diário, sai e mostra a mensagem | **só UAT**. O Independent Test pede que os pontos continuem lá depois da falha, mas nenhum teste em Node junta a falha do `saveRecordedSession` com o diário (a orquestração ficou na tela) |

### REC-06: inicialização do banco sem corrida (AC 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Schema e migrações terminam antes de qualquer leitura ou escrita, mesmo com chamadas simultâneas | `test/once.test.ts:27-32`: `calls === 1`, as duas chamadas recebem `conn`, e `ready === true`; `:43-45`: depois de uma rejeição, a chamada seguinte tenta de novo. Uso: `src/storage/db.ts:10` (`export const db = once(...)`, sem `dbInstance` global) | init único, sem leitura antes | coberto |

### REC-07: sair só com confirmação

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: sem o gesto de voltar do iOS nas duas telas | `test/rootLayout.test.ts:21-22`: `gestureEnabled: false` em `recording` e `recording-reference` (`app/_layout.tsx:178,181`) | gesto desligado | coberto (estático); o efeito real é UAT (roteiro 3) |
| AC 2: o voltar do Android e o cancelar abrem a confirmação com as 3 opções | `test/exitGuard.test.ts:12-21`: `state === 'confirming'` e os rótulos exatos "Continuar gravando", "Encerrar e salvar" e "Descartar"; `test/recordingScreen.test.ts:21`: `BackHandler.addEventListener('hardwareBackPress'`. O reconhecimento (`app/recording-reference.tsx:331-338`) não tem asserção estática | 3 opções com esses textos | coberto em `recording.tsx`; no `recording-reference.tsx` é só UAT |
| AC 3: "Encerrar e salvar" segue o caminho do "Encerrar" | `test/exitGuard.test.ts:29`: `{state:'recording', effect:'finish'}`. Fiação: `app/recording.tsx:523` (`doFinish`) e `app/recording-reference.tsx:317` (`handleFinish`) | mesmo caminho | redutor coberto; a fiação é só UAT |
| AC 4: "Descartar" para o GPS, apaga os pontos e sai | `test/exitGuard.test.ts:33`: `effect: 'discard'`. Fiação: `app/recording.tsx:513-518`, `app/recording-reference.tsx:307-312` | para, apaga e sai | redutor coberto; a fiação é só UAT |

### REC-08: sem alerta nativo em paisagem

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: tela presa em paisagem usa modal próprio, sem `Alert.alert` | `test/recordingScreen.test.ts:14,17` e `test/recordingReferenceScreen.test.ts:14,17`: nenhum `Alert.alert`, e `Alert` não é importado | nenhum `Alert.alert` | coberto nas duas telas de gravação. **Lacuna de precisão, e violação pela letra**: o AC fala de *qualquer* tela presa em paisagem, e o Out of Scope só exclui as telas que não ficam em paisagem. `app/legend-race.tsx:90` e `app/competition-race.tsx:127` travam paisagem (`useLockLandscape` em `:42` e `:71`) e ainda chamam `Alert.alert` no erro de GPS |
| AC 2: meta do reconhecimento atingida mostra aviso sem toque e a gravação segue | Faixa com `pointerEvents="none"`: `app/recording-reference.tsx:490-491` | aviso sem toque | só UAT. Lacuna de precisão: a spec não define o texto do aviso |

### REC-09: tarefa de GPS órfã (AC 1)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Na abertura, com a tarefa registrada, o app a para e trata os pontos como gravação interrompida | `test/bootCheck.test.ts:52-53`: `calls.stop === 1`, `isRunning() === false`, `{kind:'none'}`; `:63-70`: com diário, para e dá `interrupted`. `test/locationHandler.test.ts:87,93`: sem diário ativo, a tarefa para a si mesma. Real: `src/recording/runtime.ts:62-63`, `app/_layout.tsx:3,71` | `hasStartedLocationUpdatesAsync` fica falso | coberto; o aparelho é UAT (roteiro 5) |

### REC-10: falhas de início e de escrita (AC 2 e 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: se o GPS não liga, solta o keep-awake, volta ao ocioso e mostra a mensagem | Texto: `src/hooks/useLapRecorder.ts:20-21`, que confere com a spec letra por letra. Caminho: `:402-411` (`deactivateKeepAwake`, `setState('idle')`, `throw new Error(GPS_START_ERROR)`). Diálogo: `app/recording.tsx:237-241` | mensagem exata | só UAT (roteiro 6) |
| AC 3: se a escrita falha, a gravação segue em memória e o HUD mostra "Salvamento automático falhou" | `test/journal.test.ts:83-84`: `failed === true`, a falha não lança, e o pendente é mantido e regravado (`:88-91`). `info.autosaveFailed` sai em `src/hooks/useLapRecorder.ts:689` | faixa no HUD com o texto exato | **DEFEITO**: nenhuma tela lê `info.autosaveFailed`, e o texto "Salvamento automático falhou" não existe em `app/` nem em `src/components/` (só aparece num comentário, `src/hooks/useLapRecorder.ts:190`). O piloto nunca vê o aviso. O mesmo vale para o edge case do disco cheio |

### REC-11: traçado recém-reconhecido (AC 1)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| A gravação logo depois do reconhecimento usa o traçado novo | `test/recordingReferenceScreen.test.ts:23-24`: uma transição para `/recording`, com `layoutId` nos params. Valor: `app/recording-reference.tsx:169` (`transition.layoutId`, vindo de `layout.id` no `setTransition` de `:287-292`). A sessão usa `params.layoutId`: `app/recording.tsx:447` | `layout_id` do traçado novo | coberto (estático); o valor ponta a ponta é UAT (roteiro 7) |

### REC-12: `null`, nunca `''` (AC 2 e 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: sem traçado ou setup, grava `null` | `test/finishSession.test.ts:100-107`: `normalizeId('') === null`, `normalizeId(undefined) === null`, e `sessions[0].layoutId === null` e `kartSetupId === null` com a entrada `''` | `null` | coberto |
| AC 3: a migração converte os vazios em sessões e PBs | `test/migrations.test.ts:75-77`: os três `UPDATE ... = NULL WHERE ... = ''` (`sessions.layout_id`, `sessions.kart_setup_id`, `pb_records.layout_id`; `pb_records` não tem `kart_setup_id`); `:55` a última instrução é `PRAGMA user_version = 4`; `:84` na falha, a versão não sobe | `null` | coberto |

### REC-13: bloqueio de nova gravação (AC 4)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Com uma gravação interrompida pendente, iniciar outra pede recuperar ou descartar | `test/journal.test.ts:100-101`: `rejects(... instanceof UnresolvedRecordingError)` e `recordingId === null`. Redirecionamento: `app/recording.tsx:231-235`, `app/recording-reference.tsx:206-210` | pede resolver antes | coberto; a navegação é UAT |

**Resumo**: todos os ACs testáveis em Node têm evidência `arquivo:linha`, e o valor assertado bate com
a spec. Há 1 AC violado na inspeção (REC-10 AC 3) e 3 lacunas de precisão da spec (REC-08 AC 1 escopo,
REC-08 AC 2 texto do aviso, REC-02 AC 2 formato do horário).

---

## Edge cases

- [ ] **Disco cheio durante a gravação**: o diário segue e guarda o pendente (`test/journal.test.ts:80-91`, com o erro `database or disk is full`), mas o aviso do HUD não existe. É o mesmo DEFEITO de REC-10 AC 3.
- [x] **Fechamento forçado na tela de recuperação**: o diário só sai depois do commit (`src/recording/recovery.ts:126`), e `test/recovery.test.ts:115-123` cobre a morte entre o commit e a limpeza.
- [x] **Mais de 180 s sem pontos**: a recuperação usa `detectLaps` e `sliceLaps` sem regra própria (`src/recording/recovery.ts:64,91`), como a spec pede. Não há teste dedicado com um buraco de 180 s (lacuna menor de cobertura).
- [x] **Reconhecimento interrompido**: vira traçado de referência (`test/recovery.test.ts:134-142`: nenhuma sessão, 1 layout com o nome da meta e a melhor volta). A tela troca o título: `app/recovery.tsx:129-131`.

---

## Sensor de discriminação

Scratch isolado: `git worktree add --detach <scratchpad>/wt HEAD`, com symlink de `node_modules`. Cada
mutante rodou só os arquivos de teste relevantes, e o arquivo foi restaurado com `git checkout` entre um
mutante e o outro. No fim, o symlink foi removido e o worktree também (`git worktree remove --force`).
O `git status --porcelain` da árvore real ficou igual ao baseline (`?? CockPit-Guia-do-Testador.pdf`).

| # | Arquivo:linha | Mutação | Testes que falharam | Morta? |
| - | ------------- | ------- | ------------------- | ------ |
| M1 | `src/recording/journal.ts:104` | Intervalo do flush de 5 s para 15 s (`FLUSH_INTERVAL_MS * 3`) | journal #1 (t=5 s) e #2 (≤ 10 s) | ✅ morta |
| M2 | `src/recording/journal.ts:126-127` | Na falha do store, o pendente é descartado | journal #3 | ✅ morta |
| M3 | `src/recording/finishSession.ts:111` | `saveRecordedSession` sem checar se o id já existe | finishSession #2 e recovery "morre depois do commit" | ✅ morta |
| M4 | `src/recording/finishSession.ts:39` | `normalizeId` com `v ?? null`, deixando `''` passar | finishSession #4 | ✅ morta |
| M5 | `src/recording/recovery.ts:36` | `summarize` aceita `version` ≥ 1 (a 2 passa) | recovery "version 2 ou JSON quebrado" | ✅ morta |
| M6 | `src/recording/bootCheck.ts:27` | `runBootCheck` não para a tarefa | bootCheck #1 e #2 | ✅ morta |
| M7 | `src/recording/exitGuard.ts:30` | `continue` emite o efeito `discard` | exitGuard #2 | ✅ morta |
| M8 | `src/recording/postSave.ts:137` | IA e leaderboard rodam também com `fromRecovery` | postSave #3 | ✅ morta |

**Profundidade**: caminho crítico (integridade de dados), com 8 mutações manuais cobrindo todos os
módulos puros novos. **8/8 mortas.**

---

## Defeitos da inspeção (em ordem de gravidade)

### D1: o aviso "Salvamento automático falhou" nunca aparece (REC-10 AC 3; edge case do disco cheio): viola o AC

- **Causa**: o hook expõe `info.autosaveFailed` (`src/hooks/useLapRecorder.ts:689`), mas nem `app/recording.tsx` nem `app/recording-reference.tsx` o leem, e o texto da spec não existe na UI.
- **Correção**: renderizar no HUD das duas telas uma faixa sem toque, com o texto exato "Salvamento automático falhou", quando `info.autosaveFailed`. Somar uma invariante estática em `test/recordingScreen.test.ts` e em `test/recordingReferenceScreen.test.ts` (o fonte contém `autosaveFailed` e o texto).
- **Gravidade**: Major.

### D2: o GPS real morre na Corrida contra a lenda e na Competição (regressão da T8/T15)

- **Causa**: `app/legend-race.tsx:88` e `app/competition-race.tsx:125` chamam `start({ simulate: isDemo })` sem `meta`. Sem meta, o hook não chama `setLocationTaskJournal` (`src/hooks/useLapRecorder.ts:340-348`), então o diário da tarefa fica `null`. No primeiro lote de pontos, `handleLocations` vê "sem diário ativo", chama `stopLocationUpdates` e devolve sem pôr nada no `buf` (`src/recording/locationHandler.ts:31-34`). Antes da feature, o `defineTask` sempre entregava ao `buf` (`git show de41376:src/hooks/useLapRecorder.ts`, linhas 25-68). O modo real é o padrão nas duas telas: `isDemo = params.simulate === '1'` (`app/legend-race.tsx:39`, `app/competition-race.tsx:64`).
- **Efeito**: nas duas telas, com GPS de verdade, nenhum ponto chega, nenhuma volta fecha, e o GPS se desliga sozinho.
- **Correção**: separar "tarefa com dono" de "gravação com diário", com uma destas opções:
  - o hook registra o dono da tarefa em todo `start` (por exemplo, `setLocationTaskOwner` com um diário opcional), e `handleLocations` só se para quando não há dono;
  - ou as duas telas passam a gravar com meta.
- Somar um teste em `test/locationHandler.test.ts` para "gravação ativa sem diário ainda entrega ao `buf`".
- **Gravidade**: Blocker para essas duas telas. Não viola um AC da spec pela letra, mas quebra funcionalidade que existia.

### D3: `Alert.alert` em telas presas em paisagem fora das duas telas de gravação (REC-08 AC 1, pela letra)

- `app/legend-race.tsx:90` e `app/competition-race.tsx:127`: erro de GPS com alerta nativo em tela travada em paisagem. Com D2, esse alerta (agora com a mensagem de REC-10) também pode aparecer ali.
- O Problem Statement fala das "duas telas de gravação", mas o AC e o Out of Scope cobrem qualquer tela em paisagem. É preciso decidir: ou ajustar a spec, ou trocar os dois alertas pelo `CockpitDialog`.
- **Gravidade**: Minor/Major, conforme a decisão sobre a spec.

### D4: REC-05 AC 2 sem teste em Node para "os pontos persistidos continuam lá"

- O Independent Test da story pede isso, mas a orquestração "salvar e só então `journal.end`" ficou no `doFinish` da tela (`app/recording.tsx:440-475`). O código está certo na inspeção; o risco é de regressão futura, porque nada a detecta.
- **Sugestão**: extrair um `finishRecording(journal, repo, input)` puro, com um teste de falha na 3ª volta que confere `store.active !== null` e os pedaços intactos.
- **Gravidade**: Minor.

### Observações de menor peso (sem reprovar)

- **O SAVE_ERROR fala de "sessão" também para traçado**: `recover` de um reconhecimento com `trackId` nulo lança "Reconhecimento sem pista." (`src/recording/recovery.ts:96`), e a tela mostra essa mensagem (`app/recovery.tsx:95`). Na prática, a única saída é "Descartar", a cada abertura.
- **Risco a observar na UAT**: o `busy_timeout` de 2 s é aplicado só na conexão principal (`src/storage/journalStore.ts:21`). O `withExclusiveTransactionAsync` do expo-sqlite pode abrir uma conexão própria, sem esse timeout (`src/storage/sessionRepo.ts:67`, `src/storage/journalStore.ts:68`). Hoje o `stop()` para o GPS antes do salvamento, então não vi concorrência real, mas vale conferir no aparelho que "Encerrar" não cai em SQLITE_BUSY.
- **Tela de recuperação**: `app/recovery.tsx:60` roda `runBootCheck` de novo. Isso é correto para quem chega pelo `UnresolvedRecordingError`.

---

## Qualidade do código

| Princípio | Status |
| --------- | ------ |
| Código mínimo e mudanças cirúrgicas | ✅. A limpeza de `BENCH_MODE`/`detectorOptions` no reconhecimento está declarada na T17 |
| Sem escopo extra | ✅ |
| Segue os padrões do repo | ✅ |
| Asserções batem com a spec (textos, 10 s, 3 opções, `null`) | ✅ onde há teste |
| Cobertura por camada da matriz (lógica pura 1:1 com os ACs) | ✅, exceto o edge case de 180 s sem teste dedicado |
| Todo teste mapeia um AC, edge case ou Done-when | ✅ (`lapDetector.test.ts` é a suíte portada da T1) |
| Diretrizes documentadas | nenhuma; valem os defaults fortes |

---

## Fica para a UAT no aparelho (roteiro de `tasks.md`)

- REC-01: fiação do hook e da tarefa (roteiro 1)
- REC-02: tela de recuperação antes da home, os textos de AC 6 e AC 7, e o botão único (roteiro 1)
- REC-03 AC 4: selo "Recuperada" no histórico e na análise (roteiro 1)
- REC-04: "Descartar" na tela e o `journal.end` depois do "Encerrar" (roteiro 2)
- REC-05 AC 2: mensagem, saída da tela e diário mantido; e a transação real no SQLite
- REC-07: gesto do iOS, voltar do Android nas duas telas e a fiação de "Encerrar e salvar"/"Descartar" (roteiro 3)
- REC-08: diálogos em paisagem sem girar a tela; faixa da meta sem toque (roteiro 4)
- REC-09: a notificação "gravando" some ao abrir (roteiro 5)
- REC-10 AC 2: mensagem com a permissão negada, sem ficar preso em "requesting" (roteiro 6)
- REC-10 AC 3: só depois de corrigir D1
- REC-11: traçado novo na sessão (roteiro 7)
- REC-13: redirecionamento para `/recovery`
- Somar ao roteiro, por D2: Corrida contra a lenda e Competição com GPS real

---

## Rastreabilidade

| Requisito | Novo status |
| --------- | ----------- |
| REC-01, REC-03, REC-04, REC-05, REC-06, REC-09, REC-11, REC-12, REC-13 | Verificado em Node; UAT pendente |
| REC-02, REC-07, REC-08 | Verificado em Node nas partes puras; UAT pendente; REC-08 com decisão de escopo (D3) |
| REC-10 | ❌ Precisa de correção (D1) |

## Resumo

**Geral**: ❌ Não está pronto.

- **Checagem ancorada na spec**: todos os ACs testáveis em Node batem com a spec; há 3 lacunas de precisão e 1 AC violado na inspeção.
- **Sensor**: 8/8 mortas.
- **Gates**: 50 passam e 0 falham; typecheck só com a baseline.
- **Próximos passos**: corrigir D1 e D2 (fix tasks), decidir o escopo de D3 e, se quiser, fazer D4. Depois, verificar de novo.
