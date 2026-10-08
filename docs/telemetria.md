# Telemetria do CockPit — como os números são calculados

Levantamento do que acontece entre o GPS do celular e o número na tela.
Escrito a partir do código, não do que a interface promete. Cada seção
aponta o arquivo onde a regra vive, para o documento não descolar da
implementação.

---

## O caminho de uma volta

```
GPS (10 Hz)  ─┐                        ┌─→ diário: blocos de 5 s nas séries da sessão (o bruto)
IMU (50 Hz)  ─┤→ frames (relógio da ──┤
              │   sessão) → buffer     └─→ poll 500 ms ─→ detecção de voltas (frames ≤ 30 m)
              │                                                │
              │                                                ▼
              │                              volta = janela sobre o bruto (cruzamentos)
              │                                                │
              │                                     volta mais rápida = referência
              │                                                │
              └────────────────────────────────────→ map matching (s, t)
                                                               │
                                    ┌──────────────┬───────────┼───────────┐
                                    ▼              ▼           ▼           ▼
                                 setores        curvas     delta vivo   agregados
```

Tudo depois do map matching é derivado de uma única ideia: transformar a
trajetória 2D numa função **tempo em função da distância percorrida**,
`t = f(s)`. Com as duas voltas nessa forma, comparar vira subtração.

---

## O dado guardado: frames, séries e blocos

`src/telemetry/` (AD-007). Todo dado de telemetria do app entra e sai por este
modelo. Não existe outro formato: nenhum código grava amostra em JSON.

**Três formas do mesmo dado.**

| Forma | Onde | Para quê |
|---|---|---|
| **frame** (`TelemetryFrame`) | `frame.ts` | o que um consumidor lê: um ponto de GPS (`GpsFrame`), uma leitura da IMU (`ImuFrame`) ou o valor de um canal (`ChannelFrame`) |
| **série** colunar | `frame.ts`, `series.ts` | o bruto em memória: uma série por fonte e por canal, cada uma na própria taxa, sem reamostragem, com `NaN` onde o valor falta |
| **bloco** binário | `blockCodec.ts`, `telemetryStore.ts` | o bruto no banco: um pedaço da série, em colunas Float64 e `u8` |

**O relógio.** Cada frame tem `t` em **ms desde o início da série**
(`t0Utc`, o instante UTC em que a gravação começou). O `t` é estritamente
crescente dentro de cada série, e GPS e IMU do celular usam o mesmo relógio
(`src/recording/sessionClock.ts`). O instante absoluto da fix, como o sistema
entregou, fica no frame (`gnssTime`).

**A qualidade.** Cada série guarda a fonte (`PHONE`, `MYCHRON`, `ALFANO`,
`GOPRO`). Cada frame de GPS guarda a precisão horizontal em metros (ausente
quando o aparelho não informou), o estado do fix (`none`, `2d`, `3d` ou
`unknown`; o celular não informa e fica `unknown`) e duas marcas: `timeRepaired`
(o instante foi estimado, §1) e `legacy` (veio da conversão do histórico).

**As unidades.** Catálogo fechado (`Unit`): SI, mais rpm e °C, e `deg` e `%`.
O acelerômetro é guardado em **m/s²** e o giroscópio em **rad/s**. Uma unidade
fora do catálogo é recusada com `UnitError`, que nomeia o canal: quem converte
é o adaptador da fonte, e o frame guarda o valor convertido.

**Séries e blocos no banco.** `telemetry_series` tem uma linha por série, com o
dono (`session:<id>`, `layout:<id>` ou `reference:<track_id>`), a fonte, o tipo,
o `t0Utc` e a marca de legado. `telemetry_blocks` tem os blocos de cada série,
cada um com a faixa `[t_first, t_last]` dos seus instantes, para a leitura de
uma janela só decodificar os blocos que a cruzam. O codec (versão 1) grava as
colunas Float64 presentes e as `u8`; uma coluna toda `NaN` não ocupa byte, e a
ida e volta é bit a bit. 20 min de GPS a 10 Hz e IMU a 50 Hz somam ~4,3 MB, no
limite de 5 MB por sessão. Um bloco ilegível é pulado na leitura e contado.

**O bruto é a sessão inteira.** Do primeiro ponto ao "Encerrar", inclusive
paddock, volta de saída e box, com as fixes ruins. Ele fica no aparelho até a
sessão ser excluída, e a exclusão apaga voltas, séries e blocos numa transação.

