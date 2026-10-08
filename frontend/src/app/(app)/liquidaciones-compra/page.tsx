import type { Metadata } from "next";
import { Suspense } from "react";
import {
  PurchaseSettlementsScreen,
  PurchaseSettlementsSkeleton,
} from "@/features/purchase-settlements/purchase-settlements-screen";

export const metadata: Metadata = { title: "Liquidaciones de compra · Facturador SRI" };

export default function PurchaseSettlementsPage() {
  return (
    <Suspense fallback={<PurchaseSettlementsSkeleton />}>
      <PurchaseSettlementsScreen />
    </Suspense>
  );
}
