# Gravação sem perda — Validação

## Validation (rodada 3): gravação sem perda — PASS ✅

**Data**: 2026-09-24
**Rodada**: 3 de 3. A rodada 1 reprovou (T20–T26, Phase 5). A rodada 2 reprovou por um único mutante sobrevivente (T27, Phase 6).
**Spec**: `.specs/features/gravacao-sem-perda/spec.md`
**Faixa de commits**: `de41376..HEAD`, com HEAD = `57fa3fd`, na branch `feat/gravacao-sem-perda` (29 commits). `0c3d0f5`…`4a97a57` são T1–T19. `823155e` é o relatório da rodada 1. `d9693da`…`71a0c46` são T20–T26. `4dc24df` é o relatório da rodada 2. `57fa3fd` é a T27, que só acrescenta um teste em `test/locationHandler.test.ts:84-96` e marca a tarefa em `tasks.md`.
**Verificador**: sub-agente independente (autor ≠ verificador). Refiz tudo a partir da spec, do código e dos testes. O relatório da rodada 2 só serviu para saber o que tinha sido reprovado.

O PASS se resume assim. Os gates passam. Todos os ACs testáveis em Node têm evidência `arquivo:linha` com o valor que a spec pede. O sensor matou as 15 mutações, inclusive o mutante que sobreviveu na rodada 2. A inspeção achou um defeito novo (D1): contamina o diário num caminho estreito (falha do SQLite, seguida de uma corrida em modo demo no mesmo processo). Ele não viola a letra de nenhum AC e está registrado abaixo como observação aberta de maior peso.

---

## Lacuna da rodada 2

| # | Lacuna | Evidência nesta rodada | Estado |
| - | ------ | ---------------------- | ------ |
| G1 | O caminho real GPS → diário com a tela ativa (diário ativo **e** `uiActive = true`) não tinha teste. O mutante `if (!journal \|\| deps.uiActive) return;` sobrevivia | `test/locationHandler.test.ts:84-96` chama `setup(true, true)` e confere `deepEqual(buf.samples, expected)` (`:92`), `deepEqual(persistedGps(store, id!), expected)` com o payload inteiro (`:94`) e `calls.stop === 0` (`:95`). Com o mesmo mutante aplicado em `src/recording/locationHandler.ts:68`, este teste falha (mutante R2 abaixo) | fechada |

---

## Gates (árvore real)

| Gate | Comando | Resultado |
| ---- | ------- | --------- |
| Testes | `npm test` | 62 testes: 62 passam, 0 falham, 0 pulados (exit 0) |
| Typecheck | `npm run typecheck` | Exit 2 com exatamente os 8 erros da baseline: `app/career.tsx:195`, `app/leaderboard.tsx:125`, `:141`, `:166`, `app/recap.tsx:131`, `app/onboarding/email.tsx:31`, `:34`, `app/onboarding/mode.tsx:39`. Nenhum erro novo |

- Contagem de testes: 0 antes da feature (o runner nasceu na T1), 50 depois da rodada 1, 61 depois da rodada 2 e 62 agora (+1 da T27). Nenhum teste foi apagado. O diff da T27 só acrescenta linhas, e nenhuma asserção antiga foi afrouxada.

## Tarefas

T1–T27 estão ✅ em `tasks.md` (27 `**Status**: ✅` e nenhum `- [ ]` aberto). Cada tarefa tem um commit, e nenhuma está bloqueada ou parcial.

---

## Checagem ancorada na spec

Legenda:
- **coberto**: uma asserção em Node bate com o resultado da spec.
- **só UAT**: só a camada RN cobre o comportamento. Nesse caso o `arquivo:linha` aponta a implementação.
- **lacuna de precisão**: a spec não define o resultado exato.

### REC-01: persistência com perda máxima de 10 s (Crash, AC 1)

