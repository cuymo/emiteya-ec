-- add-credit-notes (design D5, D7, D10, D22 y D25): borradores de nota de crédito, la capacidad
-- acreditable de cada factura y sus reservas por nota, la capacidad devolvible por factura y
-- producto con sus reservas, y la operación de idempotencia de la emisión. Aditiva: las facturas, los
-- artefactos y los movimientos existentes no cambian; la capacidad de una factura nace con su
-- primera nota. Primero el DDL que genera Prisma; después las restricciones y triggers que Prisma no
-- expresa.

-- CreateTable
CREATE TABLE "credit_note_draft" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "emission_point_id" TEXT,
    "cause" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "credit_note_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_draft_line" (
    "draft_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "physical_return" DECIMAL NOT NULL,

    CONSTRAINT "credit_note_draft_line_pkey" PRIMARY KEY ("draft_id","position")
);

-- CreateTable
CREATE TABLE "credit_capacity" (
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "original_total" DECIMAL NOT NULL,
    "reserved_total" DECIMAL NOT NULL DEFAULT 0,
    "applied_total" DECIMAL NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_capacity_pkey" PRIMARY KEY ("company_id","invoice_id")
);

-- CreateTable
CREATE TABLE "credit_capacity_line" (
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "original_quantity" DECIMAL NOT NULL,
    "reserved_quantity" DECIMAL NOT NULL DEFAULT 0,
    "applied_quantity" DECIMAL NOT NULL DEFAULT 0,

    CONSTRAINT "credit_capacity_line_pkey" PRIMARY KEY ("company_id","invoice_id","position")
);

-- CreateTable
CREATE TABLE "credit_reservation" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "credit_note_id" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluded_at" TIMESTAMPTZ(3),

    CONSTRAINT "credit_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_reservation_line" (
    "reservation_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "subtotal" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL,
    "taxable_base" DECIMAL NOT NULL,
    "taxes" JSONB NOT NULL,
    "physical_return" DECIMAL NOT NULL,

    CONSTRAINT "credit_reservation_line_pkey" PRIMARY KEY ("reservation_id","position")
);

-- CreateTable
CREATE TABLE "stock_return_capacity" (
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "original_quantity" DECIMAL NOT NULL,
    "reserved_quantity" DECIMAL NOT NULL DEFAULT 0,
    "applied_quantity" DECIMAL NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_return_capacity_pkey" PRIMARY KEY ("company_id","invoice_id","product_id")
);

