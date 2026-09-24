# Gravação sem perda — Validação

## Validation (rodada 2): gravação sem perda — FAIL ❌

**Data**: 2026-09-24
**Rodada**: 2 (a rodada 1 reprovou; as lacunas dela viraram T20–T26, Phase 5 de `tasks.md`)
**Spec**: `.specs/features/gravacao-sem-perda/spec.md`
**Faixa de commits**: `de41376..HEAD` (HEAD = `71a0c46`), branch `feat/gravacao-sem-perda`. `0c3d0f5`…`4a97a57` = T1–T19; `823155e` = relatório da rodada 1; `d9693da`…`71a0c46` = T20–T26
**Verificador**: sub-agente independente (autor ≠ verificador). Tudo foi derivado de novo a partir da spec e do código; o relatório da rodada 1 só serviu para saber o que ela tinha reprovado.

Motivo do FAIL, em uma linha: as 5 lacunas da rodada 1 estão fechadas, os gates passam e nenhum AC é violado na
inspeção, mas um mutante sobreviveu. A combinação real de produção da tarefa de GPS depois da T20 (diário ativo
**e** `uiActive = true`) não tem teste. Um handler que deixa de gravar no diário quando a tela está ativa quebra
REC-01 AC 1 na tela de gravação, e a suíte não pega isso.

---

## Lacunas da rodada 1

| # | Lacuna da rodada 1 | Evidência nesta rodada | Estado |
| - | ------------------ | ---------------------- | ------ |
| a | O GPS morria na Competição e na Corrida contra a lenda (gravam sem diário) | `src/recording/locationHandler.ts:34-38`: só para quando `!journal && !deps.uiActive`; `:67-68`: entrega ao `buf` e só depois sai se não há diário. `test/locationHandler.test.ts:98-116`: com `uiActive = true` e sem diário, `calls.stop === 0` e `buf.samples` com o payload inteiro (`deepEqual`), inclusive com `journal: null`. `test/locationHandler.test.ts:118-125`: sem tela e sem diário, `calls.stop === 2` e `buf.samples` vazio. Fiação: `src/hooks/useLapRecorder.ts:355` (liga no `start`), `:415` (desliga na falha do GPS), `:727` (no `stop`), `:772` (no unmount); `src/recording/locationTask.ts:21,33-35,57` | fechada |
| b | O aviso "Salvamento automático falhou" não aparecia | `app/recording.tsx:692-696` e `app/recording-reference.tsx:500-507`: faixa `pointerEvents="none"` sob `{info.autosaveFailed && (...)}` com o texto exato. `test/recordingScreen.test.ts:30-34` e `test/recordingReferenceScreen.test.ts:27-31`: regex do bloco condicional e `includes('>Salvamento automático falhou<')`. A flag vem de `src/hooks/useLapRecorder.ts:697` (`journal.failed`); o valor inicial é `false` (`:257`) | fechada (estático; o efeito é UAT) |
| c | `Alert.alert` em telas presas em paisagem | `grep` em todo `app/`: as 4 telas com `useLockLandscape` (`app/recording.tsx:106`, `app/recording-reference.tsx:133`, `app/legend-race.tsx:43`, `app/competition-race.tsx:72`) não chamam `Alert.alert` nem importam `Alert`; o `Alert` que sobra está só em telas que não travam paisagem (`settings`, `new-session`, `kart-setups`, `profile-edit`, `(tabs)/sessions`, `kart-setup-edit`, `track-layouts-picker`, `coach`, `ai-key`, `onboarding/email`), o que o Out of Scope permite. Não há `Alert.alert` em `src/`, e `ScreenOrientation.lockAsync` só existe em `src/hooks/useLockLandscape.ts:25`. Testes: `test/competitionRaceScreen.test.ts:13-20` e `test/legendRaceScreen.test.ts:13-20` (sem `Alert.alert`, sem `Alert` no import, com `<CockpitDialog`). O `CockpitDialog` é uma `View` absoluta, não um `Modal` (`src/components/CockpitDialog.tsx:31-33`) | fechada |
| d | REC-05 AC 2 sem teste em Node ("a falha mantém o diário") | `src/recording/finishRecording.ts:48-54`: o `catch` do `saveRecordedSession` devolve `save-failed` sem `journal.end`. `test/finishRecording.test.ts:76-94`: com o repo falhando na 3ª volta, `out.kind === 'save-failed'`, `endCalls` vazio, `postSaveCalls` vazio, 0 sessões e 0 voltas, `store.active.id === recordingId` e os pontos persistidos iguais aos de antes (`deepEqual`). A tela usa a função: `app/recording.tsx:420`, e `test/recordingScreen.test.ts:24-28` confere que ela não chama mais `saveRecordedSession` | fechada |
| e | Edge case de mais de 180 s sem teste | `test/recovery.test.ts:190-223`: buraco de 200 s no meio da 3ª volta; `recover` grava exatamente as voltas do `detectLaps` (`deepEqual` de `[startedAt, durationMs]`), 3 voltas, nenhuma com mais de 180 s nem atravessando o buraco, 2 antes e 1 depois | fechada |