| AC | Evidência (`arquivo:linha` + asserção) | Resultado da spec | Status |
| -- | -------------------------------------- | ----------------- | ------ |
| Pontos de GPS e IMU vão ao armazenamento durável, e a morte do processo perde no máximo 10 s | `test/journal.test.ts:38`: `FLUSH_INTERVAL_MS === 5000`. `:46`: nada é gravado de 0 a 4,9 s. `:50-53`: em t = 5 s há 1 pedaço, com `seq 0`, 50 GPS e 50 IMU. `:68`: `assert.ok(worstGap <= 10_000)` em 60 s de GPS a 10 Hz. Implementação: `src/recording/journal.ts:102-107` | no máximo 10 s | coberto |
| O GPS da tarefa de localização vai ao diário no estado de produção (diário e tela ativos) | `test/locationHandler.test.ts:92,94,95`: buffer e diário recebem o payload inteiro (`deepEqual`), e `calls.stop === 0`. O caso só com o diário (processo relançado) fica em `:78,80,81`, e o filtro de 30 m em `:65,67`. Implementação: `src/recording/locationHandler.ts:67-70` | pontos persistidos | coberto |
| Fiação no hook: o poll chama `appendImu` e `flushIfDue`, e o `stop()` chama `flush()`. O diário e o `uiActive` ligam no `start` | `src/hooks/useLapRecorder.ts:347,352,355,440,444,744` | — | só UAT (roteiro 1) |

### REC-02: oferta de recuperação (Crash, AC 2, 6 e 7)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: antes da home, pista, horário de início e voltas completas, com "Recuperar" e "Descartar" | `test/recovery.test.ts:74-76`: `trackName === 'Kartódromo de Conquista'`, `startedAt === T0`, `laps === 3`. `test/bootCheck.test.ts:65-71`: `kind === 'interrupted'`, resumo com `laps === 2` e diário mantido. Tela: `app/recovery.tsx:135-137,145-161`. Antes da home: `app/_layout.tsx:71-81` (redireciona) e `:133` (a splash espera o `bootCheck`) | pista, horário, voltas e 2 opções | dados cobertos. Tela e rota só UAT. Lacuna de precisão: a spec não define o formato do horário (`app/recovery.tsx:34-41` usa dd/mm hh:mm) |
| AC 6: sem volta completa, "Nenhuma volta completa para recuperar" e só "Descartar" | `test/recovery.test.ts:152`: `laps === 0`. Texto e botão único: `app/recovery.tsx:23,140,144` (texto idêntico ao da spec) | texto exato, só "Descartar" | `laps = 0` coberto. Texto e botão só UAT |
| AC 7: formato desconhecido é descartado com "Não consegui ler a gravação interrompida" | `test/recovery.test.ts:161,163,166`: `summarize(...) === 'unreadable'` para version 2, meta quebrada e pedaço quebrado. `test/bootCheck.test.ts:94-96`: `{kind:'unreadable'}`, `store.active === null` e pedaços apagados. Texto: `app/recovery.tsx:24,118` (idêntico ao da spec) | descarta e informa | descarte coberto. Texto só UAT |

### REC-03: recuperar sem duplicar (Crash, AC 3, 4 e 8)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 3: sessão com as voltas do `detectLaps` e com a mesma pista, traçado, setup e modo | `test/recovery.test.ts:89-102`: `trackId === 'track_1'`, `trackName`, `layoutId === 'layout_7'`, `kartSetupId === 'setup_3'`, `mode === 'race'`, `startedAt === T0` e 3 voltas com as durações de `sliceLaps(samples, [])` | os valores da meta | coberto (ver D1) |
| AC 3 (efeitos): XP, PB, conquistas e desafios, sem IA nem leaderboard | `test/postSave.test.ts:140-145`: cada efeito do jogo roda 1 vez. `getProfile`, `requestQuickInsight`, `pushCoachInsight`, `ensurePilot` e `publishLeaderboardEntry` rodam 0 vez | decisão do design | coberto |
| AC 4: selo "Recuperada" no histórico e na análise | `test/finishSession.test.ts:113`: `recovered === true`. `:117`: `false` no caminho normal. `test/recovery.test.ts:96`. Selo: `src/components/RecoveredBadge.tsx:11` ("Recuperada"), `app/(tabs)/sessions.tsx:339`, `app/session/[id].tsx:400,415,489`. Leitura: `src/storage/db.ts:282,303` | "Recuperada" | flag coberta. O selo na tela só UAT |
| AC 8: se o app morre na recuperação, a abertura seguinte oferece de novo, sem duplicar | `test/recovery.test.ts:117-125`: depois de falhar o `deleteRecording`, `sessions.length === 1` e o diário continua. Na segunda vez, `sessions.length === 1` e `laps.length === 3`. `test/finishSession.test.ts:58-60`. `test/bootCheck.test.ts:81-83` (`already-saved` limpa) | sem duplicar | coberto |