**A regra de leitura.** O bruto guarda tudo; a análise lê só o que passa no
corte. `analysisGps` (`src/telemetry/laps.ts`) devolve os frames com precisão
**definida e ≤ 30 m**, o mesmo corte que a captura fazia antes de existir o
bruto, e é sobre eles que as voltas são detectadas e analisadas. A volta é uma
janela sobre o bruto (§2), e os pontos de fronteira dela são **gerados na
leitura** a partir dos cruzamentos guardados, nunca gravados (AD-006 continua
valendo para quem lê a volta).

---

## 1. Aquisição

`src/hooks/useLapRecorder.ts`, `src/recording/locationTask.ts` e
`src/recording/locationHandler.ts`

**GPS.** `Location.Accuracy.BestForNavigation`, `timeInterval: 100` ms e
`distanceInterval: 0`. Pedimos ~10 Hz e nenhuma filtragem por distância,
porque kart parado no grid ainda precisa aparecer. Os 10 Hz só valem no
Android: no iOS o `timeInterval` é ignorado e o CoreLocation decide a taxa.
Roda como *background task*, então a tela pode apagar sem perder a volta.

**Nenhuma fix é descartada.** Cada fix vira um `GpsFrame`, com a precisão que
o aparelho informou, inclusive acima de 30 m, ou sem precisão quando ela não
veio. O corte de 30 m é da leitura (`analysisGps`), não da captura: o bruto
precisa ser completo para uma análise melhor no futuro ser refeita sobre ele.

**Timestamp.** Algumas builds Expo/Android entregam `loc.timestamp` sem parte
de sub-segundo (ou zerado). O handler guarda um relógio por gravação,
`clock: { trustsRaw, session }`, zerado a cada gravação (`session` é o relógio
da sessão, que começa no `t0Utc`):

- o primeiro fix com sub-segundo liga `trustsRaw`, que vale até o fim da
  gravação. Daí em diante o timestamp do GPS é usado mesmo quando cai
  exatamente num segundo cheio (`.000`);
- sem `trustsRaw`, o app **fabrica** o tempo: `agora − (n−1−i) × 100 ms`,
  espalhando o lote retroativamente a 10 Hz;
- todo `t` entregue é `max(t, último t + 1)`: estritamente crescente dentro
  da série (`sessionClock.gpsT`);
- o frame guarda `t` = instante resolvido − `t0Utc`, o instante como o sistema
  entregou (`gnssTime`) e, quando o instante foi fabricado, a marca
  `timeRepaired`.

> Consequência: em aparelho que só entrega timestamp quantizado, o *instante*
> de cada ponto é uma estimativa, e o frame diz isso. A posição e a velocidade
> continuam corretas.

**IMU.** Acelerômetro e giroscópio a **50 Hz** (`20 ms`), pareados em
`src/recording/imuCapture.ts`. São ~2500 frames por volta de 50 s, contra ~500
do GPS. A IMU não entra em nenhum tempo mostrado.

- O `t` vem do `timestamp` do sensor, ancorado no relógio da sessão no primeiro
  evento (`sessionClock.imuT`): o espaçamento é o do sensor, e não o do relógio
  do aparelho.
- O frame sai quando as duas leituras chegaram, com o `t` da mais recente. Se o
  mesmo sensor chega duas vezes antes de o par fechar, a leitura anterior sai
  sozinha, num frame com o outro sensor ausente.
- O expo-sensors entrega o acelerômetro **em g**. A captura multiplica por
  `G = 9,80665` e o frame guarda **m/s²**. O giroscópio já vem em rad/s. Os
  eixos são os do celular: x para a direita, y para cima em retrato, z saindo da
  tela; o yaw da cabine é o giroscópio z.

**Diário.** Os frames novos vão para o diário (`src/recording/journal.ts`), que
a cada **5 s** grava um bloco por série (GPS e IMU) nas séries da sessão
(`session:session_<gravação>`), numa transação. O que o diário grava já é o
bruto da sessão: o "Encerrar" não copia nada, só grava as voltas como janelas.
Se o app morre, a recuperação lê as séries até o último bloco gravado. Uma
escrita que falha devolve o pendente à fila e acende o aviso do HUD. Gravação
com menos de 30 pontos de análise, inclusive sem nenhuma fix, é descartada com
todo o bruto.

