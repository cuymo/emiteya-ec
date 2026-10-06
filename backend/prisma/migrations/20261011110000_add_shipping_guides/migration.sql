-- add-shipping-guides (design D3, D6 a D8, D14, D15 y D26): borradores de guía de remisión, el registro
-- inmutable de cada guía con su transportista, su origen y sus fechas, cada destinatario con su clase,
-- su sustento tipado y su declaración, y la operación de idempotencia de su emisión. Aditiva: los
-- demás comprobantes, las capacidades, los artefactos y los movimientos no cambian. Primero el DDL que
-- genera Prisma; después las restricciones y triggers que Prisma no expresa.

-- CreateTable
CREATE TABLE "shipping_guide_draft" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "emission_point_id" TEXT,
    "origin_establishment_id" TEXT,
    "departure_address" VARCHAR(300),
    "transporter_source" TEXT,
    "carrier_party_id" TEXT,
    "plate" VARCHAR(20),
    "transport_start" DATE,
    "transport_end" DATE,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "shipping_guide_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_guide" (
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "origin_establishment_id" TEXT,
    "transporter_source" TEXT NOT NULL,
    "carrier_party_id" TEXT,
    "carrier_identification_type" CHAR(2) NOT NULL,
    "carrier_identification" VARCHAR(13) NOT NULL,
    "carrier_name" VARCHAR(300) NOT NULL,
    "plate" VARCHAR(20) NOT NULL,
    "transport_start" DATE NOT NULL,
    "transport_end" DATE NOT NULL,
    "recipient_count" INTEGER NOT NULL,
    "detail_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_guide_pkey" PRIMARY KEY ("company_id","document_id")
);

