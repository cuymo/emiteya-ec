import type { Metadata } from "next";
import { ConfigurationIndex } from "@/features/configuration/configuration-layout";

export const metadata: Metadata = { title: "Configuración · EmiteYa" };

export default function ConfigurationPage() {
  return <ConfigurationIndex />;
}
