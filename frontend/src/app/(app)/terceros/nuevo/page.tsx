import type { Metadata } from "next";
import { PartyFormScreen } from "@/features/parties/party-form";

export const metadata: Metadata = { title: "Nuevo tercero · EmiteYa" };

export default function NewPartyPage() {
  return <PartyFormScreen />;
}
