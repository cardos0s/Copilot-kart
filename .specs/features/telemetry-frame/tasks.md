# Telemetry frame Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/telemetry-frame/design.md`
**Status**: Approved (06/10) — In Progress

---

## Test Coverage Matrix

> Segue a matriz da `tempos-honestos`. Não há `AGENTS.md`, `CONTRIBUTING.md` nem configuração de
> cobertura, então valem os defaults fortes. Os 149 testes atuais (`test/*.test.ts`) são o piso de
> estilo. A novidade é SQL real nos testes, com o `sql.js` (aprovado pela Julia em 06/10).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Lógica pura (`src/telemetry/*.ts`, `src/lib/*.ts`, `src/recording/*.ts`) | unit | Todos os ramos; 1:1 com os ACs de TF-01 a TF-25; todo edge case listado tem teste; valores da spec (30 m, 5 MB, 200 ms, faixas 5/10 m) assertados exatamente | `test/*.test.ts` | `npm test` |
| Armazenamento e migração (`src/telemetry/telemetryStore.ts`, `src/storage/*.ts`, `src/storage/migrations.ts`) | integration (SQL real no sql.js) | Caminhos de leitura e escrita, janela por tempo, exclusão, rollback de uma sessão, retomada, remoção das colunas | `test/*.test.ts` | `npm test` |
| Comparação de referência (TF-14) | unit (golden) | Cada consumidor puro e as três funções extraídas, nas quatro sessões de referência, pela regra de tolerância da spec | `test/golden.test.ts` | `npm test` |
| Invariantes estáticas das telas e do hook | unit (estático, lê o fonte) | Uma asserção por AC que só a tela cobre (selo, tipos, chamadas). Cada regex antigo reescrito nomeia o que substitui | `test/*Screen.test.ts`, `test/lapRecorderHook.test.ts` | `npm test` |
| Telas React Native (visual) | none | Build gate e a UAT no aparelho, ao fim | – | build gate + UAT |
| Documentação | none | Build gate | – | build gate |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Tarefas com teste unitário | `npm test` |
| Full | Tarefas com teste de integração (sql.js) | `npm test` |
| Build | Tarefas sem teste, e o fim de cada fase | `npm test && npm run typecheck` |

**Baseline do typecheck:** os mesmos 8 erros da `tempos-honestos`:
- `app/career.tsx:195`
- `app/leaderboard.tsx:125`, `:141`, `:166`
- `app/recap.tsx:131`
- `app/onboarding/email.tsx:31`, `:34`
- `app/onboarding/mode.tsx:39`

O gate passa só se aparecerem exatamente esses. O `tsc` demora mais de 2 min: rodar com timeout de 600000 ms.

**Contagem de testes:** hoje são 149. Ela só pode crescer. Cada tarefa registra no "Done when" o
número real depois dela.

**Rede de segurança:** a partir da T6, `test/golden.test.ts` roda em toda tarefa. Nenhuma tarefa pode
mudar `test/golden/expected.json`. Quando uma tarefa muda a assinatura de um consumidor, ela atualiza
a chamada no harness do golden, e o valor esperado continua o mesmo.

**Período de transição (fases 3 a 6):** `GpsSample`, `ImuSample` e `LocalSample` viram aliases
deprecados de `GpsFrame`, `ImuFrame` e `LocalGpsFrame`. `LapRecord` carrega `gps`/`imu` e, enquanto
houver consumidor antigo, também `samples`/`imuSamples` apontando para os mesmos arrays. A T46 remove
os aliases e as propriedades antigas, e um teste estático garante que não sobrou nenhuma referência
(TF-13).

---

## Execution Plan

As fases rodam em ordem. Cada tarefa depende da fase anterior inteira. As setas mostram só as
dependências dentro da fase.

### Phase 1: Rede de segurança (antes de tocar em qualquer código)

```
T4 -> T6
T5 -> T6
```

T1, T2, T3, T4 e T5 não dependem de nenhuma tarefa da fase. A T6 captura o golden com as três
funções já extraídas.

### Phase 2: Modelo e armazenamento

```
T7 -> T8
T9 -> T10
T8 -> T10
T10 -> T11
T9 -> T12
```

### Phase 3: Captura e gravação

```
T13 -> T14
T13 -> T15
T14 -> T16
T15 -> T16
T17 -> T18
T16 -> T19
T17 -> T19
T18 -> T19
T19 -> T20
T20 -> T21
```

### Phase 4: Leitura, repositórios e selo

```
T22 -> T23
T22 -> T24
T22 -> T25
```

T26 não depende de nenhuma tarefa da fase.

### Phase 5: Consumidores puros (`src/lib`)

```
T27 -> T28
T27 -> T29
T27 -> T30
T27 -> T31
T27 -> T32
T27 -> T33
T27 -> T34
```

### Phase 6: Componentes e telas

```
T35 -> T36
T35 -> T37
T35 -> T38
T35 -> T39
T35 -> T40
T35 -> T41
```

### Phase 7: Migração do histórico e fechamento

```
T42 -> T43
T43 -> T44
T44 -> T45
T45 -> T46
T46 -> T47
```

---

## Task Breakdown

### Phase 1: Rede de segurança

#### T1: Extrair o ponto de frenagem B

**What**: Mover o cálculo da frenagem mais forte de `app/session/[id].tsx:1345` para a função pura `hardestBraking(samples)`, sem mudar a regra, e fazer a tela chamá-la.
**Where**: `src/lib/brakingPoint.ts`
**Depends on**: None
**Reuses**: o trecho inline da tela, copiado como está
**Requirement**: TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa volta sintética com uma frenagem conhecida (de 25 m/s para 10 m/s em 1 s), a função devolve o ponto e o valor que o código inline devolvia.
- [x] Teste estático: a tela chama `hardestBraking(` e não contém mais o laço inline.
- [x] Gate: `npm test`, contagem registrada: 153 testes (149 + 4).

**Tests**: unit
**Gate**: quick

---

#### T2: Extrair a velocidade mínima por curva

**What**: Mover o cálculo de `app/track-map.tsx:~150` para `minSpeedPerCorner(corners, matched)`, sem mudar a regra, e fazer a tela chamá-la.
**Where**: `src/lib/cornerSpeed.ts`
**Depends on**: None
**Reuses**: o trecho inline da tela
**Requirement**: TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa volta da pista circular com duas curvas, devolve a velocidade mínima de cada uma, igual ao código inline.
- [x] Teste estático: a tela chama `minSpeedPerCorner(`.
- [x] Gate: `npm test`, contagem registrada: 156 testes (153 + 3).

**Tests**: unit
**Gate**: quick

---

#### T3: Extrair a faixa de cor por velocidade

