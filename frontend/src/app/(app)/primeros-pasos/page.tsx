import type { Metadata } from "next";
import { ReadinessScreen } from "@/features/home/readiness-screen";

export const metadata: Metadata = { title: "Primeros pasos · EmiteYa" };

export default function GettingStartedPage() {
  return <ReadinessScreen />;
}
