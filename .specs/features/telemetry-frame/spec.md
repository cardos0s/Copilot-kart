# Telemetry frame — Specification

## Problem Statement

O app não guarda o dado bruto e não tem um modelo de telemetria próprio. Isso aparece de quatro jeitos:

1. **O bruto se perde.** Depois do "Encerrar", o diário da gravação é apagado (`journalStore.ts:69`).
   Só ficam as fatias das voltas, em JSON (`laps.samples_json` e `imu_samples_json`). Paddock,
   volta de saída e box desaparecem, e nenhuma feature derivada pode ser recalculada quando os
   algoritmos melhorarem.
2. **A captura joga dado fora sem deixar rastro.** A fix com precisão pior que 30 m é descartada
   antes de ser guardada (`locationHandler.ts:63`). O timestamp quantizado é trocado por um tempo
   estimado sem marca nenhuma (`locationHandler.ts:65`).
3. **Os relógios divergem.** A IMU recebe `Date.now()` no instante em que o par accel+gyro se
   completa (`useLapRecorder.ts:75`). O GPS usa o horário da fix. São dois relógios diferentes na
   mesma sessão.
4. **Nada diz de onde a amostra veio nem quão boa ela é.** `GpsSample` e `ImuSample` são formatos
   do celular. O `.xrk` do MyChron (feature 7) traz canais em 1, 20, 25 e 50 Hz, com unidades
   próprias e pontos sem fix (`Copilot-kart-dados/xrk/spike/RELATORIO.md`). O modelo de hoje não
   tem onde pôr isso.

O Telemetry Engine (documento de ideias de 06/10, §3 e §12) precisa de um modelo único, estável e
independente de MyChron, GoPro e Alfano, antes que a conta-e-backup (feature 4) suba qualquer
coisa para a nuvem.

## Goals

