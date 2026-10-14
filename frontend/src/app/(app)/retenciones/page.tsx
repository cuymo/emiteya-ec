import type { Metadata } from "next";
import { Suspense } from "react";
import {
  WithholdingReceiptsScreen,
  WithholdingReceiptsSkeleton,
} from "@/features/withholding-receipts/withholding-receipts-screen";

export const metadata: Metadata = { title: "Retenciones · EmiteYa" };

export default function WithholdingReceiptsPage() {
  return (
    <Suspense fallback={<WithholdingReceiptsSkeleton />}>
      <WithholdingReceiptsScreen />
    </Suspense>
  );
}
