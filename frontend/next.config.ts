import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { resolveApiInternalUrl } from "./src/lib/api-internal-url";

// La API se sirve en el mismo origen: /api se reenvía al backend (ADR 0016). Solo `next dev` admite
// el destino de bucle local por defecto; el build de producción y `next start` exigen
// API_INTERNAL_URL (harden-production-configuration-and-clock-ownership, design D5).
export default function nextConfig(phase: string): NextConfig {
  const apiInternalUrl = resolveApiInternalUrl(process.env.API_INTERNAL_URL, {
    required: phase !== PHASE_DEVELOPMENT_SERVER,
  });
  return {
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
}
