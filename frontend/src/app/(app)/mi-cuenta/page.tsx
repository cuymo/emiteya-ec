import type { Metadata } from "next";
import { AccountScreen } from "@/features/account/account-screen";

export const metadata: Metadata = { title: "Mi cuenta · Facturador SRI" };

export default function AccountPage() {
  return <AccountScreen />;
}
