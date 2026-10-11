import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { SemanticToaster } from "@/components/feedback";
import { QueryProvider } from "@/components/session";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/menu-and-tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Facturador SRI",
  description: "Facturador electrónico open source para los comprobantes del SRI.",
};

// Leer el nonce de `proxy.ts` hace dinámico todo el árbol: cada documento se renderiza por petición
// con su propio nonce (enforce-frontend-security-headers-csp, design D2 y D5).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="es" suppressHydrationWarning>
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