**What**: Mover os percentis 5/95 de `app/session/[id].tsx:1256` para `speedColorRange(samples)`, sem mudar a regra, e fazer a tela chamá-la.
**Where**: `src/lib/speedRange.ts`
**Depends on**: None
**Reuses**: o trecho inline da tela
**Requirement**: TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: para 100 velocidades conhecidas, devolve exatamente o p5 e o p95 que o código inline devolvia.
- [x] Teste estático: a tela chama `speedColorRange(`.
- [x] Gate: `npm test`, contagem registrada: 159 testes (156 + 3).

**Tests**: unit
**Gate**: quick

---

#### T4: Sessões de referência

**What**: Criar as quatro sessões de referência da design (seção 10) como entradas **brutas**:
- lotes de `LocationObject` com fixes acima de 30 m, `timestamp` quantizado num trecho e base epoch 1,79e12;
- eventos de acelerômetro e de giroscópio a 50 Hz, com um trompo;
- o `DEMO_LAP` em 3 voltas a 5 Hz;
- o traçado da melhor volta;
- uma volta legada com timestamps degenerados.

**Where**: `test/golden/sessions.ts`
**Depends on**: None
**Reuses**: `test/helpers/syntheticTrack.ts`, `src/data/demoLap.ts`
**Requirement**: TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: a sessão 1 tem paddock, volta de saída, 6 voltas e box, e `detectLaps` atual fecha exatamente 6 voltas nela.
- [x] Teste: a sessão 1 tem pelo menos 5 fixes acima de 30 m e um trecho de pelo menos 20 fixes com `timestamp % 1000 === 0`.
- [x] Teste: as entradas são determinísticas (duas gerações dão arrays idênticos).
- [x] Gate: `npm test`, contagem registrada: 162 testes (159 + 3).

**Tests**: unit
**Gate**: quick

---

#### T5: Comparador com a tolerância da spec

**What**: Criar `goldenCompare(expected, actual, path)`, que percorre objetos e arrays e aplica a regra:
- inteiros e strings iguais;
- chaves marcadas como tempo (`t`, `*Ms`, `*At`, `tMs`) com diferença de até 0,001;
- os demais números reais com diferença de até 1e-9.

A falha devolve o caminho exato da primeira diferença.

**Where**: `test/helpers/goldenCompare.ts`
**Depends on**: None
**Reuses**: nada
**Requirement**: TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: `{lapMs: 1000}` contra `{lapMs: 1000.0009}` passa; contra `1000.0011` falha com o caminho `lapMs`.
- [x] Teste: `{speed: 1}` contra `1 + 2e-9` falha; contra `1 + 5e-10` passa.
- [x] Teste: um inteiro diferente, uma string diferente e um array de outro tamanho falham, cada um com o caminho.
- [x] Gate: `npm test`, contagem registrada: 167 testes (162 + 5).

**Tests**: unit
**Gate**: quick

---

#### T6: Captura do golden e teste de referência

**What**: Criar `scripts/golden-capture.ts`. Ele roda o pipeline **atual** sobre as sessões da T4 e grava `test/golden/expected.json`:
- `handleLocations`, `sliceLaps`, `LapRecord`, `detectLaps` e `sectorSplits`;
- `analyzeLap`/`matchLapToReference`, a sequência do `DeltaTracker` e `peakSpeed*`;
- `buildLapInsight`, `detectSpins`, `detectCorners`/`analyzeCorners` e `compareLaps`;
- `buildPilotDna`, `countCorners`, `samplesToSilhouette` e `polylineLength`;
- `lineFromLayout`, a parte pura do contexto do coach, as três funções das T1–T3 e o payload do ao vivo.

Criar também `test/golden.test.ts`, que roda o mesmo harness e compara com o `goldenCompare`.

**Where**: `test/golden.test.ts`
**Depends on**: T4, T5
**Reuses**: T1, T2, T3
**Requirement**: TF-14, TF-15

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `expected.json` commitado, gerado pelo script, com uma entrada por consumidor e por sessão.
- [x] `golden.test.ts` passa sobre o código atual.
- [x] Teste de sanidade: mudar 1 ms num tempo de volta dentro do teste (cópia local) faz a comparação falhar.
- [x] Gate: `npm test`, contagem registrada: 170 testes (167 + 3). Fim da fase: `npm run typecheck` com os mesmos 8 erros da baseline.

**Tests**: unit
**Gate**: quick

---

### Phase 2: Modelo e armazenamento

#### T7: Modelo de frames, séries e unidades

**What**: Criar os tipos da design:
- `Source`, `FixState`, `Unit`;
- `GpsFrame`, `LocalGpsFrame`, `ImuFrame`, `ChannelFrame`, `TelemetryFrame`;
- as séries e `SeriesMeta`, `Owner`, `BoundaryCross` e `LapWindow`;
- a constante `G`, `assertUnit` e `UnitError`.

**Where**: `src/telemetry/frame.ts`
**Depends on**: None
**Reuses**: `CrossPoint` de `startLine.ts`
**Requirement**: TF-21 (AC 2, 3)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: `assertUnit('RPM', 'rpm')` devolve `'rpm'`; `assertUnit('BRK', 'bar')` lança `UnitError` com `channel === 'BRK'` e `unit === 'bar'`.
- [x] Teste: cada unidade do catálogo é aceita.
- [x] Gate: `npm test`, contagem registrada: 174 testes (170 + 4).

**Tests**: unit
**Gate**: quick

---

#### T8: Codec de bloco

**What**: Criar `encodeBlock`, `decodeBlock`, `concatSeries` e `BlockError`. O formato é o da design: cabeçalho com versão e máscara de colunas, colunas Float64 e `u8`, coluna só com NaN omitida e cópia alinhada na decodificação.
**Where**: `src/telemetry/blockCodec.ts`
**Depends on**: T7
**Reuses**: nada
**Requirement**: TF-10, TF-22 (AC 5, parte do codec)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: ida e volta de uma `GpsSeries`, uma `ImuSeries` e uma `ChannelSeries` com valores aleatórios. Todos os valores e instantes são bit a bit iguais, inclusive NaN nas posições ausentes.
- [x] Teste: a decodificação de um payload deslocado em 3 bytes dentro de um `Uint8Array` maior funciona.
- [x] Teste: uma coluna toda NaN não ocupa bytes (tamanho do payload conferido).
- [x] Teste (TF-10): 20 min de GPS a 10 Hz e de IMU a 50 Hz, em blocos de 5 s, somam ≤ 5.000.000 bytes de payload.
- [x] Teste: versão desconhecida e tamanho inconsistente lançam `BlockError`.
- [x] Gate: `npm test`, contagem registrada: 184 testes (174 + 10). TF-10 medido: 4.251.840 bytes de payload em 20 min (pior caso, todas as colunas presentes).

