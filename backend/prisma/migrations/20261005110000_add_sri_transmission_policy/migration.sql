-- Política de tamaño del envío al SRI (add-sri-transmission, design D17, Q-47): datos normativos
-- versionados del sistema, con el mismo patrón que consumer_final_policy.

-- CreateTable
CREATE TABLE "sri_transmission_policy" (
    "id" TEXT NOT NULL,
    "max_signed_document_bytes" INTEGER NOT NULL,
    "source_text" TEXT NOT NULL,
    "source_section" TEXT NOT NULL,
    "literal_unit" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_from_basis" TEXT NOT NULL,
    "effective_to" DATE,
    "dataset_version" INTEGER NOT NULL,
    "closed_in_dataset_version" INTEGER,

    CONSTRAINT "sri_transmission_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sri_transmission_policy_effective_from_key" ON "sri_transmission_policy"("effective_from");

-- El dataset nuevo es un tipo admitido del registro de datasets aplicados.
ALTER TABLE "fiscal_catalog_dataset" DROP CONSTRAINT "fiscal_catalog_dataset_catalog_type_check";
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_catalog_type_check" CHECK ("catalog_type" IN (
  'identification-type', 'tax', 'iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method',
  'consumer-final-policy', 'schema-registry', 'special-case-matrix', 'sri-transmission-policy'));

ALTER TABLE "sri_transmission_policy" ADD CONSTRAINT "sri_transmission_policy_values_check" CHECK (
  "max_signed_document_bytes" > 0
  AND btrim("source_text") <> '' AND btrim("source_section") <> ''
  AND btrim("literal_unit") <> '' AND btrim("interpretation") <> ''
  AND "effective_from_basis" IN ('SOURCE_STATED', 'PROJECT_BASELINE')
  AND ("effective_to" IS NULL OR "effective_to" >= "effective_from"));

-- Nada se borra ni se trunca; una versión publicada solo cierra su vigencia abierta.
CREATE TRIGGER "sri_transmission_policy_no_delete" BEFORE DELETE ON "sri_transmission_policy"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "sri_transmission_policy_no_truncate" BEFORE TRUNCATE ON "sri_transmission_policy"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_catalog_reject_change"();

CREATE FUNCTION "sri_transmission_policy_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  movable TEXT[] := ARRAY['effective_to', 'closed_in_dataset_version'];
BEGIN
  IF (to_jsonb(NEW) - movable) <> (to_jsonb(OLD) - movable)
     OR NOT (OLD."effective_to" IS NULL AND NEW."effective_to" IS NOT NULL
             AND OLD."closed_in_dataset_version" IS NULL AND NEW."closed_in_dataset_version" IS NOT NULL) THEN
    RAISE EXCEPTION 'sri_transmission_policy: solo se cierra una vigencia abierta'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sri_transmission_policy_guard" BEFORE UPDATE ON "sri_transmission_policy"
  FOR EACH ROW EXECUTE FUNCTION "sri_transmission_policy_guard"();

-- Las versiones no se superponen (fechas inclusivas, sin fin = abierta).
CREATE FUNCTION "sri_transmission_policy_no_overlap"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "sri_transmission_policy"
    WHERE "id" <> NEW."id"
      AND daterange("effective_from", "effective_to", '[]')
          && daterange(NEW."effective_from", NEW."effective_to", '[]')
  ) THEN
    RAISE EXCEPTION 'sri_transmission_policy: versiones superpuestas'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sri_transmission_policy_no_overlap" BEFORE INSERT OR UPDATE ON "sri_transmission_policy"
  FOR EACH ROW EXECUTE FUNCTION "sri_transmission_policy_no_overlap"();
