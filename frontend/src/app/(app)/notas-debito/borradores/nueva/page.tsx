import type { Metadata } from "next";
import { NewDebitNoteDraftScreen } from "@/features/debit-notes/debit-note-draft-editor";

export const metadata: Metadata = { title: "Nueva nota de débito · EmiteYa" };

/** `?factura={id}` llega desde el detalle de la factura con la factura ya elegida. */
export default async function NewDebitNoteDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { factura } = await searchParams;
  return <NewDebitNoteDraftScreen invoiceId={typeof factura === "string" ? factura : null} />;
}