**Tests**: unit
**Gate**: quick

---

#### T9: Conexão SQL injetável e sql.js nos testes

**What**:
- Adicionar `sql.js` como devDependency.
- Criar a interface `SqlConn` (`runAsync`, `getAllAsync`, `getFirstAsync`, `execAsync`, `withExclusiveTransactionAsync`) e o adaptador do expo-sqlite.
- Criar, nos testes, `test/helpers/sqlJsConn.ts`, que implementa `SqlConn` sobre o sql.js com BLOB como `Uint8Array`.

**Where**: `src/storage/sqlConn.ts`
**Depends on**: None
**Reuses**: o recorte de API que `db.ts` já usa
**Requirement**: TF-17 a TF-20 (infraestrutura de teste)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: no sql.js, criar uma tabela, inserir um BLOB `Uint8Array` e lê-lo de volta igual.
- [x] Teste: um erro dentro de `withExclusiveTransactionAsync` desfaz o que foi escrito nela.
- [x] `package.json` e `package-lock.json` atualizados; o `sql.js` não aparece em `dependencies`.
- [x] Gate: `npm test`, contagem registrada: 187 testes (184 + 3). sql.js 1.14.2 e @types/sql.js 1.4.11 em devDependencies.

**Tests**: integration
**Gate**: full

---

#### T10: Repositório de séries

**What**: Criar o `telemetryStore`, com `createSeries`, `appendBlocks` (transação única), `readSeries` (com filtro por tipo e por janela via `t_first`/`t_last`) e `deleteOwner`. A criação de tabelas fica na T12; aqui o teste cria o schema pelo mesmo SQL que a T12 vai usar.
**Where**: `src/telemetry/telemetryStore.ts`
**Depends on**: T8, T9
**Reuses**: o padrão de repositório injetado de `finishSession.ts`
**Requirement**: TF-07, TF-09, TF-16 (base)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): grava uma série em 10 blocos e lê de volta igual.
- [x] Teste (sql.js): uma janela `[tFrom, tTo]` lê só os blocos que cruzam a janela (conferido pelo número de blocos decodificados).
- [x] Teste (sql.js): uma falha no 2º bloco de um `appendBlocks` não deixa o 1º gravado.
- [x] Teste (sql.js): `deleteOwner` apaga séries e blocos daquele dono e não toca nos de outro.
- [x] Teste: um bloco corrompido é pulado na leitura, e a contagem de blocos pulados é devolvida.
- [x] Gate: `npm test`, contagem registrada: 193 testes (187 + 6).

**Tests**: integration
**Gate**: full

---

#### T11: Contrato multi-fonte

**What**: Criar `channelSeries(meta, t, v)` e `gpsSeriesFrom(...)`, que montam séries a partir de arrays de um adaptador (com `assertUnit`). Escrever o teste de contrato da sessão sintética de MyChron.
**Where**: `src/telemetry/series.ts`
**Depends on**: T10
**Reuses**: T7, T8
**Requirement**: TF-21 (AC 1, 2, 3), TF-22 (AC 4, 5)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): uma sessão `MYCHRON` com canais a 1, 20, 25 e 50 Hz, mais rpm, temperatura em °C e um GPS com 50 pontos sem fix (`fix: none`), é gravada e lida de volta com todos os valores e instantes iguais.
- [x] Teste: um canal em `bar` é recusado com `UnitError` que nomeia o canal.
- [x] Gate: `npm test`, contagem registrada: 195 testes (193 + 2).

**Tests**: integration
**Gate**: full

---

#### T12: Migração v5a (schema)

**What**: Criar `migrateV5Schema(executor)`, que cria `telemetry_series`, `telemetry_blocks` e o índice, as colunas de janela em `laps` e em `track_layouts`, e `sessions.frames_version`, tudo numa transação. Ligar no `db()` depois da v4.
**Where**: `src/storage/migrations.ts`
**Depends on**: T9
**Reuses**: `MigrationExecutor` e o padrão da v4
**Requirement**: TF-17 (infraestrutura), TF-20

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): sobre um banco v4 com dados, a v5a cria tabelas e colunas, e os dados antigos continuam legíveis.
- [x] Teste (sql.js): rodar duas vezes não falha nem duplica nada.
- [x] Teste: uma falha no meio desfaz tudo da v5a.
- [x] Gate: `npm test && npm run typecheck`, contagem registrada: 199 testes (195 + 4). Fim da fase: `npm run typecheck` com os mesmos 8 erros da baseline.

**Tests**: integration
**Gate**: build

---

### Phase 3: Captura e gravação

#### T13: Relógio da sessão

**What**: Criar `createSessionClock(t0Utc)`, com `gpsT(resolvedEpochMs)` e `imuT(sensorSeconds, nowMs)`. O `offset` da IMU fica fixo no primeiro evento, e `t` é estritamente crescente por série.
**Where**: `src/recording/sessionClock.ts`
**Depends on**: None
**Reuses**: a regra `max(t, lastT + 1)` de `locationHandler.ts:66`
**Requirement**: TF-05, TF-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: com `t0Utc = 1000`, sensor em 5,000 s e `nowMs = 6020` no 1º evento, o `t` é 5020; no evento seguinte, com sensor em 5,020 s e `nowMs = 6100`, o `t` é 5040. O espaçamento é o do sensor, e não o do relógio.
- [x] Teste: GPS e IMU com o mesmo instante absoluto dão o mesmo `t`.
- [x] Teste: `nowMs` voltando 1 h (ajuste de relógio) não faz `t` decrescer em nenhuma das séries.
- [x] Gate: `npm test`, contagem registrada: 202 testes (199 + 3).

**Tests**: unit
**Gate**: quick

---

#### T14: GPS em frames, sem descarte

**What**: Fazer `handleLocations` emitir `GpsFrame`:
- sem o corte de 30 m;
- precisão `undefined` quando ausente;
- `fix: 'unknown'` e `gnssTime`;
- `timeRepaired` quando o tempo foi estimado;
- `t` pelo `sessionClock`.

O buffer e o diário recebem frames.

**Where**: `src/recording/locationHandler.ts`
**Depends on**: T13
**Reuses**: a resolução de timestamp existente
**Requirement**: TF-02, TF-03, TF-04, TF-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: uma fix com precisão de 45 m é emitida com `accuracy: 45` (antes era descartada).
- [x] Teste: uma fix sem precisão é emitida com `accuracy` indefinido.
- [x] Teste: num lote com `timestamp` quantizado, os frames estimados saem com `timeRepaired`; com o relógio confiável, saem sem a marca.
- [x] Teste: cada frame tem `gnssTime` igual ao `loc.timestamp` e `t = tempo resolvido − t0Utc`.
- [x] `test/locationHandler.test.ts` atualizado: a asserção do descarte de 30 m é substituída pela de gravação com a precisão real, com nota no teste.
- [x] Gate: `npm test`, contagem registrada: 205 testes (202 + 3).

