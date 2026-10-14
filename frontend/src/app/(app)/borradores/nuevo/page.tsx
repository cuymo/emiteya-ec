import type { Metadata } from "next";
import { DraftEditorScreen } from "@/features/invoices/draft-editor";

export const metadata: Metadata = { title: "Nueva factura · EmiteYa" };

export default function NewDraftPage() {
  return <DraftEditorScreen draftId={null} />;
}
