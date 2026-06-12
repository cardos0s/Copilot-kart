import { Reveal } from "./Reveal";

export function SectionHeading({
  kicker,
  title,
  dark = false,
}: {
  kicker: string;
  title: string;
  dark?: boolean;
}) {
  return (
    <div className="max-w-5xl">
      <Reveal>
        <p
          className={`data mb-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] ${
            dark ? "text-senna-yellow" : "text-ink/60"
          }`}
        >
          <span className="inline-block h-px w-10 bg-current" />
          {kicker}
        </p>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="display text-[clamp(2.8rem,7vw,6.5rem)] text-ink">
          {title}
        </h2>
      </Reveal>
    </div>
  );
}
