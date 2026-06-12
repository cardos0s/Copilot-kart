"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Reveal } from "../ui/Reveal";

function PhoneScreen() {
  return (
    <div className="flex h-full flex-col gap-4 bg-[#0c0c0d] p-5 text-ink">
      <div className="data flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-ink/50">
        <span>COCKPIT</span>
        <span className="flex items-center gap-1.5">
          <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-senna-green" />
          REC
        </span>
      </div>

      <div className="flex flex-col items-center gap-1 py-3">
        <span className="data text-[9px] uppercase tracking-[0.3em] text-ink/40">
          Lap 12
        </span>
        <span className="data text-5xl font-bold tracking-tight text-ink">
          47.236
        </span>
        <span className="data text-sm font-semibold text-senna-green">
          -0.142
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ["S1", "15.88", "var(--senna-green)"],
          ["S2", "16.02", "var(--senna-yellow)"],
          ["S3", "15.33", "rgba(244,242,237,0.3)"],
        ].map(([s, t, c]) => (
          <div key={s} className="flex flex-col gap-1.5 bg-ink/5 p-2.5">
            <span className="data text-[8px] uppercase tracking-[0.2em] text-ink/40">
              {s}
            </span>
            <span className="data text-xs text-ink">{t}</span>
            <span className="block h-1 w-full" style={{ background: c }} />
          </div>
        ))}
      </div>

      <div className="relative flex-1 bg-ink/5 p-3">
        <span className="data text-[8px] uppercase tracking-[0.2em] text-ink/40">
          Traçado
        </span>
        <svg viewBox="0 0 200 140" className="mt-1 h-full max-h-36 w-full">
          <path
            d="M40 120 C12 108 14 60 40 44 C70 26 100 60 124 48 C152 34 146 10 172 14 C196 18 196 52 180 72 C160 96 96 140 40 120 Z"
            fill="none"
            stroke="rgba(244,242,237,0.25)"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <path
            d="M40 120 C12 108 14 60 40 44 C70 26 100 60 124 48"
            fill="none"
            stroke="var(--senna-yellow)"
            strokeWidth="2.5"
          />
          <circle cx="124" cy="48" r="4" fill="var(--senna-yellow)" />
        </svg>
      </div>

      <div className="data flex items-center justify-between text-[9px] uppercase tracking-[0.15em] text-ink/50">
        <span>SPEED 98 km/h</span>
        <span className="text-senna-yellow">BEST 46.901</span>
      </div>
    </div>
  );
}

export function AppMockup() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const phoneY = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const phoneRotate = useTransform(scrollYProgress, [0, 0.5, 1], [6, 0, -4]);

  return (
    <section ref={ref} className="relative overflow-hidden bg-paper-soft py-28 md:py-40">
      <p
        className="display pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 select-none whitespace-nowrap text-[clamp(4rem,16vw,13rem)] text-ink/[0.05]"
        aria-hidden
      >
        NA SUA MÃO
      </p>

      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-6 lg:grid-cols-2">
        <div className="order-2 flex justify-center lg:order-1">
          <motion.div
            style={{ y: phoneY, rotate: phoneRotate }}
            className="relative h-[600px] w-[290px] rounded-[44px] border border-ink/20 bg-carbon p-2.5 shadow-[0_40px_90px_rgba(10,10,10,0.3)]"
          >
            <div className="absolute left-1/2 top-4 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
            <div className="h-full overflow-hidden rounded-[34px]">
              <PhoneScreen />
            </div>
          </motion.div>
        </div>

        <div className="order-1 flex flex-col gap-8 lg:order-2">
          <Reveal>
            <p className="data flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/60">
              <span className="inline-block h-px w-10 bg-current" />
              04 — O app
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="display text-[clamp(2.8rem,6vw,5.5rem)] text-ink">
              O cockpit cabe no bolso
            </h2>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="max-w-md text-lg leading-relaxed text-ink-soft">
              Tempo ao vivo, delta, setores e traçado — direto no celular.
              Sem sensor caro, sem instalação. Liga e acelera.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
