-- Emisión de facturas (add-invoice-emission, design D2, D3, D8 y D9): borradores editables previos a
-- la emisión, el comprobante electrónico desde RESERVED con su snapshot inmutable, su historial de
-- transiciones, el artefacto firmado exacto (ADR 0010) y el registro de idempotencia (Q-30).
-- Primero el DDL que genera Prisma; después las restricciones y triggers que Prisma no expresa.

-- CreateTable
CREATE TABLE "invoice_draft" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "emission_point_id" TEXT,
    "buyer_party_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "invoice_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_draft_line" (
    "draft_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL,

    CONSTRAINT "invoice_draft_line_pkey" PRIMARY KEY ("draft_id","position")
);

-- CreateTable
CREATE TABLE "invoice_draft_payment" (
    "draft_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "catalog_type" TEXT NOT NULL DEFAULT 'payment-method',
    "entry_key" TEXT NOT NULL,
    "amount" DECIMAL,

    CONSTRAINT "invoice_draft_payment_pkey" PRIMARY KEY ("draft_id","position")
);

-- CreateTable
CREATE TABLE "electronic_document" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_type" CHAR(2) NOT NULL,
    "environment" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "emission_point_id" TEXT NOT NULL,
    "document_number" CHAR(17) NOT NULL,
    "sequential" INTEGER NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "access_key" CHAR(49) NOT NULL,
    "numeric_code" CHAR(8) NOT NULL,
    "issue_date" DATE NOT NULL,
    "state" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schema_version" TEXT NOT NULL,
    "buyer_identification" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "total" DECIMAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(3),
    "last_attempt_stage" TEXT,
    "last_attempt_code" TEXT,
    "last_attempt_class" TEXT,
    "last_attempt_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "attempt_lease_until" TIMESTAMPTZ(3),

    CONSTRAINT "electronic_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_state_transition" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_state_transition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_artifact" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "company_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "document_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("company_id","operation","idempotency_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_draft_document_id_key" ON "invoice_draft"("document_id");

