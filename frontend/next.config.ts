import type { NextConfig } from "next";

// La API se sirve en el mismo origen: /api se reenvía al backend (ADR 0016).
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@facturador/contracts"],
  async rewrites() {
    // `fallback`: después de las rutas dinámicas, para que la descarga del paquete de portabilidad
    // (app/api/v1/data-exports/[id]/download) se atienda en su ruta propia, sin el plazo de 30 s
    // del reenvío (add-data-portability, design D16).
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [{ source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` }],
    };
  },
};

export default nextConfig;
