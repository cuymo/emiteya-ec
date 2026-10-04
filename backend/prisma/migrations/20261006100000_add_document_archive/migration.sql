-- add-document-archive (design D4, D9 y Migration Plan): el artefacto RIDE_PDF, el historial de
-- entregas de solo agregado y los índices de la bandeja. Aditiva: los datos existentes siguen válidos.

-- CreateTable
CREATE TABLE "document_delivery_event" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "artifact_kind" TEXT NOT NULL,
    "artifact_sha256" CHAR(64) NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_delivery_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_delivery_event_company_id_document_id_occurred_at_idx" ON "document_delivery_event"("company_id", "document_id", "occurred_at");

-- CreateIndex
CREATE INDEX "electronic_document_company_id_issue_date_id_idx" ON "electronic_document"("company_id", "issue_date", "id");

-- CreateIndex
CREATE INDEX "electronic_document_company_id_buyer_identification_idx" ON "electronic_document"("company_id", "buyer_identification");

-- AddForeignKey
ALTER TABLE "document_delivery_event" ADD CONSTRAINT "document_delivery_event_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_delivery_event" ADD CONSTRAINT "document_delivery_event_document_id_artifact_kind_fkey" FOREIGN KEY ("document_id", "artifact_kind") REFERENCES "document_artifact"("document_id", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_delivery_event" ADD CONSTRAINT "document_delivery_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Artefactos (design D4): los XML con application/xml y el RIDE con application/pdf.
ALTER TABLE "document_artifact" DROP CONSTRAINT "document_artifact_values_check";
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_values_check" CHECK (
  (("kind" IN ('SIGNED_XML', 'AUTHORIZED_XML') AND "media_type" = 'application/xml')
    OR ("kind" = 'RIDE_PDF' AND "media_type" = 'application/pdf'))
  AND "size_bytes" > 0 AND "size_bytes" = octet_length("content")
  AND "sha256" ~ '^[0-9a-f]{64}$');

-- Entregas observables (design D9, Q-24): una descarga servida o una solicitud de impresión del
-- RIDE. Nunca "impreso" ni "recibido"; nunca bytes.
ALTER TABLE "document_delivery_event" ADD CONSTRAINT "document_delivery_event_values_check" CHECK (
  "event" IN ('DOWNLOAD', 'PRINT_REQUESTED')
  AND "artifact_kind" IN ('SIGNED_XML', 'AUTHORIZED_XML', 'RIDE_PDF')
  AND ("event" <> 'PRINT_REQUESTED' OR "artifact_kind" = 'RIDE_PDF')
  AND "artifact_sha256" ~ '^[0-9a-f]{64}$'
  AND "request_id" ~ '^[A-Za-z0-9._-]{8,128}$');

-- El historial es de solo agregado y no se trunca.
CREATE TRIGGER "document_delivery_event_append_only" BEFORE UPDATE OR DELETE ON "document_delivery_event"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "document_delivery_event_no_truncate" BEFORE TRUNCATE ON "document_delivery_event"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
