import type { Metadata } from "next";
import { NewWithholdingDraftScreen } from "@/features/withholding-receipts/withholding-draft-editor";

export const metadata: Metadata = { title: "Nueva retención · EmiteYa" };

export default function NewWithholdingDraftPage() {
  return <NewWithholdingDraftScreen />;
}
