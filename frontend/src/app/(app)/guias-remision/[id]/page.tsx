import type { Metadata } from "next";
import { ShippingGuideDetailScreen } from "@/features/shipping-guides/shipping-guide-detail";

export const metadata: Metadata = { title: "Guía de remisión · Facturador SRI" };

export default async function ShippingGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShippingGuideDetailScreen shippingGuideId={id} />;
}