- [ ] Toda sessão nova guarda o bruto inteiro (GPS e IMU, do início ao "Encerrar") em `TelemetryFrame`, e todo código de leitura e análise do app lê só desse modelo.
- [ ] Os números que o piloto já vê não mudam: tempos, setores, delta, pico e insights das sessões de referência saem idênticos antes e depois da troca.
- [ ] As sessões antigas continuam abrindo, com os mesmos tempos, depois da atualização do app.
- [ ] O modelo representa uma sessão de MyChron (canais multi-taxa, unidades do logger, pontos sem fix) sem nenhuma mudança de schema.
- [ ] A tela da sessão mostra a fonte e a qualidade do GPS.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Importar `.xrk` | É a feature 7 (`importar-xrk`). Aqui só entra o contrato que ela vai usar |
| Recorder nativo (Kotlin/Swift) e relógio monotônico do sistema | Fica para a v2 (Spike A). Nesta feature o relógio é o da sessão, montado em JS |
| GoPro, Alfano, EngineSense, microfone e magnetômetro | Fica para a v2 |
| Alinhar fontes diferentes no tempo (Spike E) | Ainda só existe uma fonte gravada (o celular) |
| Backup, sync e formato na nuvem | É a feature 4 (`conta-e-backup`) |
| Formato do ao vivo (`live_samples`) e `web-spectator` | É a feature 5 (`nuvem-segura`). O ao vivo continua publicando o mesmo payload, agora montado a partir de frames |
| Recalcular tempos de sessões antigas | Mantém a decisão da `tempos-honestos`: as antigas ficam com os tempos salvos |
| Confiança por canal, preferência de fonte e qualquer UI além do selo | Entra com a corner-intelligence e o coach com evidência (feature 6) |
| `src/lib/insights.ts` e `track_references` | Ninguém importa `insights.ts`. Os dois saem na `produto-limpo` |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Alcance da troca | Todo consumidor de `GpsSample`, `ImuSample`, `LocalSample` e `.samples`/`.imuSamples` é reescrito sobre `TelemetryFrame`. Os tipos antigos deixam de existir no código do app | Decidido pela Julia em 06/10 ("reescrever tudo em TelemetryFrame") | y |
| Bruto guardado | A sessão inteira, GPS e IMU, do primeiro ponto ao "Encerrar". Fica no aparelho até a sessão ser excluída, sem prazo automático | Decidido pela Julia em 06/10 | y |
| Sessões antigas | Convertidas na atualização do app: fonte `PHONE`, marca de legado e fix desconhecido. Os tempos salvos não mudam | Decidido pela Julia em 06/10 | y |
| Selo na sessão | Mostra a fonte e a qualidade do GPS: boa com mediana de precisão ≤ 5 m, média com ≤ 10 m, ruim acima de 10 m, "desconhecida" sem dado de precisão | Decidido pela Julia em 06/10 | y |
| Forma do modelo | Uma série por fonte e por canal, cada uma na própria taxa e sem reamostragem. Não existe um "quadro" de taxa fixa guardado | O `.xrk` tem quatro taxas no mesmo arquivo. Reamostrar perde o dado bruto, que é o que esta feature preserva | y |
| Relógio | Cada frame tem `t` em ms desde o início da sessão, estritamente crescente dentro de cada série. A sessão guarda o instante UTC do início. GPS e IMU do celular usam esse mesmo relógio | É o que dá para garantir em JS sem o recorder nativo. O tempo absoluto do GNSS continua guardado como dado da fix | y |
| Fonte | `PHONE`, `MYCHRON`, `ALFANO` ou `GOPRO`, gravada em cada série. Nesta feature só se grava `PHONE` | Lista do §3 do documento de ideias | y |
| Qualidade por frame de GPS | Precisão horizontal em m (ou ausente), estado do fix (`none`, `2d`, `3d` ou `unknown`) e duas marcas: `timeRepaired` (o tempo foi estimado porque o timestamp veio quantizado ou zerado) e `legacy` (veio da conversão) | São os casos que o código e o spike mostraram. O celular não informa fix 2D/3D, então a fix dele é `unknown` com precisão presente | y |
| Ponto sintético da AD-006 | Não é gravado no bruto. A volta guarda o cruzamento que a abre e o que a fecha (t, lat, lng, velocidade), e os pontos de fronteira são gerados na leitura pela mesma função de hoje | O bruto só tem o que um sensor entregou. A AD-006 continua valendo para quem lê a volta | y |
| Filtro de 30 m | Sai da captura: a fix ruim é gravada com a qualidade marcada. Os consumidores aplicam o mesmo corte de 30 m ao ler, o que mantém os números de hoje | O bruto precisa ser completo, e o corte é uma regra de análise | y |
| Unidades | Cada canal declara a unidade a partir de um catálogo fixo (SI, mais rpm e °C). A conversão acontece no adaptador da fonte, e o frame guarda o valor convertido | O spike mostrou unidades do logger (g, deg/s, km/h, mV). O consumidor não pode ter de saber de onde o valor veio | y |
| Traçados (`track_layouts`) | Guardam uma cópia própria dos frames do traçado, convertida na migração. Não dependem da sessão de origem | A sessão de origem pode ser excluída, e o traçado precisa continuar existindo | y |
| Migração em etapas | Uma transação por sessão e por traçado, com retomada; as colunas antigas saem só no fim | Uma transação única pode levar minutos para quem tem muito histórico e ser morta pelo sistema na abertura, repetindo para sempre. Ajuste de TF-20 aprovado pela Julia em 06/10, no Design | y |
| Gravação com menos de 30 pontos de GPS (inclusive nenhum) | É descartada, junto com todo o bruto, como hoje | A regra anterior (salvar só com IMU quando não há nenhuma fix) criava sessão vazia no histórico para quem aperta Iniciar e Encerrar sem sinal. Decidido pela Julia em 07/10, na execução | y |
| Lap com JSON ilegível na conversão | A volta continua listada com o tempo salvo e sem trajetória, e a sessão abre. A conversão registra quantas voltas pulou | Perder a sessão inteira por uma volta corrompida é pior que perder a trajetória dessa volta | y |
| Espaço | Uma sessão de 20 min com GPS a 10 Hz e IMU a 50 Hz ocupa no máximo 5 MB no aparelho | Em JSON, como hoje, daria cerca de 9 MB. O limite obriga a um formato compacto em blocos (§6 do documento), sem fixar qual | y |
| Tempo de leitura | Ler o bruto de uma sessão de 20 min e montar as voltas leva no máximo 200 ms **de CPU** no Node da suíte (mediana de 5, depois de 1 aquecimento) | Só o Node é mensurável na suíte. O `npm test` roda os arquivos em paralelo, e o relógio de parede da mesma leitura variou de 30 a 355 ms só por espera de CPU; o tempo de CPU mediu 59–115 ms. Ajuste da T22 (07/10), aprovado pela Julia em 08/10 | y |
| "Mesmos números" | Para as sessões de referência, cada valor derivado sai igual ao de antes da troca: inteiros e textos exatamente; grandezas de tempo (chaves `t`, `tMs`, `*Ms`, `*At`, `*_ms`) com diferença ≤ 0,001 ms; as demais grandezas reais com diferença ≤ max(1e-9, 1e-5 × |valor esperado|) | O `t` desde o início da sessão é mais preciso que o epoch em ms: perto de 1,8e12, o double só distingue cerca de 0,00024 ms. A diferença vem desse erro de arredondamento do formato antigo. Na T27, reais derivados do tempo (velocidade média dos setores das pontas, desaceleração da frenagem B) mudaram até 8,6e-7 relativo, e o mesmo código com tempo absoluto deu zero diferença. Tempo aprovado pela Julia em 06/10; parte relativa aprovada em 08/10 | y |