**Tests**: unit
**Gate**: quick

---

#### T15: Captura da IMU

**What**: Tirar o pareamento de `useLapRecorder.ts:53-81` para o módulo puro `createImuCapture(clock, emit)`:
- usa o `timestamp` do sensor;
- `t` do mais recente do par;
- o mesmo sensor duas vezes antes de fechar o par emite um frame só com ele;
- o acelerômetro sai em m/s² (× `G`).

**Where**: `src/recording/imuCapture.ts`
**Depends on**: T13
**Reuses**: a lógica de pareamento atual
**Requirement**: TF-05, edge "par incompleto"

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: accel (1 g em z) e gyro chegando com 3 ms de diferença dão um frame com `accel.z = 9.80665` e o `t` do gyro.
- [x] Teste: accel, accel e depois gyro dão um frame só com `accel` (`gyro` ausente) e depois um frame completo.
- [x] Gate: `npm test`, contagem registrada: 208 testes (205 + 3).

**Tests**: unit
**Gate**: quick

---

#### T16: Diário em blocos

**What**: Reescrever o diário sobre o `telemetryStore`:
- `begin` cria as séries `gps`/`imu` do dono `session:session_<recordingId>` com `t0Utc`;
- `flush` grava um bloco por série numa transação;
- `end` apaga só `recording_active`;
- `discard` novo apaga `recording_active` e as séries.

A regra de falha e de nova tentativa continua igual.

**Where**: `src/recording/journal.ts`
**Depends on**: T14, T15
**Reuses**: `journal.ts` atual, T10
**Requirement**: TF-01, TF-07, TF-09

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): `begin` registra `t0Utc` e fonte `PHONE` nas duas séries.
- [x] Teste (sql.js): 12 s de gravação dão 3 blocos por série, e `end` mantém todos.
- [x] Teste (sql.js): `discard` apaga séries, blocos e o registro ativo.
- [x] Teste: uma escrita que falha devolve o pendente à fila e liga `failed`; a próxima grava tudo, sem duplicar.
- [x] `test/journal.test.ts` e `test/helpers/fakeJournalStore.ts` migrados para o formato novo, com as mesmas asserções de comportamento.
- [x] Gate: `npm test`, contagem registrada: 211 testes (208 + 3).

**Tests**: integration
**Gate**: full

---

#### T17: Janelas de volta

**What**: Criar `analysisGps(frames)` (precisão definida e ≤ 30 m), `sliceLapWindows(gps, line)` e `lapFrames(window, gps, imu)`, com as regras da design, incluindo a janela por índice do legado. Guardar no cruzamento a precisão da fronteira (a regra de `boundaryPoint`).
**Where**: `src/telemetry/laps.ts`
**Depends on**: None
**Reuses**: `sliceLaps` e `boundaryPoint` de `finishSession.ts:26-55`, `detectLaps`
**Requirement**: TF-11, TF-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: numa pista sintética com fixes de 45 m, `sliceLapWindows` dá as mesmas voltas e cruzamentos que `sliceLaps` dá sobre os frames filtrados em 30 m.
- [x] Teste: `lapFrames` de uma janela por cruzamento devolve `[fronteira, frames internos com ≤ 30 m, fronteira]`, com as fronteiras `synthetic` e a precisão guardada.
- [x] Teste: a IMU da janela inclui os frames em `start.t` e em `end.t`.
- [x] Teste: uma janela por índice devolve os frames `from..to` como estão; `kind: 'none'` devolve vazio.
- [x] Gate: `npm test`, contagem registrada: 216 testes (211 + 5).

**Tests**: unit
**Gate**: quick

---

#### T18: Payload do ao vivo a partir de frames

**What**: Criar `toLiveSample(frame, info)`, que monta exatamente o `LiveSample` de hoje a partir de um `GpsFrame` e do `info` atual, e fazer `app/recording.tsx` usá-la.
**Where**: `src/lib/liveSession.ts`
**Depends on**: T17
**Reuses**: o corpo atual de `publishSample` (`liveSession.ts:166-189`)
**Requirement**: TF-15

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste: para um frame com `t0Utc` conhecido, o payload sai igual ao que o código de hoje montava para o `GpsSample` equivalente, inclusive o `t` em ISO absoluto.
- [x] Teste estático: `recording.tsx` chama `toLiveSample(`.
- [x] Golden (payload do ao vivo) passa sem mudar o `expected.json`.
- [x] Gate: `npm test`, contagem registrada: 219 testes (216 + 3).

**Tests**: unit
**Gate**: quick

---

#### T19: Hook de gravação sobre frames

**What**: Trocar no `useLapRecorder`:
- buffers de frames;
- `imuCapture` no lugar do pareamento inline;
- `detectLaps` sobre `analysisGps`;
- `stop()` devolvendo as janelas.

A simulação passa a emitir `GpsFrame` pelo `sessionClock`, com `t` estritamente crescente também na volta do laço.

**Where**: `src/hooks/useLapRecorder.ts`
**Depends on**: T16, T17, T18
**Reuses**: T13–T17
**Requirement**: TF-05, TF-06, TF-07, TF-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste estático (`test/lapRecorderHook.test.ts`): o regex `sliceLaps(allSamples, allImuSamples, line)` é substituído por `sliceLapWindows(analysisGps(`, com nota de qual asserção ele substitui; o hook não chama mais `Date.now()` para a IMU.
- [x] Teste: o gerador da simulação (extraído para função pura) nunca repete `t` quando o laço reinicia.
- [x] Gate: `npm test && npm run typecheck`, contagem registrada: 223 testes (219 + 1 do comparador, bc9d4e1, + 3), baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T20: Salvar a sessão com janelas

**What**: Fazer `saveRecordedSession`, `sessionOps.insertLap` e `finishRecording` gravarem as voltas com as colunas de janela, sem JSON de amostra, e sem copiar frames (as séries já são da sessão). A gravação com menos de 30 pontos de GPS, inclusive nenhum, é descartada com todo o bruto (`journal.discard`), como hoje (edge ajustado pela Julia em 07/10).
**Where**: `src/recording/finishSession.ts`
**Depends on**: T19
**Reuses**: `sessionRepo.ts`, a transação existente
**Requirement**: TF-07, TF-11, TF-25

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): uma gravação de 3 voltas salva 3 linhas em `laps` com `start_*`/`end_*`, e o número de frames das séries é o mesmo de antes do "Encerrar", incluindo paddock e box.
- [x] Teste (sql.js): uma gravação só com IMU e sem nenhuma fix, e outra com 29 pontos de GPS, terminam sem sessão salva e sem nenhuma linha em `telemetry_series`/`telemetry_blocks`; com 30 pontos, a sessão é salva.
- [x] `test/finishSession.test.ts`, `test/finishRecording.test.ts` e `test/helpers/fakeSessionRepo.ts` migrados, com as mesmas asserções de comportamento (o `fakeSessionRepo` não precisou de mudança: ele guarda o `LapRecord` como vem).
- [x] Gate: `npm test`, contagem registrada: 225 testes (223 + 2).

