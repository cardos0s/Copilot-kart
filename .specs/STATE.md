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

## Handoff

- **Feature**: `.specs/features/tempos-honestos/` (2ª de 7). A 1ª, `gravacao-sem-perda`, está com o Verificador PASS e a UAT no aparelho pendente.
- **Phase / Task**: Specify. A spec está escrita e validada e espera a aprovação da Julia. A linha do traçado e os terços exatos foram decididos por ela em 25/09.
- **Completed**: gravacao-sem-perda T1–T27.
- **In-progress**: nada.
- **Next step**: aprovada a spec, ir para o Design (gate perpendicular e sentido no `lapDetector`, setores interpolados no hook e na análise, p99).
- **Blockers**: nenhum. A pendência D1 da gravacao-sem-perda (demo gravando num diário guardado depois de falhar o "Encerrar") fica registrada no `validation.md` dela e não entra aqui.
- **Uncommitted files**: `.specs/features/tempos-honestos/spec.md`, `CockPit-Guia-do-Testador.pdf`.
- **Branch**: `feat/tempos-honestos`, criada a partir de `feat/gravacao-sem-perda`.
