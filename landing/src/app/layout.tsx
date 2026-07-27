import type { Metadata } from "next";
import { Anton, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://cockpit219.com.br"),
  alternates: { canonical: "/" },
  title: "COCKPIT — Telemetria inteligente para kart",
  description:
    "Telemetria inteligente para quem quer baixar tempo, entender cada volta e evoluir como piloto. Do kart ao legado.",
  openGraph: {
    title: "COCKPIT — Telemetria inteligente para kart",
    description:
      "Transforme dados em evolução real. Tempo de volta, velocidade, delta, setores e traçado GPS.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${anton.variable} ${grotesk.variable} ${jetbrains.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
