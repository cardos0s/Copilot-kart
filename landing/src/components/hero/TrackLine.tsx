"use client";

import { motion, useTransform, type MotionValue } from "framer-motion";

/** Linha de pista sutil desenhada ao fundo do hero, progride com o scroll. */
export function TrackLine({ progress }: { progress: MotionValue<number> }) {
  const pathLength = useTransform(progress, [0, 0.9], [0.15, 1]);
  const opacity = useTransform(progress, [0, 0.5, 1], [0.5, 0.35, 0.2]);

  return (
    <motion.svg
      style={{ opacity }}
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <motion.path
        d="M -60 660 C 180 640 260 520 380 500 C 520 478 560 580 700 560 C 840 540 850 380 980 360 C 1120 338 1180 460 1300 440 C 1380 426 1440 360 1520 340"
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.18"
        strokeWidth="2"
        style={{ pathLength }}
      />
      <motion.path
        d="M -60 680 C 180 660 260 540 380 520 C 520 498 560 600 700 580 C 840 560 850 400 980 380 C 1120 358 1180 480 1300 460 C 1380 446 1440 380 1520 360"
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.08"
        strokeWidth="10"
        strokeDasharray="2 14"
        style={{ pathLength }}
      />
    </motion.svg>
  );
}
