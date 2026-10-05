import type { Metadata } from "next";
import { CreditNoteDraftScreen } from "@/features/credit-notes/credit-note-draft-editor";

export const metadata: Metadata = { title: "Nueva nota de crédito · Facturador SRI" };

/** `?factura={id}` llega desde el detalle de la factura con la factura ya elegida. */
export default async function NewCreditNoteDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { factura } = await searchParams;
  return (
    <CreditNoteDraftScreen
      draftId={null}
      invoiceId={typeof factura === "string" ? factura : null}
    />
  );
}
