# Telemetry frame: Validation

**Verdict**: PASS
**Date**: 2026-10-08
**Spec**: `.specs/features/telemetry-frame/spec.md`
**Diff range**: `5f63453..HEAD` (HEAD = `8c09cca`, branch `feat/telemetry-frame`, 53 commits)
**Verifier**: sub-agente independente (autor ≠ verificador), rodada 1

Todos os 42 critérios (37 ACs de TF-01 a TF-25 e os 5 edge cases) têm teste com `file:line` e asserção que confere o resultado definido na spec. Os 22 mutantes do sensor morreram. A suíte passa com 302 testes, e o typecheck tem só os 8 erros antigos. Ficam 6 lacunas de precisão da spec, nenhuma bloqueante.

---

## Task Completion

| Tasks | Status | Notes |
| ----- | ------ | ----- |
| T1–T47 | ✅ Done | 47 tarefas, 193 itens "Done when" marcados, nenhum aberto (`tasks.md:12`: "T1–T47 done") |

---

## Spec-Anchored Acceptance Criteria

### P1: Bruto da sessão inteira

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| TF-01 (AC 1) início com UTC e fonte | séries da sessão com `t0Utc` = instante do início e fonte `PHONE`, persistidas | `test/journal.test.ts:148` - `series.map(m => [m.kind, m.source, m.t0Utc, m.owner.kind, m.owner.id, m.legacy])` deepEqual `['gps','PHONE',1_790_000_000_000,'session','session_<id>',false]` (lido do sql.js pelo `sqlJournalStore`) | ✅ PASS |
| TF-02 (AC 2) frame de GPS completo | `t` = tempo resolvido − t0Utc, lat, lng, speed, heading, altitude, accuracy, fix, `gnssTime` = `loc.timestamp` | `test/locationHandler.test.ts:138` - `assert.deepEqual(buf.gps, expected)` com `frame(NOW-223-START, 4, NOW-223)` (todos os campos, `fix:'unknown'`, `gnssTime`); `:140` mesmo valor persistido; `:119` `[s.t, s.gnssTime]` | ✅ PASS |
| TF-03 (AC 3) fix > 30 m gravada | gravada com a precisão real | `test/locationHandler.test.ts:92` - `[[-14.1, 45], [-14.2, 30]]` no buffer; `:94` o mesmo no banco | ✅ PASS |
| TF-04 (AC 4) `timeRepaired` | quantizado, zero ou ausente → `timeRepaired`; relógio confiável → sem a marca | `test/locationHandler.test.ts:108` - `[undefined, undefined]`; `:112` - `[true, true, true]` (quantizado e `0`) | ✅ PASS (⚠️ "ausente", lacuna 1) |
| TF-05 (AC 5) IMU no relógio do GPS | mesmo instante absoluto → mesmo `t`; espaçamento do sensor | `test/sessionClock.test.ts:24-25` - `imu === 500`, `gps === 500`; `:15` - `imuT(5.02, 6100) === 5040`; `test/imuCapture.test.ts:35` frame com `t: 103` do sensor | ✅ PASS |
| TF-06 (AC 6 + edge do relógio) `t` estritamente crescente | relógio do aparelho voltando 1 h não faz `t` decrescer em nenhuma série | `test/sessionClock.test.ts:39` - IMU `[10, 30, 50, 70]`; `:43` - GPS `[100, 200, 201, 202]`; `test/locationHandler.test.ts:248,255` entre lotes | ✅ PASS |
| TF-07 (AC 7) sessão inteira mantida | todos os frames, do primeiro ao último, paddock e box inclusive | `test/finishRecording.test.ts:294` - `gpsAfter` deepEqual `gpsBefore`; `:296` paddock antes de `start.t`; `:297` box depois de `end.t`; `test/journal.test.ts:179` - 600 frames de IMU depois do `end` | ✅ PASS |
| TF-08 (AC 8 + edge da recuperada) recuperação | bruto até o último bloco gravado, sem cópia | `test/recovery.test.ts:335` - `persistedGps(...)` deepEqual os frames dos 4 blocos; `:338-341` só as séries `session_<id>`; `:342` - 8 blocos | ✅ PASS |
| TF-09 (AC 9) exclusão | nenhum frame da sessão sobra; outra sessão intacta | `test/deleteSession.test.ts:45` - `{ laps: 0, series: 0, blocks: 0, sessions: 0 }`; `:46` outra intacta; `:58` falha desfaz tudo; `test/journal.test.ts:189` descarte | ✅ PASS |
| TF-10 (AC 10) ≤ 5 MB / 20 min | GPS 10 Hz + IMU 50 Hz, 20 min, ≤ 5 MB | `test/blockCodec.test.ts:171` - `total <= 5_000_000` com 480 blocos de 5 s (`:170`) e todas as colunas presentes | ✅ PASS (⚠️ lacuna 3) |