**Drenagem.** Um `setInterval` de **500 ms** esvazia o buffer global para o
estado do React e roda a detecção de voltas de novo, inteira. É o que faz o
contador de voltas subir durante a sessão.

---

## 2. Detecção de voltas

`src/lib/lapDetector.ts` e `src/lib/startLine.ts`. Função pura: a mesma
entrada sempre dá a mesma saída. O ao vivo (hook), o "Encerrar" e a
recuperação de gravação interrompida chamam a mesma função com a **mesma
linha**, então não existe divergência entre o que você viu na pista e o que
ficou gravado.

### Fase 1 — "entrou em ritmo"

Procura o primeiro sample com velocidade `≥ 5 m/s` (18 km/h) que se
**sustente** por 3 samples consecutivos acima de `3 m/s` (11 km/h).

O limiar duplo é proposital: GPS parado oscila e cospe 6 m/s por um
instante. Exigir confirmação sustentada separa ruído de arrancada. O índice
retornado é o **primeiro** sample do período, não o último.

### Fase 2 — a linha

A linha de chegada é um **ponto, um rumo e um segmento** perpendicular a esse
rumo, com **15 m** para cada lado do ponto.

- **Com traçado gravado**, a linha é o primeiro ponto do traçado, com o rumo
  até o primeiro ponto do traçado a 5 m ou mais (`lineFromLayout`). É a mesma
  linha em todas as sessões daquele traçado. O traçado com menos de 5 pontos
  ou sem comprimento conta como sem traçado.
- **Sem traçado**, a linha é inferida no ponto onde o ritmo começou, com o
  rumo do movimento a partir dele (`lineFromMotion`). Na prática é a saída do
  box.

A linha da gravação vai para a meta do diário (`RecordingMeta.line`). Um
diário antigo, sem ela, recupera com a linha inferida.

### Fase 3 — fechar a volta

A volta fecha no instante em que a trajetória **atravessa o segmento da
linha no sentido dela** (`crossing`). No referencial da linha, `u` é a
distância ao longo do rumo e `v` a lateral. Há cruzamento quando:

| Condição | Valor | Por quê |
|---|---|---|
| sentido | `u_a < 0 ≤ u_b` | o piloto na contramão (box, trecho paralelo) não fecha volta |
| largura | `|v| ≤ 15 m` no ponto de corte | passar ao lado da linha não é cruzar |
| buraco | `t_b − t_a ≤ 2 s` | sem ponto de um dos lados, o instante seria chute |

E o cruzamento só fecha volta se, desde o cruzamento anterior:

| Condição | Valor | Por quê |
|---|---|---|
| distância percorrida | `≥ 300 m` | quem sai 16 m e volta não deu volta |
| tempo decorrido | `≥ 25 s` | descarta fechamento espúrio |
| trava de saída | afastou-se mais de **30 m** (2 × 15 m) do ponto da linha | kart parado na linha, com jitter, não fecha volta |

Cruzamento que não fecha volta é ignorado e não reinicia a contagem. Volta
acima de **180 s** é descartada (pit-in, parada, sinal perdido), mas a
próxima conta a partir daquele cruzamento.

**A primeira volta.** Sem traçado, o ponto de ritmo é o primeiro cruzamento
(`f = 0`), e a 1ª volta segue a mesma regra das outras. Com traçado, o trecho
antes do primeiro cruzamento da linha não é volta: quem começa a gravar já
andando só tem a 1ª volta a partir da linha.

### O tempo da volta é interpolado

O instante do cruzamento sai da interpolação linear entre os dois pontos do
GPS que ficam um de cada lado da linha: `f = −u_a / (u_b − u_a)` e
`t = t_a + f · (t_b − t_a)`. Posição e velocidade no cruzamento saem do mesmo
`f`. Como o corte é geométrico, o instante não depende da taxa do GPS: em
pista sintética a 5 e a 10 Hz, o erro contra a duração real fica em até
20 ms, inclusive na 1ª volta.

### A volta é uma janela sobre o bruto

`sliceLapWindows` (`src/telemetry/laps.ts`) roda a detecção sobre os frames
de análise e guarda cada volta como **os dois cruzamentos** que a abrem e
fecham (`t`, lat, lng, velocidade e a precisão do ponto de fronteira, que é a
pior do par interpolado). A linha de `laps` guarda essa janela e a duração; os
frames ficam nas séries da sessão, sem cópia.

