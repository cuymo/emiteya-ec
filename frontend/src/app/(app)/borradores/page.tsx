import type { Metadata } from "next";
import { Suspense } from "react";
import { DraftsScreen, DraftsSkeleton } from "@/features/invoices/drafts-screen";

export const metadata: Metadata = { title: "Borradores · Facturador SRI" };

export default function DraftsPage() {
  return (
    <Suspense fallback={<DraftsSkeleton />}>
      <DraftsScreen />
    </Suspense>
  );
}
