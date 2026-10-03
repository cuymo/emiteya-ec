import type { Metadata } from "next";
import { InvoiceDetailScreen } from "@/features/invoices/invoice-detail";

export const metadata: Metadata = { title: "Factura · Facturador SRI" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetailScreen invoiceId={id} />;
}