**Open questions:** none. Quatro decisões são da Julia, de 06/10. As demais são padrões meus, aprovados por ela com a spec no mesmo dia.

---

## User Stories

### P1: Bruto da sessão inteira, com fonte, relógio e qualidade ⭐ MVP

**User Story**: Como piloto, quero que o app guarde tudo o que os sensores mediram na sessão, para que análises melhores no futuro possam ser refeitas sobre as minhas sessões de hoje.

**Why P1**: Sem o bruto, cada melhora de algoritmo só vale para sessões novas, e a conta-e-backup não tem o que subir.

**Acceptance Criteria**:

1. WHEN uma gravação é iniciada THEN the recorder SHALL registrar na sessão o instante UTC do início e a fonte `PHONE`.
2. WHEN o GPS entrega uma fix durante a gravação THEN the recorder SHALL gravar um frame de GPS com `t` (ms desde o início da sessão), lat, lng, velocidade, rumo, altitude, precisão, estado do fix e o timestamp absoluto da fix.
3. WHEN o GPS entrega uma fix com precisão pior que 30 m THEN the recorder SHALL gravá-la, com a precisão real no frame.
4. WHEN o timestamp de uma fix é estimado (relógio quantizado, zero ou ausente) THEN the recorder SHALL marcar o frame com `timeRepaired`.
5. WHEN a IMU entrega uma leitura THEN the recorder SHALL gravar o frame de IMU no mesmo relógio de `t` dos frames de GPS da sessão.
6. The recorder SHALL gravar `t` estritamente crescente dentro de cada série.
7. WHEN o piloto toca "Encerrar" THEN the app SHALL manter todos os frames da sessão, do primeiro ao último, inclusive o trecho fora das voltas.
8. IF o app é encerrado à força durante a gravação THEN the recovery SHALL restaurar a sessão com o bruto até o último bloco gravado, como na `gravacao-sem-perda`.
9. WHEN o piloto exclui uma sessão THEN the app SHALL apagar todos os frames dela.
10. The recorder SHALL ocupar no máximo 5 MB por sessão de 20 min com GPS a 10 Hz e IMU a 50 Hz.

**Independent Test**: gravar uma sessão simulada com paddock, volta de saída, voltas e box, com fixes acima de 30 m e timestamps quantizados. Encerrar, reabrir o banco e conferir que todos os frames estão lá, com a qualidade e o relógio certos.

