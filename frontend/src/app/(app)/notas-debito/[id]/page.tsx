import type { Metadata } from "next";
import { DebitNoteDetailScreen } from "@/features/debit-notes/debit-note-detail";

export const metadata: Metadata = { title: "Nota de débito · Facturador SRI" };

export default async function DebitNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DebitNoteDetailScreen debitNoteId={id} />;
}
