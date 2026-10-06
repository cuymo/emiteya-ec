import type { Metadata } from "next";
import { NewWithholdingDraftScreen } from "@/features/withholding-receipts/withholding-draft-editor";

export const metadata: Metadata = { title: "Nueva retención · Facturador SRI" };

export default function NewWithholdingDraftPage() {
  return <NewWithholdingDraftScreen />;
}
