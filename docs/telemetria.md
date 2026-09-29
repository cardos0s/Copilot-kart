# Telemetria do CockPit — como os números são calculados

Levantamento do que acontece entre o GPS do celular e o número na tela.
Escrito a partir do código, não do que a interface promete. Cada seção
aponta o arquivo onde a regra vive, para o documento não descolar da
implementação.

---

## O caminho de uma volta

```
GPS (10 Hz)  ─┐
IMU (50 Hz)  ─┤→ buffer global ─→ poll 500 ms ─→ detecção de voltas
              │                                        │
              │                                        ▼
              │                              volta mais rápida = referência
              │                                        │
              └────────────────────────────────→ map matching (s, t)
                                                       │
                            ┌──────────────┬───────────┼───────────┐
                            ▼              ▼           ▼           ▼
                         setores        curvas     delta vivo   agregados
```

Tudo depois do map matching é derivado de uma única ideia: transformar a
trajetória 2D numa função **tempo em função da distância percorrida**,
`t = f(s)`. Com as duas voltas nessa forma, comparar vira subtração.

---

## 1. Aquisição

`src/hooks/useLapRecorder.ts`, `src/recording/locationTask.ts` e
`src/recording/locationHandler.ts`

**GPS.** `Location.Accuracy.BestForNavigation`, `timeInterval: 100` ms e
`distanceInterval: 0`. Pedimos ~10 Hz e nenhuma filtragem por distância,
porque kart parado no grid ainda precisa aparecer. Os 10 Hz só valem no
Android: no iOS o `timeInterval` é ignorado e o CoreLocation decide a taxa.
Roda como *background task*, então a tela pode apagar sem perder a volta.

**Descarte na entrada.** Toda fix com `accuracy > 30 m` é jogada fora antes
mesmo de entrar no buffer (`MAX_ACCURACY_M`, em `locationHandler.ts`). Não é
filtro de análise, é filtro de porta: uma fix de 100 m de erro não tem uso
nenhum.

**Timestamp.** Algumas builds Expo/Android entregam `loc.timestamp` sem parte
de sub-segundo (ou zerado). O handler guarda um relógio por gravação,
`clock: { trustsRaw, lastT }`, zerado a cada gravação:

- o primeiro fix com sub-segundo liga `trustsRaw`, que vale até o fim da
  gravação. Daí em diante o timestamp do GPS é usado mesmo quando cai
  exatamente num segundo cheio (`.000`);
- sem `trustsRaw`, o app **fabrica** o tempo: `agora − (n−1−i) × 100 ms`,
  espalhando o lote retroativamente a 10 Hz;
- todo `t` entregue é `max(t, lastT + 1)`: estritamente crescente dentro da
  gravação.

> Consequência: em aparelho que só entrega timestamp quantizado, o *instante*
> de cada ponto é uma estimativa. A posição e a velocidade continuam corretas.

**IMU.** Acelerômetro e giroscópio a **50 Hz** (`20 ms`). São ~2500 amostras
por volta de 50 s, contra ~500 do GPS. A IMU não entra em nenhum tempo
mostrado.

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

### A volta começa e termina na linha

`sliceLaps` (`src/recording/finishSession.ts`) monta cada volta como
`[cruzamento de abertura, pontos crus entre os dois cruzamentos, cruzamento
de fechamento]`. Os dois pontos das pontas são **sintéticos**
(`synthetic: true`), ficam exatamente na linha e têm o instante interpolado.
`durationMs = round(último.t − primeiro.t)`, e o fim da volta N é o mesmo
ponto que o início da volta N+1. A IMU é recortada pela mesma janela de
tempo.

Toda régua de tempo (volta, setores, delta) deriva desses pontos (AD-006).
Quem contar pontos ou exportar a trajetória precisa saber que há dois pontos
por volta que o GPS não entregou. As voltas gravadas antes disso não têm os
pontos de fronteira e não foram recalculadas.

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
os pontos como foram salvos, que são os mesmos que o ao vivo mediu.

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

1. **Porta de entrada** — `accuracy > 30 m` nem vira sample.
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
  foram salvos: as voltas delas não têm os pontos de fronteira e não foram
  recalculadas.

---

## 12. Constantes num lugar só

| Constante | Valor | Arquivo |
|---|---|---|
| taxa GPS pedida | 100 ms (10 Hz, só no Android) | `src/hooks/useLapRecorder.ts` |
| descarte na entrada | accuracy > 30 m | `src/recording/locationHandler.ts` |
| espalhamento do timestamp fabricado | 100 ms | `src/recording/locationHandler.ts` |
| taxa IMU | 20 ms (50 Hz) | `src/hooks/useLapRecorder.ts` |
| drenagem do buffer | 500 ms | `src/hooks/useLapRecorder.ts` |
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
