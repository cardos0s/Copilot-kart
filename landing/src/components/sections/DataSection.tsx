import { SectionHeading } from "../ui/SectionHeading";
import { Reveal } from "../ui/Reveal";

const STATS = [
  { value: "10 Hz", label: "Captura GPS por segundo" },
  { value: "±0.05s", label: "Precisão de tempo de volta" },
  { value: "100%", label: "Das voltas registradas" },
];

export function DataSection() {
  return (
    <section id="dados" className="tech-grid relative bg-paper py-28 md:py-40">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeading
          kicker="01 — Registro"
          title="O kart agora tem dados"
        />

        <div className="mt-14 grid gap-12 md:grid-cols-2 md:gap-20">
          <Reveal delay={0.1}>
            <p className="max-w-md text-lg leading-relaxed text-ink-soft">
              O COCKPIT registra cada volta, cada velocidade, cada trajetória.
              O que antes era só memória vira histórico — e histórico vira
              evolução.
            </p>
          </Reveal>

          <div className="grid gap-px border border-ink/15 bg-ink/15 sm:grid-cols-3">
            {STATS.map((stat, i) => (
              <Reveal key={stat.label} delay={0.15 + i * 0.1} className="h-full">
                <div className="flex h-full flex-col gap-3 bg-paper p-7">
                  <span className="display text-4xl text-ink">{stat.value}</span>
                  <span className="data text-[10px] uppercase tracking-[0.2em] text-ink/55">
                    {stat.label}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
