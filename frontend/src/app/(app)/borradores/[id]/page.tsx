import type { Metadata } from "next";
import { DraftEditorScreen } from "@/features/invoices/draft-editor";

export const metadata: Metadata = { title: "Borrador de factura · Facturador SRI" };

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DraftEditorScreen draftId={id} />;
}