---

## Gates

| Gate | Comando | Resultado |
| ---- | ------- | --------- |
| Testes | `npm test` | 61 testes, 61 passam, 0 falham, 0 pulados (exit 0) |
| Typecheck | `npm run typecheck` | Exatamente os 8 erros da baseline: `app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`. Nenhum erro novo |

- Testes antes da feature: 0 no `npm test` (o runner nasceu na T1). Depois da rodada 1: 50. Agora: 61 (+11 com T20–T26). Nenhum teste foi apagado, e nenhuma asserção antiga foi afrouxada: o teste "sem diário ativo, para a tarefa" (`test/locationHandler.test.ts:84-96`) continua igual, agora com `uiActive = false` por padrão.

## Tarefas

T1–T26 estão ✅ em `tasks.md`, uma por commit. Nenhuma bloqueada ou parcial.

---

## Checagem ancorada na spec

Legenda: **coberto** = asserção em Node que bate com o resultado da spec · **só UAT (pendente)** = só a camada RN
cobre (o `arquivo:linha` é da implementação) · **lacuna de precisão** = a spec não define o resultado exato.

### REC-01: persistência com no máximo 10 s de perda (Crash, AC 1)

| AC | Evidência (`arquivo:linha` + asserção) | Resultado da spec | Status |
| -- | -------------------------------------- | ----------------- | ------ |
| Pontos de GPS/IMU vão ao armazenamento durável, e a morte do processo perde ≤ 10 s | `test/journal.test.ts:68`: `assert.ok(worstGap <= 10_000)` em 60 s a 10 Hz; `:38` `FLUSH_INTERVAL_MS === 5000`; `:46` nada gravado de 0 a 4,9 s; `:50-53` em t=5 s, 1 pedaço, `seq 0`, 50 GPS e 50 IMU | no máximo 10 s | coberto |
| O GPS da tarefa de localização vai ao diário | `test/locationHandler.test.ts:78-81`: `deepEqual(buf.samples, expected)`, `deepEqual(persistedGps(store, id), expected)` e `calls.stop === 0` | pontos persistidos | coberto **só com `uiActive = false`**. Em produção a tela de gravação liga as duas coisas (`src/hooks/useLapRecorder.ts:352,355`), e essa combinação não tem teste: o mutante P1 sobreviveu (ver Sensor) |
| Fiação no hook: poll → `appendImu` + `flushIfDue`, e `stop()` → `flush()` | `src/hooks/useLapRecorder.ts:440,444,744` | — | só UAT (pendente, roteiro 1) |

### REC-02: oferta de recuperação (Crash, AC 2, 6 e 7)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: antes da home, pista, horário de início e voltas completas, com "Recuperar" e "Descartar" | `test/recovery.test.ts:74-76`: `trackName === 'Kartódromo de Conquista'`, `startedAt === T0`, `laps === 3`; `test/bootCheck.test.ts:65-71`: `kind === 'interrupted'`, resumo e diário mantido. Tela: `app/recovery.tsx:135-137,146,155`; antes da home: `app/_layout.tsx:71-81,133` | pista, horário, voltas e 2 opções | dados cobertos; tela e rota só UAT (pendente). Lacuna de precisão: a spec não define o formato do horário |
| AC 6: sem volta completa, "Nenhuma volta completa para recuperar" e só "Descartar" | `test/recovery.test.ts:152`: `laps === 0`. Texto e botão único: `app/recovery.tsx:23,140,144` | texto exato e só "Descartar" | `laps = 0` coberto; o texto (confere letra por letra) e o botão único são só UAT (pendente) |
| AC 7: formato desconhecido é descartado, com "Não consegui ler a gravação interrompida" | `test/recovery.test.ts:161,163,166`: `summarize(...) === 'unreadable'` (version 2, meta quebrada, pedaço quebrado); `test/bootCheck.test.ts:94-96`: `{kind:'unreadable'}`, `store.active === null`, pedaços apagados. Texto: `app/recovery.tsx:24,118` | descarta e informa | descarte coberto; o texto (confere com a spec) é só UAT (pendente) |

