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

`src/hooks/useLapRecorder.ts`

**GPS.** `Location.Accuracy.BestForNavigation`, `timeInterval: 100` ms e
`distanceInterval: 0` — pedimos ~10 Hz e nenhuma filtragem por distância,
porque kart parado no grid ainda precisa aparecer. Roda como *background
task*, então a tela pode apagar sem perder a volta.

**Descarte na entrada.** Toda fix com `accuracy > 30 m` é jogada fora antes
mesmo de entrar no buffer. Não é filtro de análise, é filtro de porta: uma
fix de 100 m de erro não tem uso nenhum.

**Timestamp.** Aqui mora uma defesa que quase ninguém vê. Algumas builds
Expo/Android entregam `loc.timestamp` sem parte de sub-segundo (ou zerado).
Quando isso acontece, o app **fabrica** o tempo: `agora − (n−1−i) × 100 ms`,
espalhando o lote retroativamente a 10 Hz. Sem isso, um lote de cinco fixes
viraria cinco samples no mesmo milissegundo.

> Consequência: em aparelho com esse defeito, o *instante* de cada ponto é
> uma estimativa. A posição e a velocidade continuam corretas.

**IMU.** Acelerômetro e giroscópio a **50 Hz** (`20 ms`), pareados por
timestamp com os samples de GPS. São ~2500 amostras por volta de 50 s,
contra ~500 do GPS.

**Drenagem.** Um `setInterval` de **500 ms** esvazia o buffer global para o
estado do React e roda a detecção de voltas de novo, inteira. É o que faz o
contador de voltas subir durante a sessão.

---

## 2. Detecção de voltas

`src/lib/lapDetector.ts` — função pura, mesma entrada sempre dá a mesma
saída. É usada tanto ao vivo quanto na hora de salvar, então não existe
divergência entre o que você viu na pista e o que ficou gravado.

**Não existe linha de chegada cadastrada.** O app deduz.

### Fase 1 — "entrou em ritmo"

Procura o primeiro sample com velocidade `≥ 5 m/s` (18 km/h) que se
**sustente** por 3 samples consecutivos acima de `3 m/s` (11 km/h).

O limiar duplo é proposital: GPS parado oscila e cospe 6 m/s por um
instante. Exigir confirmação sustentada separa ruído de arrancada. O índice
retornado é o **primeiro** sample do período, não o último — a linha nasce
onde o ritmo começou, não onde foi confirmado.

### Fase 2 — a linha

O ponto onde o ritmo começou vira a linha de largada/chegada. Na prática é
a saída do box.

### Fase 3 — fechar a volta

A cada sample, fecha volta se **as quatro** condições valerem:

| Condição | Valor | Por quê |
|---|---|---|
| distância até a linha | `< 15 m` | raio de cruzamento |
| distância percorrida | `≥ 300 m` | quem sai 16 m e volta não deu volta |
| tempo decorrido | `≥ 25 s` | descarta fechamento espúrio |
| não acabou de cruzar | flag | evita contar o mesmo cruzamento várias vezes |

A trava do "acabou de cruzar" só libera quando o piloto se afasta mais de
**30 m** (dois raios) da linha.

Volta acima de **180 s** é descartada — pit-in, parada, sinal perdido — mas
o ponteiro é reposicionado, então a próxima volta conta a partir dali.

### O tempo da volta é interpolado

Esse detalhe vale ouro. A **10 Hz**, o instante do cruzamento cai em algum
lugar entre dois samples, e usar o mais próximo faria todo tempo de volta
"grudar" em múltiplos de ~100 ms (43.000, 43.600 e nunca 43.412).

O detector projeta a linha sobre os segmentos vizinhos ao cruzamento e
**interpola o instante exato**, com peso `f` dentro do segmento. É de onde
vem o milésimo dos tempos que você lê no app.

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
segmentos** ao redor de onde o ponto anterior caiu.

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

