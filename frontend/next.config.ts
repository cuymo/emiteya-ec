import type { NextConfig } from "next";

// La API se sirve en el mismo origen: /api se reenvía al backend (ADR 0016).
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@facturador/contracts"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
