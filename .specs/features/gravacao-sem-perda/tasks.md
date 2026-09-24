# Gravação sem perda — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Regras do repo que valem aqui:
- Os commits seguem Conventional Commits em português (`feat(gravação): ...`), **sem `Co-Authored-By` e sem nenhuma referência a IA** no histórico.
- Branch `feat/gravacao-sem-perda`, criada a partir da `main`. Nada de push sem autorização explícita.
- **Não rodar build nativo nem prebuild**: trava a máquina. A verificação visual acontece no aparelho, com EAS.

---

**Design**: `.specs/features/gravacao-sem-perda/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Gerada a partir do código, das diretrizes e da spec. Confirmar antes do Execute. Diretrizes encontradas: nenhuma (não há `AGENTS.md`, `CONTRIBUTING.md` nem config de cobertura), então valem os defaults fortes. Hoje o repo não tem suíte: o único teste real é `scripts/self-test-lap-detector.js`, rodado com `npx tsx`. O runner foi aprovado no design: `node:test` + `tsx`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Lógica pura de gravação (`src/recording/*.ts` e `src/lib/*.ts`) | unit | Todos os ramos; 1:1 com os ACs da spec; todo edge case listado tem teste | `test/*.test.ts` | `npm test` |
| Invariantes estáticas das telas (sem `Alert.alert` em paisagem, `gestureEnabled: false`) | unit (estático, lê o fonte) | Uma asserção por AC de REC-07 (AC 1) e REC-08 (AC 1) | `test/*.test.ts` | `npm test` |
| Adaptadores de expo-sqlite (`src/storage/*Repo.ts`, `journalStore.ts`) | none | O build gate; Node não tem SQLite nativo (só a partir do Node 22.5), e o comportamento é coberto pelos testes da lógica com o armazenamento injetado mais a UAT | – | build gate |
| Telas, hook e componentes React Native | none | O build gate mais o roteiro de UAT no aparelho, ao fim; não há runner de RN no projeto (design, Riscos) | – | build gate + UAT |

## Gate Check Commands

> Gerada a partir do código. Confirmar antes do Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Tarefas com teste unitário | `npm test` |
| Full | Igual ao Quick: não há integração nem e2e em Node | `npm test` |
| Build | Tarefas sem teste (adaptadores e telas) e o fim de cada fase | `npm test && npm run typecheck` |

**Baseline do typecheck.** Depois da T1, `npm run typecheck` ignora `landing/` e mostra
só os 8 erros que já existem hoje em arquivos que esta feature não toca:

- `app/career.tsx:195`
- `app/leaderboard.tsx:125`, `:141`, `:166`
- `app/recap.tsx:131`
- `app/onboarding/email.tsx:31`, `:34`
- `app/onboarding/mode.tsx:39`

O gate passa quando a lista de erros é exatamente essa: nenhum erro novo.

---

## Execution Plan

As fases rodam em sequência. Dentro de cada fase, as setas mostram as dependências
reais, e as tarefas sem seta não dependem de outra da mesma fase.

### Phase 1: Fundação

```
T1 -> T2
T1 -> T3
```

### Phase 2: Núcleo puro (testado em Node)

```
T4 -> T6
T5 -> T6
T6 -> T7
T5 -> T8
T4 -> T10
```

T9 não depende de nenhuma tarefa da fase.

### Phase 3: Adaptadores e componentes

```
T11 -> T14
```

T12 e T13 não dependem de nenhuma tarefa da fase.

### Phase 4: Fiação nas telas

```
T15 -> T16
T15 -> T17
T16 -> T18
T17 -> T18
T18 -> T19
```

---

## Task Breakdown

### Phase 1: Fundação

#### T1: Runner de testes e script de typecheck

**What**: Criar `npm test` (`node --import tsx --test test/*.test.ts`) e `npm run typecheck` (`tsc --noEmit`). Tirar `landing` do tsconfig raiz e portar os 5 casos de `scripts/self-test-lap-detector.js` para `test/lapDetector.test.ts`, que passa a ser a primeira suíte.
**Where**: `package.json`
**Depends on**: None
**Reuses**: `scripts/self-test-lap-detector.js` (casos e gerador de pista sintética)
**Requirement**: infraestrutura de REC-01 a REC-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `npm test` roda e passa os 5 testes do detector.
- [x] `tsconfig.json` exclui `landing`, e `npm run typecheck` mostra exatamente os 8 erros da baseline.
- [x] Gate: `npm test && npm run typecheck`.

**Tests**: unit
**Gate**: build
**Commit**: `test: runner node:test com tsx e typecheck sem a landing`
**Status**: ✅

---

#### T2: Inicialização do banco sem corrida

**What**: Criar `once(init)`, que memoiza a **promise** da inicialização, e fazer o `db()` usá-lo, para que chamadas simultâneas esperem o schema e as migrações.
**Where**: `src/lib/once.ts`
**Depends on**: T1
**Reuses**: `db()` em `src/storage/db.ts:7-201`
**Requirement**: REC-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: duas chamadas simultâneas executam o `init` uma única vez e as duas recebem o mesmo resultado.
- [x] Teste: se o `init` rejeita, a chamada seguinte tenta de novo, sem ficar presa numa promise rejeitada.
- [x] `db.ts` passa a usar `once`, sem atribuir `dbInstance` antes das migrações terminarem.
- [x] Gate: `npm test`; 7 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `fix(db): inicialização memoizada — ninguém lê o banco antes das migrações`
**Status**: ✅

---

#### T3: Migração v4

**What**: Criar `migrateV4(exec)`, que roda dentro de uma transação exclusiva, e chamá-la em `db.ts`. Ela cria `recording_active` e `recording_chunks`, adiciona `sessions.recovered`, converte `''` em `NULL` em `sessions.layout_id`, `sessions.kart_setup_id` e `pb_records.layout_id`, e grava `user_version = 4`.
**Where**: `src/storage/migrations.ts`
**Depends on**: T1
**Reuses**: o padrão de `PRAGMA user_version` de `db.ts:136-201`
**Requirement**: REC-12 (AC 3), REC-01 (tabelas)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (com executor falso que registra os SQL): com `user_version = 3`, todas as instruções rodam dentro do callback da transação, e a última é `PRAGMA user_version = 4`.
- [x] Teste: com `user_version = 4`, nenhuma instrução roda.
- [x] Teste: os três `UPDATE ... = NULL WHERE ... = ''` estão presentes.
- [x] Teste: se uma instrução falha, a transação propaga o erro e `user_version = 4` não é executado.
- [x] Gate: `npm test`; 11 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(db): migração v4 — diário de gravação, sessão recuperada e vazio vira null`
**Status**: ✅

---

### Phase 2: Núcleo puro (testado em Node)

#### T4: Salvamento atômico e idempotente da sessão

**What**: Em `finishSession.ts`, criar:
- `sliceLaps(samples, imu)`, extraída de `useLapRecorder.ts:759-768`;
- `saveRecordedSession(input, repo)`, que grava a sessão com id `session_<recordingId>` e todas as voltas dentro de `repo.transaction`, e não faz nada se o id já existe;
- `normalizeId(v)`, que transforma `''` e `undefined` em `null`.
**Where**: `src/recording/finishSession.ts`
**Depends on**: T3
**Reuses**: `toLapRecord` (`app/recording.tsx:94-105`), `detectLaps`
**Requirement**: REC-05, REC-03 (AC 8), REC-12 (AC 2)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: um repositório falso que falha ao inserir a 3ª volta deixa 0 sessões e 0 voltas (rollback), e o erro é propagado.
- [x] Teste: salvar duas vezes com o mesmo `recordingId` deixa 1 sessão e N voltas.
- [x] Teste: `sliceLaps` recorta a IMU pela janela de tempo de cada volta.
- [x] Teste: `layoutId: ''` e `kartSetupId: ''` são gravados como `null`.
- [x] Teste: `recovered: true` é repassado ao repositório.
- [x] Gate: `npm test`; 16 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(gravação): salvar sessão numa transação só, sem duplicar`
**Status**: ✅

---

#### T5: RecordingJournal

**What**: Criar a classe pura `RecordingJournal`, com `JournalStore` e relógio injetados: `begin`, `appendGps`, `appendImu`, `flushIfDue` (5 s), `flush`, `end` e `failed`. Uma chamada a `begin` com diário ativo rejeita com `UnresolvedRecordingError`.
**Where**: `src/recording/journal.ts`
**Depends on**: None
**Reuses**: tipos de `src/lib/geometry.ts`
**Requirement**: REC-01, REC-10 (AC 3), REC-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: com um relógio falso, os pontos acrescentados em t=0..4,9 s não são gravados, e em t=5 s são gravados num pedaço com `seq = 0`.
- [x] Teste: numa gravação contínua de 60 s com flush a cada poll de 500 ms, o intervalo entre o último ponto gravado e qualquer instante nunca passa de 10 s.
- [x] Teste: uma falha do store mantém o pendente, liga `failed`, e o flush seguinte grava tudo com o `seq` certo e desliga `failed`.
- [x] Teste: `begin` com um registro ativo no store rejeita com `UnresolvedRecordingError`.
- [x] Teste: `end` apaga o registro e os pedaços.
- [x] Gate: `npm test`; 21 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(gravação): diário que grava os pontos a cada 5 s`
**Status**: ✅

---

#### T6: Recuperação

**What**: Criar `summarize`, `recover` e `discard` sobre o diário:
- **corrida:** vira sessão com `recovered: true`, via `saveRecordedSession`;
- **reconhecimento:** vira layout de referência;
- **zero voltas:** é informado;
- **formato desconhecido:** vira `unreadable`.
**Where**: `src/recording/recovery.ts`
**Depends on**: T4, T5
**Reuses**: `detectLaps`, `sliceLaps`, `saveRecordedSession`
**Requirement**: REC-02, REC-03, REC-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: um diário com pontos sintéticos de 3 voltas resulta em `summarize` com a pista, o `startedAt` e `laps = 3`.
- [x] Teste: `recover` numa corrida cria a sessão com a pista, o traçado, o setup e o modo da meta, `recovered: true` e 3 voltas, e depois apaga o diário.
- [x] Teste: se `recover` morre depois do commit e antes de apagar, rodar `recover` de novo não duplica.
- [x] Teste: `recover` num reconhecimento cria o layout com o nome da meta a partir da melhor volta.
- [x] Teste: sem volta completa, `summarize` dá `laps = 0`.
- [x] Teste: com `version: 2` ou JSON quebrado, dá `unreadable`.
- [x] Teste: `discard` apaga o diário.
- [x] Gate: `npm test`; 28 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(gravação): recuperar ou descartar gravação interrompida`
**Status**: ✅

---

#### T7: bootCheck

**What**: Criar `runBootCheck(deps)`:
- para a tarefa de localização se ela estiver registrada;
- devolve `none`, `already-saved` (a sessão `session_<id>` já existe; apaga o diário), `interrupted` com o resumo, ou `unreadable` (apaga o diário).
**Where**: `src/recording/bootCheck.ts`
**Depends on**: T6
**Reuses**: `summarize`
**Requirement**: REC-09 (AC 1), REC-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: com a tarefa registrada e sem diário, chama `stopLocationUpdates` e devolve `none`.
- [x] Teste: com a tarefa registrada e um diário ativo, para a tarefa e devolve `interrupted`.
- [x] Teste: com a sessão já existente, devolve `already-saved` e apaga o diário.
- [x] Teste: com diário ilegível, devolve `unreadable` e apaga.
- [x] Gate: `npm test`; 32 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(gravação): checagem na abertura — GPS órfão e gravação interrompida`
**Status**: ✅

---

#### T8: Handler da tarefa de localização

**What**: Criar `handleLocations(locations, deps)` com a lógica de `useLapRecorder.ts:25-68`:
- filtro de 30 m e timestamp;
- entrega ao `buf` da UI e ao `journal.appendGps` + `flushIfDue`;
- sem diário ativo, chama `stopLocationUpdates`.

No mesmo arquivo fica o `defineTask`, que só chama esse handler.
**Where**: `src/recording/locationTask.ts`
**Depends on**: T5
**Reuses**: `useLapRecorder.ts:25-68`
**Requirement**: REC-01, REC-09

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: um fix com `accuracy` de 31 m é descartado, e um de 30 m entra.
- [x] Teste: com diário ativo, os pontos vão ao `buf` e ao diário.
- [x] Teste: sem diário ativo, `stopLocationUpdates` é chamado e nada vai ao diário.
- [x] Teste: o timestamp segue a regra atual (sub-segundo → `loc.timestamp`; senão, espalhado a 100 ms).
- [x] Gate: `npm test`; 36 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `refactor(gravação): tarefa de localização fora do hook e ligada ao diário`
**Status**: ✅
**Nota**: a lógica pura ficou em `src/recording/locationHandler.ts` (testada em Node). O `locationTask.ts` só tem o `defineTask`, o `buf` global e `setLocationTaskJournal(j)`, que o hook chama ao começar e ao terminar (T15).

---

#### T9: Exit guard

**What**: Criar um redutor puro para a saída da gravação:
- estados `recording | confirming`;
- ações `requestExit`, `continue`, `finish` e `discard`;
- efeitos `none | finish | discard`.
**Where**: `src/recording/exitGuard.ts`
**Depends on**: None
**Reuses**: nada
**Requirement**: REC-07 (AC 2, 3, 4)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: `requestExit` em `recording` leva a `confirming`, com as opções "Continuar gravando", "Encerrar e salvar" e "Descartar".
- [x] Teste: `continue` volta a `recording` sem efeito.
- [x] Teste: `finish` emite o efeito `finish`, que é o mesmo do botão "Encerrar".
- [x] Teste: `discard` emite o efeito `discard`.
- [x] Gate: `npm test`; 40 testes passam.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(gravação): confirmação antes de sair da gravação`
**Status**: ✅

---

#### T10: Efeitos pós-salvamento

**What**: Extrair de `app/recording.tsx:447-586` a função `runPostSaveEffects(session, laps, opts, deps)`, com dependências injetadas: XP, PB, conquistas e desafios sempre; insight de IA e leaderboard só quando `opts.fromRecovery` é falso.
**Where**: `src/recording/postSave.ts`
**Depends on**: T4
**Reuses**: o bloco inteiro de `app/recording.tsx:447-586`
**Requirement**: REC-03 (AC 3); preserva o comportamento atual do "Encerrar"

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: com `fromRecovery: false`, chama gamificação, PB, conquistas, desafios, IA e leaderboard (este último só com PB nova e `trackId`).
- [x] Teste: com `fromRecovery: true`, chama gamificação, PB, conquistas e desafios, e **não** chama IA nem leaderboard.
- [x] Teste: um erro na gamificação não impede o retorno da função; o comportamento de engolir o erro é o atual.
- [x] Gate: `npm test`; 44 testes passam (um a mais que o previsto: o caso "leaderboard só com PB nova e `trackId`" ganhou teste próprio).

**Tests**: unit
**Gate**: quick
**Commit**: `refactor(gravação): efeitos pós-salvamento fora da tela de gravação`
**Status**: ✅

---

### Phase 3: Adaptadores e componentes

#### T11: Repositório de sessão no SQLite

**What**: Implementar o `SessionRepo` da T4 sobre o expo-sqlite, com `withExclusiveTransactionAsync`, `sessionExists`, `insertSession` (com a coluna `recovered`) e `insertLap`. `Session` ganha `recovered`, e o `listSessions`/`getSession` passam a ler essa coluna.
**Where**: `src/storage/sessionRepo.ts`
**Depends on**: T4
**Reuses**: `createSession` e `saveLap` de `db.ts:227-456`
**Requirement**: REC-05, REC-03 (AC 4)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Implementa a interface da T4, sem erro de tipo.
- [x] `Session.recovered: boolean` lido em `listSessions` e em `getSession`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline.

**Tests**: none
**Gate**: build
**Commit**: `feat(db): repositório de sessão transacional`
**Status**: ✅
**Nota**: o mesmo arquivo exporta `sqliteLayoutRepo` (o `LayoutRepo` do `saveReferenceLayout`, sobre `listLayoutsForTrack`/`saveLayout`). O `db()` de `db.ts` passou a ser exportado para os repositórios.

---

#### T12: JournalStore no SQLite

**What**: Implementar o `JournalStore` da T5 sobre as tabelas da v4, com `PRAGMA busy_timeout = 2000`.
**Where**: `src/storage/journalStore.ts`
**Depends on**: T5
**Reuses**: `db()`
**Requirement**: REC-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Implementa a interface da T5, sem erro de tipo.
- [x] `busy_timeout` aplicado na conexão.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline.

**Tests**: none
**Gate**: build
**Commit**: `feat(db): armazenamento do diário de gravação`
**Status**: ✅

---

#### T13: CockpitDialog

**What**: Criar um diálogo in-app para telas em paisagem, com título, texto e 1 a 3 botões, no estilo do `idleCard`.
**Where**: `src/components/CockpitDialog.tsx`
**Depends on**: None
**Reuses**: os estilos `idleOverlay`/`idleCard` de `app/recording.tsx`
**Requirement**: REC-08 (AC 1)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] O componente aceita de 1 a 3 ações, cada uma com a variante `primary | secondary | destructive`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline.

**Tests**: none
**Gate**: build
**Commit**: `feat(ui): diálogo do cockpit, sem alerta nativo`
**Status**: ✅
**Nota**: é uma `View` absoluta, não `Modal` (o `Modal` do RN assume retrato no iOS). A tela renderiza o diálogo como último filho da raiz.

---

#### T14: Selo "Recuperada"

**What**: Criar o componente `RecoveredBadge` e usá-lo na linha do histórico (`app/(tabs)/sessions.tsx`) e no cabeçalho da análise (`app/session/[id].tsx:398,412`) quando `session.recovered`.
**Where**: `src/components/RecoveredBadge.tsx`
**Depends on**: T11
**Reuses**: os tokens de `src/theme`
**Requirement**: REC-03 (AC 4)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] O selo aparece nos dois lugares só quando `recovered` é verdadeiro.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline.

**Tests**: none
**Gate**: build
**Commit**: `feat(sessões): selo de sessão recuperada`
**Status**: ✅
**Nota**: na análise, o selo fica logo abaixo do cabeçalho "ANÁLISE DE VOLTAS" e também nos estados "Dados insuficientes" e "Não foi possível analisar" (as linhas 398 e 412 citadas).

---

### Phase 4: Fiação nas telas

#### T15: Hook ligado ao diário

**What**: Mudar o `useLapRecorder`:
- o `start(opts)` recebe a meta e chama `journal.begin`;
- se o `start` falha, solta o keep-awake, volta a `idle` e lança a mensagem da spec;
- o poll manda a IMU ao diário e chama `flushIfDue`;
- o `stop()` faz `journal.flush()` antes de devolver;
- `info.autosaveFailed` vem do diário;
- sai o `defineTask`, que já está na T8, e o recorte usa `sliceLaps`.
**Where**: `src/hooks/useLapRecorder.ts`
**Depends on**: T5, T8, T12
**Reuses**: `sliceLaps` (T4)
**Requirement**: REC-01, REC-10 (AC 2, 3), REC-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Um erro em `startLocationUpdatesAsync` deixa `state = 'idle'` e o keep-awake desativado. Verificado pelo roteiro de UAT, item 6 (implementado; a UAT no aparelho ainda não rodou).
- [x] O `stop()` chama `journal.flush()` antes de montar o resultado.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline.

**Tests**: none
**Gate**: build
**Commit**: `feat(gravação): hook grava no diário durante a sessão`
**Status**: ✅
**Nota**: o diário do processo fica em `src/recording/runtime.ts` (composição com o `sqliteJournalStore`). A `meta` do `start` é opcional no tipo para não quebrar as telas antes da T16/T17; sem ela, nada vai para o diário. A permissão negada também cai na mensagem da spec. No modo simulado, o GPS vai ao diário pelo próprio simulador; no real, pela tarefa de localização.

---

#### T16: Tela de gravação

**What**: Mudar o `app/recording.tsx`:
- o `doFinish` usa `saveRecordedSession`, `runPostSaveEffects` e `journal.end`, com try/catch que abre o `CockpitDialog` com a mensagem de REC-05 (AC 2) e manda para `/` no "OK";
- as 6 chamadas de `Alert.alert` viram `CockpitDialog`;
- o `BackHandler` e o botão de cancelar passam pelo exit guard;
- "Descartar" chama `stop` + `journal.end`;
- os parâmetros passam por `normalizeId`;
- se o `start` rejeita com `UnresolvedRecordingError`, a tela manda para `/recovery`.
**Where**: `app/recording.tsx`
**Depends on**: T15
**Reuses**: T4, T9, T10, T13
**Requirement**: REC-05, REC-07 (AC 2–4), REC-08, REC-12 (AC 2), REC-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: `app/recording.tsx` não contém `Alert.alert` nem importa `Alert`.
- [x] Teste estático: o arquivo registra `BackHandler.addEventListener('hardwareBackPress'`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline; 46 testes passam (um a mais que o previsto, herdado da T10).

**Tests**: unit
**Gate**: build
**Commit**: `feat(gravação): encerrar atômico e saída só com confirmação`
**Status**: ✅
**Nota**: as dependências reais do `runPostSaveEffects` ficaram em `src/recording/runtime.ts` (`postSaveDeps`), junto do diário. A rota `/recovery` usa `as any`, como as outras rotas que faltam no `.expo/types/router.d.ts` (gerado só pelo `expo start`). O `startedAt` da sessão segue sendo a hora do "Encerrar", como antes. O "Poucos dados" apaga o diário, como o descarte de antes.

---

#### T17: Tela de reconhecimento

**What**: Mudar o `app/recording-reference.tsx`:
- as 6 chamadas de `Alert.alert` viram `CockpitDialog`;
- a meta atingida vira faixa na tela, sem toque, e a gravação segue;
- o `handleFinish` salva via `saveReferenceLayout` e `journal.end`;
- a transição para `/recording` passa o `layoutId` do layout recém-criado;
- o `BackHandler` e o cancelar passam pelo exit guard;
- o `detectorOptions` morto e o `as any` saem.
**Where**: `app/recording-reference.tsx`
**Depends on**: T15
**Reuses**: T6 (`saveReferenceLayout`), T9, T13
**Requirement**: REC-07, REC-08 (AC 1, 2), REC-11

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático: o arquivo não contém `Alert.alert` nem importa `Alert`.
- [x] Teste estático: o `router.replace` para `/recording` inclui `layoutId`.
- [x] Gate: `npm test && npm run typecheck`, só com a baseline; 48 testes passam (um a mais que o previsto, herdado da T10).

**Tests**: unit
**Gate**: build
**Commit**: `feat(reconhecimento): sem alerta nativo e o traçado novo vai para a cronometragem`
**Status**: ✅
**Nota**: com o `detectorOptions` saíram também o `BENCH_MODE` e o `BENCH_DETECTOR_OPTIONS`, que só existiam para ele. A falha ao salvar o traçado mostra "Não consegui salvar o traçado. Ele fica guardado e o app oferece recuperar na próxima abertura.", variante da mensagem de REC-05 (a spec só define o texto para a sessão).

---

#### T18: Layout raiz

**What**: No `app/_layout.tsx`:
- importar `src/recording/locationTask` no topo;
- `gestureEnabled: false` em `recording` e `recording-reference`;
- registrar a rota `recovery` sem gesto;
- o `AuthGate` roda o `runBootCheck` antes de decidir a rota e manda para `/recovery` quando a gravação foi interrompida ou está ilegível.
**Where**: `app/_layout.tsx`
**Depends on**: T16, T17
**Reuses**: T7
**Requirement**: REC-07 (AC 1), REC-09, REC-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste estático: as telas `recording` e `recording-reference` têm `gestureEnabled: false` nas options.
- [ ] Teste estático: o arquivo importa `locationTask`.
- [ ] Gate: `npm test && npm run typecheck`, só com a baseline; 49 testes passam.

**Tests**: unit
**Gate**: build
**Commit**: `feat(gravação): abertura para a tarefa órfã e leva à recuperação`

---

#### T19: Tela de recuperação

**What**: Criar a tela `app/recovery.tsx`, em retrato:
- mostra a pista, o horário de início e as voltas completas;
- "Recuperar" leva para `/session/<id>` ou, se for reconhecimento, para o seletor de traçado; "Descartar" leva para `/`;
- mostra "Nenhuma volta completa para recuperar" só com "Descartar";
- mostra "Não consegui ler a gravação interrompida";
- bloqueia o voltar do Android enquanto não houver escolha.
**Where**: `app/recovery.tsx`
**Depends on**: T18
**Reuses**: T6, os componentes de `src/components/ui`
**Requirement**: REC-02, REC-03, REC-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Os três estados da tela (recuperável, sem volta e ilegível) estão implementados.
- [ ] Gate: `npm test && npm run typecheck`, só com a baseline; 49 testes passam.

**Tests**: none
**Gate**: build
**Commit**: `feat(gravação): tela de recuperação`

---

## Phase Execution Map

Phase 1 → Phase 2 → Phase 3 → Phase 4. As dependências dentro de cada fase estão nos
diagramas do Execution Plan acima.

A execução é sequencial, uma tarefa por vez, na ordem dos números.

---

## Roteiro de UAT no aparelho (depois da T19)

Num dev build por EAS, no aparelho da Julia. Cobre o que Node não testa.

1. Gravar mais de 2 voltas no velocímetro demo e matar o app pelo multitarefa. Na abertura, a tela de recuperação mostra a pista, o horário e as voltas. "Recuperar" abre a sessão com o selo "Recuperada". (REC-01 a REC-03)
2. Repetir e escolher "Descartar": o app vai para a home, e na próxima abertura não aparece recuperação. (REC-04)
3. Durante a gravação, fazer o gesto de voltar no iOS: nada acontece. No Android, o botão voltar abre a confirmação com 3 opções; "Continuar gravando" mantém a contagem de voltas. (REC-07)
4. Em paisagem, abrir todos os diálogos das duas telas (cancelar, erro de GPS e poucos dados): nenhum gira a tela nem trava. (REC-08)
5. Depois de matar o app no meio da gravação, a notificação "gravando" some ao abrir. (REC-09)
6. Negar a permissão de localização e iniciar: aparece a mensagem da spec e a tela não fica em "requesting". (REC-10)
7. Reconhecer um segundo traçado e deixar a transição seguir: a sessão sai com esse traçado. (REC-11)

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | 1 config de runner mais 1 suíte portada | ✅ coeso |
| T2 | 1 função (`once`) e o uso dela em `db()` | ✅ |
| T3 | 1 função de migração | ✅ |
| T4 | 3 funções coesas do salvamento | ⚠️ coeso, mesmo arquivo |
| T5 | 1 classe | ✅ |
| T6 | 3 funções de recuperação | ⚠️ coeso, mesmo arquivo |
| T7 | 1 função | ✅ |
| T8 | 1 handler mais o `defineTask` | ✅ |
| T9 | 1 redutor | ✅ |
| T10 | 1 função | ✅ |
| T11 | 1 adaptador | ✅ |
| T12 | 1 adaptador | ✅ |
| T13 | 1 componente | ✅ |
| T14 | 1 componente usado em 2 telas | ⚠️ coeso |
| T15 | 1 hook | ✅ |
| T16 | 1 tela | ✅ |
| T17 | 1 tela | ✅ |
| T18 | 1 layout | ✅ |
| T19 | 1 tela | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | – | ✅ |
| T2 | T1 | T1 → T2 | ✅ |
| T3 | T1 | T1 → T3 | ✅ |
| T4 | T3 (fase 1) | nenhuma seta intra-fase | ✅ |
| T5 | None | – | ✅ |
| T6 | T4, T5 | T4 → T6, T5 → T6 | ✅ |
| T7 | T6 | T6 → T7 | ✅ |
| T8 | T5 | T5 → T8 | ✅ |
| T9 | None | – | ✅ |
| T10 | T4 | T4 → T10 | ✅ |
| T11 | T4 (fase 2) | – | ✅ |
| T12 | T5 (fase 2) | – | ✅ |
| T13 | None | – | ✅ |
| T14 | T11 | T11 → T14 | ✅ |
| T15 | T5, T8 (fase 2), T12 (fase 3) | – | ✅ |
| T16 | T15 | T15 → T16 | ✅ |
| T17 | T15 | T15 → T17 | ✅ |
| T18 | T16, T17 | T16 → T18, T17 → T18 | ✅ |
| T19 | T18 | T18 → T19 | ✅ |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | runner e suíte | unit | unit | ✅ |
| T2 | lógica pura (`once`) mais `db.ts` | unit | unit | ✅ |
| T3 | lógica pura (migração com executor injetado) | unit | unit | ✅ |
| T4–T10 | lógica pura | unit | unit | ✅ |
| T11, T12 | adaptador expo-sqlite | none | none | ✅ |
| T13, T14 | componente RN | none | none | ✅ |
| T15 | hook RN | none | none | ✅ |
| T16, T17, T18 | tela RN mais invariante estática | unit (estático) | unit | ✅ |
| T19 | tela RN | none | none | ✅ |
