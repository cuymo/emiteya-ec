import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryScreen, InventorySkeleton } from "@/features/inventory/inventory-screen";

export const metadata: Metadata = { title: "Inventario · Facturador SRI" };

export default function InventoryPage() {
  return (
    <Suspense fallback={<InventorySkeleton />}>
      <InventoryScreen />
    </Suspense>
  );
}
