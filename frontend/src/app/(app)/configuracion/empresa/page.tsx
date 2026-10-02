import type { Metadata } from "next";
import { CompanyScreen } from "@/features/company/company-screen";

export const metadata: Metadata = { title: "Empresa · Facturador SRI" };

export default function CompanyPage() {
  return <CompanyScreen />;
}
