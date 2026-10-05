import type { Metadata } from "next";
import { CreditNoteDraftScreen } from "@/features/credit-notes/credit-note-draft-editor";

export const metadata: Metadata = { title: "Borrador de nota de crédito · Facturador SRI" };

export default async function CreditNoteDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CreditNoteDraftScreen draftId={id} />;
}
