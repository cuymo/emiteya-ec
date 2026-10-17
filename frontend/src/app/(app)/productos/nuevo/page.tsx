import type { Metadata } from "next";
import { ProductFormScreen } from "@/features/products/product-form";

export const metadata: Metadata = { title: "Nuevo producto · EmiteYa" };

export default function NewProductPage() {
  return <ProductFormScreen />;
}
