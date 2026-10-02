import type { Metadata } from "next";
import { Suspense } from "react";
import { UsersScreen, UsersSkeleton } from "@/features/users/users-screen";

export const metadata: Metadata = { title: "Usuarios · Facturador SRI" };

export default function UsersPage() {
  return (
    <Suspense fallback={<UsersSkeleton />}>
      <UsersScreen />
    </Suspense>
  );
}
