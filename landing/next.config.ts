import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export estático: gera HTML puro em out/ (sem servidor) — ideal pra Netlify.
  output: "export",
  // Static export não roda o otimizador de imagem; serve as imagens como estão.
  images: {
    unoptimized: true,
  },
  // O repositório tem outro lockfile na raiz (app Expo);
  // fixa a raiz do projeto na própria landing.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
