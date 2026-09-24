# Gravação sem perda — Specification

## Problem Statement

Durante a gravação, os pontos de GPS e IMU ficam só em memória e só vão para o SQLite
quando o piloto toca em "Encerrar" (`useLapRecorder.ts:19,307`, `recording.tsx:417-433`).
Vários caminhos perdem a sessão inteira:

- o app cai, o sistema o mata ou a bateria acaba;
- o gesto de voltar tira o piloto da tela;
- o SQLite falha no meio do salvamento.

Três falhas vizinhas deixam o app em estado ruim:

- o GPS fica ligado sozinho depois de um crash;
- alertas nativos em tela presa em paisagem travam o iOS;
- a sessão grava o traçado ou o setup errado.

Este é o primeiro bloqueio para lançar, porque perder uma corrida é a falha que o
piloto não perdoa.

## Goals

- [ ] Nenhuma sessão perdida por crash, morte do processo ou gesto de voltar: no pior caso, perdem-se os últimos 10 s de pontos.
- [ ] Nenhuma tela de gravação usa alerta nativo enquanto está presa em paisagem.
- [ ] O GPS nunca fica ligado sem uma gravação visível na tela.
- [ ] Toda sessão sai com o traçado e o setup com que foi gravada, ou com `null`.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Precisão dos tempos: interpolação do cruzamento, 1ª volta curta, setores ao vivo, pico de velocidade | É a feature `tempos-honestos` |
| Backup na nuvem e restauração em outro aparelho | É a feature `conta-e-backup` (AD-002) |
| Confiabilidade da publicação ao vivo | É a feature `nuvem-segura` |
| Pedido de localização "sempre", tela de aviso e permissões | É a feature `conformidade-e-ficha` |
| Crash reporting (Sentry ou similar) | É decisão de observabilidade do lançamento, na feature `conformidade-e-ficha` |
| Consumo de bateria e aviso de bateria baixa | Não há medição hoje; entra depois, se o teste em pista mostrar problema |
| Trocar alerta nativo por modal nas telas que não ficam em paisagem | Lá o alerta não trava; mudar seria só estética |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Janela máxima de perda num crash | 10 s de pontos | Escrever com mais frequência gasta bateria e disco. Em 10 s a 10 Hz são ~100 pontos, menos de um quarto de volta | y |
| O que a recuperação guarda | Só as voltas completas, pelo mesmo `detectLaps` do "Encerrar" | É a mesma regra do encerramento normal, então a sessão recuperada é igual à que teria sido salva | y |
| Selo na sessão recuperada | Mostra "Recuperada" no histórico e na análise | O piloto precisa saber por que talvez falte o fim da sessão | y |
| Quando a recuperação é oferecida | Na abertura do app, antes da home, até o piloto recuperar ou descartar | É o ponto em que a gravação interrompida é descoberta | y |
| Meta do reconhecimento atingida | Aviso na tela que não pede toque; a gravação segue até o piloto encerrar | Hoje dispara um alerta com o kart andando (`recording-reference.tsx:182`) | y |
| Sessões antigas gravadas com `layout_id = ''` ou `kart_setup_id = ''` | Migração converte para `null` | Junta os PBs de "sem traçado" que hoje estão divididos em dois grupos | y |
| O que aproveitar do `recovery.ts` da `fix/live-perf` | Decide o Design | É a mesma ideia (snapshot a cada 30 s), mas com janela maior que a meta de 10 s | y |

**Open questions:** none. Todas foram resolvidas ou registradas acima e confirmadas pela Julia em 24/09 na aprovação da spec.

---

## User Stories

### P1: A sessão sobrevive a um crash ⭐ MVP

**User Story**: Como piloto, quero que a sessão seja salva mesmo se o app cair ou o celular desligar, para não perder uma corrida.

**Why P1**: Hoje uma queda no meio de 15 minutos de pista perde tudo, sem aviso.

**Acceptance Criteria**:

1. WHILE uma gravação está em andamento the app SHALL persistir em armazenamento durável os pontos de GPS e IMU, de forma que a morte do processo perca no máximo os últimos 10 s de pontos.
2. WHEN o app abre e encontra uma gravação interrompida THEN the app SHALL mostrar, antes da home, a pista, o horário de início e o número de voltas completas, com as opções "Recuperar" e "Descartar".
3. WHEN o piloto escolhe "Recuperar" THEN the app SHALL criar a sessão com as voltas que `detectLaps` encontra nos pontos persistidos, com a mesma pista, traçado, setup e modo da gravação original.
4. WHEN a sessão recuperada é criada THEN the app SHALL marcá-la como "Recuperada" no histórico e na análise.
5. WHEN o piloto escolhe "Descartar" THEN the app SHALL apagar os pontos persistidos da gravação interrompida.
6. IF a gravação interrompida não tem nenhuma volta completa THEN the app SHALL informar "Nenhuma volta completa para recuperar" e oferecer só "Descartar".
7. IF os dados persistidos estão num formato que o app não reconhece THEN the app SHALL descartá-los e informar "Não consegui ler a gravação interrompida".
8. IF o app morre durante a recuperação THEN the app SHALL, na abertura seguinte, oferecer a recuperação de novo sem criar sessão duplicada.
9. WHEN o "Encerrar" conclui com sucesso THEN the app SHALL apagar os pontos persistidos daquela gravação.

