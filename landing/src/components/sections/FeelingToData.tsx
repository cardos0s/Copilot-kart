import { SectionHeading } from "../ui/SectionHeading";
import { Reveal } from "../ui/Reveal";

export function FeelingToData() {
  return (
    <section className="relative bg-paper py-28 md:py-40">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeading kicker="03 — Evolução" title="Do feeling ao dado" />

        <div className="mt-14 grid items-center gap-14 lg:grid-cols-2">
          <div className="flex flex-col gap-8">
            <Reveal delay={0.1}>
              <p className="max-w-md text-lg leading-relaxed text-ink-soft">
                &ldquo;Acho que perdi tempo na entrada da curva&rdquo; vira
                <span className="data mx-2 bg-senna-yellow px-2 py-0.5 text-sm text-[#0a0a0d]">
                  +0.32s · curva 7
                </span>
                . O piloto deixa de depender só da sensação e passa a saber
                exatamente onde ganhou — e onde perdeu.
              </p>
            </Reveal>
            <Reveal delay={0.2}>
              <ul className="flex flex-col gap-4">
                {[
                  ["Sensação", "Dado"],
                  ["Achismo", "Traçado real"],
                  ["Memória", "Histórico de evolução"],
                ].map(([from, to]) => (
                  <li
                    key={to}
                    className="data flex items-center gap-4 text-[11px] uppercase tracking-[0.2em]"
                  >
                    <span className="text-ink/40 line-through">{from}</span>
                    <span className="h-px w-8 bg-ink/30" aria-hidden />
                    <span className="font-semibold text-ink">{to}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={0.15}>
            <figure className="relative border border-ink/15 bg-paper-soft p-6">
              <svg viewBox="0 0 520 340" className="w-full" aria-hidden>
                {/* pista */}
                <path
                  d="M90 290 C30 270 24 180 70 140 C120 96 200 130 250 110 C310 86 300 36 370 32 C440 28 480 80 470 140 C460 200 400 200 360 240 C320 280 200 320 90 290 Z"
                  fill="none"
                  stroke="rgba(242,241,234,0.15)"
                  strokeWidth="26"
                  strokeLinejoin="round"
                />
                {/* volta de referência */}
                <path
                  d="M90 290 C30 270 24 180 70 140 C120 96 200 130 250 110 C310 86 300 36 370 32 C440 28 480 80 470 140 C460 200 400 200 360 240 C320 280 200 320 90 290 Z"
                  fill="none"
                  stroke="rgba(242,241,234,0.4)"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                />
                {/* sua volta */}
                <path
                  d="M94 282 C42 264 36 184 78 146 C126 104 202 138 254 118 C312 96 308 44 370 40 C434 36 472 84 462 138 C452 192 396 194 354 234 C314 272 198 312 94 282 Z"
                  fill="none"
                  stroke="var(--senna-yellow)"
                  strokeWidth="3.5"
                  style={{ filter: "drop-shadow(0 0 6px rgba(216,240,0,0.45))" }}
                />
                {/* curva 7: onde o tempo escapou */}
                <circle cx="370" cy="36" r="10" fill="none" stroke="var(--senna-blue)" strokeWidth="2.5" />
                <line x1="378" y1="44" x2="420" y2="88" stroke="var(--senna-blue)" strokeWidth="1.5" />
                <text x="408" y="108" fill="var(--senna-blue)" fontSize="13" fontFamily="monospace" fontWeight="bold">
                  +0.32s
                </text>
                <text x="408" y="124" fill="rgba(242,241,234,0.55)" fontSize="10" fontFamily="monospace">
                  CURVA 7
                </text>
              </svg>
              <figcaption className="data mt-4 flex items-center gap-6 text-[10px] uppercase tracking-[0.2em] text-ink/55">
                <span className="flex items-center gap-2">
                  <span className="block h-0.5 w-6 bg-senna-yellow" /> Sua volta
                </span>
                <span className="flex items-center gap-2">
                  <span className="block h-0.5 w-6 border-t-2 border-dashed border-ink/40" />
                  Melhor volta
                </span>
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
