# Levantamento para a loja — CockPit 219

24/09/2026. Tudo foi lido do código, sem nenhuma edição. A referência é a `main` em
`19d3f16` (25/08), o último commit. Complementa o [`telemetria.md`](telemetria.md), que
descreve o algoritmo; as correções a ele estão na seção 2.

**Veredito.** O motor de telemetria é bom e testável, mas **o app não passa em
nenhuma das duas lojas hoje**:

- Há 8 bloqueadores de política: privacidade, exclusão de conta, localização em
  segundo plano, marca, moderação, Senna, telas inacabadas e ficha da loja.
- O banco na nuvem está aberto para leitura e escrita por qualquer pessoa.
- A gravação perde a sessão inteira se o app cair.

Já existe o app no App Store Connect (`ascAppId 6780962406`), e houve um beta
v0.1.0 no TestFlight. No Google Play não há nada.

---

## 1. Estado do repositório

- **Stack:** Expo SDK 54, React Native 0.81 e New Architecture. O README ainda diz SDK 52.
- **`android/` e `ios/` fora do git.** O `.gitignore` exclui as duas pastas, então o
  EAS gera tudo a partir do `app.config.js`. As pastas locais são sobra de um prebuild
  de 16/06: não confiar nelas.
- **Branches.** Quase todas já foram mergeadas. As exceções:
  - **`fix/live-perf`: 14 commits fora da main** (29/05–15/06). Trazem:
    - recuperação anti-crash (`src/storage/recovery.ts`);
    - backup anônimo (`sessionSync.ts`);
    - modo evento (`/event/[code]`) e renomeação para Cockpit;
    - **troca do bundle id para `com.cortextech.cockpit`**, que conflita com o
      `com.cortextech.copilot` da main e com o app já criado no App Store Connect.

    A main seguiu outro caminho na competição (`match.ts`), então o merge não sai
    limpo: é escolher peça por peça.
  - `claude/busy-pare-*` e `claude/nostalgic-benz-*` estão abandonadas.
- **Worktrees:** busy-pare, live-perf, modest-galileo, nostalgic-benz e team-box.
- **Fora do git:** `docs/telemetria.md`, `CockPit-Guia-do-Testador.pdf` e este arquivo.

## 2. Núcleo da telemetria

### O que está sólido
- `detectLaps` é pura, e a mesma chamada roda ao vivo e no `stop()`. A contagem de
  voltas não diverge entre a pista e o que fica salvo.
- As constantes do `telemetria.md` §12 batem com o código.
- Sessão, comparação, mapa, Pilot DNA e contexto do coach aplicam `cleanSamples`
  e `repairDegenerateTimestamps`.
- A publicação ao vivo é fire-and-forget e não trava a gravação.

