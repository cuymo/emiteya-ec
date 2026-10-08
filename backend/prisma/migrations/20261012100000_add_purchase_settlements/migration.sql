-- add-purchase-settlements (design D3, D14 y D25): borradores de liquidación de compra, el registro
-- inmutable de cada liquidación con su proveedor y el caso de procedencia, sus cuatro declaraciones
-- de procedencia del usuario y la operación de idempotencia de su emisión. Aditiva: los comprobantes,
-- las capacidades, los artefactos y los movimientos existentes no cambian. Primero el DDL que genera
-- Prisma; después las restricciones y triggers que Prisma no expresa.

-- CreateTable
CREATE TABLE "purchase_settlement_draft" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "emission_point_id" TEXT,
    "supplier_party_id" TEXT,
    "supplier_address" VARCHAR(300),
    "lines" JSONB NOT NULL DEFAULT '[]',
    "payments" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "purchase_settlement_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_settlement" (
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "supplier_party_id" TEXT NOT NULL,
    "eligibility_case" TEXT NOT NULL,
    "eligibility_policy" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "line_count" INTEGER NOT NULL,
    "payment_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_settlement_pkey" PRIMARY KEY ("company_id","document_id")
);

-- CreateTable
CREATE TABLE "purchase_settlement_declaration" (
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "declared_by" TEXT NOT NULL,
    "declared_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_settlement_declaration_pkey" PRIMARY KEY ("company_id","document_id","statement_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_settlement_draft_document_id_key" ON "purchase_settlement_draft"("document_id");

-- CreateIndex
CREATE INDEX "purchase_settlement_draft_company_id_status_updated_at_idx" ON "purchase_settlement_draft"("company_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_settlement_draft_company_id_id_key" ON "purchase_settlement_draft"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_settlement_draft_company_id_document_id_key" ON "purchase_settlement_draft"("company_id", "document_id");

-- CreateIndex
CREATE INDEX "purchase_settlement_company_id_supplier_party_id_idx" ON "purchase_settlement"("company_id", "supplier_party_id");

-- AddForeignKey
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_company_id_emission_point_id_fkey" FOREIGN KEY ("company_id", "emission_point_id") REFERENCES "emission_point"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_company_id_supplier_party_id_fkey" FOREIGN KEY ("company_id", "supplier_party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement" ADD CONSTRAINT "purchase_settlement_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement" ADD CONSTRAINT "purchase_settlement_company_id_supplier_party_id_fkey" FOREIGN KEY ("company_id", "supplier_party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement_declaration" ADD CONSTRAINT "purchase_settlement_declaration_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "purchase_settlement"("company_id", "document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_settlement_declaration" ADD CONSTRAINT "purchase_settlement_declaration_declared_by_fkey" FOREIGN KEY ("declared_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Borradores (design D5, D12 y D25): estado cerrado, EMITTED si y solo si tiene su comprobante; la
-- dirección del proveedor de 1 a 300 caracteres sin saltos de línea, opcional mientras se prepara.
-- Las líneas y los pagos son arreglos JSON que valida el contrato; la base solo defiende su forma y su
-- tamaño (a lo sumo 500 líneas y 20 pagos, los máximos absolutos del contrato, y 4 MiB, el límite
-- del cuerpo del borrador).
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_values_check" CHECK (
  "status" IN ('DRAFT', 'EMITTED')
  AND ("status" = 'EMITTED') = ("document_id" IS NOT NULL)
  AND ("supplier_address" IS NULL OR (char_length("supplier_address") BETWEEN 1 AND 300
    AND "supplier_address" !~ '[\r\n]'))
  AND "version" >= 1);
ALTER TABLE "purchase_settlement_draft" ADD CONSTRAINT "purchase_settlement_draft_content_check" CHECK (
  jsonb_typeof("lines") = 'array'
  AND jsonb_array_length("lines") <= 500
  AND octet_length("lines"::text) <= 4194304
  AND jsonb_typeof("payments") = 'array'
  AND jsonb_array_length("payments") <= 20
  AND octet_length("payments"::text) <= 65536);

-- El registro de la liquidación (design D3): solo el caso c) del art. 13 con la versión 1 de su
-- política, y conteos dentro de los máximos absolutos (1 a 500 líneas, 1 a 20 pagos).
ALTER TABLE "purchase_settlement" ADD CONSTRAINT "purchase_settlement_values_check" CHECK (
  "eligibility_case" = 'ART_13_C'
  AND "eligibility_policy" = 'PURCHASE_SETTLEMENT_ELIGIBILITY_V1'
  AND "policy_version" = 1
  AND "line_count" BETWEEN 1 AND 500
  AND "payment_count" BETWEEN 1 AND 20);

-- Las declaraciones (design D3): uno de los cuatro identificadores de la política, su versión y la
-- base declarada por el usuario; nunca verificada por el sistema. La clave primaria impide repetir
-- un identificador en la misma liquidación.
ALTER TABLE "purchase_settlement_declaration" ADD CONSTRAINT "purchase_settlement_declaration_values_check" CHECK (
  "statement_id" IN ('NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING', 'NO_RUC_OR_SUSPENDED_RUC',
    'UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY', 'MOVABLE_GOODS_OR_SERVICES_TRANSACTION')
  AND "policy_version" = 1
  AND "basis" = 'USER_DECLARED');

-- Idempotencia de la emisión de liquidaciones de compra (design D14).
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_values_check";
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_values_check" CHECK (
  "operation" IN ('invoice.emit', 'credit_note.emit', 'debit_note.emit', 'withholding_receipt.emit',
    'shipping_guide.emit', 'purchase_settlement.emit')
  AND "idempotency_key" ~ '^[!-~]{1,100}$'
  AND "request_fingerprint" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION purchase_settlement_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Un borrador emitido no cambia ni se borra; la empresa y el autor de un borrador no cambian.
CREATE FUNCTION purchase_settlement_draft_guard() RETURNS trigger
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
CREATE TRIGGER "purchase_settlement_draft_guard" BEFORE UPDATE OR DELETE ON "purchase_settlement_draft"
  FOR EACH ROW EXECUTE FUNCTION purchase_settlement_draft_guard();

-- El registro es de una liquidación de compra 03 de la empresa (la FK compuesta fija la empresa); se
-- escribe en la transacción de la reserva y nunca cambia ni se borra, como sus declaraciones.
CREATE FUNCTION purchase_settlement_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "electronic_document"
      WHERE "company_id" = NEW."company_id" AND "id" = NEW."document_id" AND "document_type" = '03'
  ) THEN
    RAISE EXCEPTION 'el registro es de una liquidación de compra de la empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "purchase_settlement_origin" BEFORE INSERT ON "purchase_settlement"
  FOR EACH ROW EXECUTE FUNCTION purchase_settlement_origin();
CREATE TRIGGER "purchase_settlement_immutable" BEFORE UPDATE OR DELETE ON "purchase_settlement"
  FOR EACH ROW EXECUTE FUNCTION purchase_settlement_reject_change();
CREATE TRIGGER "purchase_settlement_no_truncate" BEFORE TRUNCATE ON "purchase_settlement"
  FOR EACH STATEMENT EXECUTE FUNCTION purchase_settlement_reject_change();
CREATE TRIGGER "purchase_settlement_declaration_immutable" BEFORE UPDATE OR DELETE ON "purchase_settlement_declaration"
  FOR EACH ROW EXECUTE FUNCTION purchase_settlement_reject_change();
CREATE TRIGGER "purchase_settlement_declaration_no_truncate" BEFORE TRUNCATE ON "purchase_settlement_declaration"
  FOR EACH STATEMENT EXECUTE FUNCTION purchase_settlement_reject_change();

-- Una liquidación de compra no se confirma sin su registro y exactamente las cuatro declaraciones de
-- la versión de su política (design D3 y D25): un trigger de restricción diferido sobre los
-- comprobantes del tipo 03, el mismo acoplamiento intencional que las notas, la retención y la guía
-- (database.md). Los demás tipos no lo disparan.
CREATE FUNCTION purchase_settlement_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  settlement_version INTEGER;
  declarations INTEGER;
BEGIN
  SELECT "policy_version" INTO settlement_version FROM "purchase_settlement"
    WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la liquidación de compra % no tiene su registro', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO declarations FROM "purchase_settlement_declaration"
    WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id"
      AND "policy_version" = settlement_version;
  IF declarations <> 4 THEN
    RAISE EXCEPTION 'la liquidación de compra % no tiene sus cuatro declaraciones de procedencia', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "purchase_settlement_complete"
  AFTER INSERT OR UPDATE ON "electronic_document"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."document_type" = '03')
  EXECUTE FUNCTION purchase_settlement_complete();