-- CreateTable
CREATE TABLE "stock_return_reservation" (
    "company_id" TEXT NOT NULL,
    "credit_note_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluded_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_return_reservation_pkey" PRIMARY KEY ("company_id","credit_note_id","product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_draft_document_id_key" ON "credit_note_draft"("document_id");

-- CreateIndex
CREATE INDEX "credit_note_draft_company_id_status_updated_at_idx" ON "credit_note_draft"("company_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_draft_company_id_id_key" ON "credit_note_draft"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_draft_company_id_document_id_key" ON "credit_note_draft"("company_id", "document_id");

-- CreateIndex
CREATE INDEX "credit_reservation_company_id_invoice_id_status_idx" ON "credit_reservation"("company_id", "invoice_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_reservation_company_id_credit_note_id_key" ON "credit_reservation"("company_id", "credit_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_reservation_company_id_invoice_id_id_key" ON "credit_reservation"("company_id", "invoice_id", "id");

-- CreateIndex
CREATE INDEX "stock_return_reservation_company_id_invoice_id_product_id_s_idx" ON "stock_return_reservation"("company_id", "invoice_id", "product_id", "status");

-- AddForeignKey
ALTER TABLE "credit_note_draft" ADD CONSTRAINT "credit_note_draft_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_draft" ADD CONSTRAINT "credit_note_draft_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_draft" ADD CONSTRAINT "credit_note_draft_company_id_emission_point_id_fkey" FOREIGN KEY ("company_id", "emission_point_id") REFERENCES "emission_point"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_draft" ADD CONSTRAINT "credit_note_draft_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_draft" ADD CONSTRAINT "credit_note_draft_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_draft" ADD CONSTRAINT "credit_note_draft_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_draft_line" ADD CONSTRAINT "credit_note_draft_line_company_id_draft_id_fkey" FOREIGN KEY ("company_id", "draft_id") REFERENCES "credit_note_draft"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_capacity" ADD CONSTRAINT "credit_capacity_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_capacity_line" ADD CONSTRAINT "credit_capacity_line_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "credit_capacity"("company_id", "invoice_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_capacity_line" ADD CONSTRAINT "credit_capacity_line_company_id_product_id_fkey" FOREIGN KEY ("company_id", "product_id") REFERENCES "product"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservation" ADD CONSTRAINT "credit_reservation_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "credit_capacity"("company_id", "invoice_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservation" ADD CONSTRAINT "credit_reservation_company_id_credit_note_id_fkey" FOREIGN KEY ("company_id", "credit_note_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservation_line" ADD CONSTRAINT "credit_reservation_line_company_id_invoice_id_reservation__fkey" FOREIGN KEY ("company_id", "invoice_id", "reservation_id") REFERENCES "credit_reservation"("company_id", "invoice_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservation_line" ADD CONSTRAINT "credit_reservation_line_company_id_invoice_id_position_fkey" FOREIGN KEY ("company_id", "invoice_id", "position") REFERENCES "credit_capacity_line"("company_id", "invoice_id", "position") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_capacity" ADD CONSTRAINT "stock_return_capacity_company_id_invoice_id_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_capacity" ADD CONSTRAINT "stock_return_capacity_company_id_product_id_fkey" FOREIGN KEY ("company_id", "product_id") REFERENCES "product"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_reservation" ADD CONSTRAINT "stock_return_reservation_company_id_credit_note_id_fkey" FOREIGN KEY ("company_id", "credit_note_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_reservation" ADD CONSTRAINT "stock_return_reservation_company_id_invoice_id_product_id_fkey" FOREIGN KEY ("company_id", "invoice_id", "product_id") REFERENCES "stock_return_capacity"("company_id", "invoice_id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Borradores (design D5): causa cerrada, motivo de una línea de 1 a 300 caracteres (`motivo` del
-- XSD, `[^\n]*`), EMITTED si y solo si tiene su comprobante. Líneas por posición de la factura, con
-- la cantidad acreditada y el retorno físico en el dominio `cantidad` (18/6) y el retorno físico
-- nunca mayor que lo acreditado.
ALTER TABLE "credit_note_draft" ADD CONSTRAINT "credit_note_draft_values_check" CHECK (
  "cause" IN ('TOTAL_ANNULMENT', 'RETURN')
  AND "status" IN ('DRAFT', 'EMITTED')
  AND ("status" = 'EMITTED') = ("document_id" IS NOT NULL)
  AND ("reason" IS NULL OR (
    char_length("reason") BETWEEN 1 AND 300
    AND strpos("reason", E'\n') = 0
    AND btrim("reason") <> ''))
  AND "version" >= 1);
ALTER TABLE "credit_note_draft_line" ADD CONSTRAINT "credit_note_draft_line_values_check" CHECK (
  "position" >= 1
  AND "quantity" >= 0 AND scale("quantity") <= 6
  AND "quantity" < power(10::numeric, 18 - scale("quantity"))
  AND "physical_return" >= 0 AND scale("physical_return") <= 6
  AND "physical_return" <= "quantity");

-- Capacidad acreditable (design D7): importes en el dominio `importe` (14/2) y cantidades en el
-- dominio `cantidad`, no negativos, y lo reservado más lo aplicado nunca supera lo original. Es la
-- última defensa de la capacidad: un exceso revierte la transacción de la reserva.
ALTER TABLE "credit_capacity" ADD CONSTRAINT "credit_capacity_values_check" CHECK (
  "original_total" >= 0 AND scale("original_total") <= 2
  AND "original_total" < power(10::numeric, 14 - scale("original_total"))
  AND "reserved_total" >= 0 AND scale("reserved_total") <= 2
  AND "applied_total" >= 0 AND scale("applied_total") <= 2
  AND "reserved_total" + "applied_total" <= "original_total");
ALTER TABLE "credit_capacity_line" ADD CONSTRAINT "credit_capacity_line_values_check" CHECK (
  "position" >= 1
  AND "original_quantity" >= 0 AND scale("original_quantity") <= 6
  AND "original_quantity" < power(10::numeric, 18 - scale("original_quantity"))
  AND "reserved_quantity" >= 0 AND scale("reserved_quantity") <= 6
  AND "applied_quantity" >= 0 AND scale("applied_quantity") <= 6
  AND "reserved_quantity" + "applied_quantity" <= "original_quantity");

-- Reservas acreditables (design D6 y D7): causa y estado cerrados, concluida si y solo si no está
-- RESERVED. Sus líneas no tienen importes negativos (CREDIT_NOTE_LINE_AMOUNT_NEGATIVE) y el retorno
-- físico nunca supera lo acreditado.
ALTER TABLE "credit_reservation" ADD CONSTRAINT "credit_reservation_values_check" CHECK (
  "cause" IN ('TOTAL_ANNULMENT', 'RETURN')
  AND "status" IN ('RESERVED', 'APPLIED', 'RELEASED')
  AND ("status" = 'RESERVED') = ("concluded_at" IS NULL)
  AND "amount" >= 0 AND scale("amount") <= 2
  AND "amount" < power(10::numeric, 14 - scale("amount")));
ALTER TABLE "credit_reservation_line" ADD CONSTRAINT "credit_reservation_line_values_check" CHECK (
  "position" >= 1
  AND "quantity" >= 0 AND scale("quantity") <= 6
  AND "quantity" < power(10::numeric, 18 - scale("quantity"))
  AND "subtotal" >= 0 AND scale("subtotal") <= 12
  AND "discount" >= 0 AND scale("discount") <= 2
  AND "taxable_base" >= 0 AND scale("taxable_base") <= 2
  AND jsonb_typeof("taxes") = 'array'
  AND "physical_return" >= 0 AND scale("physical_return") <= 6
  AND "physical_return" <= "quantity");

-- Capacidad devolvible (design D10): dominio `existencia` (30/6), no negativa, y lo reservado más
-- lo aplicado nunca supera la salida original. Las reservas son positivas.
ALTER TABLE "stock_return_capacity" ADD CONSTRAINT "stock_return_capacity_values_check" CHECK (
  "original_quantity" >= 0 AND scale("original_quantity") <= 6
  AND "original_quantity" < power(10::numeric, 30 - scale("original_quantity"))
  AND "reserved_quantity" >= 0 AND scale("reserved_quantity") <= 6
  AND "applied_quantity" >= 0 AND scale("applied_quantity") <= 6
  AND "reserved_quantity" + "applied_quantity" <= "original_quantity");
ALTER TABLE "stock_return_reservation" ADD CONSTRAINT "stock_return_reservation_values_check" CHECK (
  "status" IN ('RESERVED', 'APPLIED', 'RELEASED')
  AND ("status" = 'RESERVED') = ("concluded_at" IS NULL)
  AND "quantity" > 0 AND scale("quantity") <= 6
  AND "quantity" < power(10::numeric, 30 - scale("quantity")));

-- Idempotencia de la emisión de notas (design D11).
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_values_check";
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_values_check" CHECK (
  "operation" IN ('invoice.emit', 'credit_note.emit')
  AND "idempotency_key" ~ '^[!-~]{1,100}$'
  AND "request_fingerprint" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION credit_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Un borrador emitido y sus líneas no cambian ni se borran; la empresa, la factura y el autor de un
-- borrador no cambian.
CREATE FUNCTION credit_note_draft_guard() RETURNS trigger
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
CREATE TRIGGER "credit_note_draft_guard" BEFORE UPDATE OR DELETE ON "credit_note_draft"
  FOR EACH ROW EXECUTE FUNCTION credit_note_draft_guard();

CREATE FUNCTION credit_note_draft_line_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  d_id TEXT;
BEGIN
  d_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."draft_id" ELSE NEW."draft_id" END;
  IF EXISTS (SELECT 1 FROM "credit_note_draft" WHERE "id" = d_id AND "status" = 'EMITTED') THEN
    RAISE EXCEPTION 'un borrador emitido no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "credit_note_draft_line_guard" BEFORE INSERT OR UPDATE OR DELETE ON "credit_note_draft_line"
  FOR EACH ROW EXECUTE FUNCTION credit_note_draft_line_guard();

-- La capacidad nace de una factura propia autorizada, con su total, y cada línea con el producto y
-- la cantidad de la misma posición del snapshot (design D3 y D7): nunca del producto vigente.
CREATE FUNCTION credit_capacity_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "electronic_document"
      WHERE "company_id" = NEW."company_id" AND "id" = NEW."invoice_id"
        AND "document_type" = '01' AND "state" = 'AUTHORIZED' AND "total" = NEW."original_total"
  ) THEN
    RAISE EXCEPTION 'la capacidad acreditable nace de una factura autorizada y de su total'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "credit_capacity_origin" BEFORE INSERT ON "credit_capacity"
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_origin();

CREATE FUNCTION credit_capacity_line_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "electronic_document" d, jsonb_array_elements(d."snapshot" -> 'lines') l
      WHERE d."company_id" = NEW."company_id" AND d."id" = NEW."invoice_id"
        AND (l ->> 'position')::int = NEW."position"
        AND l ->> 'productId' = NEW."product_id"
        AND (l ->> 'quantity')::numeric = NEW."original_quantity"
  ) THEN
    RAISE EXCEPTION 'la línea % de la capacidad no es la de la factura', NEW."position"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "credit_capacity_line_origin" BEFORE INSERT ON "credit_capacity_line"
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_line_origin();

-- El original de la capacidad no cambia; solo cambian lo reservado y lo aplicado. No se borra.
CREATE FUNCTION credit_capacity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."company_id", NEW."invoice_id", NEW."original_total", NEW."created_at")
    IS DISTINCT FROM (OLD."company_id", OLD."invoice_id", OLD."original_total", OLD."created_at") THEN
    RAISE EXCEPTION 'el original de una capacidad acreditable no cambia'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "credit_capacity_guard" BEFORE UPDATE ON "credit_capacity"
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_guard();
CREATE TRIGGER "credit_capacity_no_delete" BEFORE DELETE ON "credit_capacity"
  FOR EACH ROW EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "credit_capacity_no_truncate" BEFORE TRUNCATE ON "credit_capacity"
  FOR EACH STATEMENT EXECUTE FUNCTION credit_reject_change();

CREATE FUNCTION credit_capacity_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."company_id", NEW."invoice_id", NEW."position", NEW."product_id", NEW."original_quantity")
    IS DISTINCT FROM
     (OLD."company_id", OLD."invoice_id", OLD."position", OLD."product_id", OLD."original_quantity") THEN
    RAISE EXCEPTION 'el original de una línea de la capacidad no cambia'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "credit_capacity_line_guard" BEFORE UPDATE ON "credit_capacity_line"
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_line_guard();
CREATE TRIGGER "credit_capacity_line_no_delete" BEFORE DELETE ON "credit_capacity_line"
  FOR EACH ROW EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "credit_capacity_line_no_truncate" BEFORE TRUNCATE ON "credit_capacity_line"
  FOR EACH STATEMENT EXECUTE FUNCTION credit_reject_change();

-- Una reserva nace RESERVED para una nota de crédito y solo pasa de RESERVED a APPLIED o RELEASED,
-- con su conclusión; lo demás no cambia y nunca se borra ni se reutiliza (design D7). Sirve para la
-- reserva acreditable y para la devolvible.
CREATE FUNCTION credit_reservation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RESERVED' THEN
      RAISE EXCEPTION 'una reserva nace RESERVED' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "electronic_document"
        WHERE "company_id" = NEW."company_id" AND "id" = NEW."credit_note_id" AND "document_type" = '04'
    ) THEN
      RAISE EXCEPTION 'una reserva es de una nota de crédito' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'concluded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'concluded_at') THEN
    RAISE EXCEPTION 'una reserva solo cambia su estado' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'RESERVED' AND NEW."status" IN ('APPLIED', 'RELEASED')) THEN
    RAISE EXCEPTION 'una reserva solo pasa de RESERVED a APPLIED o RELEASED'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = OLD."status" AND NEW."concluded_at" IS DISTINCT FROM OLD."concluded_at" THEN
    RAISE EXCEPTION 'una reserva concluida no cambia' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "credit_reservation_guard" BEFORE INSERT OR UPDATE ON "credit_reservation"
  FOR EACH ROW EXECUTE FUNCTION credit_reservation_guard();
