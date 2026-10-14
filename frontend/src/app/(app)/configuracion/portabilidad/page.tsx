import type { Metadata } from "next";
import { DataPortabilityScreen } from "@/features/data-portability/data-portability-screen";

export const metadata: Metadata = { title: "Portabilidad de datos · EmiteYa" };

export default function DataPortabilityPage() {
  return <DataPortabilityScreen />;
}