### REC-04: limpeza (Crash, AC 5 e 9)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 5: "Descartar" apaga os pontos | `test/recovery.test.ts:172-173`: `store.active === null` e `chunks.has(id) === false`. Tela: `app/recovery.tsx:100-108` | apagado | coberto. Tela só UAT (roteiro 2) |
| AC 9: o "Encerrar" com sucesso apaga os pontos | `test/finishRecording.test.ts:130-132`: `events` = `['end(sessões gravadas: 1)', 'postSave']`, ou seja, o `end` roda só com a sessão já no banco. Depois `store.active === null` e `chunks.size === 0`. `test/journal.test.ts:113-115`. A tela chama a função em `app/recording.tsx:420` | apagado | coberto |

### REC-05: "Encerrar" atômico (AC 1 e 2)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: sessão e voltas numa transação só | `test/finishSession.test.ts:48-50`: rejeita com `/disk I\/O error na volta 3/` e deixa 0 sessões e 0 voltas. `test/finishRecording.test.ts:89-90`. Implementação: `src/recording/finishSession.ts:110-114`. Adaptador: `src/storage/sessionRepo.ts:65-70` | tudo ou nada | coberto com o repo falso. O SQLite real só UAT |
| AC 2: na falha, os pontos ficam, a tela sai e a mensagem aparece | `test/finishRecording.test.ts:85-93`: `out.kind === 'save-failed'`, `endCalls` vazio, sem efeitos, `store.active.id === recordingId` e os pedaços iguais aos de antes (`deepEqual`). Mensagem: `app/recording.tsx:81-82` (idêntica à da spec). Diálogo e saída para `/`: `app/recording.tsx:459-476`. O teste estático `test/recordingScreen.test.ts:24-28` garante que a tela passa pela função | mantém, sai e mostra | diário coberto. Mensagem e saída só UAT |

### REC-06: inicialização do banco sem corrida (AC 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Schema e migrações terminam antes de qualquer leitura ou escrita, mesmo com chamadas simultâneas | `test/once.test.ts:27-32`: `calls === 1`, as duas chamadas recebem `conn` e `ready === true`. `:43-45`: uma rejeição não prende. Uso: `src/storage/db.ts:10` (`db = once(...)`), com a v4 em `:207`. O `journalStore` também passa pelo `db()` (`src/storage/journalStore.ts:19-23`) | init único | coberto |

### REC-07: sair só com confirmação

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: sem gesto de voltar do iOS | `test/rootLayout.test.ts:21-22`: `gestureEnabled: false` em `recording` e `recording-reference` (`app/_layout.tsx:178,181`) | desligado | coberto (estático). Efeito real só UAT (roteiro 3) |
| AC 2: o voltar do Android e o cancelar abrem a confirmação com 3 opções | `test/exitGuard.test.ts:11-21`: `state === 'confirming'` e os rótulos exatos, na ordem. `test/recordingScreen.test.ts:21`: `BackHandler.addEventListener('hardwareBackPress'`. Reconhecimento: `app/recording-reference.tsx:321-338,536` | 3 opções | coberto em `recording.tsx`. No reconhecimento só UAT |
| AC 3: "Encerrar e salvar" segue o caminho do "Encerrar" | `test/exitGuard.test.ts:29`: `{state:'recording', effect:'finish'}`. Fiação: `app/recording.tsx:518-523` (`doFinish`) e `app/recording-reference.tsx:314-319` (`handleFinish`) | mesmo caminho | redutor coberto. Fiação só UAT |
| AC 4: "Descartar" para o GPS, apaga e sai | `test/exitGuard.test.ts:33`: `effect: 'discard'`. Fiação: `app/recording.tsx:511-516` e `app/recording-reference.tsx:307-312` (`stop()`, `journal.end` e `router.replace('/')`) | para, apaga e sai | redutor coberto. Fiação só UAT |

