import type { ReactNode } from "react";
import { SectionHeading } from "../ui/SectionHeading";
import { Reveal } from "../ui/Reveal";

function Sparkline({ color = "var(--senna-yellow)" }: { color?: string }) {
  return (
    <svg viewBox="0 0 200 60" className="h-14 w-full" aria-hidden>
      <path
        d="M0 44 L24 40 L44 46 L66 30 L88 36 L110 18 L134 26 L158 12 L180 18 L200 8"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
      />
      <circle cx="200" cy="8" r="3.5" fill={color} />
    </svg>
  );
}

function SpeedBars() {
  const bars = [34, 48, 42, 56, 50, 38, 52, 58, 44, 60];
  return (
    <svg viewBox="0 0 200 60" className="h-14 w-full" aria-hidden>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 20 + 4}
          y={60 - h}
          width="10"
          height={h}
          fill={i === 9 ? "var(--senna-yellow)" : "rgba(244,242,237,0.25)"}
        />
      ))}
    </svg>
  );
}

function DeltaViz() {
  return (
    <svg viewBox="0 0 200 60" className="h-14 w-full" aria-hidden>
      <line x1="100" y1="6" x2="100" y2="54" stroke="rgba(244,242,237,0.25)" strokeWidth="1.5" />
      <rect x="52" y="20" width="48" height="20" fill="var(--senna-green)" />
      <text x="44" y="36" textAnchor="end" fill="var(--senna-green)" fontSize="15" fontFamily="monospace">
        -0.142
      </text>
    </svg>
  );
}

function SectorViz() {
  return (
    <svg viewBox="0 0 200 60" className="h-14 w-full" aria-hidden>
      <rect x="0" y="24" width="60" height="14" fill="var(--senna-green)" />
      <rect x="66" y="24" width="60" height="14" fill="var(--senna-yellow)" />
      <rect x="132" y="24" width="60" height="14" fill="rgba(244,242,237,0.25)" />
      <text x="0" y="56" fill="rgba(244,242,237,0.55)" fontSize="10" fontFamily="monospace">S1</text>
      <text x="66" y="56" fill="rgba(244,242,237,0.55)" fontSize="10" fontFamily="monospace">S2</text>
      <text x="132" y="56" fill="rgba(244,242,237,0.55)" fontSize="10" fontFamily="monospace">S3</text>
    </svg>
  );
}

function GpsTrace() {
  return (
    <svg viewBox="0 0 200 60" className="h-14 w-full" aria-hidden>
      <path
        d="M30 48 C10 40 12 16 38 14 C70 12 76 34 104 32 C136 30 130 8 162 10 C188 12 194 34 172 44 C140 58 70 60 30 48 Z"
        fill="none"
        stroke="var(--senna-blue)"
        strokeWidth="3"
        strokeLinejoin="round"
        style={{ filter: "brightness(1.8)" }}
      />
      <circle cx="104" cy="32" r="4" fill="var(--senna-yellow)" />
    </svg>
  );
}

function CompareViz() {
  return (
    <svg viewBox="0 0 200 60" className="h-14 w-full" aria-hidden>
      <path
        d="M0 40 C40 36 60 18 100 22 C140 26 160 12 200 16"
        fill="none"
        stroke="var(--senna-yellow)"
        strokeWidth="2.5"
      />
      <path
        d="M0 46 C40 44 60 28 100 34 C140 40 160 24 200 30"
        fill="none"
        stroke="rgba(244,242,237,0.35)"
        strokeWidth="2.5"
        strokeDasharray="5 5"
      />
    </svg>
  );
}

const CARDS: { title: string; desc: string; viz: ReactNode; value: string }[] = [
  {
    title: "Tempo de volta",
    value: "47.236",
    desc: "Cronometragem automática, volta a volta, com precisão de centésimos.",
    viz: <Sparkline />,
  },
  {
    title: "Velocidade",
    value: "98 km/h",
    desc: "Pico e média por trecho. Saiba onde o kart anda — e onde ele para.",
    viz: <SpeedBars />,
  },
  {
    title: "Delta",
    value: "-0.142",
    desc: "Diferença em tempo real contra a sua melhor volta.",
    viz: <DeltaViz />,
  },
  {
    title: "Setores",
    value: "S1 · S2 · S3",
    desc: "A pista dividida em setores para achar exatamente onde o tempo escapa.",
    viz: <SectorViz />,
  },
  {
    title: "Traçado GPS",
    value: "10 Hz",
    desc: "Sua trajetória real desenhada sobre a pista, curva por curva.",
    viz: <GpsTrace />,
  },
  {
    title: "Comparação de voltas",
    value: "V12 × V18",
    desc: "Volta contra volta, lado a lado. O traçado mais rápido fica visível.",
    viz: <CompareViz />,
  },
];

export function TelemetryCards() {
  return (
    <section
      id="telemetria"
      className="tech-grid-dark relative bg-carbon py-28 md:py-40"
    >
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeading
          dark
          kicker="02 — Telemetria"
          title="Cada volta vira informação"
        />

        <div className="mt-16 grid gap-px border border-ink/10 bg-ink/10 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((card, i) => (
            <Reveal key={card.title} delay={(i % 3) * 0.1} className="h-full">
              <article className="group flex h-full flex-col gap-5 bg-carbon p-8 transition-colors duration-300 hover:bg-[#181818]">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="data text-[11px] font-semibold uppercase tracking-[0.25em] text-ink/60">
                    {card.title}
                  </h3>
                  <span className="data text-xs text-senna-yellow">
                    {card.value}
                  </span>
                </div>
                {card.viz}
                <p className="text-sm leading-relaxed text-ink/55">
                  {card.desc}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
