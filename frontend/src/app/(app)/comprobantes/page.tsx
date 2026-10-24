import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentsScreen, DocumentsSkeleton } from "@/features/archive/documents-screen";

export const metadata: Metadata = { title: "Todos los comprobantes · EmiteYa" };

export default function DocumentsPage() {
  return (
    <Suspense fallback={<DocumentsSkeleton />}>
      <DocumentsScreen />
    </Suspense>
  );
}
