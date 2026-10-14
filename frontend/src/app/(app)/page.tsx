import type { Metadata } from "next";
import { ReadinessScreen } from "@/features/home/readiness-screen";

export const metadata: Metadata = { title: "Inicio · EmiteYa" };

export default function HomePage() {
  return <ReadinessScreen />;
}
