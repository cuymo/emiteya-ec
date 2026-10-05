import type { Metadata } from "next";
import { Suspense } from "react";
import { DebitNotesScreen, DebitNotesSkeleton } from "@/features/debit-notes/debit-notes-screen";

export const metadata: Metadata = { title: "Notas de débito · Facturador SRI" };

export default function DebitNotesPage() {
  return (
    <Suspense fallback={<DebitNotesSkeleton />}>
      <DebitNotesScreen />
    </Suspense>
  );
}