---

### P1: Voltas lidas do bruto, com os mesmos números ⭐ MVP

**User Story**: Como piloto, quero que meus tempos, setores e insights continuem exatamente iguais depois da troca, para confiar no que o app já me mostrou.

**Why P1**: As features 1 e 2 validaram esses números. A reescrita não pode mudá-los em silêncio.

**Acceptance Criteria**:

1. The app SHALL guardar cada volta como uma janela sobre o bruto da sessão: o cruzamento que a abre e o que a fecha (t, lat, lng, velocidade), mais a duração.
2. WHEN uma volta é lida THEN the app SHALL entregar os frames da janela com os pontos de fronteira gerados a partir dos cruzamentos guardados (AD-006).
3. WHEN um consumidor lê os frames de GPS para análise THEN the app SHALL aplicar o mesmo corte de precisão de 30 m que a captura aplicava antes desta feature.
4. The app SHALL NOT ler nem gravar `laps.samples_json` nem `laps.imu_samples_json`.
5. The app SHALL NOT conter os tipos `GpsSample`, `ImuSample` e `LocalSample`: todo consumidor recebe frames.
6. WHEN as sessões de referência passam pelo código novo THEN the app SHALL produzir para cada volta, sem diferença, o tempo, S1/S2/S3, a curva de delta, o pico de velocidade, os insights da volta (`lapInsight`), a detecção de trompo, a análise de curvas, o Pilot DNA e o contexto do coach. "Sem diferença" é a regra das Assumptions.
7. WHEN o ao vivo publica um ponto THEN the app SHALL enviar o mesmo payload de `live_samples` de antes, montado a partir dos frames.
8. The app SHALL ler o bruto de uma sessão de 20 min e montar as voltas em no máximo 200 ms no Node da suíte.

**Independent Test**: antes de mudar qualquer código, gravar a saída atual de cada consumidor para as sessões de referência. Depois da troca, rodar as mesmas sessões e comparar valor a valor.

---

### P1: Sessões e traçados antigos convertidos ⭐ MVP

**User Story**: Como piloto que já usa o app, quero abrir minhas sessões antigas depois da atualização e ver os mesmos tempos.

**Why P1**: Se a migração quebrar, o piloto perde o histórico, os PBs e os traçados.

**Acceptance Criteria**:

1. WHEN o app atualizado abre pela primeira vez THEN the migration SHALL converter cada volta salva em frames de GPS e de IMU com fonte `PHONE` e marca `legacy`.
2. WHEN uma volta convertida tinha pontos sintéticos (`synthetic: true`) THEN the migration SHALL guardá-los como os cruzamentos da volta, e não como frames.
3. WHEN duas voltas consecutivas convertidas têm um ponto com o mesmo instante THEN the migration SHALL gravar um único frame para ele.
4. The migration SHALL manter `started_at` e `duration_ms` de cada volta como estavam.
5. WHEN a migração termina THEN the app SHALL marcar o estado do fix dos frames convertidos como `unknown`, mantendo a precisão que existia.
6. WHEN o app atualizado abre pela primeira vez THEN the migration SHALL converter cada traçado de `track_layouts` em frames próprios do traçado, com a mesma linha de chegada que ele produzia antes.
7. IF a conversão de uma sessão ou de um traçado falha THEN the migration SHALL desfazer só a conversão dela, manter os dados antigos dela legíveis e retomar dela na próxima abertura.
8. The migration SHALL remover as colunas e tabelas antigas só depois que todas as sessões e todos os traçados estiverem convertidos.
9. IF o JSON de uma volta não pode ser lido THEN the migration SHALL manter a volta com o tempo salvo e sem trajetória, e seguir com as outras.
10. WHEN uma sessão convertida é aberta THEN the app SHALL mostrar os mesmos tempos de volta e o mesmo PB de antes da atualização.

