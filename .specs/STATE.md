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

## Handoff

- **Pausa em 06/10**: a Julia vai continuar numa sessão nova.
- **Feito**:
  - `gravacao-sem-perda` com PASS (24/09).
  - `tempos-honestos` com PASS na rodada 5 (03/10).
  - A UAT no aparelho das duas está pendente.
- **Roteiro novo**: `docs/levantamento-loja.md` §7, revisto em 06/10.
  - A v1 sai intercalada com o Telemetry Engine, a partir do documento de ideias da Julia: Modo Mobile, Modo Pro, `TelemetryFrame`, Corner Intelligence, coach com evidência e `.xrk`.
  - O `.xrk` do MyChron é importado **direto no app**.
  - Ordem: 3 `telemetry-frame` → 4 `conta-e-backup` → 5 `nuvem-segura` → 6 `corner-intelligence` → 7 `importar-xrk` → 8 `produto-limpo` → 9 `conformidade-e-ficha`.
- **Spike do `.xrk`, interrompido**:
  - As amostras públicas (libxrk, MIT, dados de carro) e o trabalho parcial do leitor em TypeScript estão em `/Volumes/SSD/Dev/Pessoal/Copilot-kart-dados/xrk/` (ver `LEIA-ME.md`).
  - Objetivo: portar `xrk_format.py` para TypeScript puro e validar contra o gabarito do arquivo 0033 (13 voltas, 26 canais), medir desempenho e comparar com o `detectLaps`.
  - O MyChron real é do namorado da Julia. Ainda não há sessão de kart para validar.
- **Next step, a escolher pela Julia**:
  1. Terminar o spike do `.xrk`.
  2. Especificar a `telemetry-frame`, que é a próxima frente.
- **Pendências**:
  - Os 8 commits de `feat/tempos-honestos` depois de `3bc4232` e o commit do roteiro (`557f973`) podem ainda não estar no origin. O push é da Julia, porque o modo automático bloqueia.
  - A GoPro dela é uma HERO7: falta confirmar se é a Black (com GPS) mandando um MP4.
- **Blockers**: nenhum.
- **Uncommitted files**: `CockPit-Guia-do-Testador.pdf`.
- **Branch**: `feat/tempos-honestos`.