### REC-08: sem alerta nativo em paisagem

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 1: tela presa em paisagem usa modal próprio, sem `Alert.alert` | `test/recordingScreen.test.ts:14,17`, `test/recordingReferenceScreen.test.ts:14,17`, `test/competitionRaceScreen.test.ts:14,17-18` e `test/legendRaceScreen.test.ts:14,17-18`. O `grep` desta rodada confirma que as 4 telas com `useLockLandscape()` são exatamente essas. O `Alert.alert` que sobra fica em telas sem trava de paisagem (settings, kart-setups, profile-edit, (tabs)/sessions, kart-setup-edit, track-layouts-picker, coach, ai-key, onboarding/email), o que o Out of Scope permite. Em `src/components/CockpitDialog.tsx:4` a menção é só um comentário | nenhum `Alert.alert` | coberto. Diálogos no aparelho só UAT (roteiro 4) |
| AC 2: a meta do reconhecimento mostra aviso sem toque, e a gravação segue | `app/recording-reference.tsx:490-494`: `pointerEvents="none"` e "META ATINGIDA · … Siga gravando ou encerre quando quiser.". O hook só marca `targetReachedRef` e chama o callback, sem parar (`src/hooks/useLapRecorder.ts:454-458`) | aviso sem toque | só UAT. Lacuna de precisão: a spec não define o texto |

### REC-09: tarefa de GPS órfã (AC 1)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Na abertura, com a tarefa registrada, o app a para e trata os pontos como gravação interrompida | `test/bootCheck.test.ts:51-53`: `{kind:'none'}`, `calls.stop === 1` e `isRunning() === false`. `:63-70`: com diário, para e devolve `interrupted`. `test/locationHandler.test.ts:137-138`: num processo sem tela ativa (`uiActive` começa em `false`, `src/recording/locationTask.ts:21`) e sem diário, a tarefa se para e o buffer fica vazio. Real: `src/recording/runtime.ts:62-63,72` e `app/_layout.tsx:3,71` | `hasStartedLocationUpdatesAsync` falso | coberto. No aparelho só UAT (roteiro 5) |

### REC-10: falhas de início e de escrita (AC 2 e 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: GPS não liga → solta o keep-awake, volta ao ocioso e mostra a mensagem | Texto: `src/hooks/useLapRecorder.ts:25-26` (idêntico ao da spec). Caminho: `:409-418`. Diálogos: `app/recording.tsx:238-242`, `app/recording-reference.tsx:212-216`, `app/competition-race.tsx:131,482-487` e `app/legend-race.tsx:94,258-263` | mensagem exata | só UAT (roteiro 6) |
| AC 3: a escrita falha → segue em memória e o HUD mostra "Salvamento automático falhou" | `test/journal.test.ts:82-84`: o `flush` não lança e `failed === true`. `:88-91`: o pendente é regravado, `seq [0,1]` e `failed === false`. Faixa: `test/recordingScreen.test.ts:31-33` e `test/recordingReferenceScreen.test.ts:28-30` (bloco sob `{info.autosaveFailed && (...)}` com `>Salvamento automático falhou<`). A flag vem de `src/hooks/useLapRecorder.ts:697` | faixa com o texto exato | coberto (núcleo e presença da faixa). O visual só UAT |

### REC-11: traçado recém-reconhecido (AC 1)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| A gravação logo depois do reconhecimento usa o traçado novo | `test/recordingReferenceScreen.test.ts:23-24`: uma única transição para `/recording`, com `layoutId` nos params. Valor: `app/recording-reference.tsx:169` (`transition.layoutId`, que recebe `layout.id` em `:287-292`). Uso: `app/recording.tsx:226,426` | `layout_id` do traçado novo | coberto (estático). Ponta a ponta só UAT (roteiro 7) |

### REC-12: `null`, nunca `''` (AC 2 e 3)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| AC 2: sem traçado ou setup, grava `null` | `test/finishSession.test.ts:100-107`: `normalizeId('') === null`, `normalizeId(undefined) === null`, `layoutId === null` e `kartSetupId === null`. A `preflight.tsx:65-66` ainda manda `''` nos params, e o `saveRecordedSession` normaliza (`src/recording/finishSession.ts:102-105`). O único outro `INSERT INTO sessions` é o `createSession` da sessão demo, que já passa `null` (`src/lib/demoSession.ts:83-84`) | `null` | coberto |
| AC 3: a migração converte os vazios | `test/migrations.test.ts:75-77`: os três `UPDATE ... = NULL WHERE ... = ''` (`pb_records` não tem `kart_setup_id`). `:55`: a última instrução é `PRAGMA user_version = 4`. `:84`: na falha, a versão não sobe | `null` | coberto |

### REC-13: bloqueio de nova gravação (AC 4)

