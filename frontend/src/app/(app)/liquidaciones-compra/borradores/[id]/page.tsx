import type { Metadata } from "next";
import { PurchaseSettlementDraftScreen } from "@/features/purchase-settlements/purchase-settlement-draft-editor";

export const metadata: Metadata = { title: "Borrador de liquidación de compra · Facturador SRI" };

export default async function PurchaseSettlementDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseSettlementDraftScreen draftId={id} />;
}