Na leitura, `lapFrames` monta a volta como `[fronteira de abertura, frames com
precisão ≤ 30 m e start.t < t < end.t, fronteira de fechamento]`. Os dois
pontos das pontas são **sintéticos** (`synthetic: true`), ficam exatamente na
linha e têm o instante interpolado. `durationMs = round(end.t − start.t)`, e o
fim da volta N é o mesmo cruzamento que o início da volta N+1. A IMU da volta
são os frames com `start.t ≤ t ≤ end.t`. `loadLaps` (`src/storage/lapRepo.ts`)
lê a janela de tempo que cobre todas as voltas da sessão e só decodifica a IMU
quando ela é pedida; listas e agregados usam `loadLapSummaries`, que não toca
no bruto.

Toda régua de tempo (volta, setores, delta) deriva desses pontos (AD-006).
Quem contar pontos ou exportar a trajetória precisa saber que há dois pontos
por volta que o GPS não entregou, gerados na leitura. As voltas gravadas antes
da AD-006 não têm os pontos de fronteira: viram uma janela **por índice**
(§ "O histórico de antes") e não foram recalculadas.

O ao vivo recorta as voltas dos frames em memória com `sliceLaps`
(`src/recording/finishSession.ts`), pela mesma detecção e com os mesmos pontos
de fronteira.

---

## 3. Referência e map matching

`src/lib/geometry.ts`, `src/lib/analysis.ts`

**A referência é a volta mais rápida** da sessão (ou o traçado gravado, se a
pista tiver um). Ela é convertida para coordenadas locais ENU — leste/norte
em metros a partir de uma origem — com precisão sub-métrica em raios de até
10 km. Cada ponto ganha sua distância acumulada `s`.

**Map matching**: cada sample da volta analisada é projetado sobre o
segmento mais próximo da referência, virando um par `(s, t)`. Para não
varrer a polilinha inteira a cada ponto, a busca usa uma janela de **±30
segmentos** ao redor de onde o ponto anterior caiu. Se o melhor casamento
nessa janela fica a mais de **20 m**, a busca é refeita na polilinha inteira
(o piloto rodou ou saiu da dica).

### Duas correções que o código carrega

**Ambiguidade da linha de chegada.** O ponto físico da linha aparece duas
vezes na polilinha: em `s ≈ 0` e em `s ≈ comprimento total`. Se o primeiro
sample cai na ponta final, a janela de ±30 nunca consegue voltar ao início e
a volta inteira fica presa no último terço da pista.

Detecção: primeiro sample em `s > 70%` **e** mais de metade dos samples lá.
Correção: refaz o primeiro ponto buscando só no **primeiro 35%** da
polilinha, aceita se a alternativa estiver a menos de **25 m**, e re-roda o
resto com a dica corrigida.

**Desenrolar o `s`.** Quando o recorte da volta pega um pedaço depois da
linha, o `s` volta a zero no meio da série. Como a interpolação exige `s`
monotônico, o código soma o comprimento total ao detectar a queda.

---

## 4. Setores

### S1, S2 e S3

`sectorSplits` em `src/lib/sectors.ts` é a **única** régua de S1/S2/S3. O
ao vivo, a publicação para a equipe e a análise da sessão chamam essa função
sobre os mesmos pontos da volta.

- S1, S2 e S3 são os **terços exatos do comprimento do traçado**, a partir da
  linha de chegada.
- O instante em que a volta passa por `L/3` e `2L/3` sai do map matching e da
  interpolação entre os dois pontos em volta de cada limite. Não é o instante
  do poll.
- Numa volta fechada, o fim é o ponto de fronteira na linha, e
  `S1 + S2 + S3 = durationMs` (± 1 ms de arredondamento).
- Numa volta em curso, o setor ainda não alcançado fica `null` ("—").

**Qual traçado.** Com traçado gravado, a régua é o traçado
(`referenceFromLayout`). Sem traçado, a análise usa a melhor volta da sessão
(`referenceFromLap`), e o ao vivo fica sem setores.

**No cockpit** (`useLapRecorder.ts`), a cada poll a volta em curso (do
cruzamento que a abriu até o ponto atual) passa pelo `sectorSplits`. Quando
a volta fecha, a volta recortada pelo `sliceLaps` passa pelo mesmo
`sectorSplits`, e é esse resultado que vai para a equipe.

**Na análise da sessão** (`app/session/[id].tsx`), cada volta é medida sobre
os frames da janela da volta, com as mesmas fronteiras que o ao vivo mediu.

