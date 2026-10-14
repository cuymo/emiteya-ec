import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsScreen, ReportsSkeleton } from "@/features/reports/reports-screen";

export const metadata: Metadata = { title: "Reportes · EmiteYa" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsScreen />
    </Suspense>
  );
}
