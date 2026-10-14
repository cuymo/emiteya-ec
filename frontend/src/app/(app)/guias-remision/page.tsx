import type { Metadata } from "next";
import { Suspense } from "react";
import {
  ShippingGuidesScreen,
  ShippingGuidesSkeleton,
} from "@/features/shipping-guides/shipping-guides-screen";

export const metadata: Metadata = { title: "Guías de remisión · EmiteYa" };

export default function ShippingGuidesPage() {
  return (
    <Suspense fallback={<ShippingGuidesSkeleton />}>
      <ShippingGuidesScreen />
    </Suspense>
  );
}
