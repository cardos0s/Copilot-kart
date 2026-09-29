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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
