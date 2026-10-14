import type { Metadata } from "next";
import { SequencesScreen } from "@/features/sequences/sequences-screen";

export const metadata: Metadata = { title: "Secuenciales · EmiteYa" };

export default function SequencesPage() {
  return <SequencesScreen />;
}
