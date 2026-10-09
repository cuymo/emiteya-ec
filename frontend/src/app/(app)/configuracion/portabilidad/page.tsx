import type { Metadata } from "next";
import { DataPortabilityScreen } from "@/features/data-portability/data-portability-screen";

export const metadata: Metadata = { title: "Portabilidad de datos · Facturador SRI" };

export default function DataPortabilityPage() {
  return <DataPortabilityScreen />;
}