### P1: Voltas lidas do bruto

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| TF-11 (AC 1) volta = janela | `laps` guarda cruzamento de abertura e de fechamento (t, lat, lng, velocidade) e a duração | `test/finishRecording.test.ts:278-285` - `window_kind 'cross'`, `[start_t, start_lat, start_lng, start_speed, start_acc]` e `end_*` iguais à janela, `duration_ms`; `:287` `samples_json === '[]'` | ✅ PASS |
| TF-11 (AC 2) fronteiras na leitura | `[fronteira(start), internos, fronteira(end)]` gerados dos cruzamentos | `test/lapRepo.test.ts:67` - `lap.gps` deepEqual `[boundary(start), ...inner, boundary(end)]` com `synthetic: true`; `test/telemetryLaps.test.ts:84-91` | ✅ PASS |
| TF-12 (AC 3) corte de 30 m na leitura | só precisão definida e ≤ 30 m; 30 entra, 30,0001 sai | `test/telemetryLaps.test.ts:53` - `[30, 30.0001, undefined, NaN, 3]` → `[30, 3]`; `:58-73` mesmas voltas que antes; `test/lapRepo.test.ts:65` | ✅ PASS |
| TF-13 (AC 4, 5) sem JSON e sem tipos antigos | nenhum `GpsSample`/`ImuSample`/`LocalSample`/`samples_json`/`imu_samples_json` em `src/` e `app/` fora da migração; nenhum `.samples`/`.imuSamples` | `test/noLegacyTypes.test.ts:36` - `found` deepEqual `[]`; `:60` idem para `.samples`; `test/migrationV5Cleanup.test.ts:156` banco novo sem as colunas. Checagem estática do verificador: grep vazio | ✅ PASS |
| TF-14 (AC 6 + edge da demo) mesmos números | tempo, S1/S2/S3, delta, pico, `lapInsight`, trompo, curvas, Pilot DNA, coach; regra "Mesmos números" | `test/golden.test.ts:60` (harness atual), `:99` (pipeline novo de ponta a ponta: captura → diário sql.js → "Encerrar" → `loadLaps`), `:110` (JSON legado → v5a/b/c → `loadLaps`) - `goldenCompare(...) === null`; `test/demoSession.test.ts:69-72` demo igual ao `expected.json` | ✅ PASS (⚠️ lacuna 5) |
| TF-15 (AC 7) payload do ao vivo | o mesmo payload de `live_samples` de antes | `test/liveSample.test.ts:94` - `got` deepEqual `todayPayload(sample, INFO)`; `test/golden.test.ts:60` inclui `livePoll` | ✅ PASS |
| TF-16 (AC 8) ≤ 200 ms | mediana de 5 (após 1 aquecimento), CPU, sessão de 20 min | `test/lapRepo.test.ts:129` - `median(cpu) <= 200`; `:104-105` 20 min, ≥ 11.950 GPS e ≥ 59.750 IMU | ✅ PASS |

