"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

type Variant = "primary" | "ghost" | "inverse";

const styles: Record<Variant, string> = {
  // amarelo neon com texto escuro — para fundos escuros
  primary:
    "bg-senna-yellow text-[#0a0a0d] border border-senna-yellow hover:bg-ink hover:border-ink",
  ghost:
    "bg-transparent text-ink border border-ink/30 hover:border-senna-yellow hover:text-senna-yellow",
  // escuro com texto neon — para fundos claros/amarelos
  inverse:
    "bg-[#0a0a0d] text-senna-yellow border border-[#0a0a0d] hover:bg-carbon",
};

export function Button({
  children,
  variant = "primary",
  href = "#",
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  href?: string;
  className?: string;
}) {
  return (
    <motion.a
      href={href}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`data inline-flex items-center justify-center gap-3 px-8 py-4 text-xs font-semibold uppercase tracking-[0.2em] transition-colors duration-300 ${styles[variant]} ${className}`}
    >
      {children}
      <span aria-hidden>→</span>
    </motion.a>
  );
}