**Independent Test**: Gravar com o simulador de GPS por mais de 2 voltas e matar o processo. Na abertura seguinte, "Recuperar" deve criar uma sessão com as voltas completas e o selo "Recuperada".

---

### P1: O "Encerrar" nunca perde a sessão ⭐ MVP

**User Story**: Como piloto, quero que tocar em "Encerrar" salve tudo ou não mude nada, para nunca ficar com meia sessão.

**Why P1**: Hoje o `doFinish` não tem tratamento de erro. Uma falha do SQLite no meio deixa uma sessão parcial e a tela travada.

**Acceptance Criteria**:

1. The app SHALL salvar a sessão e todas as voltas dela numa única transação: ou todas as voltas ficam gravadas, ou nenhuma.
2. IF o salvamento no SQLite falha THEN the app SHALL manter os pontos persistidos, sair da tela de gravação e mostrar "Não consegui salvar a sessão. Ela fica guardada e o app oferece recuperar na próxima abertura."
3. The app SHALL concluir a criação do schema e as migrações do SQLite antes de atender qualquer leitura ou escrita, inclusive chamadas simultâneas na abertura.

**Independent Test**: Um teste com o banco falhando na terceira volta deve deixar zero voltas gravadas, e os pontos persistidos devem continuar lá.

---

### P1: Sair da gravação só com confirmação ⭐ MVP

**User Story**: Como piloto, quero que um toque sem querer não jogue a sessão fora.

**Why P1**: Hoje o gesto de voltar do iOS e o botão voltar do Android desmontam a tela, param o GPS e descartam tudo, sem perguntar.

**Acceptance Criteria**:

1. WHILE a tela de gravação ou de reconhecimento está ativa the app SHALL desligar o gesto de voltar do iOS.
2. WHILE a tela de gravação ou de reconhecimento está ativa, WHEN o piloto aciona o botão voltar do Android ou o botão de cancelar THEN the app SHALL mostrar uma confirmação com "Continuar gravando", "Encerrar e salvar" e "Descartar".
3. WHEN o piloto escolhe "Encerrar e salvar" na confirmação THEN the app SHALL seguir o mesmo caminho do botão "Encerrar".
4. WHEN o piloto escolhe "Descartar" na confirmação THEN the app SHALL parar o GPS, apagar os pontos persistidos e sair da tela.

**Independent Test**: Durante a gravação, o gesto e o botão voltar abrem a confirmação, e "Continuar gravando" mantém a contagem de voltas.

---

### P1: Nada de alerta nativo em paisagem ⭐ MVP

**User Story**: Como piloto, quero que o app não congele na minha mão no meio da pista.

**Why P1**: O próprio código documenta que `Alert.alert` com a tela presa em paisagem trava o iOS (`recording.tsx:397-399`). Ainda sobram dez chamadas nas duas telas de gravação.

**Acceptance Criteria**:

1. WHILE uma tela está presa em paisagem the app SHALL mostrar confirmações e erros num modal desenhado pela própria tela, sem `Alert.alert`.
2. WHEN a meta de reconhecimento é atingida THEN the app SHALL mostrar um aviso na tela que não pede toque e seguir gravando até o piloto encerrar.

**Independent Test**: Um teste estático confirma que `app/recording.tsx` e `app/recording-reference.tsx` não chamam `Alert.alert`.

---

### P1: O GPS nunca fica ligado sozinho ⭐ MVP

**User Story**: Como piloto, quero que o GPS desligue quando não estou gravando, para não gastar a bateria sem eu saber.

**Why P1**: Se o app morre gravando, o task-manager religa o GPS na abertura seguinte e ninguém o desliga. Fica a notificação de gravação solta e a bateria drenando.

**Acceptance Criteria**:

1. WHEN o app abre, sem tela de gravação ativa, e a tarefa de localização em segundo plano está registrada THEN the app SHALL parar essa tarefa e tratar os pontos persistidos como gravação interrompida.
2. IF ligar o GPS falha THEN the app SHALL liberar o keep-awake, voltar ao estado ocioso e mostrar "Não consegui ligar o GPS. Confira a permissão de localização e tente de novo."
3. IF a escrita durável falha durante a gravação THEN the app SHALL seguir gravando em memória e mostrar no HUD "Salvamento automático falhou".

