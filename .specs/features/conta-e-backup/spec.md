# Conta e backup — Specification

## Problem Statement

Hoje quem troca de celular, perde o aparelho ou reinstala o app perde todas as sessões. A conta do
CockPit não guarda nada:
- serve só para mostrar "Conectado";
- o interruptor "Sincronizar dados" está fixo em desligado e diz "Em breve" (`app/settings.tsx:156-164`);
- não há backup, restauração nem exclusão de conta.

O login por e-mail também engana o piloto:
- senha errada num e-mail que já existe cai no cadastro e mostra "Confirme seu e-mail" sem logar ninguém (`src/lib/auth.ts:94-113`);
- o link de confirmação não abre o app;
- "Sair da conta" limpa só o perfil local e não desloga (`app/settings.tsx:90-106`).

As duas lojas exigem a exclusão de conta dentro do app (levantamento §5, L2). Pela AD-002, a conta
é opcional, mas é ela que guarda os dados na nuvem, com dono por `auth.uid()`. Pela AD-007, o bruto
da telemetria vai para a nuvem nos blocos binários em que já está no aparelho.

## Goals

- [ ] Um piloto que entra na conta num celular novo recebe de volta todas as sessões, voltas, traçados, PBs e o bruto da telemetria, com os mesmos números do aparelho antigo.
- [ ] Toda sessão salva com conta e backup ligado chega à nuvem sem ação do piloto, e o estado do backup fica visível em Configurações.
- [ ] O login por e-mail distingue senha errada de conta nova, e a confirmação por e-mail abre o app já logado.
- [ ] O piloto exclui a conta e todo o backup dentro do app, sem e-mail nem suporte.
- [ ] Nenhum usuário consegue ler ou escrever o backup de outro.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Login com Google | Decidido pela Julia em 08/10: Apple e e-mail bastam agora |
| Sincronização com edição simultânea em vários aparelhos | Decidido pela Julia em 08/10: o modelo é backup com restauração |
| RLS e identidade do ao vivo, do ranking e da corrida por código (`pilots`, `live_*`, `leaderboard_entries`, `match:<code>`) | É a feature 5 (`nuvem-segura`), inclusive a limpeza desses dados na exclusão de conta |
| Backup da chave da IA do coach, do `device_id` e do diário de gravação em andamento | Decidido pela Julia em 08/10: segredo e dado por aparelho ficam no aparelho |
| Compressão dos blocos na nuvem | Os blocos já são o formato compacto da AD-007 |
| Exportar sessão em arquivo (GPX, CSV) | Não foi pedido; é outra feature |
| Recalcular análises na nuvem | O processamento continua no aparelho |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Modelo | Backup contínuo com restauração. O aparelho envia e o aparelho novo recebe. Sessões se somam pelo id. Nos poucos dados editáveis (perfil, traçado padrão, setups), vale a versão mais recente | Decidido pela Julia em 08/10 | y |
| Quando envia | Automático depois de cada sessão salva e ao abrir o app, para o que ficou pendente. Botão "Fazer backup agora" e interruptor para desligar o backup | Decidido pela Julia em 08/10 | y |
| Rede | Os dados pequenos vão por qualquer rede. O bruto da telemetria só vai pelo Wi-Fi, a menos que o piloto ligue "Usar dados móveis" | Decidido pela Julia em 08/10 | y |
| Bruto na nuvem | Sim, tudo, nos blocos binários do aparelho (AD-007) | Decidido pela Julia em 08/10 | y |
| Plano do Supabase | **Pendente**: a Julia confirma o plano e a cota de armazenamento antes de aplicar no projeto real. Uma sessão de 20 min ocupa cerca de 4,3 MB | O limite do plano define quantas sessões cabem somando todos os usuários. Não bloqueia a spec | n |
| Primeiro login com dados no aparelho | Junta tudo na conta automaticamente, depois de uma tela que diz quantas sessões serão enviadas. Se a conta já tem dados de outro aparelho, os dois lados se somam. XP e contadores ficam com o maior valor de cada um, sem somar; conquistas, desafios e pistas personalizadas se unem pelo id | Decidido pela Julia em 08/10 | y |
| Sair da conta | Pergunta: "Manter os dados neste aparelho" ou "Apagar deste aparelho". Sai o segundo cartão "CONTA", e "Sair da conta Apple" vira "Sair da conta" para todos | Decidido pela Julia em 08/10 | y |
| Excluir conta | Apaga a conta no Supabase Auth, todo o backup e a foto do perfil na nuvem, e revoga o login da Apple. Pergunta se também apaga os dados do aparelho | Decidido pela Julia em 08/10. A Apple exige a revogação do token na exclusão | y |
| O que fica de fora | A chave da IA do coach, o `device_id`, o diário de gravação em andamento (`recording_active`), a citação do Senna e a sessão demo (ids `demo-*`). As conversas do coach entram | Decidido pela Julia em 08/10. A sessão demo é falsa e sai do app na `produto-limpo` | y |
| Login | Apple (iOS) e e-mail com senha. Senha errada vira senha errada, a confirmação abre o app pelo link, e o token do Supabase sai do AsyncStorage para o SecureStore | Decidido pela Julia em 08/10 | y |
| Excluir sessão com backup | A exclusão vale também na nuvem: a sessão e o bruto dela saem do backup | Se o backup guardasse a sessão excluída, a restauração a traria de volta | n |
| "Esqueci a senha" | Entra: manda o e-mail de redefinição, e o link abre o app numa tela para definir a senha nova | Com conta por e-mail e senha, sem isso o piloto que esquece a senha perde o backup | n |
| Restauração do bruto | Depois do login, sessões, voltas, traçados e PBs chegam primeiro. O bruto vem em segundo plano, com a mesma regra de rede do envio. Abrir uma sessão cujo bruto ainda não chegou baixa o bruto dela na hora, em qualquer rede, porque foi o piloto quem pediu | Assim a lista aparece rápido, e o celular novo não baixa gigabytes pelo plano de dados sem o piloto pedir | n |
| Sessão salva = sessão no backup | Uma sessão só conta como "na nuvem" quando a linha, as voltas e todos os blocos do bruto foram confirmados pelo servidor | Evita mostrar "tudo salvo" com o bruto pela metade | n |
| Falha de rede no meio do envio | O que já subiu fica. O resto volta para a fila, que sobrevive ao fechamento do app e é retomada na próxima oportunidade, sem duplicar nada | Envio por partes é o normal no celular | n |
| Sair com backup pendente | Se houver dado ainda não enviado, "Apagar deste aparelho" avisa quantas sessões ainda não estão na nuvem e só apaga depois de uma confirmação explícita | Apagar dado que não está em lugar nenhum é perda definitiva | n |
| Aplicar no Supabase real | Tabelas, políticas, bucket e Edge Function ficam em arquivos versionados no repositório. Só são aplicados no projeto real com o ok explícito da Julia na hora | É ação externa e afeta usuários reais | y |