### REC-03: recuperar sem duplicar (Crash, AC 3, 4 e 8)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 3: sessão com as voltas do `detectLaps`, mesma pista, traçado, setup e modo | `test/recovery.test.ts:87-102`: `trackId === 'track_1'`, `trackName`, `layoutId === 'layout_7'`, `kartSetupId === 'setup_3'`, `mode === 'race'`, `startedAt === T0`, 3 voltas com as durações de `sliceLaps(samples)` | valores da meta | coberto |
| AC 3 (efeitos): XP, PB, conquistas e desafios, sem IA nem leaderboard | `test/postSave.test.ts:140-145`: cada efeito do jogo 1 vez; `getProfile`, `requestQuickInsight`, `pushCoachInsight`, `ensurePilot`, `publishLeaderboardEntry` 0 vez | decisão do design | coberto |
| AC 4: selo "Recuperada" no histórico e na análise | `test/finishSession.test.ts:113`: `sessions[0].recovered === true` (e `:117` `false` no normal); `test/recovery.test.ts:96`. Selo: `src/components/RecoveredBadge.tsx:8`, `app/(tabs)/sessions.tsx:339`, `app/session/[id].tsx:400,415,489` | "Recuperada" | flag coberta; selo na tela só UAT (pendente) |
| AC 8: morre na recuperação, e na abertura seguinte a oferta volta sem duplicar | `test/recovery.test.ts:117-125`: depois de falhar o `deleteRecording`, `sessions.length === 1` e o diário continua; de novo, `sessions.length === 1`, `laps.length === 3`. `test/finishSession.test.ts:58-60`; `test/bootCheck.test.ts:81-83` (`already-saved` limpa) | sem duplicar | coberto |

### REC-04: limpeza (Crash, AC 5 e 9)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 5: "Descartar" apaga os pontos | `test/recovery.test.ts:171-172`: `store.active === null`, `chunks.has(id) === false`. Tela: `app/recovery.tsx:103` | apagado | coberto; a tela é UAT (pendente, roteiro 2) |
| AC 9: o "Encerrar" com sucesso apaga os pontos | `test/finishRecording.test.ts:130-132`: `events` = `['end(sessões gravadas: 1)', 'postSave']` (o `end` só com a sessão no banco), `store.active === null`, `chunks.size === 0`; `test/journal.test.ts:113-115` | apagado | coberto (a tela chama a função: `app/recording.tsx:420`) |

### REC-05: "Encerrar" atômico (AC 1 e 2)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: sessão e voltas numa transação só | `test/finishSession.test.ts:48-50`: rejeita com `/disk I\/O error na volta 3/`, 0 sessões e 0 voltas; `test/finishRecording.test.ts:89-90`. Adaptador: `src/storage/sessionRepo.ts:65-67` | tudo ou nada | coberto com o repo falso; o SQLite real é UAT (pendente) |
| AC 2: na falha, os pontos ficam, a tela sai e a mensagem aparece | `test/finishRecording.test.ts:85-93` (diário e pedaços intactos, sem `journal.end` nem efeitos). Mensagem: `app/recording.tsx:81-82` (confere letra por letra), diálogo e saída para `/`: `app/recording.tsx:460-476` | mantém, sai e mostra | diário coberto; mensagem e saída só UAT (pendente) |

### REC-06: inicialização do banco sem corrida (AC 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Schema e migrações antes de qualquer leitura ou escrita, mesmo com chamadas simultâneas | `test/once.test.ts:27-32`: `calls === 1`, as duas recebem `conn`, `ready === true`; `:43-45`: rejeição não prende. Uso: `src/storage/db.ts:10` | init único | coberto |

