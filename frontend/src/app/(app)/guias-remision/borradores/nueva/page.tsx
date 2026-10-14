import type { Metadata } from "next";
import { Suspense } from "react";
import { NewShippingGuideDraftScreen } from "@/features/shipping-guides/shipping-guide-draft-editor";

export const metadata: Metadata = { title: "Nueva guía de remisión · EmiteYa" };

export default function NewShippingGuideDraftPage() {
  return (
    <Suspense>
      <NewShippingGuideDraftScreen />
    </Suspense>
  );
}
