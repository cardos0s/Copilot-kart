# CockPit 

App de análise de voltas de kart via GPS. Grava trajetória no celular no bolso
do macacão, detecta voltas automaticamente, identifica a melhor volta como
referência e mostra num mapa onde nas outras voltas você perdeu tempo.

## Como funciona

1. Cria uma sessão (nome da pista, kart, condição).
2. Põe o celular no bolso do macacão e toca em "Iniciar gravação".
3. Corre. O app grava posição GPS em background a até 10Hz.
4. Termina, toca em "Encerrar". O app segmenta automaticamente as voltas.
5. Abre a análise: mapa da pista colorido (verde = ganhou tempo, vermelho =
   perdeu) com ranking dos setores onde mais se perdeu tempo.

Sem mensalidade, sem conta, sem nuvem. Tudo local no celular via SQLite.

## Stack

- **Expo SDK 52** + expo-router
- **expo-location** com `Accuracy.BestForNavigation` e background updates
- **expo-task-manager** pra continuar gravando com tela apagada
- **expo-sqlite** pra persistência
- **react-native-maps** (Google Maps no Android) pra renderizar a trajetória

## Setup local

```bash
# 1. Clone este projeto pra um diretório
cd kartlap

# 2. Instala dependências
npm install

# 3. Valida que o algoritmo de análise funciona (teste sintético)
node scripts/self-test.js

# 4. Se tiver um arquivo GPX de alguma corrida anterior, testa com ele:
npm install fast-xml-parser
node scripts/analyze-gpx.js caminho/para/track.gpx
```

## Build Android APK (sem Mac, sem conta Apple)

```bash
# 1. Instala EAS CLI
npm install -g eas-cli

# 2. Login (conta Expo grátis basta)
eas login

# 3. Configura o projeto (gera eas.json)
eas build:configure

# 4. Faz o build APK de development (pra testar antes de produção)
eas build --platform android --profile development

# No fim, o EAS mostra um link. Abre no celular e instala.
```

O plano grátis do EAS tem fila (15min–2h dependendo do horário) e limite
mensal de builds — suficiente pra MVP.

## Build iOS via EAS (conta Apple gratuita)

Com conta Apple gratuita o app só roda por 7 dias antes de precisar reinstalar,
mas pra validar funciona:

```bash
eas build --platform ios --profile development
```

O EAS vai pedir credenciais da conta Apple. Use sua Apple ID gratuita. O build
gerado tu instala via TestFlight ou via link direto (no celular registrado).

## Testando em pista pela primeira vez

**Antes de correr com o app em produção, vale rodar um teste de baixo risco:**

1. Usa o app em paralelo com um gravador GPX (Strava, GeoTracker, GPX Logger).
   Se der algum bug, ainda tem os dados brutos.
2. Primeira volta deve ser em ritmo de pista (velocidade sustentada >30 km/h)
   pra linha de largada ser detectada corretamente.
3. Celular precisa de céu aberto. Bolso traseiro/interno do macacão funciona.
   Dentro do forro grosso, capacete, ou dentro do kart = sinal ruim.

## Precisão esperada

- Android moderno com dual-band GNSS (Galaxy S22+, Z Flip 4+, Pixel 7+):
  accuracy ~2-3m, taxa 5-10Hz. Detecção de voltas: ±0.2s. Delta por setor: ±0.3s.
- Android médio: accuracy 4-8m, taxa 1-5Hz. Delta por setor: ±0.5-1s.
- Kartódromo coberto: **GPS não funciona**. Este app não serve.

## Limitações conhecidas

- Precisa de pelo menos 2 voltas válidas pra ter análise.
- Detecção de linha de largada assume que a primeira volta completa o circuito
  (não cruza o traçado com atalho). Em 99% das pistas isso é verdade.
- Setores são divisões iguais em distância (20 por default). Não considera
  setores "naturais" da pista (curva 1, reta, etc). Dá pra customizar no
  arquivo `src/lib/analysis.ts` no futuro.

## Estrutura

```
app/                          # rotas (expo-router)
  _layout.tsx
  index.tsx                   # home, lista de sessões
  new-session.tsx
  recording.tsx               # tela durante gravação
  session/[id].tsx            # análise pós-sessão

src/
  hooks/
    useLapRecorder.ts         # hook de captura GPS com background
  lib/
    geometry.ts               # haversine, projeção ENU, map matching
    analysis.ts               # delta time, setores
    segmentation.ts           # detecta voltas a partir de amostras brutas
  storage/
    db.ts                     # SQLite: sessões e voltas

scripts/
  self-test.js                # teste sintético do pipeline
  analyze-gpx.js              # roda análise num GPX externo
```
