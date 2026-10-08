import type { Metadata } from "next";
import { PurchaseSettlementDetailScreen } from "@/features/purchase-settlements/purchase-settlement-detail";

export const metadata: Metadata = { title: "Liquidación de compra · Facturador SRI" };

export default async function PurchaseSettlementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseSettlementDetailScreen purchaseSettlementId={id} />;
}