**Open questions:** o plano do Supabase (linha marcada `n` acima) depende de uma informação da
Julia e não bloqueia a spec. As demais linhas `n` são padrões meus e aguardam a aprovação da spec.

---

## User Stories

### P1: Login que funciona ⭐ MVP

**User Story**: Como piloto, quero entrar com Apple ou e-mail e saber exatamente o que aconteceu, para confiar que minha conta existe e está ligada.

**Why P1**: Sem um login confiável, nenhum backup tem dono.

**Acceptance Criteria**:

1. WHEN o piloto entra com um e-mail que já tem conta e a senha certa THEN the app SHALL logar e mostrar o e-mail em Configurações.
2. IF o piloto entra com um e-mail que já tem conta e a senha errada THEN the app SHALL mostrar "Senha incorreta" e SHALL NOT tentar criar conta.
3. WHEN o piloto cria conta com um e-mail novo THEN the app SHALL pedir a confirmação por e-mail e mostrar que a conta ainda não está ativa.
4. WHEN o piloto toca o link de confirmação no celular THEN the app SHALL abrir já logado.
5. WHEN o piloto toca "Esqueci a senha" e informa o e-mail THEN the app SHALL pedir ao Supabase o e-mail de redefinição; WHEN o link é tocado THEN the app SHALL abrir na tela de senha nova.
6. IF o login falha por falta de rede THEN the app SHALL mostrar "Sem conexão" e SHALL NOT mostrar "Senha incorreta" nem "Confirme seu e-mail".
7. The app SHALL guardar a sessão do Supabase Auth no SecureStore, e não no AsyncStorage.
8. WHEN um piloto que já estava logado atualiza o app THEN the app SHALL mantê-lo logado, levando o token do AsyncStorage para o SecureStore.