CREATE TRIGGER "credit_reservation_no_delete" BEFORE DELETE ON "credit_reservation"
  FOR EACH ROW EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "credit_reservation_no_truncate" BEFORE TRUNCATE ON "credit_reservation"
  FOR EACH STATEMENT EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "credit_reservation_line_append_only" BEFORE UPDATE OR DELETE ON "credit_reservation_line"
  FOR EACH ROW EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "credit_reservation_line_no_truncate" BEFORE TRUNCATE ON "credit_reservation_line"
  FOR EACH STATEMENT EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "stock_return_reservation_guard" BEFORE INSERT OR UPDATE ON "stock_return_reservation"
  FOR EACH ROW EXECUTE FUNCTION credit_reservation_guard();
CREATE TRIGGER "stock_return_reservation_no_delete" BEFORE DELETE ON "stock_return_reservation"
  FOR EACH ROW EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "stock_return_reservation_no_truncate" BEFORE TRUNCATE ON "stock_return_reservation"
  FOR EACH STATEMENT EXECUTE FUNCTION credit_reject_change();

-- Al confirmar, los totales de la capacidad acreditable son la suma de sus reservas por estado, y
-- cada línea, la suma de las cantidades de sus líneas reservadas por estado (design D7): la
-- capacidad y sus reservas se escriben en la misma transacción o ninguna.
CREATE FUNCTION credit_capacity_totals_check(company TEXT, invoice TEXT) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  reserved numeric;
  applied numeric;
