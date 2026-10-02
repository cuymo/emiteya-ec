import type { Metadata } from "next";
import { EnvironmentScreen } from "@/features/company/environment-screen";

export const metadata: Metadata = { title: "Ambiente · Facturador SRI" };

export default function EnvironmentPage() {
  return <EnvironmentScreen />;
}
