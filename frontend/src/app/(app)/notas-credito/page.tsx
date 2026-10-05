import type { Metadata } from "next";
import { Suspense } from "react";
import {
  CreditNotesScreen,
  CreditNotesSkeleton,
} from "@/features/credit-notes/credit-notes-screen";

export const metadata: Metadata = { title: "Notas de crédito · Facturador SRI" };

export default function CreditNotesPage() {
  return (
    <Suspense fallback={<CreditNotesSkeleton />}>
      <CreditNotesScreen />
    </Suspense>
  );
}
