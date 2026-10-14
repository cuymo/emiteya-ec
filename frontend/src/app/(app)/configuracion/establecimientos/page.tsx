import type { Metadata } from "next";
import { EstablishmentsScreen } from "@/features/establishments/establishments-screen";

export const metadata: Metadata = { title: "Establecimientos · EmiteYa" };

export default function EstablishmentsPage() {
  return <EstablishmentsScreen />;
}
