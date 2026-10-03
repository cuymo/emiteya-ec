import type { Metadata } from "next";
import { SigningScreen } from "@/features/signing/signing-screen";

export const metadata: Metadata = { title: "Firma electrónica · Facturador SRI" };

export default function SigningPage() {
  return <SigningScreen />;
}
