import type { Metadata } from "next";
import { ReadinessScreen } from "@/features/home/readiness-screen";

export const metadata: Metadata = { title: "Inicio · Facturador SRI" };

export default function HomePage() {
  return <ReadinessScreen />;
}