### P1: Sessões e traçados antigos

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| TF-17 (AC 1) voltas viram frames | frames de GPS e IMU, fonte `PHONE`, marca `legacy` | `test/migrationV5Data.test.ts:164-170` - séries `{source:'PHONE', legacy:1}`; `:187` cada frame `synthetic \|\| legacy`; `test/legacy.test.ts:111` - todo frame `legacy === true && source === 'PHONE'` | ✅ PASS |
| TF-17 (AC 2) sintéticos viram cruzamentos | não viram frames | `test/legacy.test.ts:111` - `synthetic === undefined` em todo frame; `:118` `w.start` = 1º ponto sintético | ✅ PASS |
| TF-17 (AC 3) duplicata de fronteira | um frame só para o ponto idêntico; mesmo `t` com outra posição fica | `test/legacy.test.ts:144` - `conv.gps.length === 11 + 3`; `:145-147` janelas por índice | ✅ PASS |
| TF-17 (AC 5) fix `unknown` e precisão mantida | `fix: 'unknown'`, precisão original | `test/migrationV5Data.test.ts:186-187` - pontos antigos (com `accuracy`) iguais e `fix === 'unknown'` | ✅ PASS |
| TF-18 (AC 4) `started_at` e `duration_ms` | iguais aos de antes | `test/migrationV5Data.test.ts:157` - `lapRows(conn)` deepEqual `laps` | ✅ PASS |
| TF-18 (AC 10) mesmos tempos e PB | depois de tudo, inclusive a v5c | `test/migrationV5Cleanup.test.ts:116-121` - voltas, `pb_records` e melhor volta iguais; `test/migrationV5Data.test.ts:158` | ✅ PASS |
| TF-19 (AC 6) traçados | frames próprios, a mesma linha de chegada | `test/migrationV5Data.test.ts:206` - `lineFromLayout(layoutGps(read))` deepEqual a linha antiga; `test/layoutRepo.test.ts:91` traçado inalterado após excluir a sessão de origem | ✅ PASS |
| TF-20 (AC 7) falha na 2ª sessão | só ela desfeita, legível no formato antigo, retomada na próxima | `test/migrationV5Data.test.ts:267` `failed ['session:session_b']`; `:272` `frames_version 0`; `:276` nenhuma série; `:282` legível; `:289` 2ª execução converte 1 sem duplicar | ✅ PASS |
| TF-20 (AC 8) colunas só no fim | com qualquer sobra, nada sai e `user_version` fica 4 | `test/migrationV5Cleanup.test.ts:87-88` - `ALL_LEGACY` e `userVersion === 4` para cada um dos 4 tipos de sobra; `:115` 5 só com tudo convertido | ✅ PASS |
| TF-20 (AC 9) JSON ilegível | volta fica com o tempo, sem trajetória; as outras seguem | `test/legacy.test.ts:175-176` `skipped` e `{kind:'none'}`; `test/migrationV5Data.test.ts:180-181` volta lida com `window none` e `gps []`, tempo em `:175` | ✅ PASS |

### P1: Contrato multi-fonte

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| TF-21 (AC 1) multi-taxa | 1, 20, 25 e 50 Hz, cada uma com os próprios `t` | `test/telemetryContract.test.ts:83` - `n` `[60, 1200, 1500, 3000]`; `:89` bit a bit; `:93-94` `t` iguais | ✅ PASS |
| TF-21 (AC 2) canais além de GPS/IMU | nome, unidade do catálogo e fonte | `test/telemetryContract.test.ts:97` - `[channel, unit, source]` de temperatura, pedal, direção e rpm | ✅ PASS (⚠️ lacuna 6) |
| TF-21 (AC 3) unidade fora do catálogo | erro que nomeia canal e unidade | `test/telemetryContract.test.ts:115` - `UnitError`, `channel === 'Brake Press'`, `unit === 'bar'`; `test/telemetryFrame.test.ts:22-25` | ✅ PASS |
| TF-22 (AC 4) GPS sem fix | fix `none` | `test/telemetryContract.test.ts:107-108` - 50 pontos `none` e `states` deepEqual `fix` | ✅ PASS |
| TF-22 (AC 5) ida e volta MyChron | todos os valores e instantes iguais | `test/telemetryContract.test.ts:80` metas iguais; `:89` cada coluna bit a bit | ✅ PASS |