| AC | Evidência | Resultado da spec | Status |
| -- | --------- | ----------------- | ------ |
| Com uma gravação interrompida pendente, iniciar outra pede recuperar ou descartar | `test/journal.test.ts:100-101`: `rejects(... instanceof UnresolvedRecordingError)` e `recordingId === null`. Redirecionamento: `app/recording.tsx:232-236` e `app/recording-reference.tsx:206-210`. O `uiActive` só liga depois do `begin` (`src/hooks/useLapRecorder.ts:345-355`) | pede resolver antes | coberto. Navegação só UAT |

**Resumo**: 13/13 requisitos com evidência. Todos os ACs testáveis em Node têm uma asserção que bate com o valor da spec. As lacunas de precisão, que não reprovam, são REC-02 AC 2 (formato do horário) e REC-08 AC 2 (texto do aviso da meta).

---

## Edge cases

- [x] **Disco cheio durante a gravação**: o diário segue em memória e guarda o pendente (`test/journal.test.ts:80-91`). A faixa existe nas duas telas (`app/recording.tsx:692-696`, `app/recording-reference.tsx:500-507`).
- [x] **Fechamento forçado na tela de recuperação**: o diário só é apagado depois do commit (`src/recording/recovery.ts:126`). `test/recovery.test.ts:117-125` cobre a morte entre o commit e a limpeza. O `bootCheck` da abertura seguinte acha o diário de novo (`src/recording/bootCheck.ts:33-47`).
- [x] **Mais de 180 s sem pontos**: `test/recovery.test.ts:190-223` confere que as voltas são exatamente as do `detectLaps` (`deepEqual` de `[startedAt, durationMs]`): 3 voltas, nenhuma acima de 180 s nem atravessando o buraco, 2 antes e 1 depois.
- [x] **Reconhecimento interrompido vira traçado de referência**: `test/recovery.test.ts:136-144` (nenhuma sessão, 1 layout com o nome da meta e a melhor volta). Título na tela: `app/recovery.tsx:129-131`.

---

## Sensor de discriminação

O sensor rodou num scratch isolado:

- **Montagem**: `git worktree add --detach <scratchpad>/wt3 HEAD` em `57fa3fd`, com symlink de `node_modules`. Antes dos mutantes, o `npm test` no scratch deu 62/62.
- **Execução**: cada mutante é uma troca exata de texto, que só vale se o trecho aparece uma única vez no arquivo. Cada um rodou o `npm test` inteiro, e o arquivo voltava com `git checkout` entre um mutante e outro.
- **Limpeza**: symlink removido, `git worktree remove --force` e `git worktree prune`.
- **Estado da árvore real**: `git status --porcelain` antes e depois é idêntico (`?? CockPit-Guia-do-Testador.pdf`, conferido com `diff`). Nada de `git stash`, e nenhuma edição na árvore real.

| # | Arquivo:linha | Mutação | Testes que falharam | Morta? |
| - | ------------- | ------- | ------------------- | ------ |
| R2 | `src/recording/locationHandler.ts:68` | **Mutante da rodada 2**: `if (!journal \|\| deps.uiActive) return;` (com a tela ativa, não grava no diário) | "gravação real (diário ativo e tela ativa)…" (T27) | ✅ morta |
| M1 | `src/recording/locationHandler.ts:35` | Estado **só UI**: `if (!journal)` para a tarefa mesmo com a tela ativa | "tela de gravação ativa sem diário…" | ✅ morta |
| M2 | `src/recording/locationHandler.ts:35` | Estado **nenhum**: `... && false`, e a tarefa nunca se para | "sem diário ativo, para a tarefa…"; "sem tela de gravação e sem diário…" | ✅ morta |
| M3 | `src/recording/journal.ts:104` | O diário grava a cada 15 s (`FLUSH_INTERVAL_MS * 3`) | journal "t=0 a 4,9 s… seq = 0"; journal "em 60 s… nunca mais de 10 s" | ✅ morta |
| M4 | `src/recording/finishSession.ts:111` | Idempotência: sem o `sessionExists` | saveRecordedSession "salvar duas vezes…"; recover "morre depois do commit… não duplica" | ✅ morta |
| M5 | `src/recording/finishSession.ts:112` | Atomicidade: a sessão é gravada pelo `repo`, fora da transação | 9 testes, entre eles saveRecordedSession "falha na 3ª volta desfaz tudo" e finishRecording "repo falha na 3ª volta" | ✅ morta |
| M6 | `src/recording/finishRecording.ts:53` | `save-failed` chama `journal.end` antes de devolver | finishRecording "repo falha na 3ª volta → save-failed…" | ✅ morta |
| M7 | `src/recording/recovery.ts:36` | `parseJournal` aceita `version` desconhecida | summarize "version 2 ou JSON quebrado dá unreadable" | ✅ morta |
| M8 | `src/recording/recovery.ts:64` | `summarize` conta uma volta a menos | summarize "3 voltas…"; bootCheck "interrupted com o resumo" | ✅ morta |
| M9 | `src/recording/bootCheck.ts:27` | O `bootCheck` não para a tarefa órfã | bootCheck "sem diário para a tarefa…"; bootCheck "diário ativo para a tarefa…" | ✅ morta |
| M10 | `src/recording/exitGuard.ts:28` | `requestExit` não abre a confirmação (`state: 'recording'`) | exitGuard "requestExit… confirming com as 3 opções" | ✅ morta |
| M11 | `src/recording/postSave.ts:137` | Sessão recuperada chama IA e leaderboard (`if (true)`) | runPostSaveEffects "(fromRecovery: true)… sem IA nem leaderboard" | ✅ morta |
| M12 | `app/competition-race.tsx:131` | `Alert.alert` reintroduzido no erro do GPS, com `Alert` no import | competition-race.tsx "não chama Alert.alert…" | ✅ morta |
| M13 | `app/_layout.tsx:178` | `gestureEnabled: false` removido da tela `recording` | _layout.tsx "gestureEnabled: false" | ✅ morta |
| M14 | `src/recording/journal.ts:78` | O `begin` não bloqueia com gravação pendente (REC-13) | journal "begin com um registro ativo… rejeita" | ✅ morta |