### Bugs que atingem o piloto
| # | Problema | Onde | Efeito |
|---|---|---|---|
| T1 | **Nada é salvo durante a sessão**: os pontos ficam só em memória até o "Encerrar". O `doFinish` não tem try/catch | `useLapRecorder.ts:19,307`, `recording.tsx:417-433` | Crash, SO matando o app ou falta de RAM perdem a sessão inteira; erro no SQLite deixa a sessão pela metade |
| T2 | **Gesto/botão voltar apaga a sessão** sem confirmar | `_layout.tsx:151`, `useLapRecorder.ts:779` | Perde a sessão em um toque |
| T3 | **A interpolação do cruzamento não funciona a 5–10 Hz**: a fração fica presa em 1 | `lapDetector.ts:153-191` | Tempos grudam em múltiplos de 100 ms (49.600 / 50.000 ms no GPX de bancada); o milésimo é falso |
| T4 | **A 1ª volta sai 400–900 ms curta** (começa na linha, fecha ~13 m antes) | idem | PB falso, e o app oferece trocar a referência por uma volta truncada (`recording.tsx:602,946`) |
| T5 | **GPS órfão**: se o app morre gravando, o task-manager religa o GPS na abertura seguinte e ninguém o para | boot sem `hasStarted`/`stop` | Bateria drenada e notificação "Copilot gravando" solta |
| T6 | **Alert nativo em tela travada em paisagem**, que o próprio código diz travar o iOS | `recording-reference.tsx:182,214,220,264,276`, `recording.tsx:235,412,436,609` | App congelado; o :264 é o único jeito de encerrar o reconhecimento |
| T7 | **Setores ao vivo usam outra régua** que a análise (terços geográficos × 7/7/6 mini-setores) e supõem que a linha inventada coincide com o s=0 do traçado | `useLapRecorder.ts:634-641`, `session/[id].tsx:757` | S1/S2/S3 da pista ≠ S1/S2/S3 da análise; a equipe recebe o errado |
| T8 | **Traçado novo ignorado**: a transição reconhecimento → gravação navega sem `layoutId` | `recording-reference.tsx:162` | Segundo traçado nunca é usado; a sessão sai com layout null |
| T9 | **Preflight grava `''` em vez de null** em layout/setup | `preflight.tsx:62`, `recording.tsx:424` | PBs de "sem traçado" separados em dois grupos |
| T10 | **Pico de velocidade é o máximo bruto** (continua) | `speed.ts:16`, `recording.tsx:538`, `lapInsight.ts:52` | Uma fix ruim infla o "máx" e vai para a IA |
| T11 | **Insights sem reparo de timestamp** (continua; §13 do doc) e a volta descartada fica no denominador | `lapInsight.ts:45,90` | Média por curva diluída em silêncio |
| T12 | "Pior setor recorrente" lê `track_references`, que nada mais grava | `insights.ts:298` | Insight morto para usuário novo |

Menores: a heurística de timestamp (`% 1000`) troca fix legítima (`:53`); o início que
falha deixa keep-awake ligado e o estado em `'requesting'` (`:415-429`); a IMU usa
`Date.now()` e o GPS usa `loc.timestamp` (`:111`); não há medição de bateria.

### Correções ao `telemetria.md`
- "10 Hz" só vale no Android: no iOS, `timeInterval` é ignorado.
- §2: a interpolação não funciona na taxa real (T3).
- §5: a janela de intensidade é ±6 m fixa; o que é adaptativo é a suavização de
  posição. Faltam no doc a histerese de 0,5× e o varrido mínimo de 30°.
- §4: a tela agrupa em 7/7/6, não em terços; o ao vivo usa terços geográficos.
- "12 sessões" mora em `insights.tsx:38`.
- §10 contradiz §13, e o lapInsight não é o único consumidor cru.
- O comentário em `analysis.ts:190` diz 3×, mas o código usa 5×.
- Regras não documentadas:
  - busca global acima de 20 m;
  - delta ao vivo null acima de 40 m ou |30 s|;
  - trompo por GPS (2 s / 50% / 120°).

### Testes
- **Não há suíte.** Nenhum `*.test.*`, jest ou script `test`.
- `scripts/self-test.js` passa, mas **reimplementa o pipeline dentro do script**:
  não testa o código de produção.
- `scripts/self-test-lap-detector.js` usa o detector real e passa 5/5 com `npx tsx`
  (com `node` puro falha).
- `npx tsc --noEmit`: **17 erros**, nenhum no núcleo:
  - 9 são da `landing/`, que o tsconfig da raiz inclui;
  - 8 são do app: reanimated `SharedValue`, `onboarding/email.tsx:31,34` e
    `mode.tsx:39`.

### Demo vazando para o usuário real
- A seção **DEMO** de Configurações aparece para todos (`settings.tsx:186-252`,
  marcada "TEMP").
- O **"Velocímetro (demo)"** grava uma sessão real numa pista real e soma XP,
  PB e conquistas. Também chama a IA com a chave do usuário e **publica o PB no
  ranking público**.
- `seedDemoSession` entra no histórico e na melhor volta da pista.