### P2: Selo

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| TF-23 (AC 1) fonte | "Celular" para `PHONE`, "MyChron" para `MYCHRON`; texto "Celular · GPS boa (4 m)" | `test/badge.test.ts:62-64` - `sourceLabel` e `badgeText(phone) === 'Celular · GPS boa (4 m)'`; tela: `test/sessionScreen.test.ts:110-114`, `:121` | ✅ PASS (⚠️ lacuna 4) |
| TF-24 (AC 2) faixas | mediana sem fronteiras: boa ≤ 5, média ≤ 10, ruim > 10 | `test/badge.test.ts:31` - `[3,5,8,10,15]` → `['boa','boa','média','média','ruim']`; `:34-35` 5,01 → média, 10,01 → ruim; `:42` fronteiras fora | ✅ PASS (⚠️ lacuna 2) |
| TF-24 (AC 3) sem precisão | "desconhecida", sem metros | `test/badge.test.ts:49-50` - `{quality:'desconhecida', medianAccuracyM:null}` e `'Celular · GPS desconhecida'` | ✅ PASS |
| TF-24 (AC 4) sem volta | todos os frames de GPS da sessão | `test/badge.test.ts:55-56` - mediana 15, `ruim`; `test/lapRepo.test.ts:189` `loadSessionGps` devolve todos os frames, inclusive > 30 m | ✅ PASS |

### Edge cases

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| < 30 pontos de GPS, inclusive nenhum (TF-25) | descartada com todo o bruto; 30 salva | `test/finishRecording.test.ts:312-314` só IMU → `too-few`, nenhuma sessão, `[0, 0]` séries/blocos; `:317-319` 29 pontos idem; `:322-324` 30 pontos → `saved` | ✅ PASS |
| Par accel+gyro incompleto (TF-25) | frame com o canal que chegou, o outro ausente | `test/imuCapture.test.ts:47-48` - frame só com accel e `'gyro' in frames[0] === false`; `:62`; consumidor: `test/spinDetector.test.ts:88,90` | ✅ PASS |
| Relógio volta no tempo (TF-06) | `t` estritamente crescente | `test/sessionClock.test.ts:39,43,46` | ✅ PASS |
| Sessão demo (TF-14) | gravada em frames, mesmo resultado | `test/demoSession.test.ts:69-72` voltas iguais ao `expected.json`; `:76-83` série e janelas, sem JSON; `test/golden.test.ts:60` sessão `demo` | ✅ PASS |
| Sessão recuperada (TF-08) | frames do diário viram o bruto, sem cópia | `test/recovery.test.ts:338-342` mesmas séries e 8 blocos; `test/bootCheck.test.ts:86-89` sessão já salva mantém as séries | ✅ PASS |

**Status**: ✅ 42/42 critérios com evidência e resultado da spec; ⚠️ 6 lacunas de precisão da spec.

### Payload/conjunction rule

- `laps` (janela): os 13 campos persistidos conferidos por valor em `test/finishRecording.test.ts:278-287`, mais `frames_version` em `:290`.
- Meta das séries (`source`, `t0_utc`, `legacy`, dono): `test/journal.test.ts:148` (gravação nova) e `test/migrationV5Data.test.ts:164-170` (convertida).
- Campos do frame: `fix` (`test/locationHandler.test.ts:138`, `test/telemetryContract.test.ts:108`), `gnssTime` (`test/locationHandler.test.ts:119-130`), `timeRepaired` (`:108,112`). Os três passam pelo banco em `:140`.

### Golden

- `git diff 21d1c16..HEAD -- test/golden/expected.json`: vazio. O `expected.json` é o capturado do código anterior à troca.
- `test/helpers/goldenCompare.ts` implementa a regra aprovada: chaves de tempo `t`, `tMs`, `*Ms`, `*_ms`, `*At` (`:27`) com ≤ 0,001 (`:53`); demais reais com ≤ max(1e-9, 1e-5·|esperado|) (`:20`, `:58`); inteiros e textos exatos (`:55`, `:91`); chave ausente ou a mais falha (`:81`, `:86`). O elemento de array herda a chave do array. A regra tem testes próprios em `test/goldenCompare.test.ts`.

---

## Spec-precision gaps