### REC-07: sair só com confirmação

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: sem gesto de voltar do iOS | `test/rootLayout.test.ts:21-22`: `gestureEnabled: false` em `recording` e `recording-reference` (`app/_layout.tsx:178,181`) | desligado | coberto (estático); efeito real só UAT (pendente, roteiro 3) |
| AC 2: voltar do Android e cancelar abrem a confirmação com 3 opções | `test/exitGuard.test.ts:12-21`: `state === 'confirming'` e os rótulos exatos; `test/recordingScreen.test.ts:21`. Reconhecimento: `app/recording-reference.tsx:323,334,541` | 3 opções | coberto em `recording.tsx`; no reconhecimento só UAT (pendente) |
| AC 3: "Encerrar e salvar" = "Encerrar" | `test/exitGuard.test.ts:29`: `{state:'recording', effect:'finish'}`. Fiação: `app/recording.tsx:518-522` (`doFinish`), `app/recording-reference.tsx:314-318` (`handleFinish`) | mesmo caminho | redutor coberto; fiação só UAT (pendente) |
| AC 4: "Descartar" para o GPS, apaga e sai | `test/exitGuard.test.ts:33`: `effect: 'discard'`. Fiação: `app/recording.tsx:511-516`, `app/recording-reference.tsx:307-312` | para, apaga e sai | redutor coberto; fiação só UAT (pendente) |

### REC-08: sem alerta nativo em paisagem

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: tela presa em paisagem usa modal próprio, sem `Alert.alert` | `test/recordingScreen.test.ts:14,17`, `test/recordingReferenceScreen.test.ts:14,17`, `test/competitionRaceScreen.test.ts:14,17-18`, `test/legendRaceScreen.test.ts:14,17-18`. As 4 são todas as telas com `useLockLandscape` (lacuna c) | nenhum `Alert.alert` | coberto; diálogos em paisagem no aparelho só UAT (pendente, roteiro 4) |
| AC 2: meta do reconhecimento atingida mostra aviso sem toque e a gravação segue | `app/recording-reference.tsx:490-494` (`pointerEvents="none"`, "META ATINGIDA · … Siga gravando ou encerre quando quiser.") | aviso sem toque | só UAT (pendente). Lacuna de precisão: a spec não define o texto |

### REC-09: tarefa de GPS órfã (AC 1)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Na abertura, com a tarefa registrada, o app a para e trata os pontos como gravação interrompida | `test/bootCheck.test.ts:52-53`: `calls.stop === 1`, `isRunning() === false`, `{kind:'none'}`; `:63-70`: com diário, para e dá `interrupted`. `test/locationHandler.test.ts:118-125`: processo sem tela ativa (`uiActive = false`, o valor inicial de `src/recording/locationTask.ts:21`) e sem diário, a tarefa se para. Real: `src/recording/runtime.ts:62-63,72`, `app/_layout.tsx:3,71` | `hasStartedLocationUpdatesAsync` falso | coberto; aparelho só UAT (pendente, roteiro 5) |

### REC-10: falhas de início e de escrita (AC 2 e 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: GPS não liga → solta keep-awake, volta ao ocioso, mensagem | Texto: `src/hooks/useLapRecorder.ts:25-26` (confere letra por letra). Caminho: `:410-418`. Diálogo: `app/recording.tsx:238-242`, `app/recording-reference.tsx:212-216`, e agora `app/competition-race.tsx:131` e `app/legend-race.tsx:94` via `CockpitDialog` | mensagem exata | só UAT (pendente, roteiro 6) |
| AC 3: escrita falha → segue em memória e o HUD mostra "Salvamento automático falhou" | `test/journal.test.ts:82-84`: `flush` não lança, `failed === true`; `:88-91`: pendente regravado, `seq [0,1]`, `failed === false`. Faixa: lacuna b | faixa com o texto exato | coberto (núcleo e presença estática da faixa); visual só UAT (pendente) |

### REC-11: traçado recém-reconhecido (AC 1)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| A gravação logo depois do reconhecimento usa o traçado novo | `test/recordingReferenceScreen.test.ts:23-24`: uma transição para `/recording`, com `layoutId` nos params. Valor: `app/recording-reference.tsx:169` (`transition.layoutId` ← `layout.id`, `:287-292`); uso: `app/recording.tsx:226` | `layout_id` do traçado novo | coberto (estático); ponta a ponta só UAT (pendente, roteiro 7) |

