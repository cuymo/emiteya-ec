import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsScreen, ReportsSkeleton } from "@/features/reports/reports-screen";

export const metadata: Metadata = { title: "Reportes · Facturador SRI" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsScreen />
    </Suspense>
  );
}