**Independent Test**: com um cliente de auth falso, conferir cada resposta (sucesso, senha errada, conta nova, e-mail não confirmado, sem rede) e a mensagem mostrada; conferir que o armazenamento de sessão usado é o do SecureStore.

---

### P1: Backup automático ⭐ MVP

**User Story**: Como piloto com conta, quero que cada sessão vá para a nuvem sozinha, para não perder nada se o celular sumir.

**Why P1**: É o motivo da feature.

**Acceptance Criteria**:

1. WHEN uma sessão é salva com o piloto logado e o backup ligado THEN the app SHALL enfileirar o envio da sessão, das voltas e do bruto dela.
2. WHEN o app abre com o piloto logado e o backup ligado THEN the app SHALL retomar o envio de tudo o que estiver pendente.
3. WHILE o aparelho não está no Wi-Fi e "Usar dados móveis" está desligado the app SHALL enviar só os dados pequenos e deixar os blocos do bruto na fila.
4. The app SHALL enviar, além das sessões, voltas e bruto: traçados (com as séries deles), PBs, setups de kart, gamificação, conquistas, desafios, conversas do coach, o perfil com a foto e as pistas personalizadas.
5. The app SHALL NOT enviar a chave da IA do coach, o `device_id`, o diário de gravação em andamento nem as sessões demo (`demo-*`).
6. IF o envio falha no meio THEN the app SHALL manter na nuvem o que já foi confirmado e reenviar o resto na próxima tentativa, sem criar nenhuma linha nem bloco duplicado.
7. The app SHALL marcar uma sessão como "na nuvem" só quando a linha, as voltas e todos os blocos do bruto dela foram confirmados pelo servidor.
8. WHEN o piloto exclui uma sessão com backup THEN the app SHALL apagar a sessão, as voltas e o bruto dela também na nuvem, e SHALL repetir a exclusão na próxima oportunidade se estiver sem rede.
9. WHERE o backup está desligado the app SHALL NOT enviar nada e SHALL manter a fila para quando for religado.
10. The backup SHALL NOT bloquear a gravação nem a tela: o envio acontece em segundo plano, e uma falha nunca interrompe uma sessão em andamento.

**Independent Test**: com o servidor simulado, gravar uma sessão, cortar a rede no meio do bruto, religar e conferir que a nuvem fica com exatamente as linhas e os blocos do aparelho, sem duplicata; repetir sem Wi-Fi e com "Usar dados móveis" desligado.

---

### P1: Primeiro login junta os dados do aparelho ⭐ MVP

**User Story**: Como piloto que já usava o app sem conta, quero criar a conta e levar tudo o que já gravei.

**Why P1**: Todo usuário atual começa sem conta (AD-002).

**Acceptance Criteria**:

1. WHEN o piloto entra pela primeira vez neste aparelho e há dados locais THEN the app SHALL mostrar quantas sessões serão enviadas antes de começar.
2. WHEN o piloto confirma THEN the app SHALL enfileirar o envio de todos os dados locais elegíveis para a conta.
3. WHEN a conta já tem dados de outro aparelho THEN the app SHALL somar os dois lados: sessões, voltas, traçados, PBs, setups, conquistas, desafios, conversas e pistas pela união dos ids.
4. WHEN a gamificação existe dos dois lados THEN the app SHALL ficar, em cada campo numérico (XP, nível, contadores), com o maior dos dois valores.
5. WHEN o mesmo id existe dos dois lados num dado editável (perfil, traçado, setup) THEN the app SHALL ficar com a versão de edição mais recente.

**Independent Test**: aparelho com 3 sessões e conta com 2 sessões de outro aparelho; depois do login, os dois lados têm as 5, e o XP é o maior dos dois.

---

### P1: Restauração num aparelho novo ⭐ MVP

**User Story**: Como piloto que trocou de celular, quero entrar na conta e ver todas as minhas sessões de volta, com os mesmos tempos.

**Why P1**: É o benefício que o piloto percebe.

**Acceptance Criteria**:

