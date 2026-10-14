// Contexto de la empresa de la sesión en el shell (adopt-premium-design-foundation-and-shell, design
// D11): el nombre comercial o, si no hay, la razón social que da `/company/status` (`displayName`),
// que pueden leer administradores y operadores. Ante un error no supone ningún nombre, y una empresa
// sin datos registrados no tiene nombre que mostrar.
"use client";

import { CompanyContext } from "@/components/shell/company-context";
import { useCompanyStatus } from "./company-api";

export function ShellCompanyContext() {
  const status = useCompanyStatus();
  if (status.isPending) return <CompanyContext state={{ status: "loading" }} />;
  if (status.isError) return <CompanyContext state={{ status: "error" }} />;
  if (!status.data.displayName) return <CompanyContext state={{ status: "unnamed" }} />;
  return <CompanyContext state={{ status: "ready", name: status.data.displayName }} />;
}
