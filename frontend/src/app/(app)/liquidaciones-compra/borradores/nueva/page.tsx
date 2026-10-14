import type { Metadata } from "next";
import { Suspense } from "react";
import { NewPurchaseSettlementDraftScreen } from "@/features/purchase-settlements/purchase-settlement-draft-editor";

export const metadata: Metadata = { title: "Nueva liquidación de compra · EmiteYa" };

export default function NewPurchaseSettlementDraftPage() {
  return (
    <Suspense>
      <NewPurchaseSettlementDraftScreen />
    </Suspense>
  );
}
