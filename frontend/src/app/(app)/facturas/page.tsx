import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoicesScreen, InvoicesSkeleton } from "@/features/invoices/invoices-screen";

export const metadata: Metadata = { title: "Facturas · EmiteYa" };

export default function InvoicesPage() {
  return (
    <Suspense fallback={<InvoicesSkeleton />}>
      <InvoicesScreen />
    </Suspense>
  );
}
