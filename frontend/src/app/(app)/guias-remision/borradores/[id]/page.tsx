import type { Metadata } from "next";
import { ShippingGuideDraftScreen } from "@/features/shipping-guides/shipping-guide-draft-editor";

export const metadata: Metadata = { title: "Borrador de guía de remisión · EmiteYa" };

export default async function ShippingGuideDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ShippingGuideDraftScreen draftId={id} />;
}
