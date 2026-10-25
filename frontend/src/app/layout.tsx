import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { SemanticToaster } from "@/components/feedback";
import { QueryProvider } from "@/components/session";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/menu-and-tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "EmiteYa",
  description: "Facturador electrónico open source para los comprobantes del SRI.",
  // Los iconos viven en `public/` y no como archivos de `app/`: Next prerenderaría esas rutas, y la
  // política exige que ningún documento sea estático (enforce-frontend-security-headers-csp, D2).
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "256x256" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180" },
  },
};

// Leer el nonce de `proxy.ts` hace dinámico todo el árbol: cada documento se renderiza por petición
// con su propio nonce (enforce-frontend-security-headers-csp, design D2 y D5).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // Geist Sans desde el propio origen (`next/font/local` del paquete, ADR 0028): una sola familia.
    <html lang="es" className={GeistSans.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider nonce={nonce}>
          <QueryProvider>
            <TooltipProvider delayDuration={300}>
              {children}
              <SemanticToaster />
            </TooltipProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
