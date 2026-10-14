import type { Metadata } from "next";
import { WithholdingReceiptDetailScreen } from "@/features/withholding-receipts/withholding-receipt-detail";

export const metadata: Metadata = { title: "Comprobante de retención · EmiteYa" };

export default async function WithholdingReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WithholdingReceiptDetailScreen withholdingReceiptId={id} />;
}
