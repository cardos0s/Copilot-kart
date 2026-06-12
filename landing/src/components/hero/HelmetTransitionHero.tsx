"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import Image from "next/image";
import {
  animate,
  motion,
  useTransform,
  useSpring,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import { TrackLine } from "./TrackLine";
import { FloatingTelemetry } from "./FloatingTelemetry";
import { Button } from "../ui/Button";

/**
 * Camada de máscara da transição piloto → capacete.
 * Cada camada revela a imagem do capacete através de um clip-path
 * interpolado conforme o progresso (posição X do cursor sobre o hero).
 */
export type HelmetMaskLayer = {
  id: string;
  /** Janela do progresso [início, fim] em que a camada anima. */
  range: [number, number];
  /** clip-path inicial (fora da composição). */
  clipFrom: string;
  /** clip-path final (posição definitiva sobre o rosto). */
  clipTo: string;
  /** O que a camada revela. */
  content: "helmet" | "stripes" | "reflection";
  opacity?: number;
  /** Janela em que a camada sai de cena para dar lugar à fusão final. */
  fadeOut?: [number, number];
};

/**
 * Enquadramento de uma foto dentro do frame 4:5 do retrato.
 * Permite escalar/posicionar fotos que não foram fotografadas no
 * enquadramento esperado (close em paisagem, pôster com tipografia etc.)
 * para que o visor/olhos caiam a ~43% da altura do frame.
 */
export type HelmetFraming = {
  /** background-size (ex.: "152% auto"). */
  size: string;
  /** background-position (ex.: "53% 30%"). */
  position: string;
};

function FramedPhoto({
  src,
  framing,
  alt,
  priority = false,
}: {
  src: string;
  framing?: HelmetFraming;
  alt?: string;
  priority?: boolean;
}) {
  if (!framing) {
    return (
      <Image
        src={src}
        alt={alt ?? ""}
        fill
        priority={priority}
        sizes="(max-width: 768px) 90vw, 560px"
        className="object-cover"
      />
    );
  }
  return (
    <div
      className="absolute inset-0 bg-[#050505] bg-no-repeat"
      role={alt ? "img" : undefined}
      aria-label={alt}
      style={{
        backgroundImage: `url(${src})`,
        backgroundSize: framing.size,
        backgroundPosition: framing.position,
      }}
    />
  );
}

/**
 * Camadas padrão:
 *  1. faixa diagonal atravessando nariz e boca
 *  2. faixa curva na região dos olhos (visor)
 *  3. faixa lateral com as cores amarelo / verde / azul
 *  4. reflexos brancos translúcidos (acrílico do visor)
 */
export const DEFAULT_LAYERS: HelmetMaskLayer[] = [
  {
    id: "diagonal-nose-mouth",
    range: [0.08, 0.38],
    clipFrom: "polygon(0% 130%, 100% 104%, 100% 124%, 0% 150%)",
    clipTo: "polygon(0% 64%, 100% 38%, 100% 60%, 0% 86%)",
    content: "helmet",
    fadeOut: [0.7, 0.86],
  },
  {
    id: "visor-eyes",
    range: [0.18, 0.5],
    clipFrom: "inset(40% 90% 50% 8% round 80px)",
    clipTo: "inset(35% 11% 46% 11% round 90px)",
    content: "helmet",
  },
  {
    id: "lateral-stripes",
    range: [0.32, 0.62],
    clipFrom: "polygon(128% -10%, 150% -10%, 120% 110%, 98% 110%)",
    clipTo: "polygon(62% -10%, 84% -10%, 54% 110%, 32% 110%)",
    content: "stripes",
    fadeOut: [0.68, 0.84],
  },
  {
    id: "visor-reflections",
    range: [0.46, 0.78],
    clipFrom: "polygon(-60% -10%, -34% -10%, -64% 110%, -90% 110%)",
    clipTo: "polygon(72% -10%, 98% -10%, 68% 110%, 42% 110%)",
    content: "reflection",
    opacity: 0.5,
    fadeOut: [0.8, 0.94],
  },
];

function subscribeFinePointer(onChange: () => void) {
  const mql = window.matchMedia("(pointer: fine)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function MaskLayer({
  layer,
  progress,
  helmetSrc,
  framing,
}: {
  layer: HelmetMaskLayer;
  progress: MotionValue<number>;
  helmetSrc: string;
  framing?: HelmetFraming;
}) {
  const clipPath = useTransform(progress, layer.range, [
    layer.clipFrom,
    layer.clipTo,
  ]);
  const base = layer.opacity ?? 1;
  const fadeStops = layer.fadeOut ?? [1, 1.1];
  const opacity = useTransform(
    progress,
    [layer.range[0], layer.range[0] + 0.04, fadeStops[0], fadeStops[1]],
    [0, base, base, 0],
  );

  return (
    <motion.div
      style={{ clipPath, opacity }}
      className="absolute inset-0 will-change-[clip-path]"
      aria-hidden
    >
      {layer.content === "helmet" && (
        <FramedPhoto src={helmetSrc} framing={framing} />
      )}
      {layer.content === "stripes" && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, transparent 44%, var(--senna-yellow) 44%, var(--senna-yellow) 54%, var(--senna-green) 54%, var(--senna-green) 64%, var(--senna-blue) 64%, var(--senna-blue) 74%, transparent 74%)",
            opacity: 0.95,
          }}
        />
      )}
      {layer.content === "reflection" && (
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{
            background:
              "linear-gradient(105deg, transparent 10%, rgba(255,255,255,0.95) 38%, rgba(255,255,255,0.35) 52%, transparent 78%)",
          }}
        />
      )}
    </motion.div>
  );
}