## 3. Dados e nuvem

### Local (SQLite `kartlap.db` + AsyncStorage + SecureStore)
- As migrações são versionadas por `PRAGMA user_version` (v3), e quem atualiza o app
  mantém os dados.
- Riscos no banco local:
  - nenhuma migração roda em transação;
  - o `dbInstance` é atribuído antes de o schema terminar, então uma chamada
    simultânea pega o banco sem tabelas (`db.ts:9`);
  - `foreign_keys` desligado deixa threads do coach, PBs e conquistas órfãos
    ao apagar uma sessão.
- **Sem backup, export nem sync.** Trocar de celular perde tudo. O botão
  "Sincronizar" diz "Em breve", mas o login promete "sincronize entre aparelhos".
- A sessão do Supabase Auth fica no AsyncStorage, não no SecureStore.

### Supabase: aberto
O `schema.sql` tem RLS com `using (true)` em tudo, e o próprio arquivo diz
"TODO produção". Não há `auth.uid()` nem DELETE. Com a anon key, qualquer pessoa pode:
- listar todas as transmissões e **baixar o GPS preciso de qualquer piloto, com o nome**;
- **mandar mensagem falsa ("BOX AGORA") para quem está em pista**, e editar
  mensagens já enviadas;
- encerrar a transmissão de outro, ou injetar pontos e voltas nela;
- sobrescrever o perfil de outro piloto, já que o `device_id` é público;
- falsificar o ranking com qualquer `best_lap_ms`;
- injetar posições numa partida por código (canal broadcast aberto).

Além disso, o TTL de 6h não é aplicado: a limpeza não está agendada em lugar nenhum.

Nenhum segredo está commitado, e só a anon key vai para o cliente.

### Conta
Apple e e-mail criam conta no Supabase Auth, mas **a conta não guarda nada**: serve
só para mostrar "Conectado". Não há exclusão de conta. Senha errada num e-mail que já
existe cai no `signUp`.

### Ao vivo
O fluxo fecha de ponta a ponta:

    piloto → Supabase realtime → web-spectator (/live, /team) → mensagens de volta

- A URL fixa no app é `copilot-mu-eight.vercel.app`, mas não há config de Vercel no
  repo e o `netlify.toml` publica só a landing.
- O celular do piloto baixa os próprios pontos de volta: `subscribeLiveSession`
  assina os 4 canais.

### Coach IA
- A chave é do próprio usuário (Claude `claude-sonnet-4-6`, Gemini `gemini-2.5-pro`
  por padrão, ou OpenAI `gpt-4o-mini`). A chamada sai direto do celular.
- A chave do Gemini vai na URL.
- A tela diz que a chave "não sai do seu aparelho", o que é falso, e o app não pede
  consentimento para mandar dados à IA de terceiro.
- Não são enviadas coordenadas brutas.

### Dados que saem do aparelho (para a App Store e o Data Safety)
Localização precisa, nome, e-mail, IDs de usuário/dispositivo e conteúdo do usuário
(mensagens e chat), todos ligados à identidade. O PB vai **automaticamente** para o
ranking público, sem opção de desligar. Não há tracking nem SDK de analytics ou crash.

## 4. Telas

- **Prontas:** home, sessões, insights, onboarding (7 passos), at-track, new-session,
  seletor de traçado, preflight, recording-reference, recording, sessão, comparação,
  coach, ai-key, setups, profile-edit, pilot-dna.
- **Parciais:**
  - **perfil:** "TOP 5" e "PÓDIOS" contam errado;
  - **settings:** unidade, notificações e tema são `useState` sem efeito, e há a
    seção DEMO;
  - **replay 3D:** sem o token do Mapbox, mostra instrução de dev ao usuário;
  - **competition-race:** pista genérica, posição estimada pelo tempo;
  - **legends / legend-race:** lenda com ~38 s em qualquer pista.
