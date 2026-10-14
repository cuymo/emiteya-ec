import type { Metadata } from "next";
import { CreditNoteDetailScreen } from "@/features/credit-notes/credit-note-detail";

export const metadata: Metadata = { title: "Nota de crédito · EmiteYa" };

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CreditNoteDetailScreen creditNoteId={id} />;
}