### REC-12: `null`, nunca `''` (AC 2 e 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: sem traçado ou setup, grava `null` | `test/finishSession.test.ts:100-107`: `normalizeId('') === null`, `normalizeId(undefined) === null`, `layoutId === null`, `kartSetupId === null` | `null` | coberto |
| AC 3: a migração converte os vazios | `test/migrations.test.ts:75-77`: os três `UPDATE ... = NULL WHERE ... = ''`; `:55` última instrução `PRAGMA user_version = 4`; `:84` na falha, a versão não sobe | `null` | coberto |

### REC-13: bloqueio de nova gravação (AC 4)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Com uma gravação interrompida pendente, iniciar outra pede recuperar ou descartar | `test/journal.test.ts:100-101`: `rejects(... instanceof UnresolvedRecordingError)`, `recordingId === null`. Redirecionamento: `app/recording.tsx:231-235`, `app/recording-reference.tsx:206-210`; o `uiActive` só liga depois do `begin` (`src/hooks/useLapRecorder.ts:347-355`) | pede resolver antes | coberto; navegação só UAT (pendente) |

**Resumo**: todos os ACs testáveis em Node têm evidência `arquivo:linha` com o valor da spec, mas a de REC-01
AC 1 na tarefa de GPS não discrimina a combinação que roda em produção (mutante P1). Lacunas de precisão da spec,
sem reprovar: REC-02 AC 2 (formato do horário) e REC-08 AC 2 (texto do aviso da meta).

---

## Edge cases

- [x] **Disco cheio durante a gravação**: o diário segue e guarda o pendente (`test/journal.test.ts:80-91`), e a faixa existe nas duas telas (lacuna b).
- [x] **Fechamento forçado na tela de recuperação**: o diário só sai depois do commit (`src/recording/recovery.ts:126`); `test/recovery.test.ts:117-125` cobre a morte entre o commit e a limpeza.
- [x] **Mais de 180 s sem pontos**: `test/recovery.test.ts:190-223` (lacuna e).
- [x] **Reconhecimento interrompido vira traçado de referência**: `test/recovery.test.ts:136-144` (nenhuma sessão, 1 layout com o nome da meta e a melhor volta). Título da tela: `app/recovery.tsx:129-131`.

---

## Sensor de discriminação

Scratch isolado: `git worktree add --detach <scratchpad>/wt2 HEAD`, com symlink de `node_modules`. Cada mutante
rodou o `npm test` inteiro e o arquivo foi restaurado com `git checkout` no worktree entre um e outro. No fim: symlink
removido, `git worktree remove --force`, e o `git status --porcelain` da árvore real ficou igual ao de antes
(`?? CockPit-Guia-do-Testador.pdf`). Nada de `git stash`.

| # | Arquivo:linha | Mutação | Testes que falharam | Morta? |
| - | ------------- | ------- | ------------------- | ------ |
| M1 | `src/recording/locationHandler.ts:35` | Regra `uiActive` invertida: `!journal && deps.uiActive` | 3 do `locationHandler` (sem diário; tela ativa sem diário; sem tela e sem diário) | ✅ morta |
| M2 | `src/recording/finishRecording.ts:53` | `save-failed` chama `journal.end` antes de devolver | finishRecording "repo falha na 3ª volta" | ✅ morta |
| M3 | `app/recording.tsx:692` | Faixa de autosave sob `info.isMoving` em vez de `info.autosaveFailed` | recordingScreen "HUD mostra…" | ✅ morta |
| M4 | `app/recording-reference.tsx:500` | Faixa de autosave sob `targetReached` | recordingReferenceScreen "mostra…" | ✅ morta |
| M5 | `src/recording/journal.ts:128` | Falha do store não liga `failed` | journal "falha do store mantém o pendente…" | ✅ morta |
| M6 | `src/recording/finishSession.ts:106` | `saveRecordedSession` grava sempre `recovered: false` | finishSession "recovered: true é repassado"; recovery "recover (corrida)" | ✅ morta |
| M7 | `src/recording/recovery.ts:64` | `summarize` conta uma volta a menos | recovery "summarize… laps = 3"; bootCheck "interrupted com o resumo" | ✅ morta |
| M8 | `src/recording/bootCheck.ts:38` | `already-saved` não apaga o diário | bootCheck "sessão já salva…" | ✅ morta |
| M9 | `src/recording/exitGuard.ts:31` | "Descartar" emite o efeito `finish` | exitGuard "discard emite o efeito discard" | ✅ morta |
| M10 | `src/recording/postSave.ts:130` | `refreshTodayChallenges` removido | postSave `fromRecovery: false` e `true` | ✅ morta |
| P1 | `src/recording/locationHandler.ts:68` | Com a tela ativa, não grava no diário: `if (!journal \|\| deps.uiActive) return;` | **nenhum** | ❌ **sobreviveu** |
| P2 | `src/recording/finishRecording.ts:47` | `journal.end` antes do salvamento | finishRecording "repo falha…" e "sucesso…" | ✅ morta |

