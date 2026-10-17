import type { Metadata } from "next";
import { ProductFormScreen } from "@/features/products/product-form";

export const metadata: Metadata = { title: "Corregir producto · EmiteYa" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductFormScreen productId={id} />;
}