### Os 20 mini-setores

`analyzeLap()` em `src/lib/analysis.ts` divide a pista em **20 mini-setores
de distância igual**. Eles são a régua interna do delta por trecho e da cor
do mapa; não são os S1/S2/S3 da tela.

Para cada mini-setor, o tempo sai de **interpolação linear** de `t(s)` nos
dois extremos, na volta atual e na referência. `delta = atual − referência`,
positivo significa perdeu tempo.

**Setor inválido** — e isso importa mais do que parece:

```
valid = curMs > 0 && refMs > 0 && curMs <= refMs * 5
```

Tempo zero significa que a interpolação não achou o piloto ali. Mais de 5×
a referência significa pit-in ou GPS perdido. (O comentário do tipo `Sector`
em `analysis.ts` ainda diz 3×; o código usa 5×.) Setor inválido entra com
`delta = 0` e é **excluído** da escolha de melhor e pior setor — senão um
buraco de dados venceria a estatística.

---

## 5. Curvas

`src/lib/corners.ts` (onde estão) e `src/lib/cornerAnalysis.ts` (o que
aconteceu nelas)

### Achar a curva

1. **Suaviza as posições** antes de qualquer conta. Jitter de ~1 m em
   samples espaçados 2–4 m vira zigue-zague que domina a curvatura — sem
   isso, reta vira curva. O raio é adaptativo: `max(3, espaçamento médio × 2)`,
   então pista gravada com menos Hz suaviza mais. É a única parte adaptativa.
2. **Heading por segmento** e **heading de corda (±4 m)**. A corda é a régua
   estável; o segmento isolado oscila alguns graus mesmo suavizado.
3. **Taxa de curvatura** em rad/m, com a intensidade medida numa janela fixa
   de **±6 m**.
4. **Limiar de 0,04 rad/m** (≈ 2,3°/m) marca o início da curva, e ela segue
   enquanto a intensidade fica acima de **metade** do limiar (histerese de
   0,5×). Comprimento mínimo de **8 m**.
5. A intensidade **com sinal** separa S e chicane: quando o sentido de
   rotação inverte, são duas curvas, não uma. Um trecho que varre menos de
   **30°** é absorvido pelo vizinho mais forte: oscilação de GPS não é curva.

### Medir a curva

Por curva, contra a referência:

- **Direção** — do ângulo varrido: positivo é direita.
- **Ângulo total** varrido, em graus.
- **Azimutes** de entrada, ápice e saída (bússola, 0 = norte).
- **Velocidade mínima** do piloto dentro da curva — é o "km/h no ápice" da
  interface.
- **Tempo dentro da curva**, dele e da referência, por interpolação de `t(s)`.
- **Delta** — a diferença. É o "+0.110" da lista.
- **Abertura de entrada** (`entryOpenDeg`): quanto o nariz dele apontava
  para fora em relação à referência. Sinal normalizado pelo lado da curva,
  então positivo sempre significa "entrou mais aberto", em curva de
  esquerda ou de direita.

Mesma regra de validade dos setores: tempo acima de 5× a referência
invalida a curva.

---

## 6. Velocidade

`src/lib/speed.ts`

**A velocidade não é calculada pelo app.** Ela vem do campo `coords.speed`
do GPS, que no iPhone é medida por efeito Doppler na portadora — mais
precisa que derivar posição por tempo.

**O pico é o percentil 99** (nearest-rank) da velocidade dos pontos com
precisão de até **10 m**:

```ts
const speeds = samples.filter((s) => s.accuracy <= 10).map((s) => s.speed).sort((a, b) => a - b);
return speeds.length ? speeds[Math.ceil(0.99 * speeds.length) - 1] : null;
```

Uma fix ruim isolada, em ~500 pontos por volta, não chega ao p99: numa volta
a ~80 km/h com um único ponto a 150 km/h, o pico fica abaixo de 81 km/h. Sem
nenhum ponto de até 10 m, o pico é `null` e a interface mostra "—".

O mesmo cálculo vale na tela de sessão (inclusive o marcador de pico no
mapa), na home, no prompt do coach (que recebe `null` quando não há dado) e
na escala de cor do "Sua volta". Fica de fora `peakSpeedInSectorMs`, que é
o máximo dentro de um trecho do mapa de setor.

---

## 7. IMU e trompos

`src/lib/spinDetector.ts`