**Profundidade**: caminho crítico (integridade de dados), com 12 mutações manuais: as 10 pedidas (regra `uiActive`,
`finishRecording` no `save-failed`, as duas faixas e os seis módulos do núcleo) mais 2 sondas na lógica nova da T20
e da T21. **11/12 mortas, 1 sobreviveu.**

**Por que P1 importa**: depois da T20 o hook liga o diário **e** `uiActive` em toda gravação com meta
(`src/hooks/useLapRecorder.ts:352,355`). Todos os testes com diário ativo usam `uiActive = false`
(`test/locationHandler.test.ts:34`, padrão do `setup`), um estado que só existe num processo relançado, onde
o diário do módulo é `null`. O caminho que roda de fato na tela de gravação (GPS → diário com a tela ativa) não
tem teste, e uma regressão ali perde a gravação inteira num crash (REC-01 AC 1) sem nenhum teste falhar.

---

## Defeitos da inspeção (em ordem de gravidade)

Nenhum caminho viola um AC da spec, e não achei regressão de comportamento causada por T20–T26. Conferido:

- **`uiActive` preso ligado mantendo GPS órfão**: a flag é estado de módulo em memória (`src/recording/locationTask.ts:21`); um processo novo (crash, morte, relançamento) começa com `false`, e o `bootCheck` para a tarefa na abertura (`src/recording/bootCheck.ts:27`). Ela desliga no `stop()`, na falha do GPS e no unmount (`src/hooks/useLapRecorder.ts:415,727,772`), e não liga se o `begin` rejeita (`:347-355`). As duas telas sem diário param o hook na saída (`app/competition-race.tsx:156,294`; `app/legend-race.tsx:85,103`). Não há caminho em que ela fique ligada sem uma tela de gravação montada.
- **`finishRecording` e o "Encerrar"**: comparado com o `doFinish` de `823155e`, a ordem é a mesma (poucos dados → apaga; salva; falha → mantém o diário e mostra `SAVE_ERROR`; sucesso → `journal.end` depois do commit; efeitos só com voltas; diálogos e navegação iguais). A única diferença é que o erro agora vem em `outcome.error` (`app/recording.tsx:461`).
- **Diálogos novos nas telas de corrida**: o `CockpitDialog` fica na raiz que está na tela quando o `start` falha (`app/competition-race.tsx:482-487`, fora do ramo `finished` de `:307`; `app/legend-race.tsx:258-263`, fora do ramo `done` de `:127`).

### G1: o caminho real GPS → diário com a tela ativa não tem teste (mutante P1): reprova pelo critério do sensor

- **Correção**: no `test/locationHandler.test.ts`, rodar o teste "com diário ativo, os pontos vão ao buf e ao diário" (e o de accuracy, `:61-68`) também com `uiActive = true`, que é o estado de produção. Basta parametrizar o `setup(true, true)` e conferir `persistedGps(store, id)` igual ao `expected` e `calls.stop === 0`.
- **Gravidade**: Major (cobertura de REC-01 AC 1; o código está certo hoje).

### Observações de menor peso (não reprovam)