**Tests**: integration
**Gate**: full

---

#### T21: Recuperação e boot sobre séries

**What**: `recover` lê as séries, recorta as janelas e salva a sessão `recovered` sem copiar frames. `bootCheck` com a sessão já salva apaga só `recording_active`. O descarte da recuperação usa `journal.discard`.
**Where**: `src/recording/recovery.ts`
**Depends on**: T20
**Reuses**: `bootCheck.ts`, T16, T17
**Requirement**: TF-08, edge "sessão recuperada"

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): uma gravação interrompida depois de 4 blocos é recuperada com todos os frames desses 4 blocos e com as voltas que eles fecham.
- [x] Teste: `bootCheck` com a sessão já salva mantém as séries.
- [x] Teste: descartar a recuperação apaga as séries.
- [x] `test/recovery.test.ts` e `test/bootCheck.test.ts` migrados.
- [x] Gate: `npm test && npm run typecheck`, contagem registrada: 226 testes (225 + 1), baseline de 8 erros. Fim da fase.

**Tests**: integration
**Gate**: build

---

### Phase 4: Leitura, repositórios e selo

#### T22: Repositório de voltas

**What**: Criar `loadLaps(sessionId, {imu?})`, com um `readSeries` na janela que cobre todas as voltas e `lapFrames` por volta, e `loadLapSummaries(sessionId)`, que não toca no bruto. `getLapsForSession` passa a delegar para `loadLaps`. Os `LapRecord` saem com `gps`/`imu`/`window`, e com `samples`/`imuSamples` apontando para os mesmos arrays durante a transição.
**Where**: `src/storage/lapRepo.ts`
**Depends on**: None
**Reuses**: T10, T17
**Requirement**: TF-11, TF-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): as voltas lidas têm as fronteiras geradas e os frames internos esperados.
- [x] Teste: sem `imu: true`, nenhum bloco de IMU é decodificado.
- [x] Teste (TF-16): uma sessão de 20 min (GPS a 10 Hz, IMU a 50 Hz, 20 voltas) é lida com `imu: true` e montada em ≤ 200 ms no Node (mediana de 5 execuções, depois de 1 aquecimento). Medido pelo tempo de CPU do processo (SPEC_DEVIATION no teste): com o `npm test` rodando 8 arquivos em paralelo, a mediana pelo relógio variou de 30 ms (sozinho) a 355 ms (suíte), por espera de CPU; a de CPU ficou entre 30 e 115 ms. O relógio sai no diagnóstico do teste.
- [x] Teste: `loadLapSummaries` devolve id, `startedAt` e `durationMs` sem decodificar nenhum bloco.
- [x] `getLapsForSession` delega para `loadLaps(…, { imu: true })` (teste estático). A volta sem janela (ainda em JSON) sai do JSON como antes: fallback transitório até a v5b/v5c (T43/T44).
- [x] Gate: `npm test`, contagem registrada: 232 testes (226 + 6).

**Tests**: integration
**Gate**: full

---

#### T23: Traçados sobre séries

**What**: Fazer `saveLayout`/`saveReferenceLayout`/`promoteReferenceLayout`/`nextReferenceLayout` copiarem a janela da volta para as séries do dono `layout:<id>`, e `rowToLayout`/`listAllLayoutsGrouped` lerem as séries. `track_references` passa a ser lido do dono `reference:<track_id>`.
**Where**: `src/storage/layoutRepo.ts`
**Depends on**: T22
**Reuses**: as funções de `db.ts:720-834,1092`, movidas para cá
**Requirement**: TF-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): um traçado salvo a partir de uma volta devolve frames com `frames[0]` sintético, e `lineFromLayout` dá a mesma linha que dava com as amostras da volta.
- [x] Teste (sql.js): "ATUALIZAR REFERÊNCIA" cria o traçado novo com séries próprias e herda o PB na mesma transação.
- [x] Teste: excluir a sessão de origem não muda os frames do traçado.
- [x] `test/promoteReferenceLayout.test.ts` reescrito como teste de integração no sql.js, no lugar do regex sobre o fonte, conferindo as mesmas três escritas na mesma transação (uma falha no PB desfaz as outras duas). O cabeçalho nomeia a asserção que ele substitui.
- [x] `deleteLayout` apaga também a série do traçado. `track_references` é lido do dono `reference:<track_id>`. O traçado sem janela e a referência sem série saem do JSON: fallback transitório até a v5b/v5c (T43/T44).
- [x] Golden: o `saveReferenceLayout` do harness grava pelo `layoutRepo` no sql.js e lê de volta da série do traçado; o `expected.json` não mudou.
- [x] Gate: `npm test`, contagem registrada: 238 testes (232 + 5 de `layoutRepo.test.ts` + 2 de `promoteReferenceLayout.test.ts` − 1 estático substituído).

**Tests**: integration
**Gate**: full

---

#### T24: Excluir a sessão com o bruto

**What**: Fazer `deleteSession` apagar voltas, séries e blocos da sessão numa transação exclusiva.
**Where**: `src/storage/db.ts`
**Depends on**: T22
**Reuses**: `deleteOwner`
**Requirement**: TF-09

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Teste (sql.js): depois de excluir, não sobra nenhuma linha em `laps`, `telemetry_series` nem `telemetry_blocks` daquela sessão, e os de outra sessão ficam intactos.
- [x] Teste: uma falha no meio desfaz a exclusão inteira.
- [x] O SQL fica em `sqlSessionRepo.deleteSessionOn` (testável no sql.js); `db.ts` `deleteSession` delega (teste estático).
- [x] Gate: `npm test`, contagem registrada: 241 testes (238 + 3).

**Tests**: integration
**Gate**: full

---

#### T25: Sessão demo em frames

**What**: Fazer `seedDemoSession` gravar a sessão demo em séries e janelas, sem `saveLap` em JSON.
**Where**: `src/lib/demoSession.ts`
**Depends on**: T22
**Reuses**: T10, T17
**Requirement**: TF-25 (edge da demo), TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste (sql.js): a sessão demo tem as mesmas voltas, durações e `started_at` de antes.
- [ ] Golden passa sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: integration
**Gate**: full