`analyzeLap()` em `src/lib/analysis.ts`

A pista é dividida em **20 mini-setores de distância igual** — não de tempo
igual, e não por curva.

Para cada setor, o tempo sai de **interpolação linear** de `t(s)` nos dois
extremos, na volta atual e na referência. `delta = atual − referência`,
positivo significa perdeu tempo.

**Setor inválido** — e isso importa mais do que parece:

```
valid = curMs > 0 && refMs > 0 && curMs <= refMs * 5
```

Tempo zero significa que a interpolação não achou o piloto ali. Mais de 5×
a referência significa pit-in ou GPS perdido. Setor inválido entra com
`delta = 0` e é **excluído** da escolha de melhor e pior setor — senão um
buraco de dados venceria a estatística.

**Os S1/S2/S3 que você vê na tela** são os 20 mini-setores agrupados em
terços. A divisão em 20 é a régua interna; a de 3 é a leitura.

---

## 5. Curvas

`src/lib/corners.ts` (onde estão) e `src/lib/cornerAnalysis.ts` (o que
aconteceu nelas)

### Achar a curva

1. **Suaviza as posições** antes de qualquer conta. Jitter de ~1 m em
   samples espaçados 2–4 m vira zigue-zague que domina a curvatura — sem
   isso, reta vira curva. O raio é adaptativo: `max(3, espaçamento médio × 2)`,
   então pista gravada com menos Hz suaviza mais.
2. **Heading por segmento** e **heading de corda (±4 m)**. A corda é a régua
   estável; o segmento isolado oscila alguns graus mesmo suavizado.
3. **Taxa de curvatura** em rad/m, suavizada numa janela de 6 m.
4. **Limiar de 0,04 rad/m** (≈ 2,3°/m) marca curva, com comprimento mínimo
   de **8 m**.
5. A intensidade **com sinal** separa S e chicane: quando o sentido de
   rotação inverte, são duas curvas, não uma.

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

**O pico é o máximo bruto**, sem filtro nem percentil:

```ts
for (const s of samples) if (s.speed > max) max = s.speed;
```

> Limitação real: uma única fix ruim que passou pelo filtro de 30 m infla o
> "velocidade máxima" da volta inteira. Usar percentil 99 em vez do máximo
> seria mais honesto, e é uma mudança de uma linha.

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

---

## 8. Delta ao vivo

`src/lib/realtimeDelta.ts`

Durante a volta o tempo final não existe ainda, então o app responde outra
pergunta: *"neste ponto da pista, estou mais rápido que minha referência?"*

Pré-computa `t(s)` da referência uma vez e, a cada sample, faz o map
matching para achar o `s` atual e compara o tempo decorrido contra o tempo
que a referência levava para chegar ali. É o mesmo pipeline da análise — o
que garante que o delta que você vê na pista e o que aparece depois falam
a mesma língua.

---

## 9. Agregados

**Insights** (`src/lib/lapInsight.ts`) — a pergunta muda de "esta volta" para
"o que se repete". Roda a análise de curvas de todas as voltas daquela pista
contra a melhor e tira a **média por curva**, com três regras:

- **Ganho não abate perda.** Uma volta excepcional numa curva não desfaz o
  custo médio dela.
- **Só a mesma pista.** Misturar kartódromos compararia curvas que não se
  comparam.
- **Teto de 12 sessões / 60 voltas.** O casamento é O(n) por volta.

**Pilot DNA** (`src/lib/pilotDna.ts`) — mesma máquina, recorte diferente:
classifica curvas por ângulo (grampo, média, rápida) e procura traços que se
repetem entre sessões.

---

## 10. Defesas contra dado ruim

O app tem quatro camadas, e vale saber que existem:

1. **Porta de entrada** — `accuracy > 30 m` nem vira sample.
2. **`cleanSamples(10)`** — antes de analisar, descarta o que passa de 10 m.
   Usado na análise de sessão, comparação de voltas, mapa, insights, DNA e
   contexto do coach.
