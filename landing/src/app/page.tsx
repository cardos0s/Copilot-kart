import { Navbar } from "@/components/Navbar";
import {
  HelmetTransitionHero,
  type HelmetMaskLayer,
} from "@/components/hero/HelmetTransitionHero";
import { DataSection } from "@/components/sections/DataSection";
import { TelemetryCards } from "@/components/sections/TelemetryCards";
import { FeelingToData } from "@/components/sections/FeelingToData";
import { AppMockup } from "@/components/sections/AppMockup";
import { TeamMode } from "@/components/sections/TeamMode";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { Footer } from "@/components/Footer";

/**
 * Camadas calibradas para a foto recortada do piloto (visor a ~29% da
 * altura do frame 3:4). Revelam o capacete do Senna em diagonal e na linha
 * do visor — só a troca fotográfica kart → legado.
 */
const CUTOUT_LAYERS: HelmetMaskLayer[] = [
  {
    id: "diagonal-chest",
    range: [0.08, 0.38],
    clipFrom: "polygon(0% 130%, 100% 104%, 100% 124%, 0% 150%)",
    clipTo: "polygon(0% 60%, 100% 34%, 100% 56%, 0% 82%)",
    content: "helmet",
    fadeOut: [0.7, 0.86],
  },
  {
    id: "visor-eyes",
    range: [0.18, 0.5],
    clipFrom: "inset(24% 90% 64% 8% round 80px)",
    clipTo: "inset(21% 11% 64% 11% round 90px)",
    content: "helmet",
  },
];

export default function Home() {
  return (
    <main>
      <Navbar />
      {/* Dois karts na mesma pose e dimensão (Davi → Senna/McLaren), ambos
          recortados. A silhueta alinha sozinha — a revelação do capacete do
          Senna cai exatamente sobre o do Davi. */}
      <HelmetTransitionHero
        pilotSrc="/images/pilot-cutout.png"
        helmetSrc="/images/senna-kart.png"
        legacySrc="/images/senna-kart.png"
        cutout
        layers={CUTOUT_LAYERS}
      />
      <DataSection />
      <TelemetryCards />
      <FeelingToData />
      <AppMockup />
      <TeamMode />
      <FinalCTA />
      <Footer />
    </main>
  );
}