---

#### T26: Selo de fonte e qualidade

**What**: Criar `sessionBadge(source, lapsGps, allGps)` e `badgeText(badge)`, com as faixas da spec e o texto da design.
**Where**: `src/telemetry/badge.ts`
**Depends on**: None
**Reuses**: nada
**Requirement**: TF-23, TF-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste: medianas de 3 m, 5 m, 8 m, 10 m e 15 m dão boa, boa, média, média e ruim.
- [ ] Teste: os pontos `synthetic` não entram na mediana.
- [ ] Teste: sem nenhuma precisão, sai "desconhecida" sem metros.
- [ ] Teste: sem volta, usa todos os frames.
- [ ] Teste: `PHONE` dá "Celular" e `MYCHRON` dá "MyChron"; `badgeText` devolve "Celular · GPS boa (4 m)".
- [ ] Gate: `npm test && npm run typecheck`, contagem registrada, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

### Phase 5: Consumidores puros (`src/lib`)

Regra de todas as tarefas da fase: **mesma estrutura, outro tipo**. Nenhum algoritmo muda. O golden
passa sem mudar o `expected.json`, e os testes existentes do arquivo só trocam o tipo dos dados de
entrada.

#### T27: Núcleo de geometria e análise

**What**: Fazer `geometry.ts` e `analysis.ts` operarem sobre `GpsFrame`/`LocalGpsFrame`/`ImuFrame`. Isso cobre `buildReferenceLap`, `cleanSamples`, `repairDegenerateTimestamps`, `matchLapToReference`, `analyzeLap`, `analyzeSession` e o `LapRecord` novo, com as propriedades de transição. `GpsSample`, `ImuSample` e `LocalSample` viram aliases deprecados.
**Where**: `src/lib/analysis.ts`
**Depends on**: None
**Reuses**: o código existente
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/analysis.test.ts` passa com fixtures de `GpsFrame`, com os mesmos valores assertados.
- [ ] Teste: `cleanSamples` descarta um frame com `accuracy` indefinido, como descartava o 999 de antes.
- [ ] Golden passa sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T28: Setores e velocidade

**What**: `sectors.ts` e `speed.ts` sobre `GpsFrame`.
**Where**: `src/lib/sectors.ts`
**Depends on**: T27
**Reuses**: o código existente
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/sectors.test.ts` e `test/speed.test.ts` passam com fixtures de `GpsFrame` e os mesmos valores.
- [ ] Golden passa sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T29: Delta ao vivo e insight da volta

**What**: `realtimeDelta.ts` e `lapInsight.ts` sobre `GpsFrame`.
**Where**: `src/lib/realtimeDelta.ts`
**Depends on**: T27
**Reuses**: o código existente
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/realtimeDelta.test.ts` e `test/lapInsight.test.ts` passam com os mesmos valores.
- [ ] Golden passa sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T30: Detector de trompo

**What**: `spinDetector.ts` sobre `GpsFrame`/`ImuFrame`. Um frame de IMU sem `gyro` é ignorado na detecção por IMU.
**Where**: `src/lib/spinDetector.ts`
**Depends on**: T27
**Reuses**: o código existente
**Requirement**: TF-13, TF-14, edge "par incompleto"

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste novo: o trompo da sessão de referência 1 é detectado no mesmo instante pela IMU e pelo GPS (hoje não há teste deste arquivo).
- [ ] Teste: frames de IMU só com `accel` não geram trompo nem erro.
- [ ] Golden passa sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T31: Curvas e comparação de voltas

**What**: `corners.ts`, `cornerAnalysis.ts`, `cornerSpeed.ts` e `lapCompare.ts` sobre `LocalGpsFrame`/`LapRecord` novo.
**Where**: `src/lib/lapCompare.ts`
**Depends on**: T27
**Reuses**: o código existente
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/lapCompare.test.ts` passa com os mesmos valores.
- [ ] Golden (curvas, métricas por curva, comparação e velocidade mínima por curva) passa sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T32: Pilot DNA, coach e estatísticas

**What**: `pilotDna.ts`, `coachContext.ts` e `pilotStats.ts` sobre o `LapRecord` novo, lendo pelo `lapRepo`. `pilotStats` remove o import morto de `listTrackReferences`.
**Where**: `src/lib/coachContext.ts`
**Depends on**: T27
**Reuses**: o código existente, T22
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Golden (Pilot DNA, parte pura do contexto do coach, km totais) passa sem mudar o `expected.json`.
- [ ] Teste: `pilotStats` com um repositório falso de 3 sessões soma os km pela mesma regra de antes.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T33: Forma da pista, silhueta, traçado e detecção