**Profundidade**: caminho crítico (integridade de dados). Foram 15 mutações manuais cobrindo todos os módulos pedidos: o diário, os 3 estados do `locationHandler`, a idempotência e a atomicidade do `finishSession`, o `save-failed` do `finishRecording`, o `recovery`/`summarize`, o `bootCheck`, o `exitGuard`, o `postSave` e os testes estáticos das telas. O mutante da rodada 2 entrou.
**Saldo do sensor**: 15/15 mortas.

---

## Defeitos da inspeção

Nenhum caminho viola a letra de um AC. A T27 só acrescenta um teste (`git show 57fa3fd` toca `test/locationHandler.test.ts` e `tasks.md`), então não há código novo desde a rodada 2. A inspeção desta rodada refez a leitura das camadas só-UAT e achou um defeito que as rodadas anteriores não registraram.

### D1: depois de um "Encerrar" que falha, uma corrida demo no mesmo processo escreve no diário guardado (novo, não bloqueia)

- **Causa**: o diário é um só por processo (`src/recording/runtime.ts:37`). No `save-failed`, o `journal.recordingId` continua apontando para a gravação guardada, como deve ser para a recuperação (`src/recording/finishRecording.ts:52-54`). A tela de recuperação também apaga pelo `store`, sem passar pelo `journal.end` (`src/recording/recovery.ts:126,131-133`), então o id em memória continua preso. Enquanto isso, o hook alimenta o diário mesmo quando o `start` veio sem `meta`, que é o caso da Competição e da Corrida contra a lenda:
  - no modo demo, `journal.appendGps(simulated)` (`src/hooks/useLapRecorder.ts:378`);
  - em todo modo, `journal.appendImu` e `journal.flushIfDue` no poll (`:440,444`), além do `journal.flush()` no `stop()` (`:744`).
- **Reprodução** (no scratch, com o núcleo puro e o store falso):
  1. Gravar 3 voltas e parar sem `end`, como faz o `save-failed`.
  2. Anexar uma segunda corrida na mesma geometria, 10 min depois: o `summarize` passa de `laps = 3` para `laps = 5`. A recuperação salvaria essas 2 voltas a mais com a pista, o traçado e o selo da gravação original.
  3. Com a segunda corrida em outra pista, o resultado fica em 3 voltas.
  4. Depois de uma recuperação feita no mesmo processo, um `flush` grava um pedaço órfão (sem `recording_active`) sob o id apagado. Esse pedaço nunca é limpo.