Roda sobre o giroscópio, nos três eixos separadamente:

| Parâmetro | Valor |
|---|---|
| entra em trompo | `> 90°/s` |
| sai do trompo | `< 30°/s` |
| duração mínima | `400 ms` |
| gap que quebra continuidade | `200 ms` |

A histerese (90 para entrar, 30 para sair) evita fragmentar um trompo em
vários eventos. Abaixo de 400 ms é correção fina de volante, não rodada.

Sem IMU, há um detector de trompo pelo GPS no mesmo arquivo: numa janela de
**2 s**, a velocidade cai mais de **50%** e o rumo muda mais de **120°**.

---

## 8. Delta ao vivo

`src/lib/realtimeDelta.ts`

Durante a volta o tempo final não existe ainda, então o app responde outra
pergunta: *"neste ponto da pista, estou mais rápido que minha referência?"*

Pré-computa `t(s)` da referência uma vez e, a cada sample, faz o map
matching para achar o `s` atual e compara o tempo decorrido contra o tempo
que a referência levava para chegar ali. É o mesmo pipeline da análise.

**Início da volta.** A linha aparece nas duas pontas da polilinha (`s ≈ 0` e
`s ≈ L`). Quando uma volta nova começa, `resetLap()` põe a dica do map
matching no segmento 0, e o primeiro ponto da volta casa perto de `s = 0`,
nunca no fim do traçado.

**Quando o delta some.** O delta vira `null` (o HUD mostra só o cronômetro)
quando o ponto fica a mais de **40 m** do traçado ou quando o valor passa de
**±30 s**.

---

## 9. Agregados

**Insights** (`src/lib/lapInsight.ts`) — a pergunta muda de "esta volta" para
"o que se repete". Roda a análise de curvas de todas as voltas daquela pista
contra a melhor e tira a **média por curva**, com estas regras:

- **Ganho não abate perda.** Uma volta excepcional numa curva não desfaz o
  custo médio dela.
- **Só o mesmo traçado da mesma pista** (`lapsForInsight`). Misturar
  kartódromos ou traçados compararia curvas que não se comparam.
- **Média só com as voltas válidas.** Uma volta sem tempo válido numa curva
  não entra no denominador daquela curva.
- **Mesmas defesas da análise.** Cada volta passa por `cleanSamples(10)` e
  `repairDegenerateTimestamps()` antes de entrar.
- **Teto de 12 sessões / 60 voltas.** O casamento é O(n) por volta. As 12
  sessões ficam em `app/(tabs)/insights.tsx`; as 60 voltas, em
  `lapInsight.ts`.

**Pilot DNA** (`src/lib/pilotDna.ts`) — mesma máquina, recorte diferente:
classifica curvas por ângulo (grampo, média, rápida) e procura traços que se
repetem entre sessões.

---

## 10. Defesas contra dado ruim

O app tem estas camadas:

1. **Corte de leitura** — a análise só lê frames com precisão definida e
   ≤ 30 m (`analysisGps`). O bruto guarda todas as fixes, com a precisão que
   tinham.
2. **Relógio do GPS** — timestamp estritamente crescente, e o do GPS é usado
   quando o aparelho já mostrou sub-segundo (§1).
3. **`cleanSamples(10)`** — antes de analisar, descarta o que passa de 10 m.
   Usado na análise de sessão (curvas, mini-setores, mapa), comparação de
   voltas, mapa da pista, insights, DNA e contexto do coach. Os S1/S2/S3 da
   sessão são medidos sobre os pontos salvos, sem esse filtro, para bater com
   o ao vivo.
4. **`repairDegenerateTimestamps()`** — se o intervalo de tempo da volta é
   menor que metade da duração conhecida, reescreve os timestamps
   distribuídos uniformemente. Devolve `repaired: true`, e é isso que
   acende o aviso *"tempos por setor aproximados"* na tela de sessão.
5. **Validade por setor e por curva** — o `× 5` descrito acima.
6. **Pico p99** — uma fix ruim isolada não vira a velocidade máxima (§6).

> O reparo de timestamp **não recupera** onde o tempo foi perdido dentro da
> volta: essa informação morreu na gravação. Ele salva o delta total, o pico
> de velocidade e o desenho no mapa.

---

## 11. O que os números não dizem

Ser explícito aqui é o que separa telemetria de enfeite.