BEGIN
  SELECT COALESCE(sum("amount") FILTER (WHERE "status" = 'RESERVED'), 0),
         COALESCE(sum("amount") FILTER (WHERE "status" = 'APPLIED'), 0)
    INTO reserved, applied
    FROM "credit_reservation" WHERE "company_id" = company AND "invoice_id" = invoice;
  IF EXISTS (
    SELECT 1 FROM "credit_capacity"
      WHERE "company_id" = company AND "invoice_id" = invoice
        AND ("reserved_total" <> reserved OR "applied_total" <> applied)
  ) OR (NOT EXISTS (
    SELECT 1 FROM "credit_capacity" WHERE "company_id" = company AND "invoice_id" = invoice
  ) AND reserved + applied > 0) THEN
    RAISE EXCEPTION 'la capacidad acreditable de la factura % no es la suma de sus reservas', invoice
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION credit_capacity_line_check(company TEXT, invoice TEXT, line INTEGER) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  reserved numeric;
  applied numeric;
BEGIN
  SELECT COALESCE(sum(l."quantity") FILTER (WHERE r."status" = 'RESERVED'), 0),
         COALESCE(sum(l."quantity") FILTER (WHERE r."status" = 'APPLIED'), 0)
    INTO reserved, applied
    FROM "credit_reservation_line" l
    JOIN "credit_reservation" r ON r."id" = l."reservation_id"
    WHERE l."company_id" = company AND l."invoice_id" = invoice AND l."position" = line;
  IF EXISTS (
    SELECT 1 FROM "credit_capacity_line"
      WHERE "company_id" = company AND "invoice_id" = invoice AND "position" = line
        AND ("reserved_quantity" <> reserved OR "applied_quantity" <> applied)
  ) THEN
    RAISE EXCEPTION 'la línea % de la capacidad acreditable no es la suma de sus reservas', line
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION credit_capacity_matches_reservations() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  line INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'credit_capacity_line' OR TG_TABLE_NAME = 'credit_reservation_line' THEN
    PERFORM credit_capacity_line_check(NEW."company_id", NEW."invoice_id", NEW."position");
    RETURN NULL;
  END IF;
  PERFORM credit_capacity_totals_check(NEW."company_id", NEW."invoice_id");
  IF TG_TABLE_NAME = 'credit_reservation' THEN
    FOR line IN SELECT "position" FROM "credit_reservation_line" WHERE "reservation_id" = NEW."id" LOOP
      PERFORM credit_capacity_line_check(NEW."company_id", NEW."invoice_id", line);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "credit_capacity_matches_reservations"
  AFTER INSERT OR UPDATE ON "credit_capacity"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_matches_reservations();
