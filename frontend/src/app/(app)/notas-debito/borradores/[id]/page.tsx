import type { Metadata } from "next";
import { DebitNoteDraftScreen } from "@/features/debit-notes/debit-note-draft-editor";

export const metadata: Metadata = { title: "Borrador de nota de débito · EmiteYa" };

export default async function DebitNoteDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DebitNoteDraftScreen draftId={id} />;
}
