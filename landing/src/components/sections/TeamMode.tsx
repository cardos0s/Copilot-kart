import { SectionHeading } from "../ui/SectionHeading";
import { Reveal } from "../ui/Reveal";

const PILOTS = [
  {
    kart: "07",
    name: "J. SANTANA",
    lap: "47.236",
    delta: "-0.142",
    sector: "S2",
    up: true,
  },
  {
    kart: "21",
    name: "M. OLIVEIRA",
    lap: "47.498",
    delta: "+0.120",
    sector: "S3",
    up: false,
  },
  {
    kart: "13",
    name: "R. COSTA",
    lap: "47.911",
    delta: "+0.533",
    sector: "S1",
    up: false,
  },
];

export function TeamMode() {
  return (
    <section
      id="equipe"
      className="tech-grid-dark relative bg-carbon py-28 md:py-40"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <SectionHeading dark kicker="05 — Modo equipe" title="O box vê tudo" />
          <Reveal delay={0.2}>
            <span className="data mb-2 flex items-center gap-2 border border-senna-green/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-senna-green">
              <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-senna-green" />
              Ao vivo
            </span>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <p className="mt-10 max-w-xl text-lg leading-relaxed text-ink/60">
            Enquanto o piloto acelera, a equipe acompanha tudo em tempo real do
            box: voltas, deltas e setores de cada kart, na mesma tela.
          </p>
        </Reveal>

        <div className="mt-14 overflow-hidden border border-ink/10">
          <div className="data grid grid-cols-[3rem_1fr_5.5rem_5rem] gap-4 border-b border-ink/10 bg-ink/5 px-6 py-3 text-[9px] uppercase tracking-[0.25em] text-ink/40 sm:grid-cols-[4rem_1fr_6rem_6rem_4rem]">
            <span>Kart</span>
            <span>Piloto</span>
            <span>Última</span>
            <span>Delta</span>
            <span className="hidden sm:block">Setor</span>
          </div>
          {PILOTS.map((p, i) => (
            <Reveal key={p.kart} delay={0.15 + i * 0.1}>
              <div className="data grid grid-cols-[3rem_1fr_5.5rem_5rem] items-center gap-4 border-b border-ink/10 px-6 py-5 text-sm transition-colors hover:bg-ink/5 sm:grid-cols-[4rem_1fr_6rem_6rem_4rem]">
                <span className="display text-2xl text-senna-yellow">
                  {p.kart}
                </span>
                <span className="truncate text-ink/85">{p.name}</span>
                <span className="text-ink">{p.lap}</span>
                <span
                  className={p.up ? "text-senna-green" : "text-ink/45"}
                >
                  {p.delta}
                </span>
                <span className="hidden text-ink/45 sm:block">{p.sector}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