1. **TF-04 "ausente"**: a spec lista três casos (quantizado, zero, ausente). Quantizado e zero têm teste (`test/locationHandler.test.ts:112`). Nenhum teste entrega uma fix sem `timestamp`, e o tipo `LocationObject.timestamp` do expo-location é `number` obrigatório, então o caso não chega pela API tipada. O código o trata como estimado (`rawTs > 0` falso). Falta decidir se o caso existe; se existir, falta o teste.
2. **TF-24 AC 2, "frames dentro das voltas"**: o selo usa `lapsRaw[i].gps`, que já passou pelo corte de 30 m da leitura (`src/telemetry/laps.ts:106`). Uma fix acima de 30 m dentro da janela da volta fica fora da mediana, o que pode deixar o selo melhor do que o GPS estava. A spec não diz se essas fixes contam, e nenhum teste fixa uma das duas leituras.
3. **TF-10, "no aparelho"**: o teste mede os bytes do payload do codec (`test/blockCodec.test.ts:171`), não o arquivo SQLite. As 480 linhas de bloco e o índice ficam fora da conta. Com ~4,3 MB de payload a folga é grande, mas a medida não é a que a spec descreve.
4. **TF-23 e TF-24 na tela**: o "WHEN a tela da sessão abre" é provado por funções puras e por asserções sobre o texto de `app/session/[id].tsx` (`test/sessionScreen.test.ts:106-124`). Não há tela renderizada na suíte.
5. **TF-14, caminho legado**: o JSON v4 do golden legado é reconstruído a partir das voltas do pipeline novo (`legacyFrame`, `test/golden/harness.ts:964`), não com os bytes que o código antigo gravava. Os valores esperados vêm do código antigo (o `expected.json` está intacto), então a comparação dos consumidores vale. O que fica sem prova é a forma exata do JSON antigo. Detalhe do comparador: "inteiro" é decidido pelo valor dos dois lados (`goldenCompare.ts:55`), então uma contagem esperada inteira com valor real fracionário cairia na tolerância relativa. Hoje nenhum consumidor produz isso.
6. **TF-21 AC 2, "freio"**: temperatura, pedal, direção e rpm voltam iguais. O canal de freio só aparece recusado em `bar` (`test/telemetryContract.test.ts:115`), nunca gravado numa unidade do catálogo (por exemplo, `Pa`).

---

## Discrimination Sensor

Worktree temporária em `scratchpad/sensor` (detached `HEAD`, `node_modules` por symlink). Cada mutante foi aplicado, testado e revertido com `git checkout`. A worktree foi removida no fim, e `git status --porcelain` do repositório real ficou igual à linha de base (`?? CockPit-Guia-do-Testador.pdf`).

| # | File | Mutation | Tests | Killed? |
| - | ---- | -------- | ----- | ------- |
| M1 | `src/recording/locationHandler.ts` | volta o descarte de fix > 30 m (ou sem precisão) na captura | locationHandler | ✅ (2 falhas) |
| M2 | `src/recording/locationHandler.ts` | remove `timeRepaired` | locationHandler | ✅ |
| M3 | `src/recording/sessionClock.ts` | IMU `t` pelo `nowMs` em vez do relógio do sensor | sessionClock | ✅ (2) |
| M3b | `src/recording/imuCapture.ts` | acelerômetro usa `now()` em vez do `timestamp` do sensor | golden | ✅ (6) |
| M4 | `src/telemetry/laps.ts` | `lapFrames` sem as fronteiras sintéticas | lapRepo, golden | ✅ (6) |
| M5 | `src/telemetry/laps.ts` | IMU da janela exclui `end.t` (`<` em vez de `<=`) | telemetryLaps | ✅ |
| M5b | `src/telemetry/laps.ts` | `lapFrames` sem o corte de 30 m nos internos | lapRepo, golden | ✅ (5) |
| M6 | `src/telemetry/blockCodec.ts` | coluna `speed` gravada com precisão Float32 | blockCodec, contrato | ✅ (4) |
| M7 | `src/telemetry/telemetryStore.ts` | `readSeries` ignora `tFrom` | telemetryStore | ✅ |
| M8 | `src/storage/migrations.ts` | v5b engole o erro dentro da transação (sessão que falhou fica meio convertida) | migrationV5Data | ✅ |
| M9 | `src/storage/migrations.ts` | v5c remove as colunas com sobras | migrationV5Cleanup | ✅ |
| M10 | `src/telemetry/legacy.ts` | duplicata de fronteira descartada só por `t` | legacy | ✅ |
| M11 | `src/telemetry/legacy.ts` | duplicata idêntica não é descartada | legacy | ✅ |
| M12 | `src/telemetry/badge.ts` | faixa boa exclusiva (5 m vira média) | badge | ✅ |
| M12b | `src/telemetry/badge.ts` | fronteiras entram na mediana | badge | ✅ (2) |
| M13 | `src/storage/sqlSessionRepo.ts` | `deleteSession` deixa séries e blocos | deleteSession | ✅ |
| M14 | `src/recording/journal.ts` | `journal.end` apaga as séries | finishRecording, golden | ✅ (6) |
| M15 | `src/recording/finishRecording.ts` | mínimo de 30 pontos com `<=` | finishRecording | ✅ (2) |
| M16 | `src/recording/journal.ts` | série da gravação sem o `t0Utc` do início | journal, recovery | ✅ (5) |
| M17 | `src/telemetry/legacy.ts` | frame convertido sem `legacy` | legacy, migrationV5Data | ✅ (3) |
| M18 | `src/recording/locationHandler.ts` | frame sem `gnssTime` | locationHandler | ✅ (4) |
| M19 | `src/telemetry/series.ts` | GPS sem fix gravado como `unknown` | contrato | ✅ |
| M20 | `src/storage/lapRepo.ts` | `loadLaps` lê só a janela da 1ª volta | lapRepo, golden | ✅ (5) |