- **Por que não reprova**: a spec pede "as voltas que `detectLaps` encontra nos pontos persistidos" (REC-03 AC 3), e isso continua valendo. Para aparecer volta a mais, é preciso juntar quatro coisas:
  - uma falha do SQLite no "Encerrar";
  - nenhum relançamento do app depois dela;
  - uma Competição ou Lenda **em modo demo**;
  - uma gravação original na mesma geometria da volta demo (a própria demo, ou a pista real dela).

  Com GPS real, a Competição e a Lenda não passam GPS ao diário (`src/hooks/useLapRecorder.ts:726`), e a IMU que entra fica fora das janelas das voltas antigas (`src/recording/finishSession.ts:30`). Nenhum dado real se perde.
- **Correção sugerida**: o hook só alimenta o diário quando aquele `start` abriu uma gravação (guardar o `recordingId` do `begin` num ref e condicionar `appendGps`, `appendImu`, `flushIfDue` e `flush`). A recuperação e o descarte também deveriam esquecer o id em memória, por exemplo com `journal.end(id)` em vez de `store.deleteRecording(id)`. Um teste em Node do hook não é possível hoje (não há runner de RN), mas o esquecimento do id cabe em `test/recovery.test.ts`.
- **Gravidade**: Minor (integridade de dados num caminho estreito, sem perda).

### Conferido sem defeito

- **`uiActive` preso ligado**: a flag é estado de módulo e nasce `false` em todo processo novo (`src/recording/locationTask.ts:21`). Ela desliga no `stop()` (`src/hooks/useLapRecorder.ts:727`), na falha do GPS (`:415`) e no unmount (`:772`). Também não liga se o `begin` rejeita (`:345-355`). A Competição e a Lenda param o hook na saída (`app/competition-race.tsx:156`, `app/legend-race.tsx:85,103`).
- **Diálogos de erro do GPS nas telas de corrida**: o `CockpitDialog` fica na raiz que está na tela quando o `start` falha (`app/competition-race.tsx:482-487`, `app/legend-race.tsx:258-263`).
- **A tela de recuperação re-roda o `runBootCheck`** (`app/recovery.tsx:60`). Ela chega sem nenhuma gravação ativa (pela abertura, ou pelo REC-13 depois de o `begin` rejeitar, antes de ligar o GPS), então parar a tarefa ali não derruba uma gravação em curso.

### Observações abertas de rodadas anteriores (não reprovam)

1. **`recover` de um reconhecimento sem `trackId`** lança "Reconhecimento sem pista." (`src/recording/recovery.ts:96`), e a tela mostra o `SAVE_ERROR` de sessão (`app/recovery.tsx:95`). A única saída é "Descartar".
2. **`busy_timeout` só na conexão principal** (`src/storage/journalStore.ts:21`). Já o `withExclusiveTransactionAsync` (`src/storage/sessionRepo.ts:67`, `src/storage/journalStore.ts:68`, e a v4 em `src/storage/db.ts:207`) pode abrir outra conexão. Vale conferir no aparelho que o "Encerrar" e o "Descartar" não caem em `SQLITE_BUSY`.
3. **Corrida no `start`**: se a tela desmonta enquanto o `start` espera a permissão (`src/hooks/useLapRecorder.ts:387-394`), o cleanup roda antes e o `start` segue. O keep-awake liga depois do cleanup, e o diário fica aberto até a abertura seguinte oferecer recuperação. O GPS se para sozinho no primeiro lote. A probabilidade é baixa.
4. **`startedAt` do "Encerrar"**: a sessão normal grava o `Date.now()` do fim (`app/recording.tsx:429`), e a recuperada grava o início real da meta (`src/recording/recovery.ts:117`). O comportamento antigo era o do "Encerrar", então não viola AC, mas as duas sessões ficam com semânticas diferentes.
5. **Falha ao salvar o traçado do reconhecimento** mostra `SAVE_LAYOUT_ERROR` (`app/recording-reference.tsx:21-22,275-278`) e mantém o diário. A spec só fala da sessão (REC-05 AC 2), mas o comportamento é análogo e coerente.

---

## Qualidade do código

| Princípio | Status |
| --------- | ------ |
| Código mínimo e mudanças cirúrgicas (a T27 é só um teste) | ✅ |
| Sem escopo extra | ✅ |
| Segue os padrões do repo (`CockpitDialog`, funções puras com dependências injetadas, adaptadores finos) | ✅ |
| As asserções batem com a spec (textos exatos, 5 s e 10 s, 3 opções, `null`) | ✅ |
| Cobertura por camada da matriz (lógica pura: todos os ramos; invariantes estáticas: uma por AC de REC-07 AC 1 e REC-08 AC 1) | ✅ os 3 estados do `handleLocations` estão cobertos, e o sensor não achou ramo sem teste |
| Todo teste mapeia um AC, um edge case ou um Done-when | ✅ |
| Diretrizes documentadas | nenhuma, então valem os defaults fortes |