export function HelmetTransitionHero({
  pilotSrc = "/images/pilot.svg",
  pilotFraming,
  helmetSrc = "/images/helmet.svg",
  helmetFraming,
  legacySrc,
  legacyFraming,
  cutout = false,
  layers = DEFAULT_LAYERS,
  progress: externalProgress,
}: {
  pilotSrc?: string;
  /** Enquadramento da foto do piloto (omitir = object-cover padrão). */
  pilotFraming?: HelmetFraming;
  helmetSrc?: string;
  /** Enquadramento da foto do capacete (omitir = object-cover padrão). */
  helmetFraming?: HelmetFraming;
  /** Imagem da fusão final (omitir = usa a do capacete). */
  legacySrc?: string;
  legacyFraming?: HelmetFraming;
  /**
   * Para PNGs com fundo transparente: usa o alpha do próprio pilotSrc como
   * máscara da composição — as revelações acontecem dentro da silhueta do
   * piloto e nada de retangular aparece (sem moldura, sem frame).
   */
  cutout?: boolean;
  layers?: HelmetMaskLayer[];
  /** MotionValue externo (0–1). Se omitido, o cursor sobre a seção controla. */
  progress?: MotionValue<number>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const finePointer = useSyncExternalStore(
    subscribeFinePointer,
    () => window.matchMedia("(pointer: fine)").matches,
    () => true,
  );

  // O cursor (desktop) ou o dedo (mobile) controla a transformação: varrer da
  // esquerda para a direita constrói o capacete. rawProgress = X normalizado.
  const rawProgress = useMotionValue(0);
  // Posição do cursor para o tilt 3D do retrato.
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  // Loop automático (touch) — guardado para pausar no primeiro toque.
  const loopRef = useRef<ReturnType<typeof animate> | null>(null);

  // Sem cursor (touch), a transformação respira sozinha em loop — até o
  // usuário tocar, quando o dedo assume o controle (ver handlePointerMove).
  useEffect(() => {
    if (externalProgress || reduced || finePointer) return;
    const controls = animate(rawProgress, 1, {
      duration: 4,
      repeat: Infinity,
      repeatType: "mirror",
      ease: "easeInOut",
      delay: 0.8,
    });
    loopRef.current = controls;
    return () => controls.stop();
  }, [externalProgress, reduced, finePointer, rawProgress]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (externalProgress) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    if (e.pointerType === "mouse") {
      mx.set(px);
      my.set(py);
      // Faixa inferior (CTAs) é zona morta: a composição volta ao piloto
      // para o intro reaparecer e os botões ficarem clicáveis.
      rawProgress.set(py > 0.78 ? 0 : px);
      return;
    }

    // Touch/caneta: o dedo "raspa" a transição. Pausa o loop e segue o X.
    loopRef.current?.stop();
    mx.set(px);
    rawProgress.set(px);
  };

  const handlePointerLeave = (e: React.PointerEvent) => {
    if (externalProgress) return;
    if (e.pointerType !== "mouse") return; // touch: trava onde o dedo soltou
    // Mouse fora: a composição volta ao piloto (o spring suaviza o retorno).
    rawProgress.set(0);
    mx.set(0.5);
    my.set(0.5);
  };

  const staticProgress = useMotionValue(1);
  const smooth = useSpring(externalProgress ?? rawProgress, {
    stiffness: 70,
    damping: 22,
    restDelta: 0.001,
  });
  const progress = reduced ? staticProgress : smooth;

  // Tilt 3D sutil do retrato seguindo o cursor.
  const tiltY = useSpring(useTransform(mx, [0, 1], [-5, 5]), {
    stiffness: 80,
    damping: 20,
  });
  const tiltX = useSpring(useTransform(my, [0, 1], [3.5, -3.5]), {
    stiffness: 80,
    damping: 20,
  });

  // Fusão final: capacete entra pela metade esquerda — metade piloto, metade legado.
  const hybridOpacity = useTransform(progress, [0.6, 0.88], [0, 1]);
  const hybridClip = useTransform(progress, [0.6, 0.88], [
    "polygon(-40% 0%, -10% 0%, -40% 100%, -70% 100%)",
    "polygon(0% 0%, 58% 0%, 42% 100%, 0% 100%)",
  ]);

  // Cena
  const portraitScale = useTransform(progress, [0, 1], [1, 1.05]);
  const portraitY = useTransform(progress, [0, 1], ["0%", "-3%"]);
  const titleOpacity = useTransform(progress, [0, 0.35], [1, 0.1]);
  const titleY = useTransform(progress, [0, 0.6], ["0%", "-14%"]);
  const introOpacity = useTransform(progress, [0.05, 0.3], [1, 0]);
  // Quando o intro some, libera o mouse para o que está atrás.
  const introPointer = useTransform(progress, (v) =>
    v > 0.28 ? "none" : "auto",
  );
  const legacyOpacity = useTransform(progress, [0.74, 0.92], [0, 1]);
  const legacyY = useTransform(progress, [0.74, 0.92], [28, 0]);
  const cueOpacity = useTransform(progress, [0, 0.08], [1, 0]);
  const bg = useTransform(
    progress,
    [0, 0.55, 1],
    ["#0a0a0d", "#0b0b10", "#0e0e14"],
  );

  return (
    <section
      ref={sectionRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative h-screen"
      aria-label="COCKPIT — do kart ao legado"
      // pan-y: arrasto horizontal raspa a transição; vertical rola a página.
      style={{ perspective: 1200, touchAction: "pan-y" }}
    >
      <motion.div
        style={{ backgroundColor: bg }}
        className="grain flex h-full flex-col items-center justify-center overflow-hidden"
      >
        <TrackLine progress={progress} />

        {/* COCKPIT gigante atrás do retrato */}
        <motion.h1
          style={{ opacity: titleOpacity, y: titleY }}
          className="display pointer-events-none absolute top-[10vh] z-0 select-none text-center text-[clamp(5.5rem,19vw,17rem)] text-ink md:top-[7vh]"
        >
          COCKPIT
        </motion.h1>

        {/* Retrato + camadas de máscara */}
        <motion.div
          style={{
            scale: portraitScale,
            y: portraitY,
            rotateY: tiltY,
            rotateX: tiltX,
            transformStyle: "preserve-3d",
            // No modo cutout, o alpha do próprio retrato recorta a composição:
            // as revelações só existem dentro da silhueta do piloto.
            ...(cutout && {
              maskImage: `url(${pilotSrc})`,
              maskSize: "cover",
              maskPosition: "center",
              maskRepeat: "no-repeat",
              WebkitMaskImage: `url(${pilotSrc})`,
              WebkitMaskSize: "cover",
              WebkitMaskPosition: "center",
              WebkitMaskRepeat: "no-repeat",
            }),
          }}
          className={`relative z-10 overflow-hidden ${
            cutout
              ? "aspect-[3/4] h-[min(62vh,580px)] md:h-[min(78vh,840px)]"
              : "aspect-[4/5] h-[min(48vh,470px)] shadow-[0_0_140px_rgba(216,240,0,0.10),0_0_60px_rgba(47,123,255,0.10)] md:h-[min(62vh,680px)]"
          }`}
        >
          <FramedPhoto
            src={pilotSrc}
            framing={pilotFraming}
            alt="Retrato frontal do piloto olhando para a câmera"
            priority
          />

          {layers.map((layer) => (
            <MaskLayer
              key={layer.id}
              layer={layer}
              progress={progress}
              helmetSrc={helmetSrc}
              framing={helmetFraming}
            />
          ))}

          {/* Fusão final — metade piloto, metade legado */}
          <motion.div
            style={{ opacity: hybridOpacity, clipPath: hybridClip }}
            className="absolute inset-0 will-change-[clip-path]"
            aria-hidden
          >
            <FramedPhoto
              src={legacySrc ?? helmetSrc}
              framing={legacySrc ? legacyFraming : helmetFraming}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-paper/20" />
          </motion.div>

          {/* contorno técnico do frame (só quando há moldura) */}
          {!cutout && (
            <>
              <div className="pointer-events-none absolute inset-0 border border-ink/10" />
              <div className="data pointer-events-none absolute bottom-2 left-3 text-[9px] uppercase tracking-[0.25em] text-white/60 mix-blend-difference">
                CAM 01 — FRONT
              </div>
            </>
          )}
        </motion.div>

        <FloatingTelemetry progress={progress} />

        {/* Intro: subtexto + CTAs */}
        <motion.div
          style={{ opacity: introOpacity, pointerEvents: introPointer }}
          className="relative z-20 mt-8 flex max-w-xl flex-col items-center gap-6 px-6 text-center md:mt-10"
        >
          <p className="text-balance text-sm leading-relaxed text-ink-soft md:text-base">
            Telemetria inteligente para quem quer baixar tempo, entender cada
            volta e evoluir como piloto.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button href="#cta">Entrar no cockpit</Button>
            <Button href="#telemetria" variant="ghost">
              Ver telemetria em ação
            </Button>
          </div>
        </motion.div>

        {/* Final: do kart ao legado */}
        <motion.div
          style={{ opacity: legacyOpacity, y: legacyY }}
          className="pointer-events-none absolute bottom-[9vh] z-20 px-6 text-center"
        >
          <p className="display text-[clamp(1.8rem,5vw,3.6rem)] text-ink">
            Do kart <span className="outline-text">ao legado</span>
          </p>
          <p className="data mt-4 text-[11px] uppercase tracking-[0.3em] text-ink/60">
            O COCKPIT transforma dados em evolução real
          </p>
        </motion.div>

        {/* Indicador: deslize o cursor (desktop) / arraste o dedo (touch) */}
        <motion.div
          style={{ opacity: cueOpacity }}
          className="pointer-events-none absolute bottom-5 z-20 flex flex-col items-center gap-2"
        >
          <span className="data text-[9px] uppercase tracking-[0.3em] text-ink/50">
            {finePointer ? "Deslize o cursor →" : "Arraste o dedo →"}
          </span>
          <div className="relative h-px w-24 bg-ink/15">
            <motion.span
              animate={reduced ? undefined : { x: [0, 88, 0] }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute -top-[3px] block h-[7px] w-[7px] rounded-full bg-senna-yellow"
            />
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
