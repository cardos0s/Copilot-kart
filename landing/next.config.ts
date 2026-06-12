import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O repositório tem outro lockfile na raiz (app Expo);
  // fixa a raiz do projeto na própria landing.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
