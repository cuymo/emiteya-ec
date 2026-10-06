-- add-shipping-guides (design D10 y D26, P10): un comprobante sin total monetario ni comprador único.
-- La guía de remisión (06) no tiene importe y puede tener varios destinatarios: su total y su
-- comprador son nulos, y sus destinatarios viven en una tabla genérica de `fiscal`. Los demás tipos
-- siguen exigiendo su total y su comprador: el CHECK fija las dos direcciones. Aditiva: las filas
-- existentes son de tipos con total y comprador, y conservan sus valores. Primero el DDL que genera
-- Prisma; después las restricciones y triggers que Prisma no expresa.

-- AlterTable
ALTER TABLE "electronic_document" ALTER COLUMN "buyer_identification" DROP NOT NULL,
ALTER COLUMN "buyer_name" DROP NOT NULL,
ALTER COLUMN "total" DROP NOT NULL;

-- CreateTable
CREATE TABLE "electronic_document_recipient" (
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "identification" VARCHAR(20) NOT NULL,
    "name" VARCHAR(300) NOT NULL,

    CONSTRAINT "electronic_document_recipient_pkey" PRIMARY KEY ("company_id","document_id","position")
);

-- CreateIndex
CREATE INDEX "electronic_document_recipient_company_id_identification_idx" ON "electronic_document_recipient"("company_id", "identification");

-- AddForeignKey
ALTER TABLE "electronic_document_recipient" ADD CONSTRAINT "electronic_document_recipient_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Comprobante (design D10): el total y el comprador son nulos si y solo si el tipo es 06, en las dos
-- direcciones; el dominio `importe` sigue rigiendo cuando el total existe. El resto de la regla no
-- cambia (add-sri-transmission, design D3).
ALTER TABLE "electronic_document" DROP CONSTRAINT "electronic_document_values_check";
ALTER TABLE "electronic_document" ADD CONSTRAINT "electronic_document_values_check" CHECK (
  "document_type" IN ('01', '03', '04', '05', '06', '07')
  AND "environment" IN ('TEST', 'PRODUCTION')
  AND "state" IN ('RESERVED', 'SIGNED', 'SEND_UNKNOWN', 'RECEIVED', 'RETURNED', 'AUTHORIZED',
    'NOT_AUTHORIZED', 'MANUAL_REVIEW')
  AND ("state" = 'RESERVED') = ("signed_at" IS NULL)
  AND "access_key" ~ '^[0-9]{49}$'
  AND "numeric_code" ~ '^[0-9]{8}$'
  AND "document_number" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'
  AND "sequential" BETWEEN 1 AND 999999999
  AND ("document_type" = '06') = ("total" IS NULL)
  AND ("document_type" = '06') = ("buyer_identification" IS NULL)
  AND ("document_type" = '06') = ("buyer_name" IS NULL)
  AND ("total" IS NULL OR ("total" >= 0 AND scale("total") <= 2
    AND "total" < power(10::numeric, 14 - scale("total"))))
  AND "attempt_count" >= 0
  AND ("last_attempt_class" IS NULL OR "last_attempt_class" IN
    ('RETRYABLE_OPERATIONAL', 'DETERMINISTIC_CONFIGURATION', 'DETERMINISTIC_VALIDATION')));

-- Destinatarios (design D10): posición desde 1, identificación de 1 a 20 y nombre de 1 a 300, sin
-- saltos de línea (los tipos del XSD de la guía).
ALTER TABLE "electronic_document_recipient" ADD CONSTRAINT "electronic_document_recipient_values_check" CHECK (
  "position" >= 1
  AND char_length("identification") BETWEEN 1 AND 20
  AND "identification" !~ '[\r\n]'
  AND char_length("name") BETWEEN 1 AND 300
  AND "name" !~ '[\r\n]');

CREATE FUNCTION electronic_document_recipient_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Un destinatario es de un comprobante de la empresa sin comprador único (la FK compuesta fija la
-- empresa); se escribe en la transacción de la reserva y nunca cambia ni se borra.
CREATE FUNCTION electronic_document_recipient_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "electronic_document"
      WHERE "company_id" = NEW."company_id" AND "id" = NEW."document_id"
        AND "buyer_identification" IS NULL
  ) THEN
    RAISE EXCEPTION 'los destinatarios son de un comprobante de la empresa sin comprador único'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "electronic_document_recipient_origin" BEFORE INSERT ON "electronic_document_recipient"
  FOR EACH ROW EXECUTE FUNCTION electronic_document_recipient_origin();
CREATE TRIGGER "electronic_document_recipient_immutable" BEFORE UPDATE OR DELETE ON "electronic_document_recipient"
  FOR EACH ROW EXECUTE FUNCTION electronic_document_recipient_reject_change();
CREATE TRIGGER "electronic_document_recipient_no_truncate" BEFORE TRUNCATE ON "electronic_document_recipient"
  FOR EACH STATEMENT EXECUTE FUNCTION electronic_document_recipient_reject_change();

-- Un comprobante sin comprador no se confirma sin destinatarios, y sus posiciones son contiguas desde
-- 1: el orden estable de design D10. Trigger de restricción diferido; los tipos con comprador no lo
-- disparan.
CREATE FUNCTION electronic_document_recipients_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  counted INTEGER;
  lowest INTEGER;
  highest INTEGER;
BEGIN
  SELECT count(*), min("position"), max("position") INTO counted, lowest, highest
    FROM "electronic_document_recipient"
    WHERE "company_id" = NEW."company_id" AND "document_id" = NEW."id";
  IF counted = 0 THEN
    RAISE EXCEPTION 'el comprobante % no tiene destinatarios', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF lowest <> 1 OR highest <> counted THEN
    RAISE EXCEPTION 'los destinatarios del comprobante % no tienen posiciones contiguas desde 1', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "electronic_document_recipients_complete"
  AFTER INSERT OR UPDATE ON "electronic_document"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."buyer_identification" IS NULL)
  EXECUTE FUNCTION electronic_document_recipients_complete();
