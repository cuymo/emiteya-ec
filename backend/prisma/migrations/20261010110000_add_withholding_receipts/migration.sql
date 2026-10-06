-- add-withholding-receipts (design D15, D16 y D28): borradores de comprobante de retención, el
-- registro inmutable de cada comprobante con sus líneas de retención y la operación de idempotencia
-- de su emisión. Aditiva: las facturas, las notas, las capacidades, los artefactos y los movimientos
-- existentes no cambian. Primero el DDL que genera Prisma; después las restricciones y triggers que
-- Prisma no expresa.

-- CreateTable
CREATE TABLE "withholding_receipt_draft" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "party_id" TEXT,
    "related_party" TEXT,
    "fiscal_period" CHAR(7),
    "emission_point_id" TEXT,
    "supports" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "withholding_receipt_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withholding_receipt" (
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "related_party" TEXT NOT NULL,
    "fiscal_period" CHAR(7) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withholding_receipt_pkey" PRIMARY KEY ("company_id","document_id")
);

-- CreateTable
CREATE TABLE "withholding_receipt_line" (
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "support_position" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "support_document_type" CHAR(2) NOT NULL,
    "support_code" CHAR(2) NOT NULL,
    "support_number" CHAR(15) NOT NULL,
    "support_issue_date" DATE NOT NULL,
    "tax" TEXT NOT NULL,
    "withholding_code" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "base" DECIMAL NOT NULL,
    "percentage" DECIMAL NOT NULL,
    "amount" DECIMAL NOT NULL,

    CONSTRAINT "withholding_receipt_line_pkey" PRIMARY KEY ("company_id","document_id","support_position","position")
);

-- CreateIndex
CREATE UNIQUE INDEX "withholding_receipt_draft_document_id_key" ON "withholding_receipt_draft"("document_id");

-- CreateIndex
CREATE INDEX "withholding_receipt_draft_company_id_status_updated_at_idx" ON "withholding_receipt_draft"("company_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "withholding_receipt_draft_company_id_id_key" ON "withholding_receipt_draft"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "withholding_receipt_draft_company_id_document_id_key" ON "withholding_receipt_draft"("company_id", "document_id");

-- CreateIndex
CREATE INDEX "withholding_receipt_company_id_fiscal_period_idx" ON "withholding_receipt"("company_id", "fiscal_period");

-- CreateIndex
CREATE INDEX "withholding_receipt_company_id_party_id_idx" ON "withholding_receipt"("company_id", "party_id");

-- AddForeignKey
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_company_id_party_id_fkey" FOREIGN KEY ("company_id", "party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_company_id_emission_point_id_fkey" FOREIGN KEY ("company_id", "emission_point_id") REFERENCES "emission_point"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt" ADD CONSTRAINT "withholding_receipt_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt" ADD CONSTRAINT "withholding_receipt_company_id_party_id_fkey" FOREIGN KEY ("company_id", "party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_receipt_line" ADD CONSTRAINT "withholding_receipt_line_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "withholding_receipt"("company_id", "document_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Borradores (design D4 a D6 y D28): estado cerrado, EMITTED si y solo si tiene su comprobante; la
-- parte relacionada SI/NO sin valor por defecto y el período `MM/AAAA` del XSD, ambos opcionales
-- mientras se prepara. Los documentos sustento son un arreglo JSON que valida el contrato; la base
-- solo defiende su forma y su tamaño (a lo sumo 30 documentos, el máximo absoluto del contrato).
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_values_check" CHECK (
  "status" IN ('DRAFT', 'EMITTED')
  AND ("status" = 'EMITTED') = ("document_id" IS NOT NULL)
  AND ("related_party" IS NULL OR "related_party" IN ('SI', 'NO'))
  AND ("fiscal_period" IS NULL OR "fiscal_period" ~ '^(0[1-9]|1[012])/20[0-9]{2}$')
  AND "version" >= 1);
ALTER TABLE "withholding_receipt_draft" ADD CONSTRAINT "withholding_receipt_draft_supports_check" CHECK (
  jsonb_typeof("supports") = 'array'
  AND jsonb_array_length("supports") <= 30
  AND octet_length("supports"::text) <= 262144);

-- El registro del comprobante: la parte relacionada declarada y el período fiscal, obligatorios.
ALTER TABLE "withholding_receipt" ADD CONSTRAINT "withholding_receipt_values_check" CHECK (
  "related_party" IN ('SI', 'NO')
  AND "fiscal_period" ~ '^(0[1-9]|1[012])/20[0-9]{2}$');

-- Las líneas (design D10, D13 y D28): el documento sustento 01, 02 o 03 como código de dos
-- caracteres, su sustento de dos dígitos, su número de 15 dígitos; renta (1) o IVA (2), el código de
-- retención de 1 a 5 caracteres en una línea (`codigoRetencion` del XSD) y la clave de su entrada del
-- catálogo. La base es un `importe` mayor que cero (política del proyecto), el porcentaje un
-- `porcentajeRetener` (3 dígitos, 2 decimales) y el valor un `importe`, igual a la base por el
-- porcentaje redondeado a 2 decimales (`calculateWithholdingAmounts` v1; `round` de PostgreSQL redondea
-- la mitad hacia arriba en los valores positivos). Posiciones dentro de los máximos absolutos.
ALTER TABLE "withholding_receipt_line" ADD CONSTRAINT "withholding_receipt_line_values_check" CHECK (
  "support_position" BETWEEN 1 AND 30
  AND "position" BETWEEN 1 AND 10
  AND "support_document_type" IN ('01', '02', '03')
  AND "support_code" ~ '^[0-9]{2}$'
  AND "support_number" ~ '^[0-9]{15}$'
  AND "tax" IN ('1', '2')
  AND char_length("withholding_code") BETWEEN 1 AND 5
  AND strpos("withholding_code", E'\n') = 0
  AND "entry_key" ~ '^[0-9A-Z][0-9A-Z-]{0,63}$'
  AND "base" > 0 AND scale("base") <= 2
  AND "base" < power(10::numeric, 14 - scale("base"))
  AND "percentage" >= 0 AND scale("percentage") <= 2
  AND "percentage" < power(10::numeric, 3 - scale("percentage"))
  AND "amount" >= 0 AND scale("amount") <= 2
  AND "amount" < power(10::numeric, 14 - scale("amount"))
  AND "amount" = round("base" * "percentage" / 100, 2));

-- Idempotencia de la emisión de comprobantes de retención (design D16).
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_values_check";
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_values_check" CHECK (
  "operation" IN ('invoice.emit', 'credit_note.emit', 'debit_note.emit', 'withholding_receipt.emit')
  AND "idempotency_key" ~ '^[!-~]{1,100}$'
  AND "request_fingerprint" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION withholding_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Un borrador emitido no cambia ni se borra; la empresa y el autor de un borrador no cambian.
CREATE FUNCTION withholding_receipt_draft_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF OLD."status" = 'EMITTED' THEN
    RAISE EXCEPTION 'un borrador emitido no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."company_id" <> OLD."company_id"
      OR NEW."created_by" <> OLD."created_by" OR NEW."created_at" <> OLD."created_at") THEN
    RAISE EXCEPTION 'la empresa y el autor de un borrador no cambian'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "withholding_receipt_draft_guard" BEFORE UPDATE OR DELETE ON "withholding_receipt_draft"
  FOR EACH ROW EXECUTE FUNCTION withholding_receipt_draft_guard();