- **Órfãs** (código funcional, mas nada navega até elas): **career, challenges,
  recap, leaderboard, track-map, competition** (esta com rivais falsos fixos) e ranking.
- **Esqueleto:** `victory`, com "JU SANTOS / Speedland / P1" fixos no código.
- **Promessas sem entrega:**
  - o onboarding promete "RPM" e "fantasma da melhor volta";
  - o README cita um score 0–100 que é código morto;
  - Configurações dizem que o coach flutuante aparece em todas as telas, mas ele só
    existe na análise.
- **Catálogo:** 72 kartódromos, não 68. Nenhum tem curvas, largura ou tipo
  preenchidos. As coordenadas são em nível de cidade, e 43 têm comprimento
  redondo (800/900/1000 m).
- **Dependências mortas:** `ios`, `react-native-maps`, `three`, `expo-three`, `expo-gl`,
  `@react-three/fiber` e `@types/three`. Código morto: `src/lib/insights.ts` e
  `CornerAnalysisPanel.tsx`.
- **Tipografia:** 476 `fontWeight`, e 463 blocos caem na fonte do sistema em vez
  de Chivo. Não há componente `Text` do tema.
- **Idioma misturado na UI:** "BEST", "REC", "PILOT DNA", "Track Mode", "Preview",
  "Replay", "Streak", mais mensagens de dev visíveis ("Faltando trackId…").
- **cockpit-vision:** roda (OpenCV, 2 scripts CLI), mas só gera vídeo com HUD.
  Não tem ligação nenhuma com o app.

## 5. O que bloqueia as lojas

Onde o texto cita regra de loja sem conferência na fonte, é o entendimento da política.

| # | Bloqueador | Loja |
|---|---|---|
| L1 | **Política de privacidade e termos**: não há URL; os botões dizem "Em breve" (`settings.tsx:312,314`) e o onboarding cita termos sem link | Ambas |
| L2 | **Exclusão de conta** dentro do app (e por URL no Google) | Ambas |
| L3 | **Localização em segundo plano**: não há tela de aviso antes do pedido (`useLapRecorder.ts:405-414`); o Play pede declaração, vídeo e o tipo de foreground service; na Apple os textos citam "KartLap" e alguns são genéricos em inglês | Ambas |
| L4 | **Marca**: o `name` é "Copilot" (também marca da Microsoft), as permissões dizem "KartLap", a notificação diz "Copilot gravando" e o compartilhamento diz "no Copilot!" | Ambas |
| L5 | **Conteúdo de usuário sem moderação**: ranking e mensagens sem denunciar ou bloquear, e o RLS aberto (seção 3) | Apple 1.2 |
| L6 | **Senna e pilotos reais**: nomes no modo Lendas, frases parafraseadas assinadas "— AYRTON SENNA", imagem `senna-kart.png` na landing | Ambas (5.2 + direito de imagem) |
| L7 | **Inacabado no build**: seção DEMO, toggles sem efeito e "Em breve" | Apple 2.1 |
| L8 | **Ficha**: faltam screenshots, descrição, classificação etária, rótulo de privacidade e Data Safety | Ambas |

Riscos menores:
- Permissões Android herdadas dos plugins: `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` e
  `READ`/`WRITE_EXTERNAL_STORAGE` (resolve com `blockedPermissions`).
- Na config: a chave `ios.package` é inválida e o `location` aparece duplicado.
- O ícone tem cantos arredondados na arte, e o adaptive tem texto perto da borda.
- `PrivacyInfo.xcprivacy` sem `NSPrivacyCollectedDataTypes`.
- Sem crash reporting e sem ErrorBoundary global.
- Versão fixa `0.1.0` em `settings.tsx:25`.

O pedido de "sempre" nem é necessário. O expo-location grava com a permissão de uso e
o foreground service segura o Android. Tirar o `ACCESS_BACKGROUND_LOCATION` pode
eliminar a declaração no Play; isso ainda precisa ser confirmado em aparelho.

## 6. Decisões da Julia (24/09)

