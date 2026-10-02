import type { Metadata } from "next";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <ThemeProvider>
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