CREATE CONSTRAINT TRIGGER "credit_capacity_line_matches_reservations"
  AFTER INSERT OR UPDATE ON "credit_capacity_line"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_matches_reservations();
CREATE CONSTRAINT TRIGGER "credit_reservation_in_capacity"
  AFTER INSERT OR UPDATE ON "credit_reservation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_matches_reservations();
CREATE CONSTRAINT TRIGGER "credit_reservation_line_in_capacity"
  AFTER INSERT ON "credit_reservation_line"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_capacity_matches_reservations();

-- La capacidad devolvible nace de una factura autorizada con la salida de su SALIDA_FACTURA para
-- ese producto, o cero sin salida (design D10); su original no cambia y no se borra.
CREATE FUNCTION stock_return_capacity_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "electronic_document"
      WHERE "company_id" = NEW."company_id" AND "id" = NEW."invoice_id"
        AND "document_type" = '01' AND "state" = 'AUTHORIZED'
  ) OR NEW."original_quantity" IS DISTINCT FROM COALESCE((
    SELECT abs("delta") FROM "stock_movement"
      WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."invoice_id"
        AND "product_id" = NEW."product_id" AND "movement_type" = 'SALIDA_FACTURA'
  ), 0) THEN
    RAISE EXCEPTION 'la capacidad devolvible nace de la salida de una factura autorizada'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "stock_return_capacity_origin" BEFORE INSERT ON "stock_return_capacity"
  FOR EACH ROW EXECUTE FUNCTION stock_return_capacity_origin();

