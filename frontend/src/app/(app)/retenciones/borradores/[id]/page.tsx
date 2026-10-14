import type { Metadata } from "next";
import { WithholdingDraftScreen } from "@/features/withholding-receipts/withholding-draft-editor";

export const metadata: Metadata = { title: "Borrador de retención · EmiteYa" };

export default async function WithholdingDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WithholdingDraftScreen draftId={id} />;
}
