import type { Metadata } from "next";
import { EmailScreen } from "@/features/email/email-screen";

export const metadata: Metadata = { title: "Correos · EmiteYa" };

export default function EmailPage() {
  return <EmailScreen />;
}