CREATE FUNCTION stock_return_capacity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."company_id", NEW."invoice_id", NEW."product_id", NEW."original_quantity", NEW."created_at")
    IS DISTINCT FROM
     (OLD."company_id", OLD."invoice_id", OLD."product_id", OLD."original_quantity", OLD."created_at") THEN
    RAISE EXCEPTION 'el original de una capacidad devolvible no cambia'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "stock_return_capacity_guard" BEFORE UPDATE ON "stock_return_capacity"
  FOR EACH ROW EXECUTE FUNCTION stock_return_capacity_guard();
CREATE TRIGGER "stock_return_capacity_no_delete" BEFORE DELETE ON "stock_return_capacity"
  FOR EACH ROW EXECUTE FUNCTION credit_reject_change();
CREATE TRIGGER "stock_return_capacity_no_truncate" BEFORE TRUNCATE ON "stock_return_capacity"
  FOR EACH STATEMENT EXECUTE FUNCTION credit_reject_change();

-- Al confirmar, lo reservado y lo aplicado de la capacidad devolvible son la suma de sus reservas.
CREATE FUNCTION stock_return_capacity_matches_reservations() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  reserved numeric;
  applied numeric;
BEGIN
  SELECT COALESCE(sum("quantity") FILTER (WHERE "status" = 'RESERVED'), 0),
         COALESCE(sum("quantity") FILTER (WHERE "status" = 'APPLIED'), 0)
    INTO reserved, applied
    FROM "stock_return_reservation"
    WHERE "company_id" = NEW."company_id" AND "invoice_id" = NEW."invoice_id"
      AND "product_id" = NEW."product_id";
  IF EXISTS (
    SELECT 1 FROM "stock_return_capacity"
      WHERE "company_id" = NEW."company_id" AND "invoice_id" = NEW."invoice_id"
        AND "product_id" = NEW."product_id"
        AND ("reserved_quantity" <> reserved OR "applied_quantity" <> applied)
  ) THEN
    RAISE EXCEPTION 'la capacidad devolvible del producto % no es la suma de sus reservas', NEW."product_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "stock_return_capacity_matches_reservations"
  AFTER INSERT OR UPDATE ON "stock_return_capacity"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stock_return_capacity_matches_reservations();