- **Não há sensor no kart.** Nada de RPM, temperatura, acelerador ou freio.
  Tudo é inferido de posição, velocidade e inércia do celular.
- **Sem traçado gravado, a linha de chegada é inferida** a cada sessão, no
  ponto onde o piloto entrou em ritmo. Duas sessões assim podem ter linhas
  alguns metros diferentes, e a comparação **entre sessões** carrega esse
  deslocamento. Com traçado, a linha é a do traçado (§2).
- **Setor é distância, não tempo.** Um setor de 40 m numa reta e outro de
  40 m num grampo não são comparáveis em dificuldade.
- **A altimetria é ignorada.** Todo o cálculo é 2D; subida e descida não
  entram em lugar nenhum.
- **A largura da pista não existe** no modelo. Traçado é uma linha, então
  "abriu demais na entrada" é medido por ângulo, nunca por metros de
  distância da zebra.
- **As sessões gravadas antes das regras novas** ficam com os tempos que
  foram salvos: a migração v5 converte o formato, não recalcula. As voltas
  anteriores à AD-006 continuam sem os pontos de fronteira.
- **GPS e IMU estão no mesmo relógio, mas por caminhos diferentes.** O GPS
  confiável usa o instante da fix; a IMU usa o relógio do aparelho, ancorado no
  primeiro evento. A diferença é o erro do relógio do aparelho, em geral abaixo
  de 100 ms com NTP. O `gnssTime` fica guardado para corrigir isso depois.

---

## O histórico de antes: a migração v5

`src/storage/migrations.ts` e `src/telemetry/legacy.ts`. Até a v4, cada volta
guardava os pontos em JSON (`laps.samples_json`, `laps.imu_samples_json`), assim
como os traçados (`track_layouts.samples_json`), as referências
(`track_references.samples_json`) e o diário (`recording_chunks`). A v5 converte
tudo para séries e janelas, em três etapas, na abertura do app (`db()`):

1. **v5a** — numa transação, cria `telemetry_series`, `telemetry_blocks`, as
   colunas de janela em `laps` e `track_layouts` e `sessions.frames_version`.
2. **v5b** — uma transação exclusiva **por item**: cada sessão, cada traçado,
   cada referência e cada diário pendente. Uma falha desfaz só aquele item, que
   continua legível no formato antigo e é tentado de novo na próxima abertura;
   os outros seguem. Convertido é: sessão com `frames_version = 5`, traçado com
   janela, referência com série (criada mesmo vazia), diário sem pedaços.
3. **v5c** — só quando nada sobrou sem conversão, numa transação, remove as
   colunas de JSON e a tabela `recording_chunks` e grava `user_version = 5`.
   Enquanto algo sobra, nada sai, e a linha nova de `laps` e `track_layouts`
   leva um `'[]'` na coluna antiga (NOT NULL) para a gravação continuar
   funcionando.

**As regras da conversão** (`legacy.ts`, puro):

- as voltas da sessão viram **uma série só**, em ordem de `started_at`, com
  `t0Utc` = o menor `t` da sessão;
- os pontos sintéticos das pontas viram os cruzamentos da janela, e não frames;
- a volta sem ponto sintético (anterior à AD-006) vira uma **janela por
  índice**, que devolve os frames `from..to` como estão: os timestamps antigos
  podem ser todos iguais, e uma janela por tempo seria ambígua;
- a 1ª amostra de uma volta idêntica (`t`, `lat` e `lng`) à última da volta
  anterior vira um frame só; com qualquer diferença, as duas ficam;
- todo frame convertido tem a fonte `PHONE`, a marca `legacy` e o fix
  `unknown`, com a precisão que existia;
- o acelerômetro antigo estava **em g** (o tipo antigo dizia m/s², mas era o
  valor do sensor) e é convertido para m/s²;
- o JSON ilegível não derruba a sessão: a volta fica com a janela `none`,
  mantém tempo e `started_at` e aparece sem trajetória; a contagem vai para o
  aviso da migração;
- o traçado segue a mesma regra sobre uma volta, com o `t` como foi gravado
  (série sem `t0Utc`); a referência guarda os pontos na ordem, sem os
  sintéticos;
- o diário v4 pendente vira as séries da gravação, no relógio do início dela, e
  a recuperação o lê como lê um diário novo.

Tempos de volta, `started_at`, PB e a linha de chegada dos traçados ficam os de
antes, e a comparação de referência (`test/golden.test.ts`) roda também pelo
JSON antigo, pela migração inteira, e bate com os mesmos números.