-- El registro es de un comprobante 07 de la empresa (la FK compuesta fija la empresa); se escribe en
-- la transacción de la reserva y nunca cambia ni se borra, como sus líneas.
CREATE FUNCTION withholding_receipt_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "electronic_document"
      WHERE "company_id" = NEW."company_id" AND "id" = NEW."document_id" AND "document_type" = '07'
  ) THEN
    RAISE EXCEPTION 'el registro es de un comprobante de retención de la empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "withholding_receipt_origin" BEFORE INSERT ON "withholding_receipt"
  FOR EACH ROW EXECUTE FUNCTION withholding_receipt_origin();
CREATE TRIGGER "withholding_receipt_immutable" BEFORE UPDATE OR DELETE ON "withholding_receipt"
  FOR EACH ROW EXECUTE FUNCTION withholding_reject_change();
CREATE TRIGGER "withholding_receipt_no_truncate" BEFORE TRUNCATE ON "withholding_receipt"
  FOR EACH STATEMENT EXECUTE FUNCTION withholding_reject_change();
CREATE TRIGGER "withholding_receipt_line_immutable" BEFORE UPDATE OR DELETE ON "withholding_receipt_line"
  FOR EACH ROW EXECUTE FUNCTION withholding_reject_change();
CREATE TRIGGER "withholding_receipt_line_no_truncate" BEFORE TRUNCATE ON "withholding_receipt_line"
  FOR EACH STATEMENT EXECUTE FUNCTION withholding_reject_change();

-- Un comprobante de retención no se confirma sin su registro y al menos una línea (design D28): un
-- trigger de restricción diferido sobre los comprobantes del tipo 07, el mismo acoplamiento
-- intencional que las notas de crédito y de débito (database.md). Las facturas y las notas no lo
-- disparan.
CREATE FUNCTION withholding_receipt_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "withholding_receipt"
      WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'el comprobante de retención % no tiene su registro', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "withholding_receipt_line"
      WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'el comprobante de retención % no tiene retenciones', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "withholding_receipt_complete"
  AFTER INSERT OR UPDATE ON "electronic_document"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."document_type" = '07')
  EXECUTE FUNCTION withholding_receipt_complete();