**What**: `trackShapeStats.ts`, `trackSilhouette.ts`, `referenceLayout.ts`, `lapDetector.ts`, `startLine.ts`, `brakingPoint.ts` e `speedRange.ts` sobre `GpsFrame`.
**Where**: `src/lib/lapDetector.ts`
**Depends on**: T27
**Reuses**: o código existente
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/lapDetector.test.ts`, `test/startLine.test.ts` e `test/referenceLayout.test.ts` passam com os mesmos valores.
- [ ] Golden (contagem de curvas, silhueta, linha, frenagem B, faixa de cor) passa sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T34: Agregados sem bruto

**What**: Fazer `recap.ts`, `gamification.ts` e `challenges.ts` usarem `loadLapSummaries`, e não `getLapsForSession`.
**Where**: `src/lib/gamification.ts`
**Depends on**: T27
**Reuses**: T22
**Requirement**: TF-13, TF-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste estático: nenhum dos três chama `getLapsForSession(`.
- [ ] Teste: com um repositório falso, XP, desafios e recap dão os mesmos valores para 3 sessões conhecidas.
- [ ] Gate: `npm test && npm run typecheck`, contagem registrada, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

### Phase 6: Componentes e telas

Mesma regra da fase 5. Os testes estáticos das telas são reescritos para o código novo, e cada regex
substituído nomeia o que substitui.

#### T35: Componentes de mapa e silhueta

**What**: `TrackSilhouette`, `ColoredTrackPath`, `ui/TrackShape` e `analysis/parts` recebem `GpsFrame`. `TrackShape` lê as referências pelo `layoutRepo`.
**Where**: `src/components/ColoredTrackPath.tsx`
**Depends on**: None
**Reuses**: T23
**Requirement**: TF-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste estático: nenhum dos quatro importa `GpsSample` ou chama `listTrackReferences(` diretamente.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T36: Tela da sessão com o selo

**What**: `app/session/[id].tsx` sobre o `LapRecord` novo, mantendo os caminhos de limpeza de hoje, com o selo no cabeçalho via `sessionBadge`/`badgeText`.
**Where**: `app/session/[id].tsx`
**Depends on**: T35
**Reuses**: T26, T28, T31, T33
**Requirement**: TF-13, TF-14, TF-23, TF-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste estático: a tela chama `sessionBadge(` e `badgeText(`; mantém `cleanSamples` + `repair` na análise e só `repair` no traçado (as linhas 244 e 255 de hoje).
- [ ] `test/sessionScreen.test.ts` reescrito: `savedSamples[l.id] = sectorLapSamples(l);` é substituído pela forma nova, com nota.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T37: Mapa da pista e comparação de voltas

**What**: `app/track-map.tsx` e `app/lap-compare.tsx` sobre o `LapRecord` novo, mantendo os caminhos de limpeza de cada uma.
**Where**: `app/track-map.tsx`
**Depends on**: T35
**Reuses**: T31
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/trackMapScreen.test.ts` e `test/lapCompareScreen.test.ts` reescritos com as mesmas regras (o mapa limpa e repara os dois lados; a comparação não limpa `savedA`).
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T38: Replay

**What**: `app/replay/[id].tsx` sobre frames, lendo a IMU (`imu: true`) para o trompo, e mantendo o filtro só de não-finitos.
**Where**: `app/replay/[id].tsx`
**Depends on**: T35
**Reuses**: T30
**Requirement**: TF-13, TF-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste estático: a tela chama `loadLaps(` com `imu: true` e não chama `cleanSamples(`.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T39: Abas, perfil, Pilot DNA e coach

**What**: `(tabs)/index`, `(tabs)/sessions`, `(tabs)/insights`, `(tabs)/profile`, `pilot-dna` e `coach` sobre o `LapRecord` novo.
- `index` usa `peakSpeedMsOfLaps` sobre as voltas lidas.
- As listas usam `loadLapSummaries` onde só precisam da duração.

**Where**: `app/(tabs)/index.tsx`
**Depends on**: T35
**Reuses**: T22, T29, T32
**Requirement**: TF-13, TF-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/homeScreen.test.ts` e `test/insightsScreen.test.ts` reescritos com as mesmas regras.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T40: Telas de gravação e recuperação

**What**: `recording`, `recording-reference` e `recovery` sobre o hook novo:
- o descarte chama `journal.discard`;
- a referência salva o traçado pelo `layoutRepo`;
- o literal 30 vira a constante compartilhada `MIN_SAMPLES`.

**Where**: `app/recording.tsx`
**Depends on**: T35
**Reuses**: T19, T21, T23
**Requirement**: TF-07, TF-09, TF-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `test/recordingScreen.test.ts` e `test/recordingReferenceScreen.test.ts` reescritos. Os dois caminhos de descarte chamam `discard(`, e o "Encerrar" chama `end(`.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T41: Telas de traçado e de pista

**What**: `track-layouts-picker`, `new-session`, `at-track`, `onboarding/track` e `onboarding/track-confirm` sobre o `layoutRepo` e `GpsFrame`.
**Where**: `app/track-layouts-picker.tsx`
**Depends on**: T35
**Reuses**: T23, T33
**Requirement**: TF-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste estático: nenhuma das cinco importa `GpsSample` nem lê `samples_json`.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

### Phase 7: Migração do histórico e fechamento

#### T42: Conversão do legado (pura)

**What**: Criar `convertSessionLaps`, `convertLayout` e `convertJournal`, com as regras da design:
- sintéticos viram cruzamentos;
- janela por índice sem sintético;
- duplicata descartada só com `t`, `lat` e `lng` iguais;
- `legacy`, `fix: unknown`;
- JSON ilegível vai para `skipped`;
- `t0Utc` = menor `t`.

**Where**: `src/telemetry/legacy.ts`
**Depends on**: None
**Reuses**: T7, T17
**Requirement**: TF-17, TF-20 (AC 9)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste: uma sessão com 3 voltas pós-AD-006 vira uma série única, 3 janelas por cruzamento, e `lapFrames` de cada janela devolve exatamente as amostras antigas da volta.
- [ ] Teste: voltas pré-AD-006 com um ponto compartilhado na fronteira geram um frame só para ele, e as janelas por índice devolvem as amostras antigas.
- [ ] Teste: uma volta com todos os `t` iguais (degenerada) mantém todos os pontos.
- [ ] Teste: um JSON ilegível vai para `skipped`, e as outras voltas convertem.
- [ ] Teste: um diário v4 pendente vira séries com os mesmos frames.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T43: Migração v5b (por sessão, com retomada)

**What**: Criar `migrateV5Data(conn)`:
- percorre as sessões sem `frames_version = 5`, depois os traçados, as referências e o diário pendente;
- para cada uma, converte numa transação exclusiva, grava séries e janelas e marca a sessão.

Uma falha desfaz só aquela, e a próxima execução retoma dela.
**Where**: `src/storage/migrations.ts`
**Depends on**: T42
**Reuses**: T10, T12
**Requirement**: TF-17, TF-18, TF-19, TF-20 (AC 7)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste (sql.js), banco v4 de referência:
  - 3 sessões das features 1 e 2, com e sem sintéticos, com e sem IMU;
  - uma volta com JSON corrompido;
  - 2 traçados;
  - um diário pendente.

  Depois da migração, os tempos, `started_at`, o PB e a linha de chegada de cada traçado são os de antes.
- [ ] Teste (sql.js): com falha injetada na 2ª sessão, a 1ª fica convertida, a 2ª continua legível no formato antigo, e a próxima execução termina sem duplicar a 1ª.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: integration
**Gate**: full

---

#### T44: Migração v5c (remoção do formato antigo)

**What**: Criar `migrateV5Cleanup(executor)`. Só quando não sobra sessão nem traçado sem conversão, ela remove `laps.samples_json`, `laps.imu_samples_json`, `track_layouts.samples_json`, `track_references.samples_json` e `recording_chunks`, e grava `user_version = 5`. Encadear v5a → v5b → v5c no `db()`.
**Where**: `src/storage/db.ts`
**Depends on**: T43
**Reuses**: T12, T43
**Requirement**: TF-13, TF-20 (AC 8)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste (sql.js): com uma sessão ainda sem conversão, a v5c não remove nada e não grava `user_version = 5`.
- [ ] Teste (sql.js): com tudo convertido, as colunas e a tabela saem, e as sessões abrem com os mesmos tempos e o mesmo PB (TF-18 AC 10).
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: integration
**Gate**: build

---

#### T45: Golden pelo pipeline novo e pelo legado

**What**: Ampliar `test/golden.test.ts` com dois caminhos:
- **pipeline novo:** as entradas brutas da T4 passam por `handleLocations`, `imuCapture`, diário em sql.js, `saveRecordedSession`, `loadLaps` e os consumidores;
- **caminho legado:** o JSON que o código antigo salvaria passa pela v5 em sql.js, depois por `loadLaps` e pelos consumidores.

Os dois são comparados com o mesmo `expected.json`.

**Where**: `test/golden.test.ts`
**Depends on**: T44
**Reuses**: T6
**Requirement**: TF-14, TF-18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Os dois caminhos passam no `goldenCompare` sem mudar o `expected.json`.
- [ ] Gate: `npm test`, contagem registrada.

**Tests**: unit
**Gate**: quick

---

#### T46: Fim dos tipos antigos

**What**: Remover os aliases `GpsSample`/`ImuSample`/`LocalSample`, as propriedades de transição `samples`/`imuSamples` do `LapRecord` e o `saveLap` em JSON. Atualizar `src/lib/insights.ts` (código morto) para os tipos novos. Criar o teste estático que varre `src/` e `app/`.
**Where**: `test/noLegacyTypes.test.ts`
**Depends on**: T45
**Reuses**: nada
**Requirement**: TF-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Teste estático: nenhum arquivo de `src/` e `app/` contém `GpsSample`, `ImuSample`, `LocalSample`, `samples_json` ou `imu_samples_json`. A única exceção é `src/storage/migrations.ts` e `src/telemetry/legacy.ts`, que leem o formato antigo.
- [ ] Teste estático: nenhum acesso a `.imuSamples` nem a `lap.samples` em `src/` e `app/`.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: unit
**Gate**: build

---

#### T47: Documentação

**What**: Atualizar `docs/telemetria.md` com o modelo, o relógio, as séries e os blocos, a qualidade, a migração v5 e a regra de leitura (30 m na leitura, fronteiras geradas, AD-007). Corrigir o comentário de `geometry.ts` sobre o acelerômetro, que vale também para quem ler o histórico.
**Where**: `docs/telemetria.md`
**Depends on**: T46
**Reuses**: design.md
**Requirement**: TF-01 a TF-25 (documentação)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] O documento descreve o `TelemetryFrame` e as séries como o formato único, sem trecho que mande gravar `samples_json`.
- [ ] Gate: `npm test && npm run typecheck`, baseline de 8 erros.

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

| Fase | Tarefas | Dependências internas |
|---|---|---|
| 1 | T1–T6 | ver o diagrama da Phase 1 |
| 2 | T7–T12 | ver o diagrama da Phase 2 |
| 3 | T13–T21 | ver o diagrama da Phase 3 |
| 4 | T22–T26 | ver o diagrama da Phase 4 |
| 5 | T27–T34 | ver o diagrama da Phase 5 |
| 6 | T35–T41 | ver o diagrama da Phase 6 |
| 7 | T42–T47 | ver o diagrama da Phase 7 |

Execução estritamente sequencial dentro de cada lote.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1–T3 | 1 função extraída + 1 chamada na tela | ✅ Granular |
| T4–T6 | 1 arquivo de teste cada | ✅ Granular |
| T7, T8, T10, T11, T13–T15, T17, T18, T22, T26, T42 | 1 módulo cada | ✅ Granular |
| T9 | interface + adaptador + helper de teste do mesmo recorte | ⚠️ Coeso (3 coisas ligadas) |
| T12, T43, T44 | 1 etapa de migração cada | ✅ Granular |
| T16, T19, T20, T21, T23, T24, T25 | 1 módulo existente reescrito cada | ✅ Granular |
| T27–T34 | troca de tipo em 1–4 arquivos da mesma área, sem mudar algoritmo | ⚠️ Coeso (mesma área, mudança mecânica, um golden) |
| T35–T41 | troca de tipo em 1–6 telas ou componentes da mesma área | ⚠️ Coeso (mesma área, mudança mecânica) |
| T45, T46, T47 | 1 teste ou 1 documento | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | None | → T6 | ✅ Match |
| T5 | None | → T6 | ✅ Match |
| T6 | T4, T5 | T4 → T6, T5 → T6 | ✅ Match |
| T7 | None | → T8 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | None | → T10, → T12 | ✅ Match |
| T10 | T8, T9 | T8 → T10, T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T9 | T9 → T12 | ✅ Match |
| T13 | None | → T14, → T15 | ✅ Match |
| T14 | T13 | T13 → T14 | ✅ Match |
| T15 | T13 | T13 → T15 | ✅ Match |
| T16 | T14, T15 | T14 → T16, T15 → T16 | ✅ Match |
| T17 | None | → T18, → T19 | ✅ Match |
| T18 | T17 | T17 → T18 | ✅ Match |
| T19 | T16, T17, T18 | T16/T17/T18 → T19 | ✅ Match |
| T20 | T19 | T19 → T20 | ✅ Match |
| T21 | T20 | T20 → T21 | ✅ Match |
| T22 | None | → T23, T24, T25 | ✅ Match |
| T23 | T22 | T22 → T23 | ✅ Match |
| T24 | T22 | T22 → T24 | ✅ Match |
| T25 | T22 | T22 → T25 | ✅ Match |
| T26 | None | — | ✅ Match |
| T27 | None | → T28 … T34 | ✅ Match |
| T28–T34 | T27 | T27 → cada uma | ✅ Match |
| T35 | None | → T36 … T41 | ✅ Match |
| T36–T41 | T35 | T35 → cada uma | ✅ Match |
| T42 | None | → T43 | ✅ Match |
| T43 | T42 | T42 → T43 | ✅ Match |
| T44 | T43 | T43 → T44 | ✅ Match |
| T45 | T44 | T44 → T45 | ✅ Match |
| T46 | T45 | T45 → T46 | ✅ Match |
| T47 | T46 | T46 → T47 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1–T3 | lógica pura + tela (estático) | unit | unit | ✅ OK |
| T4–T6 | comparação de referência | unit (golden) | unit | ✅ OK |
| T7, T8, T13–T15, T17, T18, T26, T42 | lógica pura | unit | unit | ✅ OK |
| T9, T10, T11, T16, T20–T25, T43 | armazenamento | integration | integration | ✅ OK |
| T12, T44 | migração | integration | integration | ✅ OK |
| T19 | hook (estático) + lógica pura | unit | unit | ✅ OK |
| T27–T34 | lógica pura | unit | unit | ✅ OK |
| T35–T41 | telas (estático) | unit | unit | ✅ OK |
| T45 | comparação de referência | unit (golden) | unit | ✅ OK |
| T46 | invariante estática | unit | unit | ✅ OK |
| T47 | documentação | none | none | ✅ OK |
