# Copilot Live (spectator web)

Dashboard ao vivo pra acompanhar o piloto enquanto ele corre. Roda no iPad, laptop, qualquer browser. Não precisa instalar app.

## Setup local

```bash
cd web-spectator
npm install
cp .env.example .env.local
# preenche NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (mesmo do app)
npm run dev
```

Abre http://localhost:3000

## Setup Supabase (1x, no dashboard)

1. https://dashboard.supabase.com → **New project** (free tier serve)
2. **SQL Editor** → **New query** → cola o conteúdo de `../supabase/schema.sql` → **Run**
3. **Settings → API** → copia:
   - `Project URL` → vira `NEXT_PUBLIC_SUPABASE_URL` (web) e `EXPO_PUBLIC_SUPABASE_URL` (app)
   - `anon public` key → vira `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web) e `EXPO_PUBLIC_SUPABASE_ANON_KEY` (app)

4. **Database → Replication** → habilita realtime nas tabelas `live_samples` e `live_laps`

## Deploy (Vercel)

```bash
# do diretório do projeto, com vercel CLI logada:
vercel
# segue os prompts; setting → root directory = web-spectator
```

No dashboard Vercel, **Settings → Environment Variables**, adiciona as duas
`NEXT_PUBLIC_SUPABASE_*` pra produção. Re-deploy.

Domínio resultante (tipo `copilot-live.vercel.app`) deve bater com o que o app
Copilot usa quando gera o QR — ver `app/recording.tsx`, busca por `copilot-live.vercel.app`.

## Como funciona

- Piloto ativa "📡 Ao vivo" no app → cria sessão no Supabase, recebe código `LIVE-XXXX`
- Spectator abre essa URL `/live/LIVE-XXXX` (via QR ou cola código no `/`)
- Web faz fetch inicial + assina realtime: cada GPS sample / volta nova vira UPDATE na UI
- Quando piloto encerra → sessão marca `ended_at`, badge muda pra "ENCERRADA"

## Estrutura

```
app/
  page.tsx                  Home — input do código
  live/[code]/page.tsx      Dashboard — mapa + cronômetro + voltas
  layout.tsx + globals.css  Shell + Tailwind
lib/
  supabase.ts               Cliente Supabase
  liveTypes.ts              Tipos (espelho de src/lib/liveSession.ts no app)
  useLive.ts                Hook: fetch + realtime subscribe
  trackProjection.ts        Projeção GPS → SVG
  format.ts                 fmtLap, fmtDelta, fmtTime
```