---

## Pendências de UAT no aparelho (Roteiro de `tasks.md`)

Num dev build por EAS, no aparelho da Julia. Nada disso reprova sozinho, mas a feature só está de fato pronta depois deste roteiro:

1. **REC-01 a REC-03** (roteiro 1): gravar mais de 2 voltas (demo e GPS real) e matar o app pelo multitarefa. Na abertura, a recuperação aparece antes da home com a pista, o horário e as voltas. "Recuperar" abre a sessão com o selo "Recuperada" no histórico e na análise. Conferir também os textos de AC 6 (menos de 1 volta, só "Descartar") e de AC 7.
2. **REC-04** (roteiro 2): "Descartar" vai para a home, e a próxima abertura não oferece recuperação.
3. **REC-07** (roteiro 3): o gesto de voltar do iOS não faz nada nas duas telas. O voltar do Android abre a confirmação com 3 opções nas duas telas. "Continuar gravando" mantém a contagem. "Encerrar e salvar" e "Descartar" fazem o que dizem.
4. **REC-08** (roteiro 4): em paisagem, abrir todos os diálogos das **4** telas (gravação, reconhecimento, Competição e Corrida contra a lenda): cancelar, erro de GPS, poucos dados e nenhuma volta. Nenhum pode girar a tela nem travar. A faixa da meta aparece sem pedir toque.
5. **REC-09** (roteiro 5): depois de matar o app gravando, a notificação "gravando" some ao abrir.
6. **REC-10** (roteiro 6): com a permissão negada, a mensagem da spec aparece e a tela não fica presa em "requesting". Nas 4 telas, sendo que na Competição e na Lenda o erro sai no `CockpitDialog`. **AC 3**: a faixa "Salvamento automático falhou" aparece no HUD das duas telas de gravação. O disco cheio é difícil de forçar: vale conferir ao menos o layout da faixa.
7. **REC-11** (roteiro 7): reconhecer um segundo traçado e deixar a transição seguir. A sessão sai com esse traçado.
8. **REC-13**: com uma gravação interrompida pendente, tentar gravar leva a `/recovery`.
9. **REC-05**: a mensagem e a saída da tela na falha do SQLite (difícil de forçar) e a transação real no SQLite. O "Encerrar" e o "Descartar" não podem cair em `SQLITE_BUSY` (observação 2).
10. **Competição e Corrida contra a lenda com GPS real** (somado ao roteiro): as voltas fecham, o GPS **não se desliga sozinho** no meio da corrida (regra `uiActive` da T20), a notificação some ao encerrar ou sair, e o erro de GPS aparece no `CockpitDialog` sem girar a tela.

---

## Rastreabilidade

Proposta para o orquestrador atualizar em `spec.md`. Esta rodada não altera outro arquivo além deste.

| Requisito | Status anterior | Novo status |
| --------- | --------------- | ----------- |
| REC-01 | ❌ precisava de reforço de teste (G1) | ✅ Verificado em Node; UAT pendente |
| REC-02, REC-03, REC-04, REC-05, REC-06, REC-09, REC-10, REC-11, REC-12, REC-13 | Verificado em Node; UAT pendente | ✅ Verificado em Node; UAT pendente |
| REC-07, REC-08 | Verificado em Node nas partes puras e estáticas; UAT pendente | ✅ Verificado em Node nas partes puras e estáticas; UAT pendente |

## Resumo

**Veredito**: ✅ Pronta para a UAT no aparelho (rodada 3 de 3).

- **Lacuna da rodada 2 (G1)**: fechada pela T27, e o mutante R2 agora morre.
- **Checagem ancorada na spec**: 13/13 requisitos com evidência, e todos os ACs testáveis em Node batem com a spec. Há 2 lacunas de precisão da spec, que não reprovam.
- **Sensor**: 15 mutações, 15 mortas.
- **Gates**: 62 passam e 0 falham. O typecheck mostra só a baseline.
- **Aberto**: D1 (Minor, novo) e as 5 observações de rodadas anteriores, nenhuma bloqueante.
- **Próximo passo**: rodar o Roteiro de UAT, incluindo a Competição e a Lenda com GPS real. Decidir se D1 vira tarefa antes do lançamento.