**Independent Test**: montar um banco v4 com sessões das features 1 e 2 (com e sem pontos sintéticos, com e sem IMU, uma volta com JSON corrompido) e um traçado. Rodar a migração e conferir frames, tempos, PB e linha de chegada. Repetir com uma falha injetada na conversão da segunda sessão: a primeira fica convertida, a segunda continua legível no formato antigo, as colunas antigas continuam lá, e a próxima execução termina o trabalho.

---

### P1: Contrato multi-fonte ⭐ MVP

**User Story**: Como desenvolvedora da importação de `.xrk`, quero que o modelo já aceite uma sessão de logger, para que a feature 7 seja só um adaptador.

**Why P1**: É a razão de existir do modelo. Um formato que só cabe o celular repete o problema.

**Acceptance Criteria**:

1. The model SHALL aceitar, na mesma sessão, séries de canais com taxas diferentes (por exemplo, 1, 20, 25 e 50 Hz), cada uma com seus próprios `t`.
2. The model SHALL aceitar canais além de GPS e IMU (rpm, temperatura, pedal, freio, direção), cada um com nome, unidade do catálogo e fonte.
3. IF um adaptador entrega um valor numa unidade fora do catálogo THEN the model SHALL recusar a série com um erro que nomeia o canal e a unidade.
4. WHEN um adaptador entrega um ponto de GPS sem fix THEN the model SHALL guardá-lo com o estado de fix `none`.
5. The model SHALL guardar e devolver uma sessão sintética de fonte `MYCHRON` (quatro taxas, rpm, temperatura e GPS com um trecho sem fix) com todos os valores e instantes iguais aos de entrada.

**Independent Test**: um teste de contrato monta a sessão sintética de MyChron, grava, lê de volta e compara série a série.

---

### P2: Selo de fonte e qualidade na sessão

**User Story**: Como piloto, quero ver de onde vieram os dados da sessão e quão bom estava o GPS, para saber quanto confiar na análise.

**Why P2**: Ajuda a ler a sessão, mas não muda nenhum número.

**Acceptance Criteria**:

1. WHEN a tela da sessão abre THEN the screen SHALL mostrar a fonte da sessão: "Celular" para `PHONE` e "MyChron" para `MYCHRON`.
2. WHEN a tela da sessão abre THEN the screen SHALL mostrar a qualidade do GPS calculada sobre a mediana da precisão dos frames de GPS dentro das voltas, sem contar os pontos de fronteira: "boa" (≤ 5 m), "média" (≤ 10 m) ou "ruim" (> 10 m).
3. IF nenhum frame de GPS dentro das voltas tem precisão THEN the screen SHALL mostrar a qualidade "desconhecida".
4. IF a sessão não tem nenhuma volta THEN the screen SHALL calcular a qualidade sobre todos os frames de GPS da sessão.

**Independent Test**: abrir a tela da sessão com quatro sessões de teste (precisão mediana de 3 m, 8 m e 15 m, e uma sem precisão) e conferir o selo de cada uma.

---

## Edge Cases

- IF a gravação termina com menos de 30 pontos de GPS, inclusive nenhum, THEN the app SHALL descartar a gravação e todo o bruto dela, como faz hoje com menos de 30 pontos. (Decidido pela Julia em 07/10: uma gravação sem GPS não vira sessão vazia no histórico.)
- IF o par accel+gyro chega incompleto (só um dos dois) THEN the recorder SHALL gravar o frame de IMU com o canal que chegou e o outro ausente.
- WHEN o relógio do aparelho volta no tempo durante a sessão (ajuste de hora ou fuso) THEN the recorder SHALL manter `t` estritamente crescente.
- IF a sessão demo (`demoSession.ts`) é criada THEN the app SHALL gravá-la em frames, com o mesmo resultado que os consumidores mostram hoje.
- WHEN uma sessão recuperada (crash) é convertida em sessão salva THEN the app SHALL manter os frames do diário como o bruto dela, sem copiar.

---

## Requirement Traceability

