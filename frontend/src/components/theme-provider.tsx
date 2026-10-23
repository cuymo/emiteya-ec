"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Siempre el tema claro (decisión del propietario, 2026-10-22): sin elección de tema ni la del
 * sistema. Los tokens del tema oscuro siguen en `globals.css`, sin uso. `nonce` autoriza el script en
 * línea de next-themes ante la política de seguridad (enforce-frontend-security-headers-csp, design
 * D5).
 */
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      forcedTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
