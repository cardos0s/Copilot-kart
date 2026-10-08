# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Teste com dependência injetada precisa cobrir a combinação de flags que produção de fato gera (diário ativo + uiActive=true), não só os estados isolados.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `src/recording` · harmful: 0
- features: gravacao-sem-perda
- evidence: src/recording/locationHandler.ts:68 (rodada 2) (src/recording)
- last seen: 2026-09-25T00:10:05Z

### L-002 - Ao mudar o contrato de um hook compartilhado (useLapRecorder), fazer grep de todos os chamadores e cobrir o caminho de quem não passa o parâmetro novo.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `src/hooks` · harmful: 0
- features: gravacao-sem-perda
- evidence: app/legend-race.tsx:88, app/competition-race.tsx:125 (rodada 1) (src/hooks)
- last seen: 2026-09-25T00:10:05Z

### L-003 - AC de mensagem visível não fecha no hook: exigir teste estático na tela que renderiza o texto exato da spec sob a condição.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `app` · harmful: 0
- features: gravacao-sem-perda
- evidence: REC-10 AC 3 (rodada 1) (app)
- last seen: 2026-09-25T00:10:06Z

### L-004 - Ao unificar uma régua, procurar todo cálculo equivalente (somas por fatia, terços, split) no repo, não só as chamadas da função antiga pelo nome.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `src/lib` · harmful: 0
- features: tempos-honestos
- evidence: src/lib/lapCompare.ts:146-166, app/track-map.tsx:112-121 (TMP-07) (src/lib)
- last seen: 2026-09-29T14:58:29Z

### L-005 - Estado por volta (delta, setores, cronômetro) reinicia em toda abertura de volta, inclusive a que segue uma volta descartada, não só quando uma volta fecha.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `src/hooks` · harmful: 0
- features: tempos-honestos
- evidence: src/hooks/useLapRecorder.ts:515 (TMP-10) (src/hooks)
- last seen: 2026-09-29T14:58:30Z

### L-006 - Ao corrigir um consumidor para a régua única, igualar também os pontos de entrada (mesmo filtro/reparo que a sessão e o ao vivo), com teste de fix ruim perto dos limites.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `app` · harmful: 0
- features: tempos-honestos
- evidence: app/lap-compare.tsx:81-83 (TMP-07 AC 3, rodada 2) (app)
- last seen: 2026-09-29T15:17:03Z

### L-007 - Quando uma tela ganha guarda estática da origem dos pontos, a tela irmã que usa os mesmos pontos precisa da mesma guarda.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `test` · harmful: 0
- features: tempos-honestos
- evidence: app/session/[id].tsx:267 (M04, rodada 3) (test)
- last seen: 2026-09-29T15:33:22Z

### L-008 - Guarda estática prende a origem dos dados e os argumentos exatos, não só o nome da chamada; teste de 'não altera a entrada' usa fixture próprio.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `test` · harmful: 0
- features: tempos-honestos
- evidence: M02/M06/M09 (rodada 4) (test)
- last seen: 2026-10-03T13:18:00Z

### L-009 - Do not list an input state in an acceptance criterion that the typed platform API cannot produce unless a test injects it
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: telemetry-frame
- evidence: TF-04 validation.md gap 1 (spec)
- last seen: 2026-10-08T15:52:45Z

### L-010 - State whether a quality metric over lap frames reads the raw frames or the frames after the analysis accuracy cut
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `telemetry` · harmful: 0
- features: telemetry-frame
- evidence: TF-24 AC 2 validation.md gap 2 (telemetry)
- last seen: 2026-10-08T15:52:45Z

### L-011 - State a storage size limit against the artifact the test measures, encoded payload bytes or database file size
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `storage` · harmful: 0
- features: telemetry-frame
- evidence: TF-10 test/blockCodec.test.ts:171 (storage)
- last seen: 2026-10-08T15:52:46Z

### L-012 - For screen acceptance criteria name the pure function and the wiring check that prove them, since the suite renders no screens
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `screens` · harmful: 0
- features: telemetry-frame
- evidence: TF-23 test/sessionScreen.test.ts:106 (screens)
- last seen: 2026-10-08T15:52:46Z

### L-013 - Feed migration golden tests with data written by the pre-feature code, not data re-serialized from the new pipeline
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `migration` · harmful: 0
- features: telemetry-frame
- evidence: TF-14 test/golden/harness.ts:964 (migration)
- last seen: 2026-10-08T15:52:47Z

### L-014 - When an acceptance criterion enumerates channels, round-trip each one in the contract test or mark the list as examples
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `telemetry` · harmful: 0
- features: telemetry-frame
- evidence: TF-21 AC 2 test/telemetryContract.test.ts:115 (telemetry)
- last seen: 2026-10-08T15:52:47Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
