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

- **Pausa em 08/10**: a Julia segue numa sessão nova.
- **Feature 3, `telemetry-frame`: fechada.**
  - Verificador PASS na rodada 1. Branch `feat/telemetry-frame`, último commit `672b500`, sem push.
  - O relatório está em `.specs/features/telemetry-frame/validation.md`, com 6 lacunas de precisão não bloqueantes.
  - Uma delas é decisão da Julia: o selo de qualidade ignora as fixes acima de 30 m dentro da volta.
- **Feature 4, `conta-e-backup`: spec escrita, aguardando aprovação.**
  - Commit `accbc3a`, branch `feat/conta-e-backup`, criada da `feat/telemetry-frame`.
  - Fica na **worktree `/Volumes/SSD/Dev/Pessoal/Copilot-kart-conta`**, cujo `node_modules` é um symlink para o da pasta principal.
  - As oito decisões da Julia de 08/10 estão em `context.md`.
  - Faltam:
    - a aprovação dos seis padrões marcados `n` na tabela de Assumptions;
    - o plano do Supabase e a cota de armazenamento, que a Julia informa antes de aplicar qualquer coisa no projeto real.
- **Next step**: aprovar a spec e fazer o Design.
  - Decisão técnica que entra no Design: como testar as políticas RLS (hoje não há Postgres local nem Supabase CLI).
  - O que fica de servidor (tabelas, bucket privado, Edge Function de exclusão com a revogação da Apple) vai em arquivos versionados. Só se aplica no Supabase com o ok da Julia na hora.
- **Pendências**:
  - UAT no aparelho das features 1, 2 e 3.
  - Push das branches `feat/tempos-honestos`, `feat/telemetry-frame` e `fix/desafios-sub-volta`, que fica com a Julia.
  - A correção dos desafios Sub-50/Sub-60 foi feita por outra sessão na pasta principal (branch `fix/desafios-sub-volta`, `96c6ae5`) e ainda precisa ser revista e juntada.
  - Os `.xrk` do Ricardo Haag (MyChron 5/6, Velopark) ainda não foram rodados no leitor do spike.
- **Cuidado**: a pasta principal `/Volumes/SSD/Dev/Pessoal/Copilot-kart` é usada por outras sessões. Feature nova vai em worktree própria.
- **Blockers**: nenhum.
- **Uncommitted files**: na pasta principal, `CockPit-Guia-do-Testador.pdf`.
