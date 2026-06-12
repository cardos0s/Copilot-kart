"use client";

import { motion, useScroll, useTransform } from "framer-motion";

export function Navbar() {
  const { scrollY } = useScroll();
  const bg = useTransform(
    scrollY,
    [0, 120],
    ["rgba(10,10,13,0)", "rgba(10,10,13,0.85)"],
  );
  const border = useTransform(
    scrollY,
    [0, 120],
    ["rgba(242,241,234,0)", "rgba(242,241,234,0.08)"],
  );

  return (
    <motion.header
      style={{ backgroundColor: bg, borderColor: border }}
      className="fixed inset-x-0 top-0 z-50 border-b backdrop-blur-md"
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a href="#" className="display text-xl tracking-wide text-ink">
          COCKPIT
          <span className="ml-1 inline-block h-2 w-2 bg-senna-yellow" />
        </a>
        <div className="data hidden items-center gap-8 text-[10px] font-semibold uppercase tracking-[0.25em] text-ink/60 md:flex">
          <a href="#dados" className="transition-colors hover:text-ink">
            Dados
          </a>
          <a href="#telemetria" className="transition-colors hover:text-ink">
            Telemetria
          </a>
          <a href="#equipe" className="transition-colors hover:text-ink">
            Equipe
          </a>
        </div>
        <a
          href="#cta"
          className="data border border-senna-yellow bg-senna-yellow px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#0a0a0d] transition-colors hover:bg-transparent hover:text-senna-yellow"
        >
          Entrar
        </a>
      </nav>
    </motion.header>
  );
}