1. WHEN o piloto entra na conta num aparelho sem dados THEN the app SHALL baixar sessões, voltas, traçados, PBs, setups, gamificação, conquistas, desafios, conversas, perfil com foto e pistas personalizadas.
2. WHEN a restauração termina THEN each restored session SHALL mostrar os mesmos tempos de volta, setores e PB que mostrava no aparelho de origem.
3. WHILE o bruto de uma sessão ainda não foi baixado the app SHALL listar a sessão com os tempos e mostrar que a análise detalhada depende do download.
4. WHEN o piloto abre uma sessão cujo bruto ainda não foi baixado THEN the app SHALL baixar o bruto dela na hora, em qualquer rede, e abrir a análise ao terminar.
5. The app SHALL baixar o resto do bruto em segundo plano, pela mesma regra de rede do envio.
6. WHEN o bruto de uma sessão é restaurado THEN the app SHALL guardar os blocos idênticos, byte a byte, aos que saíram do aparelho de origem.
7. IF a restauração é interrompida THEN the app SHALL retomá-la de onde parou na próxima abertura, sem duplicar nada.

**Independent Test**: enviar as sessões de referência do golden por um aparelho simulado, restaurar em outro banco vazio e comparar os números dos consumidores com o `test/golden/expected.json`.

---

### P1: Sair e excluir a conta ⭐ MVP

**User Story**: Como piloto, quero sair da conta ou apagar tudo de mim, sabendo o que acontece com os meus dados.

**Why P1**: A exclusão dentro do app é exigência das duas lojas (L2), e o "Sair" de hoje não desloga.

**Acceptance Criteria**:

1. WHEN o piloto toca "Sair da conta" THEN the app SHALL perguntar "Manter os dados neste aparelho" ou "Apagar deste aparelho", e SHALL deslogar do Supabase nos dois casos.
2. IF há dado ainda não enviado e o piloto escolhe "Apagar deste aparelho" THEN the app SHALL dizer quantas sessões ainda não estão na nuvem e SHALL só apagar depois de uma segunda confirmação.
3. WHEN o piloto confirma "Excluir conta" THEN the app SHALL pedir ao servidor a exclusão da conta e de todo o backup dela (linhas, blocos do bruto e foto).
4. WHEN a conta excluída entrou com Apple THEN the server SHALL revogar o token da Apple dessa conta.
5. WHEN a exclusão termina THEN the app SHALL perguntar se apaga também os dados deste aparelho e SHALL voltar ao onboarding deslogado.
6. IF a exclusão falha ou não há rede THEN the app SHALL mostrar o erro e SHALL manter a conta e os dados como estavam.
7. The settings screen SHALL ter um único cartão "Conta", com o estado do login, o estado do backup, "Fazer backup agora", "Usar dados móveis", o interruptor do backup, "Sair da conta" e "Excluir conta".

**Independent Test**: com o servidor simulado, excluir uma conta de Apple com backup e conferir que não sobra nenhuma linha nem objeto dela, que a revogação foi pedida e que o app volta deslogado.

---

### P1: Isolamento entre usuários ⭐ MVP

**User Story**: Como piloto, quero que só eu consiga ver e mexer no meu backup.

**Why P1**: Hoje o banco está todo aberto (levantamento §3). O backup não pode nascer assim.

**Acceptance Criteria**:

1. The server SHALL permitir ler, gravar e apagar cada linha e cada objeto de backup só ao usuário dono (`auth.uid()`).
2. IF um usuário tenta ler, gravar ou apagar o backup de outro THEN the server SHALL recusar.
3. IF uma requisição chega sem login (só com a anon key) THEN the server SHALL recusar qualquer acesso ao backup.
4. The server SHALL guardar o bruto num bucket privado, sem URL pública.

**Independent Test**: as políticas, aplicadas num Postgres de teste, recusam leitura e escrita cruzadas entre dois usuários e o acesso anônimo.

---

### P2: Estado do backup em Configurações

**User Story**: Como piloto, quero ver se meu backup está em dia.

**Why P2**: Dá confiança, mas o backup funciona sem a tela.

**Acceptance Criteria**:

1. WHEN o piloto abre Configurações logado THEN the screen SHALL mostrar "N de M sessões na nuvem" e o horário do último envio confirmado.
2. WHILE há envio em andamento the screen SHALL mostrar "Enviando…".
3. IF o último envio falhou THEN the screen SHALL mostrar o motivo em uma linha ("Sem conexão", "Aguardando Wi-Fi" ou "Erro no servidor").
4. WHEN o piloto toca "Fazer backup agora" THEN the app SHALL iniciar o envio do pendente, respeitando a regra de rede.