-- CreateIndex
CREATE INDEX "invoice_draft_company_id_status_updated_at_idx" ON "invoice_draft"("company_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_draft_company_id_id_key" ON "invoice_draft"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_document_reservation_id_key" ON "electronic_document"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_document_access_key_key" ON "electronic_document"("access_key");

-- CreateIndex
CREATE INDEX "electronic_document_company_id_document_type_created_at_id_idx" ON "electronic_document"("company_id", "document_type", "created_at", "id");

-- CreateIndex
CREATE INDEX "electronic_document_company_id_document_number_idx" ON "electronic_document"("company_id", "document_number");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_document_company_id_environment_establishment_id_key" ON "electronic_document"("company_id", "environment", "establishment_id", "emission_point_id", "document_type", "sequential");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_document_company_id_id_key" ON "electronic_document"("company_id", "id");

-- CreateIndex
CREATE INDEX "document_state_transition_company_id_document_id_occurred_a_idx" ON "document_state_transition"("company_id", "document_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_artifact_document_id_kind_key" ON "document_artifact"("document_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "party_company_id_id_key" ON "party"("company_id", "id");

-- AddForeignKey
ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_company_id_emission_point_id_fkey" FOREIGN KEY ("company_id", "emission_point_id") REFERENCES "emission_point"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_company_id_buyer_party_id_fkey" FOREIGN KEY ("company_id", "buyer_party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "electronic_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_line" ADD CONSTRAINT "invoice_draft_line_company_id_draft_id_fkey" FOREIGN KEY ("company_id", "draft_id") REFERENCES "invoice_draft"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_line" ADD CONSTRAINT "invoice_draft_line_company_id_product_id_fkey" FOREIGN KEY ("company_id", "product_id") REFERENCES "product"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_payment" ADD CONSTRAINT "invoice_draft_payment_company_id_draft_id_fkey" FOREIGN KEY ("company_id", "draft_id") REFERENCES "invoice_draft"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_draft_payment" ADD CONSTRAINT "invoice_draft_payment_catalog_type_entry_key_fkey" FOREIGN KEY ("catalog_type", "entry_key") REFERENCES "fiscal_catalog_key"("catalog_type", "entry_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_document" ADD CONSTRAINT "electronic_document_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_document" ADD CONSTRAINT "electronic_document_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "fiscal_sequence_reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_document" ADD CONSTRAINT "electronic_document_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_state_transition" ADD CONSTRAINT "document_state_transition_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_state_transition" ADD CONSTRAINT "document_state_transition_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Borradores (design D2). Escalas con la regla del XSD (decimal-policy.md): cantidad 18/6, descuento
-- e importe de pago 14/2, no negativos. EMITTED si y solo si tiene su comprobante.
ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_values_check" CHECK (
  "status" IN ('DRAFT', 'EMITTED')
  AND ("status" = 'EMITTED') = ("document_id" IS NOT NULL)
  AND "version" >= 1);
ALTER TABLE "invoice_draft_line" ADD CONSTRAINT "invoice_draft_line_values_check" CHECK (
  "position" >= 1
  AND "quantity" >= 0 AND scale("quantity") <= 6
  AND "quantity" < power(10::numeric, 18 - scale("quantity"))
  AND "discount" >= 0 AND scale("discount") <= 2
  AND "discount" < power(10::numeric, 14 - scale("discount")));
ALTER TABLE "invoice_draft_payment" ADD CONSTRAINT "invoice_draft_payment_values_check" CHECK (
  "position" >= 1
  AND "catalog_type" = 'payment-method'
  AND ("amount" IS NULL OR (
    "amount" >= 0 AND scale("amount") <= 2
    AND "amount" < power(10::numeric, 14 - scale("amount")))));

-- Un borrador emitido, sus líneas y sus pagos no cambian ni se borran; la empresa y el autor de un
-- borrador no cambian.
CREATE FUNCTION invoice_draft_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF OLD."status" = 'EMITTED' THEN
    RAISE EXCEPTION 'un borrador emitido no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."company_id" <> OLD."company_id" OR NEW."created_by" <> OLD."created_by"
      OR NEW."created_at" <> OLD."created_at") THEN
    RAISE EXCEPTION 'la empresa y el autor de un borrador no cambian' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "invoice_draft_guard" BEFORE UPDATE OR DELETE ON "invoice_draft"
  FOR EACH ROW EXECUTE FUNCTION invoice_draft_guard();

CREATE FUNCTION invoice_draft_children_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  d_id TEXT;
BEGIN
  d_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."draft_id" ELSE NEW."draft_id" END;
  IF EXISTS (SELECT 1 FROM "invoice_draft" WHERE "id" = d_id AND "status" = 'EMITTED') THEN
    RAISE EXCEPTION 'un borrador emitido no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "invoice_draft_line_guard" BEFORE INSERT OR UPDATE OR DELETE ON "invoice_draft_line"
  FOR EACH ROW EXECUTE FUNCTION invoice_draft_children_guard();
CREATE TRIGGER "invoice_draft_payment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "invoice_draft_payment"
  FOR EACH ROW EXECUTE FUNCTION invoice_draft_children_guard();

-- Comprobante electrónico (design D3).
ALTER TABLE "electronic_document" ADD CONSTRAINT "electronic_document_values_check" CHECK (
  "document_type" IN ('01', '03', '04', '05', '06', '07')
  AND "environment" IN ('TEST', 'PRODUCTION')
  AND "state" IN ('RESERVED', 'SIGNED')
  AND ("state" = 'SIGNED') = ("signed_at" IS NOT NULL)
  AND "access_key" ~ '^[0-9]{49}$'
  AND "numeric_code" ~ '^[0-9]{8}$'
  AND "document_number" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'
  AND "sequential" BETWEEN 1 AND 999999999
  AND "total" >= 0 AND scale("total") <= 2
  AND "total" < power(10::numeric, 14 - scale("total"))
  AND "attempt_count" >= 0
  AND ("last_attempt_class" IS NULL OR "last_attempt_class" IN
    ('RETRYABLE_OPERATIONAL', 'DETERMINISTIC_CONFIGURATION', 'DETERMINISTIC_VALIDATION')));

-- Desde RESERVED, el comprobante solo cambia de estado hacia SIGNED y su diagnóstico del intento;
-- snapshot, número, clave, fecha y comprador son inmutables. Nunca se borra.
CREATE FUNCTION electronic_document_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'electronic_document no admite DELETE' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."id", NEW."company_id", NEW."document_type", NEW."environment", NEW."establishment_id",
      NEW."emission_point_id", NEW."document_number", NEW."sequential", NEW."reservation_id",
      NEW."access_key", NEW."numeric_code", NEW."issue_date", NEW."snapshot", NEW."schema_version",
      NEW."buyer_identification", NEW."buyer_name", NEW."total", NEW."created_at", NEW."created_by")
    IS DISTINCT FROM
     (OLD."id", OLD."company_id", OLD."document_type", OLD."environment", OLD."establishment_id",
      OLD."emission_point_id", OLD."document_number", OLD."sequential", OLD."reservation_id",
      OLD."access_key", OLD."numeric_code", OLD."issue_date", OLD."snapshot", OLD."schema_version",
      OLD."buyer_identification", OLD."buyer_name", OLD."total", OLD."created_at", OLD."created_by") THEN
    RAISE EXCEPTION 'un comprobante reservado no cambia sus datos fiscales'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."state" <> OLD."state" AND NOT (OLD."state" = 'RESERVED' AND NEW."state" = 'SIGNED') THEN
    RAISE EXCEPTION 'un comprobante solo pasa de RESERVED a SIGNED' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" = 'SIGNED' AND NEW."signed_at" IS DISTINCT FROM OLD."signed_at" THEN
    RAISE EXCEPTION 'un comprobante firmado no cambia su firma' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "electronic_document_guard" BEFORE UPDATE OR DELETE ON "electronic_document"
  FOR EACH ROW EXECUTE FUNCTION electronic_document_guard();

-- SIGNED existe solo con su artefacto firmado exacto: se comprueba al confirmar (design D9).
CREATE FUNCTION electronic_document_requires_artifact() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW."state" = 'SIGNED' AND NOT EXISTS (
    SELECT 1 FROM "document_artifact" WHERE "document_id" = NEW."id" AND "kind" = 'SIGNED_XML'
  ) THEN
    RAISE EXCEPTION 'el comprobante % está firmado sin su artefacto', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "electronic_document_requires_artifact"
  AFTER INSERT OR UPDATE ON "electronic_document"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION electronic_document_requires_artifact();

-- Historial de transiciones (ERS RF-525).
ALTER TABLE "document_state_transition" ADD CONSTRAINT "document_state_transition_values_check" CHECK (
  "to_state" IN ('RESERVED', 'SIGNED')
  AND ("from_state" IS NULL OR "from_state" IN ('RESERVED', 'SIGNED'))
  AND "actor_type" IN ('USER', 'SYSTEM')
  AND ("actor_user_id" IS NOT NULL) = ("actor_type" = 'USER')
  AND "cause" <> '');

-- Artefacto firmado (ADR 0010): bytes exactos con su tamaño y su hash.
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_values_check" CHECK (
  "kind" IN ('SIGNED_XML')
  AND "media_type" = 'application/xml'
  AND "size_bytes" > 0 AND "size_bytes" = octet_length("content")
  AND "sha256" ~ '^[0-9a-f]{64}$');

-- Registro de idempotencia (Q-30): operación conocida, clave ASCII visible y huella SHA-256.
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_values_check" CHECK (
  "operation" IN ('invoice.emit')
  AND "idempotency_key" ~ '^[!-~]{1,100}$'
  AND "request_fingerprint" ~ '^[0-9a-f]{64}$');

-- El comprobante, sus transiciones, sus artefactos y el registro de idempotencia no se truncan; las
-- transiciones, los artefactos y el registro son de solo agregado.
CREATE FUNCTION fiscal_document_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "electronic_document_no_truncate" BEFORE TRUNCATE ON "electronic_document"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "document_state_transition_append_only" BEFORE UPDATE OR DELETE ON "document_state_transition"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "document_state_transition_no_truncate" BEFORE TRUNCATE ON "document_state_transition"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "document_artifact_append_only" BEFORE UPDATE OR DELETE ON "document_artifact"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "document_artifact_no_truncate" BEFORE TRUNCATE ON "document_artifact"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "idempotency_record_append_only" BEFORE UPDATE OR DELETE ON "idempotency_record"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "idempotency_record_no_truncate" BEFORE TRUNCATE ON "idempotency_record"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
