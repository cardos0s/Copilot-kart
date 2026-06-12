# COCKPIT — Landing Page

Landing page premium e cinematográfica do app COCKPIT (telemetria para kart).
Next.js (App Router) + Tailwind CSS v4 + Framer Motion.

## Rodando

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # build de produção
```

## Estrutura

```
src/
  app/
    layout.tsx          # fontes (Anton / Space Grotesk / JetBrains Mono) + metadata
    page.tsx            # composição das seções
    globals.css         # design tokens (cores, grid técnico, grain, tipos)
  components/
    Navbar.tsx
    Footer.tsx
    hero/
      HelmetTransitionHero.tsx   # transição piloto → capacete (scroll-driven)
      FloatingTelemetry.tsx      # chips LAP TIME / SPEED / SECTOR / DELTA / BEST LAP
      TrackLine.tsx              # linha de pista sutil ao fundo
    sections/
      DataSection.tsx            # 01 — O kart agora tem dados
      TelemetryCards.tsx         # 02 — Cards de telemetria
      FeelingToData.tsx          # 03 — Do feeling ao dado
      AppMockup.tsx              # 04 — Mockup do app no celular
      TeamMode.tsx               # 05 — Modo equipe (box ao vivo)
      FinalCTA.tsx               # CTA final — "Cada volta conta."
    ui/
      Button.tsx / Reveal.tsx / SectionHeading.tsx
public/images/
  pilot-cutout.png     # kart do Davi, fundo removido (em uso no hero)
  senna-kart.png       # kart do Senna/McLaren, mesma pose (revelação + fusão)
  pilot.svg            # placeholder vetorial (fallback)
  helmet.svg           # placeholder vetorial (fallback)
  logo.png             # logo COCKPIT 219
```

No modo `cutout` (PNG com alpha), a composição inteira é mascarada pela
silhueta do piloto — as revelações acontecem dentro do contorno e nenhuma
moldura retangular aparece.

## A transição do capacete

`HelmetTransitionHero` ocupa uma tela (`100vh`); o **cursor** controla a
transformação — varrer da esquerda para a direita (0–1, suavizado com
spring) interpola quatro camadas de `clip-path` sobre o retrato, com tilt
3D sutil seguindo o mouse. Em dispositivos touch a animação roda em loop
automático; com `prefers-reduced-motion` a composição final é estática.

1. **diagonal-nose-mouth** — faixa diagonal atravessando nariz e boca
2. **visor-eyes** — faixa curva (inset + round) na região dos olhos
3. **lateral-stripes** — faixa lateral amarelo / verde / azul
4. **visor-reflections** — reflexos brancos translúcidos (acrílico do visor)

No fim, uma camada de fusão revela o capacete pela metade esquerda —
**metade piloto, metade legado** — e a assinatura "Do kart ao legado" entra.

O componente é parametrizável:

```tsx
<HelmetTransitionHero
  pilotSrc="/images/pilot.jpg"     // retrato real
  helmetSrc="/images/helmet.jpg"   // foto cinematográfica do capacete
  layers={customLayers}            // HelmetMaskLayer[] (opcional)
  progress={externalMotionValue}   // MotionValue 0–1 (opcional)
/>
```


## Trocando as imagens

Ambas as imagens do hero são fotos reais. Se a foto não tiver o
enquadramento ideal (olhos/visor a ~43% da altura do frame 4:5),
use as props `pilotFraming` / `helmetFraming` para calibrar zoom e
posição (`size` e `position` de background) — ver exemplos em
`src/app/page.tsx`. Omitindo o framing, a imagem usa `object-cover`.

> Nota: o site usa apenas inspiração visual histórica do automobilismo
> brasileiro — sem nome, marca ou afiliação com pilotos/equipes oficiais.
