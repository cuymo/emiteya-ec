"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Temas claro, oscuro y del sistema, aplicados con la clase `dark` en <html>. `nonce` autoriza su
 * script en línea ante la política de seguridad (enforce-frontend-security-headers-csp, design D5).
 */
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
