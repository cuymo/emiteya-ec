import type { Metadata } from "next";
import { StockItemDetailScreen } from "@/features/inventory/stock-item-detail";

export const metadata: Metadata = { title: "Inventario · Facturador SRI" };

export default async function StockItemPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <StockItemDetailScreen productId={productId} />;
}
