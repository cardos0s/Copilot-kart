import { Reveal } from "../ui/Reveal";
import { WaitlistForm } from "../ui/WaitlistForm";

export function FinalCTA() {
  return (
    <section
      id="cta"
      className="relative overflow-hidden bg-senna-yellow py-32 md:py-44"
    >
      {/* linha de pista atravessando o CTA */}
      <svg
        viewBox="0 0 1440 400"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.08]"
        aria-hidden
      >
        <path
          d="M-60 320 C200 300 280 140 480 120 C680 100 720 240 920 220 C1120 200 1180 60 1380 40 L1520 30"
          fill="none"
          stroke="#0a0a0a"
          strokeWidth="40"
          strokeLinecap="round"
        />
      </svg>

      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-10 px-6 text-center">
        <Reveal>
          <h2 className="display text-[clamp(3.2rem,10vw,9rem)] text-[#0a0a0d]">
            Entre no
            <br />
            COCKPIT.
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="data text-sm font-semibold uppercase tracking-[0.35em] text-[#0a0a0d]/75 md:text-base">
            Cada volta conta.
          </p>
        </Reveal>
        <Reveal delay={0.2} className="w-full max-w-xl">
          <WaitlistForm />
        </Reveal>
      </div>
    </section>
  );
}