CREATE CONSTRAINT TRIGGER "stock_return_reservation_in_capacity"
  AFTER INSERT OR UPDATE ON "stock_return_reservation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stock_return_capacity_matches_reservations();

-- Coherencia atómica de la transición terminal (design D25), al confirmar: una reserva APPLIED exige
-- su nota AUTHORIZED; una RELEASED, su nota RETURNED o NOT_AUTHORIZED; una RESERVED, su nota en un
-- estado no terminal. Y una nota de crédito confirmada tiene su reserva acreditable, y en un estado
-- terminal ninguna reserva RESERVED. Acopla a propósito electronic_document con las reservas para que
-- nunca exista un estado local intermedio (database.md).
CREATE FUNCTION credit_reservation_matches_note() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  note_state TEXT;
BEGIN
  SELECT "state" INTO note_state FROM "electronic_document"
    WHERE "company_id" = NEW."company_id" AND "id" = NEW."credit_note_id";
  IF (NEW."status" = 'APPLIED' AND note_state <> 'AUTHORIZED')
    OR (NEW."status" = 'RELEASED' AND note_state NOT IN ('RETURNED', 'NOT_AUTHORIZED'))
    OR (NEW."status" = 'RESERVED' AND note_state IN ('AUTHORIZED', 'RETURNED', 'NOT_AUTHORIZED')) THEN
    RAISE EXCEPTION 'la reserva % de la nota % no corresponde a su estado %', NEW."status",
      NEW."credit_note_id", note_state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "credit_reservation_matches_note"
  AFTER INSERT OR UPDATE ON "credit_reservation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_reservation_matches_note();
CREATE CONSTRAINT TRIGGER "stock_return_reservation_matches_note"
  AFTER INSERT OR UPDATE ON "stock_return_reservation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_reservation_matches_note();

CREATE FUNCTION credit_note_matches_reservations() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "credit_reservation"
      WHERE "company_id" = NEW."company_id" AND "credit_note_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'la nota de crédito % no tiene su reserva acreditable', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."state" IN ('AUTHORIZED', 'RETURNED', 'NOT_AUTHORIZED') AND (
    EXISTS (
      SELECT 1 FROM "credit_reservation"
        WHERE "company_id" = NEW."company_id" AND "credit_note_id" = NEW."id" AND "status" = 'RESERVED')
    OR EXISTS (
      SELECT 1 FROM "stock_return_reservation"
        WHERE "company_id" = NEW."company_id" AND "credit_note_id" = NEW."id" AND "status" = 'RESERVED')
  ) THEN
    RAISE EXCEPTION 'la nota de crédito % terminó con capacidad reservada', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "credit_note_matches_reservations"
  AFTER INSERT OR UPDATE ON "electronic_document"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."document_type" = '04')
  EXECUTE FUNCTION credit_note_matches_reservations();