-- CreateTable
CREATE TABLE "shipping_guide_recipient" (
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "recipient_kind" TEXT NOT NULL,
    "party_id" TEXT,
    "destination_establishment_id" TEXT,
    "support_kind" TEXT NOT NULL,
    "invoice_id" TEXT,
    "exception_case" TEXT,
    "exception_policy_version" INTEGER,
    "declared_by" TEXT,
    "declared_at" TIMESTAMPTZ(3),
    "detail_count" INTEGER NOT NULL,

    CONSTRAINT "shipping_guide_recipient_pkey" PRIMARY KEY ("company_id","document_id","position")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_guide_draft_document_id_key" ON "shipping_guide_draft"("document_id");

-- CreateIndex
CREATE INDEX "shipping_guide_draft_company_id_status_updated_at_idx" ON "shipping_guide_draft"("company_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_guide_draft_company_id_id_key" ON "shipping_guide_draft"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_guide_draft_company_id_document_id_key" ON "shipping_guide_draft"("company_id", "document_id");

-- CreateIndex
CREATE INDEX "shipping_guide_company_id_carrier_identification_idx" ON "shipping_guide"("company_id", "carrier_identification");

-- CreateIndex
CREATE INDEX "shipping_guide_recipient_company_id_invoice_id_idx" ON "shipping_guide_recipient"("company_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_company_id_emission_point_id_fkey" FOREIGN KEY ("company_id", "emission_point_id") REFERENCES "emission_point"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_company_id_origin_establishment_id_fkey" FOREIGN KEY ("company_id", "origin_establishment_id") REFERENCES "establishment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_company_id_carrier_party_id_fkey" FOREIGN KEY ("company_id", "carrier_party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide" ADD CONSTRAINT "shipping_guide_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide" ADD CONSTRAINT "shipping_guide_company_id_origin_establishment_id_fkey" FOREIGN KEY ("company_id", "origin_establishment_id") REFERENCES "establishment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide" ADD CONSTRAINT "shipping_guide_company_id_carrier_party_id_fkey" FOREIGN KEY ("company_id", "carrier_party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_recipient" ADD CONSTRAINT "shipping_guide_recipient_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "shipping_guide"("company_id", "document_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_recipient" ADD CONSTRAINT "shipping_guide_recipient_company_id_document_id_position_fkey" FOREIGN KEY ("company_id", "document_id", "position") REFERENCES "electronic_document_recipient"("company_id", "document_id", "position") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_recipient" ADD CONSTRAINT "shipping_guide_recipient_company_id_party_id_fkey" FOREIGN KEY ("company_id", "party_id") REFERENCES "party"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_recipient" ADD CONSTRAINT "shipping_guide_recipient_company_id_destination_establish_fkey" FOREIGN KEY ("company_id", "destination_establishment_id") REFERENCES "establishment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_recipient" ADD CONSTRAINT "shipping_guide_recipient_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_guide_recipient" ADD CONSTRAINT "shipping_guide_recipient_declared_by_fkey" FOREIGN KEY ("declared_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Borradores (design D6, D12 y D26): estado cerrado, EMITTED si y solo si tiene su comprobante; el
-- origen del transportista SELF o PARTY, con tercero solo en PARTY; la partida desde un
-- establecimiento de origen o como texto, nunca las dos; la placa y la partida sin saltos de línea.
-- Lo demás se guarda incompleto y lo informa la vista previa. Los destinatarios son un arreglo JSON
-- que valida el contrato; la base solo defiende su forma y su tamaño (a lo sumo 50 destinatarios, el
-- máximo absoluto del contrato).
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_values_check" CHECK (
  "status" IN ('DRAFT', 'EMITTED')
  AND ("status" = 'EMITTED') = ("document_id" IS NOT NULL)
  AND ("transporter_source" IS NULL OR "transporter_source" IN ('SELF', 'PARTY'))
  AND ("carrier_party_id" IS NULL OR "transporter_source" = 'PARTY')
  AND ("origin_establishment_id" IS NULL OR "departure_address" IS NULL)
  AND ("departure_address" IS NULL OR "departure_address" !~ '[\r\n]')
  AND ("plate" IS NULL OR "plate" !~ '[\r\n]')
  AND "version" >= 1);
ALTER TABLE "shipping_guide_draft" ADD CONSTRAINT "shipping_guide_draft_recipients_check" CHECK (
  jsonb_typeof("recipients") = 'array'
  AND jsonb_array_length("recipients") <= 50
  AND octet_length("recipients"::text) <= 1048576);

-- La guía (design D3 a D5 y D26): el transportista SELF lleva el RUC de la empresa (tipo 04) y ningún
-- tercero; PARTY, su tercero con RUC, cédula o pasaporte. La identificación tiene a lo sumo 13
-- caracteres (ficha v2.34, anexo 3) y la placa de 1 a 20 sin espacios en los extremos ni saltos de
-- línea. Las fechas son de los años del XSD y el fin no es anterior al inicio (validación del
-- proyecto). Conteos dentro de los máximos absolutos.
ALTER TABLE "shipping_guide" ADD CONSTRAINT "shipping_guide_values_check" CHECK (
  "transporter_source" IN ('SELF', 'PARTY')
  AND ("transporter_source" = 'PARTY') = ("carrier_party_id" IS NOT NULL)
  AND "carrier_identification_type" IN ('04', '05', '06')
  AND ("transporter_source" = 'PARTY' OR "carrier_identification_type" = '04')
  AND char_length("carrier_identification") BETWEEN 1 AND 13
  AND "carrier_identification" !~ '[\r\n]'
  AND char_length("carrier_name") BETWEEN 1 AND 300
  AND "carrier_name" !~ '[\r\n]'
  AND char_length("plate") BETWEEN 1 AND 20
  AND "plate" !~ '[\r\n]'
  AND "plate" = btrim("plate")
  AND extract(year FROM "transport_start") BETWEEN 2000 AND 2099
  AND extract(year FROM "transport_end") BETWEEN 2000 AND 2099
  AND "transport_end" >= "transport_start"
  AND "recipient_count" BETWEEN 1 AND 50
  AND "detail_count" BETWEEN "recipient_count" AND 300);

-- Los destinatarios (design D7, D8 y D14): un tercero o la propia empresa con su establecimiento de
-- destino; exactamente un sustento tipado, la factura o la excepción declarada; la propia empresa si
-- y solo si la excepción es el traslado entre establecimientos propios; la declaración con su versión,
-- su actor y su momento, juntos y solo en una excepción.
ALTER TABLE "shipping_guide_recipient" ADD CONSTRAINT "shipping_guide_recipient_values_check" CHECK (
  "position" BETWEEN 1 AND 50
  AND "recipient_kind" IN ('PARTY', 'OWN_COMPANY')
  AND ("recipient_kind" = 'PARTY') = ("party_id" IS NOT NULL)
  AND ("recipient_kind" = 'OWN_COMPANY') = ("destination_establishment_id" IS NOT NULL)
  AND "support_kind" IN ('INTERNAL_INVOICE', 'DECLARED_EXCEPTION')
  AND ("support_kind" = 'INTERNAL_INVOICE') = ("invoice_id" IS NOT NULL)
  AND ("support_kind" = 'DECLARED_EXCEPTION') = ("exception_case" IS NOT NULL)
  AND ("exception_case" IS NULL OR "exception_case" IN ('QUANTITY_OR_PRICE_AFTER_TRANSFER',
    'CONSIGNMENT', 'OWN_ESTABLISHMENT_TRANSFER', 'EXHIBITION_OR_DEMONSTRATION'))
  AND ("recipient_kind" = 'OWN_COMPANY')
    = COALESCE("exception_case" = 'OWN_ESTABLISHMENT_TRANSFER', false)
  AND ("exception_case" IS NULL) = ("exception_policy_version" IS NULL)
  AND ("exception_case" IS NULL) = ("declared_by" IS NULL)
  AND ("exception_case" IS NULL) = ("declared_at" IS NULL)
  AND ("exception_policy_version" IS NULL OR "exception_policy_version" >= 1)
  AND "detail_count" BETWEEN 1 AND 100);

-- Idempotencia de la emisión de guías de remisión (design D15).
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_values_check";
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_values_check" CHECK (
  "operation" IN ('invoice.emit', 'credit_note.emit', 'debit_note.emit', 'withholding_receipt.emit',
    'shipping_guide.emit')
  AND "idempotency_key" ~ '^[!-~]{1,100}$'
  AND "request_fingerprint" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION shipping_guide_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Un borrador emitido no cambia ni se borra; la empresa y el autor de un borrador no cambian.
CREATE FUNCTION shipping_guide_draft_guard() RETURNS trigger
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
CREATE TRIGGER "shipping_guide_draft_guard" BEFORE UPDATE OR DELETE ON "shipping_guide_draft"
  FOR EACH ROW EXECUTE FUNCTION shipping_guide_draft_guard();

-- El registro es de un comprobante 06 de la empresa (la FK compuesta fija la empresa) y la fecha de
-- inicio del transporte no es anterior a su fecha de emisión (requisito oficial: error 82 de la ficha
-- v2.34). Se escribe en la transacción de la reserva y nunca cambia ni se borra.
CREATE FUNCTION shipping_guide_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  issued DATE;
BEGIN
  SELECT "issue_date" INTO issued FROM "electronic_document"
    WHERE "company_id" = NEW."company_id" AND "id" = NEW."document_id" AND "document_type" = '06';
  IF issued IS NULL THEN
    RAISE EXCEPTION 'el registro es de una guía de remisión de la empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."transport_start" < issued THEN
    RAISE EXCEPTION 'la fecha de inicio del transporte es anterior a la fecha de emisión de la guía'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "shipping_guide_origin" BEFORE INSERT ON "shipping_guide"
  FOR EACH ROW EXECUTE FUNCTION shipping_guide_origin();
CREATE TRIGGER "shipping_guide_immutable" BEFORE UPDATE OR DELETE ON "shipping_guide"
  FOR EACH ROW EXECUTE FUNCTION shipping_guide_reject_change();
CREATE TRIGGER "shipping_guide_no_truncate" BEFORE TRUNCATE ON "shipping_guide"
  FOR EACH STATEMENT EXECUTE FUNCTION shipping_guide_reject_change();

-- Un destinatario con factura la referencia autorizada, de la empresa y del ambiente de la guía (P1);
-- la propia empresa exige una guía con establecimiento de origen distinto de su destino (P2). La
-- factura es terminal en AUTHORIZED, así que la comprobación al insertar no envejece.
CREATE FUNCTION shipping_guide_recipient_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  origin TEXT;
  guide_environment TEXT;
BEGIN
  SELECT g."origin_establishment_id", d."environment" INTO origin, guide_environment
    FROM "shipping_guide" g
    JOIN "electronic_document" d ON d."company_id" = g."company_id" AND d."id" = g."document_id"
    WHERE g."company_id" = NEW."company_id" AND g."document_id" = NEW."document_id";
  IF NEW."invoice_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "electronic_document"
      WHERE "company_id" = NEW."company_id" AND "id" = NEW."invoice_id"
        AND "document_type" = '01' AND "state" = 'AUTHORIZED'
        AND "environment" = guide_environment
  ) THEN
    RAISE EXCEPTION 'el sustento es una factura autorizada de la empresa y del ambiente de la guía'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."recipient_kind" = 'OWN_COMPANY'
      AND (origin IS NULL OR origin = NEW."destination_establishment_id") THEN
    RAISE EXCEPTION 'un traslado entre establecimientos propios tiene un origen distinto de su destino'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "shipping_guide_recipient_rules" BEFORE INSERT ON "shipping_guide_recipient"
  FOR EACH ROW EXECUTE FUNCTION shipping_guide_recipient_rules();
CREATE TRIGGER "shipping_guide_recipient_immutable" BEFORE UPDATE OR DELETE ON "shipping_guide_recipient"
  FOR EACH ROW EXECUTE FUNCTION shipping_guide_reject_change();
CREATE TRIGGER "shipping_guide_recipient_no_truncate" BEFORE TRUNCATE ON "shipping_guide_recipient"
  FOR EACH STATEMENT EXECUTE FUNCTION shipping_guide_reject_change();

-- Una guía no se confirma sin su registro, ni sin destinatarios en las dos tablas, ni con conteos
-- distintos (design D26): un trigger de restricción diferido sobre los comprobantes del tipo 06, el
-- mismo acoplamiento intencional que las notas y la retención (database.md). Las posiciones contiguas
-- las exige `electronic_document_recipients_complete`.
CREATE FUNCTION shipping_guide_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  expected_recipients INTEGER;
  expected_details INTEGER;
  header_recipients INTEGER;
  guide_recipients INTEGER;
  guide_details INTEGER;
BEGIN
  SELECT "recipient_count", "detail_count" INTO expected_recipients, expected_details
    FROM "shipping_guide" WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id";
  IF expected_recipients IS NULL THEN
    RAISE EXCEPTION 'la guía de remisión % no tiene su registro', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO header_recipients FROM "electronic_document_recipient"
    WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id";
  SELECT count(*), coalesce(sum("detail_count"), 0) INTO guide_recipients, guide_details
    FROM "shipping_guide_recipient" WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id";
  IF guide_recipients = 0 OR guide_recipients <> expected_recipients
      OR header_recipients <> expected_recipients OR guide_details <> expected_details THEN
    RAISE EXCEPTION 'los destinatarios de la guía de remisión % no coinciden con su registro', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "shipping_guide_complete"
  AFTER INSERT OR UPDATE ON "electronic_document"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."document_type" = '06')
  EXECUTE FUNCTION shipping_guide_complete();
