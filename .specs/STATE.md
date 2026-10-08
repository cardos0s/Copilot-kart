# STATE

## Decisions

### AD-001
- **Decision**: O nome visível ao usuário é "CockPit 219" em todos os pontos: nome do app, textos de permissão, notificação, compartilhamento e URLs. Os identificadores internos continuam os mesmos: bundle id e package `com.cortextech.copilot`, slug e scheme `kartlap`, banco `kartlap.db` e chaves `@copilot:`.
- **Reason**: O app já existe no App Store Connect (`ascAppId 6780962406`) com esse bundle id, e há beta no TestFlight. Trocar o id obriga a criar outro app e abandonar o projeto do EAS.
- **Trade-off**: O código carrega nomes internos antigos para sempre. A troca para `com.cortextech.cockpit`, feita na `fix/live-perf`, fica descartada.
- **Scope**: app.config.js, eas.json e textos de UI em todas as features.
- **Date**: 2026-09-24
- **Status**: active

### AD-002
- **Decision**: A conta é opcional. Gravar e analisar funciona sem conta, só no aparelho. Backup e sync, transmissão ao vivo e ranking exigem login (Supabase Auth), e todo dado na nuvem tem dono por `auth.uid()`.
- **Reason**: A Apple costuma recusar login obrigatório para funções que não precisam de conta. Além disso, o valor central do app (gravar e analisar) é local.
- **Trade-off**: São dois caminhos para manter (anônimo e com conta), e é preciso migrar os dados locais para a conta no primeiro login. O `device_id` deixa de identificar o dono na nuvem.
- **Scope**: conta-e-backup, nuvem-segura e onboarding.
- **Date**: 2026-09-24
- **Status**: active

### AD-003
- **Decision**: A transmissão ao vivo usa dois links por sessão. O de espectador só lê. O de equipe lê e manda mensagem ao piloto. Cada link carrega um token difícil de adivinhar, e as sessões não aparecem em nenhuma listagem.
- **Reason**: Hoje o mesmo código de 6 letras serve aos dois papéis, e a tabela é legível por qualquer um. Quem só assiste consegue mandar "BOX AGORA" para quem está em pista.
- **Trade-off**: O piloto passa a ter dois QR codes e links para compartilhar, e o web-spectator muda de rota e de forma de acesso.
- **Scope**: nuvem-segura, web-spectator e tela de gravação.
- **Date**: 2026-09-24
- **Status**: active

### AD-004
- **Decision**: Pilotos reais saem do app e da landing: modo Lendas, frases do Senna, `senna-kart.png` e a cor `--senna-yellow`.
- **Reason**: Há risco de rejeição (Apple 5.2) e de ação por direito de imagem. Além disso, há frases parafraseadas assinadas como se fossem do Senna.
- **Trade-off**: Perde o modo Lendas e o tom da home. Um substituto fictício, se vier, é outra feature.
- **Scope**: produto-limpo e landing.
- **Date**: 2026-09-24
- **Status**: active

### AD-005
- **Decision**: iOS e Android são lançados juntos na v1.
- **Reason**: É decisão de produto da Julia.
- **Trade-off**: A conformidade é dobrada: declaração de localização em segundo plano no Play Console, Data Safety e o rótulo de privacidade da Apple, tudo no mesmo ciclo.
- **Scope**: conformidade-e-ficha e o perfil de build de produção do Android.
- **Date**: 2026-09-24
- **Status**: active

### AD-006
- **Decision**: Toda volta salva começa e termina em pontos sintéticos (`synthetic: true`) exatamente na linha de chegada, com o instante interpolado do cruzamento. Tempo da volta, S1/S2/S3 e delta derivam desses pontos, por uma única função de linha (`resolveStartLine`/`crossing`) e uma única de setores (`sectorSplits`).
- **Reason**: Assim o ao vivo, o "Encerrar", a recuperação e a análise dão o mesmo número por construção, sem mudar o schema.
- **Trade-off**: A volta leva dois pontos que o GPS não entregou. Quem contar pontos ou exportar a trajetória precisa saber disso.
- **Scope**: tempos-honestos; toda feature futura que grave, sincronize (conta-e-backup) ou publique (nuvem-segura) voltas tem de preservar os pontos de fronteira.
- **Date**: 2026-09-27
- **Status**: active

