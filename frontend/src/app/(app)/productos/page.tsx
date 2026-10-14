import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsScreen, ProductsSkeleton } from "@/features/products/products-screen";

export const metadata: Metadata = { title: "Productos · EmiteYa" };

export default function ProductsPage() {
  return (
    <Suspense fallback={<ProductsSkeleton />}>
      <ProductsScreen />
    </Suspense>
  );
}