**Sensor depth**: P0 expandido (integridade de dados e migração).
**Result**: 22/22 mortos. PASS.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ O que está fora de escopo na spec (xrk, recorder nativo, nuvem) não entrou |
| Matches patterns | ✅ Repositórios injetados, `SqlConn` sobre expo-sqlite e sql.js, `MigrationExecutor` |
| Spec-anchored outcome check | ✅ Os valores conferidos são os da spec (30 m, 5.000.000 B, 200 ms de CPU, 5/10 m, "Celular · GPS boa (4 m)", `none`, `legacy`, `user_version` 4/5) |
| Every test maps to a spec requirement | ✅ Cada arquivo novo cita o TF ou a tarefa no cabeçalho |
| `SPEC_DEVIATION` markers | 6, todos de assinatura da design (`decodeBlock`, `readSeries`, `toLiveSample`, `sessionBadge`), do formato da pista golden e de TF-16 em CPU (este já aprovado na spec). Nenhum muda um resultado da spec |

---

## Gate Check

- **Gate command**: `npm test` (`node --import tsx --test test/*.test.ts`)
- **Result**: 302 passed, 0 failed, 0 skipped (exit 0)
- **Test count before feature**: 149
- **Test count after feature**: 302
- **Delta**: +153. Os testes antigos reescritos nomeiam a asserção que substituem.
- **Typecheck**: `npm run typecheck` com exatamente os 8 erros antigos (`app/career.tsx:195`; `app/leaderboard.tsx:125`, `:141`, `:166`; `app/recap.tsx:131`; `app/onboarding/email.tsx:31`, `:34`; `app/onboarding/mode.tsx:39`). Nenhum erro novo.
- **Static check (TF-13)**: `grep` por `GpsSample|ImuSample|LocalSample|samples_json|imu_samples_json` em `src/` e `app/` fora de `src/storage/migrations.ts` e `src/telemetry/legacy.ts`: vazio. Nenhuma leitura de `.samples`/`.imuSamples` de volta ou traçado (o único `...samples` é uma variável local em `src/recording/locationHandler.ts:88`).

---

## Summary

**Overall**: ✅ Pronto

**Spec-anchored check**: 42/42 critérios com o resultado da spec; 6 lacunas de precisão
**Sensor**: 22/22 mutantes mortos
**Gate**: 302 passed, 0 failed; typecheck na linha de base

**Next steps**: resolver as lacunas 1 e 2 na spec (decidir se a fix sem timestamp existe e se as fixes acima de 30 m contam no selo). As outras quatro são registros de medida e não pedem mudança de código.