### AD-007
- **Decision**: Todo dado de telemetria do app entra e sai pelo modelo `TelemetryFrame` (`src/telemetry/`). O dado é guardado em séries por dono (sessão, traçado), em blocos binários Float64 (`telemetry_series` + `telemetry_blocks`), com fonte, `t` em ms desde o `t0Utc` da série e qualidade por amostra. O bruto da sessão é preservado inteiro até a exclusão. As features derivadas são recalculáveis. A AD-006 continua valendo: os pontos de fronteira da volta são gerados na leitura a partir dos cruzamentos guardados, e nunca gravados no bruto.
- **Reason**: O Telemetry Engine precisa de um formato estável e independente de fornecedor (celular, MyChron, GoPro, Alfano) antes da conta-e-backup. O bruto perdido no "Encerrar" impedia recalcular análises.
- **Trade-off**: Três formas do mesmo dado para manter (bloco, série colunar, frame). A migração v5 converte todo o histórico. Cada feature nova que lê ou grava telemetria passa pelo `telemetryStore` e pelo codec.
- **Scope**: telemetry-frame e todas as features seguintes (conta-e-backup, nuvem-segura, corner-intelligence, importar-xrk).
- **Date**: 2026-10-06
- **Status**: active

## Handoff

- **08/10**: a `telemetry-frame` (feature 3) fechou, com o Verificador PASS na rodada 1.
  - **Branch** `feat/telemetry-frame`, criada da `feat/tempos-honestos`. Nada foi enviado ao origin: o push é da Julia.
  - **Resultado**: 302 testes (eram 149) e typecheck com os mesmos 8 erros de baseline. O golden `test/golden/expected.json` não mudou desde `21d1c16`. O sensor matou 22 de 22 mutantes. O relatório está em `.specs/features/telemetry-frame/validation.md`.
  - **Decisões da Julia durante a execução**, registradas na spec:
    - gravação com menos de 30 pontos de GPS (inclusive nenhum) é descartada com o bruto;
    - TF-16 é medido em tempo de CPU;
    - na regra de "mesmos números", tempo até 0,001 ms e os demais reais até max(1e-9, 1e-5·|valor|).
  - **Lacunas de precisão da spec, não bloqueantes** (lições candidatas L-009 a L-014):
    - TF-04 com timestamp ausente;
    - o selo ignora fixes acima de 30 m dentro da volta;
    - TF-10 medido no payload, e não no arquivo SQLite;
    - o selo não é renderizado em teste;
    - o JSON legado do golden é reconstruído;
    - o canal de freio não é lido de volta numa unidade do catálogo.
- **Pendências**:
  - UAT no aparelho das features 1, 2 e 3. Na 3, conferir a migração v5 num banco real com histórico, o selo na tela da sessão e se o descarte e o abandono não deixam bruto órfão.
  - Push das branches `feat/tempos-honestos` e `feat/telemetry-frame`, que fica com a Julia.
  - O bug dos desafios diários "Sub-50/Sub-60", que nunca concluem, virou tarefa separada.
  - Os `.xrk` do Ricardo Haag (MyChron 5/6, Velopark), prometidos para 07/10, são os primeiros arquivos de kart reais. Rodar o leitor do spike neles e conferir o canal de EGT.
- **Next step**: a feature 4, `conta-e-backup`, que sobe os blocos de `telemetry_blocks` como estão (AD-007).
- **Blockers**: nenhum.
- **Uncommitted files**: `CockPit-Guia-do-Testador.pdf`.