| Requirement ID | Story | Tasks | Status |
| -------------- | ----- | ----- | ------ |
| TF-01 | P1: Bruto — início com UTC e fonte (AC 1) | T16 | In Tasks |
| TF-02 | P1: Bruto — frame de GPS completo (AC 2) | T14 | In Tasks |
| TF-03 | P1: Bruto — fix > 30 m gravada (AC 3) | T14 | In Tasks |
| TF-04 | P1: Bruto — `timeRepaired` (AC 4) | T14 | In Tasks |
| TF-05 | P1: Bruto — IMU no relógio do GPS (AC 5) | T13, T15, T19 | In Tasks |
| TF-06 | P1: Bruto — `t` estritamente crescente (AC 6, edge do relógio) | T13, T14, T19 | In Tasks |
| TF-07 | P1: Bruto — sessão inteira mantida (AC 7) | T16, T19, T20, T40 | In Tasks |
| TF-08 | P1: Bruto — recuperação após crash (AC 8, edge da recuperada) | T21 | In Tasks |
| TF-09 | P1: Bruto — exclusão apaga frames (AC 9) | T16, T24, T40 | In Tasks |
| TF-10 | P1: Bruto — ≤ 5 MB por 20 min (AC 10) | T8 | In Tasks |
| TF-11 | P1: Voltas — janela com cruzamentos (AC 1, 2) | T17, T20, T22 | In Tasks |
| TF-12 | P1: Voltas — corte de 30 m na leitura (AC 3) | T17, T19 | In Tasks |
| TF-13 | P1: Voltas — sem `samples_json` e sem tipos antigos (AC 4, 5) | T27–T41, T44, T46 | In Tasks |
| TF-14 | P1: Voltas — mesmos números nas sessões de referência (AC 6, edge da demo) | T1–T6, T27–T33, T45 | In Tasks |
| TF-15 | P1: Voltas — payload do ao vivo inalterado (AC 7) | T18 | In Tasks |
| TF-16 | P1: Voltas — leitura ≤ 200 ms (AC 8) | T22, T34, T39 | In Tasks |
| TF-17 | P1: Antigas — conversão de voltas, sintéticos e duplicatas (AC 1, 2, 3, 5) | T42, T43 | In Tasks |
| TF-18 | P1: Antigas — tempos, PB e `started_at` intactos (AC 4, 10) | T43, T44, T45 | In Tasks |
| TF-19 | P1: Antigas — traçados convertidos com a mesma linha (AC 6) | T23, T43 | In Tasks |
| TF-20 | P1: Antigas — migração em etapas com retomada, colunas antigas só saem no fim, JSON ilegível não derruba a sessão (AC 7, 8, 9) | T43, T44 | In Tasks |
| TF-21 | P1: Contrato — multi-taxa, canais extras e unidades (AC 1, 2, 3) | T7, T11 | In Tasks |
| TF-22 | P1: Contrato — GPS sem fix e ida e volta de MyChron sintético (AC 4, 5) | T8, T11 | In Tasks |
| TF-23 | P2: Selo — fonte (AC 1) | T26, T36 | In Tasks |
| TF-24 | P2: Selo — faixas de qualidade (AC 2, 3, 4) | T26, T36 | In Tasks |
| TF-25 | Edge — sessão sem GPS e IMU incompleta | T20, T25 | In Tasks |

**Coverage:** 25 total, 25 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] Uma sessão gravada depois da feature tem 100% dos frames que os sensores entregaram, do início ao "Encerrar", conferido pela contagem do diário.
- [ ] As sessões de referência dão zero diferença em todos os valores derivados antes e depois da reescrita.
- [ ] Um banco v4 real (cópia de um aparelho de teste) migra sem perder nenhuma sessão, volta, PB ou traçado.
- [ ] Nenhuma referência a `GpsSample`, `ImuSample`, `LocalSample`, `samples_json` ou `imu_samples_json` no código do app (`src/` e `app/`), fora da migração.
- [ ] A suíte `npm test` passa com os 149 testes atuais. Os valores que eles conferem não mudam: mudam só os tipos dos dados de entrada.
