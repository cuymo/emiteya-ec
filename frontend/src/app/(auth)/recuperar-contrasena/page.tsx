import type { Metadata } from "next";
import { ForgotPasswordScreen } from "@/features/auth/forgot-password-screen";

export const metadata: Metadata = { title: "Recuperar tu contraseña · EmiteYa" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
