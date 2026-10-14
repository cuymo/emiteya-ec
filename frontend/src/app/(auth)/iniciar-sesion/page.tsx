import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen, LoginSkeleton } from "@/features/auth/login-screen";

export const metadata: Metadata = { title: "Iniciar sesión · EmiteYa" };

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginScreen />
    </Suspense>
  );
}
