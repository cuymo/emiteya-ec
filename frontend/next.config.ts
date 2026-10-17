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
    async redirects() {
      // Los secuenciales viven en cada punto de Establecimientos (decisión del propietario,
      // 2026-10-16): la dirección de la antigua pestaña lleva allí.
      return [
        {
          // Los borradores de factura viven en Facturas, con el filtro «Borradores»
          // (unify-drafts-into-document-lists, design D6). Los editores no cambian de dirección.
          source: "/borradores",
          destination: "/facturas?estado=borradores",
          permanent: false,
        },
        {
          source: "/configuracion/secuenciales",
          destination: "/configuracion/establecimientos",
          permanent: false,
        },
      ];
    },
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