3. **`repairDegenerateTimestamps()`** — se o intervalo de tempo da volta é
   menor que metade da duração conhecida, reescreve os timestamps
   distribuídos uniformemente. Devolve `repaired: true`, e é isso que
   acende o aviso *"tempos por setor aproximados"* na tela de sessão.
4. **Validade por setor e por curva** — o `× 5` descrito acima.

> O reparo de timestamp **não recupera** onde o tempo foi perdido dentro da
> volta: essa informação morreu na gravação. Ele salva o delta total, o pico
> de velocidade e o desenho no mapa.

---

## 11. O que os números não dizem

Ser explícito aqui é o que separa telemetria de enfeite.

- **Não há sensor no kart.** Nada de RPM, temperatura, acelerador ou freio.
  Tudo é inferido de posição, velocidade e inércia do celular.
- **A linha de chegada é inventada** a cada sessão, no ponto onde o piloto
  entrou em ritmo. Duas sessões na mesma pista podem ter linhas alguns
  metros diferentes — os tempos de volta continuam corretos entre si, mas a
  comparação **entre sessões** carrega esse deslocamento.
- **Setor é distância, não tempo.** Um setor de 40 m numa reta e outro de
  40 m num grampo não são comparáveis em dificuldade.
- **A altimetria é ignorada.** Todo o cálculo é 2D; subida e descida não
  entram em lugar nenhum.
- **A largura da pista não existe** no modelo. Traçado é uma linha, então
  "abriu demais na entrada" é medido por ângulo, nunca por metros de
  distância da zebra.
- **O pico de velocidade é o máximo bruto** — ver seção 6.

---

## 12. Constantes num lugar só

| Constante | Valor | Arquivo |
|---|---|---|
| taxa GPS pedida | 100 ms (10 Hz) | `useLapRecorder.ts` |
| descarte na entrada | accuracy > 30 m | `useLapRecorder.ts` |
| taxa IMU | 20 ms (50 Hz) | `useLapRecorder.ts` |
| drenagem do buffer | 500 ms | `useLapRecorder.ts` |
| entra em ritmo | 5 m/s, sustentado 3 m/s × 3 | `lapDetector.ts` |
| raio da linha | 15 m | `lapDetector.ts` |
| distância mínima de volta | 300 m | `lapDetector.ts` |
| duração mínima / máxima | 25 s / 180 s | `lapDetector.ts` |
| janela do map matching | ±30 segmentos | `geometry.ts` |
| tolerância da correção de linha | 25 m | `analysis.ts` |
| mini-setores | 20 | `analysis.ts` |
| setor/curva inválidos | > 5× a referência | `analysis.ts`, `cornerAnalysis.ts` |
| limpeza pré-análise | accuracy > 10 m | `analysis.ts` |
| limiar de curva | 0,04 rad/m (≈ 2,3°/m) | `corners.ts` |
| comprimento mínimo de curva | 8 m | `corners.ts` |
| janela de suavização | 6 m (adaptativa) | `corners.ts` |
| corda do azimute | ±4 m | `corners.ts` |
| trompo: entra / sai | 90°/s / 30°/s | `spinDetector.ts` |
| trompo: duração mínima | 400 ms | `spinDetector.ts` |
| janela dos insights | 12 sessões / 60 voltas | `lapInsight.ts` |

---

## 13. Inconsistência conhecida

`src/lib/lapInsight.ts` — o módulo da tela de insights — é o **único
consumidor que não chama `cleanSamples()` nem
`repairDegenerateTimestamps()`** antes de analisar. Ele só exige 20 samples
por volta.

Na prática: numa volta gravada com timestamps degenerados, a tela de sessão
mostra o aviso de "tempos aproximados" e o insights simplesmente inclui a
volta na média sem avisar nada. Corrigir é aplicar as duas funções na
entrada do `buildLapInsight`, como todos os outros fazem.