Registradas como AD-001 a AD-005 em `.specs/STATE.md`.

1. **Nome:** "CockPit 219" em tudo o que o usuário vê. O bundle id continua
   `com.cortextech.copilot` para reaproveitar o app do App Store Connect.
2. **Ao vivo e ranking** ficam na v1, com banco protegido de verdade.
3. **Lendas e Senna** saem.
4. **Conta completa, mas opcional.** Gravar e analisar funcionam sem conta. Backup,
   ao vivo e ranking pedem login.
5. **Telas órfãs:** ficam ranking por pista, mapa detalhado, carreira, desafios, recap
   e corrida por código (a corrida precisa ser terminada). Saem Lendas, o lobby de
   competição com rivais falsos, a tela de vitória e o ranking duplicado.
6. **Ao vivo com dois links:** espectador só vê; equipe vê e manda mensagem.
7. **Plataformas:** iOS e Android juntos.

## 7. Roteiro: v1 intercalada com o Telemetry Engine (revisto em 06/10)

Em 06/10 a Julia trouxe o documento "CockPit — Telemetria, IA, Visão Computacional e
Arquitetura" e decidiu **intercalar**: a v1 já sai com parte das ideias. Em seguida
fixou que **o `.xrk` do MyChron é importado direto no app**.

| # | Feature (`.specs/features/`) | Cobre | Estado |
|---|---|---|---|
| 1 | `gravacao-sem-perda` | T1, T2, T5, T6, T8, T9, init do banco | PASS (24/09), UAT pendente |
| 2 | `tempos-honestos` | T3, T4, T7, T10, T11, T12, suíte do núcleo | PASS (03/10), UAT pendente |
| 3 | `telemetry-frame` | Modelo interno único (§3 do documento): `source`, relógio monotônico e qualidade em cada amostra, e dado bruto preservado. Fica independente de MyChron, GoPro e Alfano | — |
| 4 | `conta-e-backup` | Conta opcional; backup, sync e restauração dos frames brutos em blocos (§6); migração do dado local; exclusão de conta | — |
| 5 | `nuvem-segura` | RLS por dono, dois links ao vivo, ranking validado, TTL | — |
| 6 | `corner-intelligence` | Ponto de frenagem, entrada, ápice e saída por curva, mais o coach que só recomenda com evidência e mostra de onde veio a conclusão (Spikes F e H) | — |
| 7 | `importar-xrk` | Importação do `.xrk` do MyChron/AiM **direto no app**, convertido em `TelemetryFrame` com `source: MYCHRON` (Spike C) | — |
| 8 | `produto-limpo` | Marca, Lendas fora, telas órfãs, demo atrás de `__DEV__`, idioma, deps mortas | — |
| 9 | `conformidade-e-ficha` | Privacidade, termos, localização, permissões, ficha, build de produção e teste fechado | — |

**Fica para a v2:**
- recorder nativo em Kotlin e Swift (Spike A);
- GoPro com GPMF e vídeo sincronizado (Spike D);
- EngineSense (Spike B);
- Alfano;
- Racing Line Model;
- `corrida-por-codigo`, que saiu da v1 para compensar o atraso.

Os spikes de GoPro e EngineSense podem andar como pesquisa em `cockpit-vision/`, fora do app.

**Repositórios de referência** (conferidos em 06/10 na API do GitHub):
- `gopro/gpmf-parser` (Apache-2.0) e `Kyree-Yang/road-sensor-logger` (MIT): podem ser usados.
- `caezium/kart-telemetry-experiment`, `garysclaw/xrk-rs` e `xdw15c/esp32-adxl-fft-rpm`: não têm licença, então são só estudo, e o código não pode ser copiado.
- `tobi/omatrack`: não existe (404).

A `fix/live-perf` não entra por merge. As peças úteis (anti-crash, backup, as telas
que "ficavam carregando pra sempre") são portadas dentro das features 1, 3 e 5.
