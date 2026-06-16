# CockPit

Plataforma de telemetria de kart por GPS. Grava a trajetória pelo celular no
bolso do macacão, detecta voltas automaticamente, analisa onde você perdeu tempo
e ainda traz coach por IA, gamificação, leaderboard e transmissão ao vivo pra
equipe — sem mensalidade e com os dados de corrida no próprio celular.

## Componentes

O projeto é um monorepo com quatro partes:

| Pasta | O que é | Stack |
|---|---|---|
| `app/` + `src/` | App mobile (núcleo do produto) | Expo SDK 52, expo-router, SQLite |
| `web-spectator/` | Painel web de espectador e equipe | Next.js + Supabase realtime |
| `landing/` | Landing page de marketing | Next.js |
| `cockpit-vision/` | Telemetria por vídeo (MVP) | Python + OpenCV |

---

## App mobile

### Gravação & telemetria
- Gravação por GPS a até **10 Hz**, em background com a tela apagada.
- **HUD ao vivo** (modo paisagem): velocidade, tempo de volta e delta vs. melhor
  volta ou volta anterior.
- Tempos por **setor S1/S2/S3** ao vivo, com cores (PB de setor, mais lento etc).
- **Detecção automática de voltas** a partir das amostras brutas.
- Detecção de ociosidade (sugere encerrar após 30s parado) e de **trompo/rodada**.
- Gravação de **volta de referência** com fluxo preflight e indicador de
  precisão do GPS. Suporta **múltiplos traçados por pista**.

### Análise & insights
- **Análise da sessão**: abas de comparação, setores e mapa 2D colorido
  (verde = ganhou tempo, vermelho = perdeu).
- **Comparação de duas voltas** lado a lado, com delta ponto a ponto.
- **Insights inteligentes**: score 0–100 (consistência, ritmo, voltas limpas) e
  detecção de curvas/setores melhorando ou piorando.
- **Recap semanal** em carrossel animado.

### Coach IA
- Análise de voltas por IA (**Claude, Gemini ou OpenAI** — selecionável) com
  contexto de setores e histórico do piloto.
- Chat multi-turno com histórico persistido e botão flutuante de acesso rápido.
- Gerenciamento de chave de API (testa e armazena com segurança).

### Gamificação
- **XP e níveis**: Cadete → S1 → S2 → S3 → S4 → KZ (Lenda).
- **Recordes pessoais** por pista+traçado, com streaks e marcos sub-X segundos.
- Tela de **Carreira** (timeline de níveis e conquistas), **conquistas** e
  **desafios diários** com contador de streak.

### Social & ao vivo
- **Leaderboard público** com pódio (top 20 por pista).
- **Transmissão ao vivo** via código/QR: a equipe acompanha posição, delta,
  setores e telemetria em tempo real.
- **Mensagens equipe → piloto** com níveis de severidade e confirmação.

### Perfil & gestão
- Perfil do piloto, home com evolução, histórico de sessões com filtros.
- **Gestão de setups do kart** (chassi, motor, pneus, câmber, marchas, horas).
- Configurações (unidades, tema, IA) e onboarding multi-etapas.

---

## Web Spectator (`web-spectator/`)

Painel web em tempo real, sem instalação:
- **Vista espectador**: traçado GPS ao vivo, tempo de volta, velocidade, delta e
  lista de voltas.
- **Vista equipe/box**: delta gigante vs. PB, previsão de tempo final, delta por
  setor, ranking de pontos a melhorar, diagnóstico textual e gráfico de
  velocidade, além de mensageria rápida ao piloto.

---

## Cockpit Vision (`cockpit-vision/`)

MVP de telemetria por vídeo (Python + OpenCV). Dois modos:
- **POV (capacete/GoPro)**: velocidade por fluxo ótico, curva e freada.
- **Câmera externa fixa**: detecção do kart, trail cinematográfico, velocidade e
  contador de passagens.

Detalhes em [`cockpit-vision/README.md`](cockpit-vision/README.md).

---

## Backend (Supabase)

Identidade anônima por dispositivo (sem cadastro). Tabelas: `pilots`,
`live_sessions`, `live_samples`, `live_laps`, `live_messages`,
`leaderboard_entries` — com realtime e limpeza automática de sessões expiradas
(TTL 6h). Schema em [`supabase/schema.sql`](supabase/schema.sql).

> A gravação e a análise são **100% locais** (SQLite). A nuvem só entra para
> transmissão ao vivo e leaderboard.

---

## Setup local (app mobile)

```bash
# 1. Instala dependências
npm install

# 2. Valida que o algoritmo de análise funciona (teste sintético)
node scripts/self-test.js

# 3. Se tiver um GPX de alguma corrida anterior, testa com ele:
npm install fast-xml-parser
node scripts/analyze-gpx.js caminho/para/track.gpx
```

## Build Android APK (sem Mac, sem conta Apple)

```bash
npm install -g eas-cli
eas login                                              # conta Expo grátis basta
eas build:configure
eas build --platform android --profile development
```

No fim, o EAS mostra um link. Abre no celular e instala. O plano grátis tem fila
(15min–2h) e limite mensal de builds — suficiente pra MVP.

## Build iOS via EAS (conta Apple gratuita)

Com conta Apple gratuita o app roda por 7 dias antes de precisar reinstalar:

```bash
eas build --platform ios --profile development
```

---

## Testando em pista pela primeira vez

**Antes de correr com o app em produção, vale um teste de baixo risco:**

1. Use o app em paralelo com um gravador GPX (Strava, GeoTracker, GPX Logger).
   Se der bug, ainda tem os dados brutos.
2. Primeira volta em ritmo de pista (velocidade sustentada >30 km/h) pra linha
   de largada ser detectada corretamente.
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
- Setores são divisões iguais em distância (20 por default), não os setores
  "naturais" da pista. Dá pra customizar em `src/lib/analysis.ts`.

---

## Estrutura

```
app/                     # rotas (expo-router): recording, session, coach,
                         # leaderboard, career, challenges, kart-setups…
src/
  hooks/                 # useLapRecorder (captura GPS em background)
  lib/                   # análise, lapDetector, gamification, challenges,
                         # coach/aiAnalysis, leaderboard, liveSession, insights…
  components/            # UI, celebrações, overlays
  storage/               # SQLite (db), profile, preferences, apiKey
  llm/                   # provedores de IA (claude, gemini, openai)
scripts/                 # self-test.js, analyze-gpx.js
web-spectator/           # painel web de espectador e equipe (Next.js)
landing/                 # landing page (Next.js)
cockpit-vision/          # telemetria por vídeo (Python + OpenCV)
supabase/                # schema.sql do backend
```