- **Mantidas da rodada 1, ainda abertas**: `recover` de um reconhecimento sem `trackId` lança "Reconhecimento sem pista." (`src/recording/recovery.ts:96`) e a tela só mostra o `SAVE_ERROR` (`app/recovery.tsx:95`), então a única saída é "Descartar". O `busy_timeout` de 2 s só é aplicado na conexão principal (`src/storage/journalStore.ts:21`), e o `withExclusiveTransactionAsync` (`src/storage/sessionRepo.ts:67`, `src/storage/journalStore.ts:68`) pode usar outra; vale conferir no aparelho que "Encerrar" não cai em `SQLITE_BUSY`.
- **Corrida no `start` (anterior à rodada 2)**: se a tela desmonta enquanto o `start` espera a permissão (`src/hooks/useLapRecorder.ts:387-394`), o cleanup roda antes e o `start` segue: o keep-awake liga depois do cleanup, e o diário fica aberto até a próxima abertura oferecer recuperação. O GPS se para sozinho no primeiro lote (`uiActive` e diário do módulo já estão desligados). É de baixa probabilidade e não foi introduzido por T20–T26.
- **`startedAt` do "Encerrar"**: a sessão normal grava `Date.now()` do fim (`app/recording.tsx:429`), e a recuperada grava o início real da meta (`src/recording/recovery.ts:117`). Isso já era assim antes da feature (o `createSession` antigo também usava a hora do salvamento) e não viola AC, mas as duas sessões ficam com semânticas diferentes.

---

## Qualidade do código

| Princípio | Status |
| --------- | ------ |
| Código mínimo e mudanças cirúrgicas (T20–T26 tocam só os arquivos das tarefas) | ✅ |
| Sem escopo extra | ✅ |
| Segue os padrões do repo (`CockpitDialog`, redutor/funções puras com dependências injetadas) | ✅ |
| Asserções batem com a spec (textos exatos, 10 s, 3 opções, `null`) | ✅ onde há teste |
| Cobertura por camada da matriz (lógica pura: todos os ramos) | ❌ o ramo "diário ativo com `uiActive = true`" do `handleLocations` não tem teste (G1) |
| Todo teste mapeia um AC, edge case ou Done-when | ✅ |
| Diretrizes documentadas | nenhuma; valem os defaults fortes |

---

## Fica para a UAT no aparelho (roteiro de `tasks.md`)

- REC-01: fiação do hook e da tarefa (roteiro 1)
- REC-02: tela de recuperação antes da home, textos de AC 6 e AC 7 e o botão único (roteiro 1)
- REC-03 AC 4: selo "Recuperada" no histórico e na análise (roteiro 1)
- REC-04 AC 5: "Descartar" na tela (roteiro 2)
- REC-05: mensagem e saída da tela na falha; transação real no SQLite
- REC-07: gesto do iOS, voltar do Android nas duas telas e a fiação de "Encerrar e salvar"/"Descartar" (roteiro 3)
- REC-08: diálogos em paisagem nas 4 telas (gravação, reconhecimento, Competição, Corrida contra a lenda) sem girar nem travar; faixa da meta sem toque (roteiro 4)
- REC-09: a notificação "gravando" some ao abrir (roteiro 5)
- REC-10 AC 2: mensagem com a permissão negada, sem ficar em "requesting" (roteiro 6); AC 3: a faixa aparece no HUD das duas telas
- REC-11: traçado novo na sessão (roteiro 7)
- REC-13: redirecionamento para `/recovery`
- Somar ao roteiro: Competição e Corrida contra a lenda com GPS real (voltas fecham, o GPS não se desliga sozinho) e o erro de GPS nelas no `CockpitDialog`

---

## Rastreabilidade

| Requisito | Novo status |
| --------- | ----------- |
| REC-02, REC-03, REC-04, REC-05, REC-06, REC-09, REC-10, REC-11, REC-12, REC-13 | Verificado em Node; UAT pendente |
| REC-07, REC-08 | Verificado em Node nas partes puras e estáticas; UAT pendente |
| REC-01 | ❌ Precisa de reforço de teste (G1); o código está certo na inspeção |

## Resumo

**Geral**: ❌ Não está pronto (rodada 2 de 3).

- **Lacunas da rodada 1**: as 5 fechadas.
- **Checagem ancorada na spec**: todos os ACs testáveis em Node têm evidência que bate com a spec; 1 ramo de produção sem teste (G1); 2 lacunas de precisão da spec.
- **Sensor**: 12 mutações, 11 mortas, 1 sobreviveu (P1).
- **Gates**: 61 passam e 0 falham; typecheck só com a baseline.
- **Próximo passo**: uma tarefa de correção (T27) para G1, e depois a rodada 3.
