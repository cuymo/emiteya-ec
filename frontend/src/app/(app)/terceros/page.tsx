import type { Metadata } from "next";
import { Suspense } from "react";
import { PartiesScreen, PartiesSkeleton } from "@/features/parties/parties-screen";

export const metadata: Metadata = { title: "Terceros · EmiteYa" };

export default function PartiesPage() {
  return (
    <Suspense fallback={<PartiesSkeleton />}>
      <PartiesScreen />
    </Suspense>
  );
}