**Independent Test**: Com a tarefa de localização registrada e nenhuma tela de gravação aberta, abrir o app deve deixar `hasStartedLocationUpdatesAsync` falso e oferecer a recuperação.

---

### P2: A sessão sai com o traçado e o setup certos

**User Story**: Como piloto, quero que a sessão use o traçado que acabei de reconhecer e o setup que escolhi, para a análise comparar com a referência certa.

**Why P2**: Não perde dado, mas deixa a comparação errada, e um segundo traçado nunca chega a ser usado.

**Acceptance Criteria**:

1. WHEN a gravação começa logo após o reconhecimento THEN the app SHALL usar o traçado que acabou de ser gravado.
2. WHEN uma sessão começa sem traçado ou sem setup THEN the app SHALL gravar `null` em `layout_id` ou `kart_setup_id`, nunca string vazia.
3. WHEN o app atualiza para esta versão THEN the app SHALL converter para `null` os `layout_id` e `kart_setup_id` vazios já gravados em sessões e PBs.
4. IF existe uma gravação interrompida ainda não resolvida WHEN o piloto tenta iniciar uma nova gravação THEN the app SHALL pedir que ele recupere ou descarte a anterior primeiro.

**Independent Test**: Reconhecer um segundo traçado e seguir para a cronometragem deve gravar a sessão com o `layout_id` desse traçado. "Correr sem traçado" deve gravar `null`.

---

## Edge Cases

- IF o disco enche durante a gravação THEN the app SHALL seguir gravando em memória e mostrar o aviso de salvamento automático (story 5, AC 3).
- IF o piloto força o fechamento na tela de recuperação THEN the app SHALL oferecer a recuperação de novo na abertura seguinte.
- WHEN a gravação interrompida tem mais de 180 s sem pontos no meio THEN the app SHALL aplicar a mesma regra de descarte de volta do `detectLaps`, sem tratamento especial.
- IF a sessão interrompida era de reconhecimento de traçado THEN the app SHALL oferecer a recuperação como traçado de referência, não como sessão de corrida.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| REC-01 | P1: Sobrevive a crash (AC 1, persistência de no máximo 10 s) | Design | Pending |
| REC-02 | P1: Sobrevive a crash (AC 2, 6, 7, oferta de recuperação) | Design | Pending |
| REC-03 | P1: Sobrevive a crash (AC 3, 4, 8, recuperar sem duplicar) | Design | Pending |
| REC-04 | P1: Sobrevive a crash (AC 5, 9, limpeza) | Design | Pending |
| REC-05 | P1: Encerrar atômico (AC 1, 2) | Design | Pending |
| REC-06 | P1: Encerrar atômico (AC 3, init do banco sem corrida) | Design | Implementing |
| REC-07 | P1: Sair só com confirmação | Design | Pending |
| REC-08 | P1: Sem alerta nativo em paisagem | Design | Pending |
| REC-09 | P1: GPS nunca sozinho (AC 1, tarefa órfã) | Design | Pending |
| REC-10 | P1: GPS nunca sozinho (AC 2, 3, falhas de início e de escrita) | Design | Pending |
| REC-11 | P2: Traçado e setup certos (AC 1) | Design | Pending |
| REC-12 | P2: Traçado e setup certos (AC 2, 3, null e migração) | Design | Pending |
| REC-13 | P2: Traçado e setup certos (AC 4, bloqueio de nova gravação) | Design | Pending |

**Coverage:** 13 total, 0 mapped to tasks, 13 unmapped ⚠️ (Tasks ainda não existe)

---

## Implicit-requirement sweep

| Dimensão | Onde ficou |
| -------- | ---------- |
| Input validation & bounds | N/A: não há entrada do usuário. Os pontos já passam pelo filtro de 30 m na porta |
| Failure / partial-failure | REC-05, REC-10 e o edge case do disco cheio |
| Idempotency / retry / duplicate | REC-03 (recuperar duas vezes não duplica) |
| Auth boundaries & rate limits | N/A: tudo é local ao aparelho |
| Concurrency / ordering | REC-06 (init do banco) e REC-13 (uma gravação por vez) |
| Data lifecycle / expiry | REC-04 (pontos persistidos apagados ao resolver) |
| Observability | Aviso no HUD (REC-10). Crash reporting fica fora (Out of Scope) |
| External-dependency failure | N/A: a feature não depende de rede. A publicação ao vivo já é fire-and-forget |
| State-transition integrity | REC-07, REC-09 e REC-10 (ocioso → pedindo → gravando → encerrando, sem estado preso) |

---

## Success Criteria

- [ ] Matar o processo em qualquer momento depois da 2ª volta recupera todas as voltas completas.
- [ ] Nenhuma chamada a `Alert.alert` em `app/recording.tsx` nem em `app/recording-reference.tsx`.
- [ ] `npx tsc --noEmit` sem erro novo e testes da feature passando com `npm test`.
