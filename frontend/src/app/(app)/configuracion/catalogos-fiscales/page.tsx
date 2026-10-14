import type { Metadata } from "next";
import { FiscalCatalogsScreen } from "@/features/fiscal-catalogs/catalogs-screen";

export const metadata: Metadata = { title: "Catálogos fiscales · EmiteYa" };

export default function FiscalCatalogsPage() {
  return <FiscalCatalogsScreen />;
}