**Independent Test**: com o estado da fila simulado, conferir cada texto.

---

## Edge Cases

- IF o piloto troca de conta no mesmo aparelho (sai mantendo os dados e entra em outra conta) THEN the app SHALL perguntar se junta os dados locais à conta nova, com a mesma tela do primeiro login.
- IF a cota do armazenamento do servidor estoura THEN the app SHALL manter o bruto na fila e mostrar "Espaço da nuvem cheio" no estado do backup, sem afetar a gravação.
- IF a foto do perfil não existe mais no aparelho THEN the app SHALL fazer o backup do perfil sem foto.
- IF uma sessão restaurada aponta para um traçado ou pista personalizada que não veio THEN the app SHALL abrir a sessão como hoje abre uma sessão cujo traçado foi excluído.
- WHEN o token expira durante o envio THEN the app SHALL renovar a sessão e continuar; IF a renovação falha THEN the app SHALL pausar o backup e mostrar "Entre de novo na conta".
- IF a sessão foi gravada antes da `telemetry-frame` e convertida pela v5 THEN the app SHALL enviá-la como qualquer outra, com as séries `legacy`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| CB-01 | P1: Login — e-mail com senha certa, senha errada e conta nova (AC 1–3) | Design | Pending |
| CB-02 | P1: Login — confirmação e redefinição pelo link (AC 4, 5) | Design | Pending |
| CB-03 | P1: Login — sem rede (AC 6) | Design | Pending |
| CB-04 | P1: Login — token no SecureStore e migração do token (AC 7, 8) | Design | Pending |
| CB-05 | P1: Backup — fila automática ao salvar e ao abrir (AC 1, 2) | Design | Pending |
| CB-06 | P1: Backup — regra de rede (AC 3) | Design | Pending |
| CB-07 | P1: Backup — o que entra e o que fica de fora (AC 4, 5) | Design | Pending |
| CB-08 | P1: Backup — retomada sem duplicata e "na nuvem" só com tudo confirmado (AC 6, 7) | Design | Pending |
| CB-09 | P1: Backup — exclusão de sessão vale na nuvem (AC 8) | Design | Pending |
| CB-10 | P1: Backup — desligado e sem bloquear a gravação (AC 9, 10) | Design | Pending |
| CB-11 | P1: Primeiro login — tela de aviso e envio (AC 1, 2) | Design | Pending |
| CB-12 | P1: Primeiro login — soma dos dois lados, maior valor e versão mais recente (AC 3–5) | Design | Pending |
| CB-13 | P1: Restauração — dados pequenos e mesmos números (AC 1, 2) | Design | Pending |
| CB-14 | P1: Restauração — bruto sob demanda e em segundo plano (AC 3–5) | Design | Pending |
| CB-15 | P1: Restauração — blocos idênticos e retomada (AC 6, 7) | Design | Pending |
| CB-16 | P1: Sair — escolha e aviso de pendente (AC 1, 2) | Design | Pending |
| CB-17 | P1: Excluir conta — servidor, Apple, erro (AC 3–6) | Design | Pending |
| CB-18 | P1: Configurações — cartão único "Conta" (AC 7) | Design | Pending |
| CB-19 | P1: Isolamento — RLS por dono, anônimo recusado, bucket privado (AC 1–4) | Design | Pending |
| CB-20 | P2: Estado do backup (AC 1–4) | Design | Pending |
| CB-21 | Edge — troca de conta, cota cheia, foto ausente, referência ausente, token expirado, sessão legada | Design | Pending |

**Coverage:** 21 total, 0 mapped to tasks, 21 unmapped ⚠️ (Tasks ainda não existe)

---

## Success Criteria

- [ ] As sessões de referência do golden, enviadas por um aparelho e restauradas em outro, dão os mesmos números do `expected.json`.
- [ ] Um envio interrompido em qualquer ponto e retomado termina com a nuvem idêntica ao aparelho, sem duplicata.
- [ ] Depois de excluir uma conta, não sobra nenhuma linha nem objeto dela no backup.
- [ ] Um usuário não consegue ler nem gravar o backup de outro, nem anonimamente.
- [ ] A UAT no aparelho mostra login, backup, restauração num segundo aparelho e exclusão funcionando de ponta a ponta.