---

## 12. Constantes num lugar só

| Constante | Valor | Arquivo |
|---|---|---|
| taxa GPS pedida | 100 ms (10 Hz, só no Android) | `src/hooks/useLapRecorder.ts` |
| corte de análise (leitura) | accuracy ausente ou > 30 m | `src/telemetry/laps.ts` (`ANALYSIS_MAX_ACCURACY_M`) |
| espalhamento do timestamp fabricado | 100 ms | `src/recording/locationHandler.ts` |
| taxa IMU | 20 ms (50 Hz) | `src/hooks/useLapRecorder.ts` |
| drenagem do buffer | 500 ms | `src/hooks/useLapRecorder.ts` |
| escrita do diário (um bloco por série) | 5 s | `src/recording/journal.ts` |
| acelerômetro de g para m/s² | × 9,80665 | `src/telemetry/frame.ts` (`G`) |
| espaço máximo por sessão de 20 min | 5 MB | `src/telemetry/blockCodec.ts` |
| gravação descartada | menos de 30 pontos de análise | `src/recording/finishRecording.ts` |
| entra em ritmo | 5 m/s, sustentado 3 m/s × 3 | `src/lib/lapDetector.ts` |
| meia-largura da linha | 15 m | `src/lib/lapDetector.ts` |
| trava de saída da linha | 30 m (2 × 15 m) | `src/lib/lapDetector.ts` |
| distância mínima de volta | 300 m | `src/lib/lapDetector.ts` |
| duração mínima / máxima | 25 s / 180 s | `src/lib/lapDetector.ts` |
| corda do rumo da linha | 5 m | `src/lib/startLine.ts` |
| buraco máximo no cruzamento | 2 s | `src/lib/startLine.ts` |
| setores S1/S2/S3 | terços do comprimento do traçado | `src/lib/sectors.ts` |
| janela do map matching | ±30 segmentos | `src/lib/geometry.ts` |
| busca global do map matching | > 20 m | `src/lib/geometry.ts` |
| tolerância da correção de linha | 25 m | `src/lib/analysis.ts` |
| mini-setores | 20 | `src/lib/analysis.ts` |
| setor/curva inválidos | > 5× a referência | `src/lib/analysis.ts`, `src/lib/cornerAnalysis.ts` |
| limpeza pré-análise | accuracy > 10 m | `src/lib/analysis.ts` (`cleanSamples`) |
| pico de velocidade | p99, pontos de até 10 m | `src/lib/speed.ts` |
| delta ao vivo some | > 40 m do traçado ou \|delta\| > 30 s | `src/lib/realtimeDelta.ts` |
| limiar de curva | 0,04 rad/m (≈ 2,3°/m), histerese 0,5× | `src/lib/corners.ts` |
| comprimento mínimo de curva | 8 m | `src/lib/corners.ts` |
| varrido mínimo de curva | 30° | `src/lib/corners.ts` |
| janela de intensidade | ±6 m (fixa) | `src/lib/corners.ts` |
| suavização de posição | max(3 m, espaçamento × 2) | `src/lib/corners.ts` |
| corda do azimute | ±4 m | `src/lib/corners.ts` |
| trompo: entra / sai | 90°/s / 30°/s | `src/lib/spinDetector.ts` |
| trompo: duração mínima | 400 ms | `src/lib/spinDetector.ts` |
| trompo pelo GPS | 2 s, queda > 50%, rumo > 120° | `src/lib/spinDetector.ts` |
| janela dos insights: sessões | 12 | `app/(tabs)/insights.tsx` |
| janela dos insights: voltas | 60 | `src/lib/lapInsight.ts` |

---

## 13. Inconsistências conhecidas

A que esta seção descrevia foi corrigida: o `buildLapInsight`
(`src/lib/lapInsight.ts`) agora aplica `cleanSamples(10)` e
`repairDegenerateTimestamps()` a cada volta, como a análise da sessão (§9).

Ainda analisam pontos sem `cleanSamples()`:

- o replay 3D (`app/replay/[id].tsx`);
- os S1/S2/S3 da sessão, de propósito (§4 e §10).

O `cleanSamples(10)` tira o ponto de fronteira de uma volta quando um dos
dois pontos em volta do cruzamento tem precisão pior que 10 m. Nesse caso, a
volta limpa deixa de começar ou terminar na linha.
