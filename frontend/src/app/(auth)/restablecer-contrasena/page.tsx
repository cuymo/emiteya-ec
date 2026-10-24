import type { Metadata } from "next";
import { ResetPasswordScreen } from "@/features/auth/reset-password-screen";

// El enlace lleva el token en el fragmento: ninguna página enlazada recibe la dirección completa.
export const metadata: Metadata = {
  title: "Poner una contraseña nueva · EmiteYa",
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return <ResetPasswordScreen />;
}
