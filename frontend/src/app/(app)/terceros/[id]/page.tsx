import type { Metadata } from "next";
import { PartyFormScreen } from "@/features/parties/party-form";

export const metadata: Metadata = { title: "Corregir tercero · EmiteYa" };

export default async function EditPartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartyFormScreen partyId={id} />;
}
