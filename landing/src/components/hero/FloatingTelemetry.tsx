"use client";

import {
  motion,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";

type Chip = {
  label: string;
  value: string;
  accent?: string;
  className: string;
  drift: number; // parallax (px) ao longo do scroll
  delay: number;
};

const CHIPS: Chip[] = [
  {
    label: "LAP TIME",
    value: "47.236",
    className: "left-[6%] top-[24%] md:left-[22%] md:top-[28%]",
    drift: -70,
    delay: 0.2,
  },
  {
    label: "SPEED",
    value: "98 km/h",
    accent: "var(--senna-blue)",
    className: "right-[4%] top-[20%] md:right-[21%] md:top-[24%]",
    drift: -110,
    delay: 0.35,
  },
  {
    label: "SECTOR",
    value: "S2",
    accent: "var(--senna-green)",
    className: "left-[4%] top-[58%] md:left-[24%] md:top-[55%]",
    drift: -50,
    delay: 0.5,
  },
  {
    label: "DELTA",
    value: "-0.142",
    accent: "var(--senna-green)",
    className: "right-[6%] top-[52%] md:right-[23%] md:top-[50%]",
    drift: -90,
    delay: 0.65,
  },
  {
    label: "BEST LAP",
    value: "46.901",
    accent: "var(--senna-yellow)",
    className: "hidden md:flex right-[27%] top-[72%]",
    drift: -60,
    delay: 0.8,
  },
];

function TelemetryChip({
  chip,
  progress,
}: {
  chip: Chip;
  progress: MotionValue<number>;
}) {
  const reduced = useReducedMotion();
  const y = useTransform(progress, [0, 1], [0, chip.drift]);
  const opacity = useTransform(progress, [0, 0.12, 0.75, 0.95], [1, 1, 1, 0]);

  return (
    <motion.div
      style={{ y, opacity }}
      className={`absolute z-20 ${chip.className}`}
    >
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: chip.delay, duration: 0.8, ease: "easeOut" }}
        className="data flex items-center gap-3 border border-ink/15 bg-paper/75 px-4 py-2.5 shadow-[0_2px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm"
      >
        <span
          className="block h-1.5 w-1.5 rounded-full"
          style={{ background: chip.accent ?? "var(--ink)" }}
        />
        <span className="text-[9px] uppercase tracking-[0.25em] text-ink/50">
          {chip.label}
        </span>
        <span className="text-xs font-semibold text-ink">{chip.value}</span>
      </motion.div>
    </motion.div>
  );
}

/** Dados flutuantes com parallax sobre o hero. */
export function FloatingTelemetry({
  progress,
}: {
  progress: MotionValue<number>;
}) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {CHIPS.map((chip) => (
        <TelemetryChip key={chip.label} chip={chip} progress={progress} />
      ))}
    </div>
  );
}
