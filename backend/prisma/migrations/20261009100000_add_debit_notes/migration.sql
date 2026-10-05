-- add-debit-notes (design D15 y D26): borradores de nota de débito con sus conceptos, la factura que
-- modifica cada nota de débito y la operación de idempotencia de su emisión. Aditiva: las facturas,
-- las notas de crédito, las capacidades, los artefactos y los movimientos existentes no cambian.
-- Primero el DDL que genera Prisma; después las restricciones y triggers que Prisma no expresa.

-- CreateTable
CREATE TABLE "debit_note_draft" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "emission_point_id" TEXT,
    "payment_method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "debit_note_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debit_note_draft_concept" (
    "draft_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "cause" TEXT,
    "description" TEXT,
    "amount" DECIMAL,
    "tax_treatment" TEXT,

    CONSTRAINT "debit_note_draft_concept_pkey" PRIMARY KEY ("draft_id","position")
);

-- CreateTable
CREATE TABLE "debit_note_support" (
    "company_id" TEXT NOT NULL,
    "debit_note_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debit_note_support_pkey" PRIMARY KEY ("company_id","debit_note_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debit_note_draft_document_id_key" ON "debit_note_draft"("document_id");

-- CreateIndex
CREATE INDEX "debit_note_draft_company_id_status_updated_at_idx" ON "debit_note_draft"("company_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "debit_note_draft_company_id_id_key" ON "debit_note_draft"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "debit_note_draft_company_id_document_id_key" ON "debit_note_draft"("company_id", "document_id");

-- CreateIndex
CREATE INDEX "debit_note_support_company_id_invoice_id_idx" ON "debit_note_support"("company_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "debit_note_draft" ADD CONSTRAINT "debit_note_draft_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_draft" ADD CONSTRAINT "debit_note_draft_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_draft" ADD CONSTRAINT "debit_note_draft_company_id_emission_point_id_fkey" FOREIGN KEY ("company_id", "emission_point_id") REFERENCES "emission_point"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_draft" ADD CONSTRAINT "debit_note_draft_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_draft" ADD CONSTRAINT "debit_note_draft_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_draft" ADD CONSTRAINT "debit_note_draft_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_draft_concept" ADD CONSTRAINT "debit_note_draft_concept_company_id_draft_id_fkey" FOREIGN KEY ("company_id", "draft_id") REFERENCES "debit_note_draft"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_support" ADD CONSTRAINT "debit_note_support_company_id_debit_note_id_fkey" FOREIGN KEY ("company_id", "debit_note_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_support" ADD CONSTRAINT "debit_note_support_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Borradores (design D8 y D20): estado cerrado, EMITTED si y solo si tiene su comprobante, y la forma
-- de pago como clave de una entrada de catálogo (nunca una etiqueta). Conceptos por posición, hasta
-- el máximo del producto (100), cada campo opcional mientras se prepara: causa cerrada, descripción
-- de una línea de 1 a 300 caracteres (`razon` del XSD, `[^\n]*`), importe positivo en el dominio
-- `importe` (14/2) y tratamiento `taxCode:rateCode`.
ALTER TABLE "debit_note_draft" ADD CONSTRAINT "debit_note_draft_values_check" CHECK (
  "status" IN ('DRAFT', 'EMITTED')
  AND ("status" = 'EMITTED') = ("document_id" IS NOT NULL)
  AND ("payment_method" IS NULL OR "payment_method" ~ '^[0-9A-Z][0-9A-Z-]{0,63}$')
  AND "version" >= 1);
ALTER TABLE "debit_note_draft_concept" ADD CONSTRAINT "debit_note_draft_concept_values_check" CHECK (
  "position" BETWEEN 1 AND 100
  AND ("cause" IS NULL OR "cause" IN ('LATE_PAYMENT_INTEREST', 'POST_INVOICE_COST_EXPENSE'))
  AND ("description" IS NULL OR (
    char_length("description") BETWEEN 1 AND 300
    AND strpos("description", E'\n') = 0
    AND btrim("description") <> ''))
  AND ("amount" IS NULL OR (
    "amount" > 0 AND scale("amount") <= 2
    AND "amount" < power(10::numeric, 14 - scale("amount"))))
  AND ("tax_treatment" IS NULL OR "tax_treatment" ~ '^[0-9]{1,4}:[0-9]{1,4}$'));

-- Idempotencia de la emisión de notas de débito (design D15).
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_values_check";
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_values_check" CHECK (
  "operation" IN ('invoice.emit', 'credit_note.emit', 'debit_note.emit')
  AND "idempotency_key" ~ '^[!-~]{1,100}$'
  AND "request_fingerprint" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION debit_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Un borrador emitido y sus conceptos no cambian ni se borran; la empresa, la factura y el autor de
-- un borrador no cambian.
CREATE FUNCTION debit_note_draft_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF OLD."status" = 'EMITTED' THEN
    RAISE EXCEPTION 'un borrador emitido no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."company_id" <> OLD."company_id" OR NEW."invoice_id" <> OLD."invoice_id"
      OR NEW."created_by" <> OLD."created_by" OR NEW."created_at" <> OLD."created_at") THEN
    RAISE EXCEPTION 'la empresa, la factura y el autor de un borrador no cambian'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "debit_note_draft_guard" BEFORE UPDATE OR DELETE ON "debit_note_draft"
  FOR EACH ROW EXECUTE FUNCTION debit_note_draft_guard();

CREATE FUNCTION debit_note_draft_concept_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  d_id TEXT;
BEGIN
  d_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."draft_id" ELSE NEW."draft_id" END;
  IF EXISTS (SELECT 1 FROM "debit_note_draft" WHERE "id" = d_id AND "status" = 'EMITTED') THEN
    RAISE EXCEPTION 'un borrador emitido no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "debit_note_draft_concept_guard" BEFORE INSERT OR UPDATE OR DELETE ON "debit_note_draft_concept"
  FOR EACH ROW EXECUTE FUNCTION debit_note_draft_concept_guard();

-- La factura de una nota de débito (design D14 y D26): la nota es un comprobante 05 y la factura un
-- 01 autorizado de la misma empresa y del mismo ambiente. Se comprueba al registrar la relación, en
-- la transacción de la reserva; la relación nunca cambia ni se borra.
CREATE FUNCTION debit_note_support_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  note_environment TEXT;
BEGIN
  SELECT "environment" INTO note_environment FROM "electronic_document"
    WHERE "company_id" = NEW."company_id" AND "id" = NEW."debit_note_id" AND "document_type" = '05';
  IF note_environment IS NULL THEN
    RAISE EXCEPTION 'la relación es de una nota de débito de la empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "electronic_document"
      WHERE "company_id" = NEW."company_id" AND "id" = NEW."invoice_id"
        AND "document_type" = '01' AND "state" = 'AUTHORIZED' AND "environment" = note_environment
  ) THEN
    RAISE EXCEPTION 'una nota de débito modifica una factura autorizada de la empresa y del mismo ambiente'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "debit_note_support_origin" BEFORE INSERT ON "debit_note_support"
  FOR EACH ROW EXECUTE FUNCTION debit_note_support_origin();
CREATE TRIGGER "debit_note_support_immutable" BEFORE UPDATE OR DELETE ON "debit_note_support"
  FOR EACH ROW EXECUTE FUNCTION debit_reject_change();
CREATE TRIGGER "debit_note_support_no_truncate" BEFORE TRUNCATE ON "debit_note_support"
  FOR EACH STATEMENT EXECUTE FUNCTION debit_reject_change();

-- Una nota de débito no se confirma sin su factura (design D26): un trigger de restricción diferido
-- sobre los comprobantes del tipo 05, el mismo acoplamiento intencional que la nota de crédito con
-- su reserva acreditable (database.md). La factura y la nota de crédito no lo disparan.
CREATE FUNCTION debit_note_has_support() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "debit_note_support"
      WHERE "company_id" = NEW."company_id" AND "debit_note_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'la nota de débito % no tiene su factura', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "debit_note_has_support"
  AFTER INSERT OR UPDATE ON "electronic_document"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."document_type" = '05')
  EXECUTE FUNCTION debit_note_has_support();
