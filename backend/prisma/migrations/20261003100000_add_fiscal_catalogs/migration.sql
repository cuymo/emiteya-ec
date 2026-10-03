-- add-fiscal-catalogs (design D3, D4, D8, D9 y D14; ADR 0020): catálogos fiscales oficiales como
-- datos del sistema, versionados y sin borrado, y la habilitación por empresa.

-- CreateTable
CREATE TABLE "fiscal_catalog_dataset" (
    "catalog_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source_document" TEXT NOT NULL,
    "source_version" TEXT NOT NULL,
    "source_published_on" DATE NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_sha256" CHAR(64) NOT NULL,
    "enablement_policy" TEXT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "loaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_catalog_dataset_pkey" PRIMARY KEY ("catalog_type","version")
);

-- CreateTable
CREATE TABLE "fiscal_catalog_key" (
    "catalog_type" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "fiscal_catalog_key_pkey" PRIMARY KEY ("catalog_type","entry_key")
);

-- CreateTable
CREATE TABLE "fiscal_catalog_entry" (
    "id" TEXT NOT NULL,
    "catalog_type" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "official_label" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_from_basis" TEXT NOT NULL,
    "effective_to" DATE,
    "normative_status" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "dataset_version" INTEGER NOT NULL,
    "closed_in_dataset_version" INTEGER,
    "status_changed_in_dataset_version" INTEGER,
    "tax_kind" TEXT,
    "sri_tax_code" TEXT,
    "rate_kind" TEXT,
    "percentage" DECIMAL(4,2),
    "identification_pattern" TEXT,
    "identification_rule" TEXT,
    "reserved_for" TEXT,

    CONSTRAINT "fiscal_catalog_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_final_policy" (
    "id" TEXT NOT NULL,
    "max_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "identification_type" TEXT NOT NULL,
    "identification" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_from_basis" TEXT NOT NULL,
    "effective_to" DATE,
    "source_ref" TEXT NOT NULL,
    "dataset_version" INTEGER NOT NULL,
    "closed_in_dataset_version" INTEGER,

    CONSTRAINT "consumer_final_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schema_registry_entry" (
    "document_type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dataset_version" INTEGER NOT NULL,
    "root" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "source" TEXT NOT NULL,
    "downloaded_at" TIMESTAMPTZ(3) NOT NULL,
    "supported" BOOLEAN NOT NULL,

    CONSTRAINT "schema_registry_entry_pkey" PRIMARY KEY ("document_type","version","dataset_version")
);

-- CreateTable
CREATE TABLE "special_case_support" (
    "annex" INTEGER NOT NULL,
    "dataset_version" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,

    CONSTRAINT "special_case_support_pkey" PRIMARY KEY ("annex","dataset_version")
);

-- CreateTable
CREATE TABLE "company_fiscal_catalog_setting" (
    "company_id" TEXT NOT NULL,
    "catalog_type" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "company_fiscal_catalog_setting_pkey" PRIMARY KEY ("company_id","catalog_type","entry_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_catalog_entry_catalog_type_entry_key_effective_from_key" ON "fiscal_catalog_entry"("catalog_type", "entry_key", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_final_policy_effective_from_key" ON "consumer_final_policy"("effective_from");

-- AddForeignKey
ALTER TABLE "fiscal_catalog_entry" ADD CONSTRAINT "fiscal_catalog_entry_catalog_type_entry_key_fkey" FOREIGN KEY ("catalog_type", "entry_key") REFERENCES "fiscal_catalog_key"("catalog_type", "entry_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_catalog_entry" ADD CONSTRAINT "fiscal_catalog_entry_catalog_type_dataset_version_fkey" FOREIGN KEY ("catalog_type", "dataset_version") REFERENCES "fiscal_catalog_dataset"("catalog_type", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_fiscal_catalog_setting" ADD CONSTRAINT "company_fiscal_catalog_setting_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_fiscal_catalog_setting" ADD CONSTRAINT "company_fiscal_catalog_setting_catalog_type_entry_key_fkey" FOREIGN KEY ("catalog_type", "entry_key") REFERENCES "fiscal_catalog_key"("catalog_type", "entry_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_fiscal_catalog_setting" ADD CONSTRAINT "company_fiscal_catalog_setting_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones propias que Prisma no expresa (add-fiscal-catalogs, design D4, D8, D9 y D14).
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_catalog_type_check" CHECK ("catalog_type" IN (
  'identification-type', 'tax', 'iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method',
  'consumer-final-policy', 'schema-registry', 'special-case-matrix'));
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_version_check" CHECK ("version" >= 1);
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_hashes_check" CHECK (
  "checksum" ~ '^[0-9a-f]{64}$' AND "source_sha256" ~ '^[0-9a-f]{64}$');
-- Solo IVA, ICE, IRBPNR y formas de pago admiten habilitación por empresa (design D9).
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_enablement_policy_check" CHECK (
  ("catalog_type" IN ('iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method')
   AND "enablement_policy" IN ('DEFAULT_ENABLED', 'DEFAULT_DISABLED'))
  OR ("catalog_type" NOT IN ('iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method')
   AND "enablement_policy" = 'NOT_ENABLEABLE'));

ALTER TABLE "fiscal_catalog_key" ADD CONSTRAINT "fiscal_catalog_key_catalog_type_check" CHECK ("catalog_type" IN (
  'identification-type', 'tax', 'iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method'));
-- entryKey es la identidad interna; code es el código fiscal (codigoPorcentaje: 1 a 4 dígitos).
ALTER TABLE "fiscal_catalog_key" ADD CONSTRAINT "fiscal_catalog_key_entry_key_check" CHECK ("entry_key" ~ '^[0-9A-Z][0-9A-Z-]{0,63}$');
ALTER TABLE "fiscal_catalog_key" ADD CONSTRAINT "fiscal_catalog_key_code_check" CHECK ("code" ~ '^[0-9]{1,4}$');

ALTER TABLE "fiscal_catalog_entry" ADD CONSTRAINT "fiscal_catalog_entry_basis_check" CHECK ("effective_from_basis" IN ('SOURCE_STATED', 'PROJECT_BASELINE'));
ALTER TABLE "fiscal_catalog_entry" ADD CONSTRAINT "fiscal_catalog_entry_status_check" CHECK (
  "normative_status" IN ('OFFICIAL', 'OFFICIAL_REFERENCE', 'WITHDRAWN')
  AND ("normative_status" <> 'WITHDRAWN' OR "effective_to" IS NOT NULL));
ALTER TABLE "fiscal_catalog_entry" ADD CONSTRAINT "fiscal_catalog_entry_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
-- Columnas tipadas por catálogo (design D8): el porcentaje existe solo en tarifas PERCENTAGE de IVA.
ALTER TABLE "fiscal_catalog_entry" ADD CONSTRAINT "fiscal_catalog_entry_attributes_check" CHECK (
  CASE "catalog_type"
    WHEN 'iva-rate' THEN "tax_kind" = 'IVA' AND "sri_tax_code" = '2'
      AND "rate_kind" IN ('PERCENTAGE', 'NOT_SUBJECT', 'EXEMPT', 'DIFFERENTIATED')
      AND ("percentage" IS NOT NULL) = ("rate_kind" = 'PERCENTAGE')
      AND ("percentage" IS NULL OR "percentage" BETWEEN 0 AND 100)
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'ice-rate' THEN "tax_kind" = 'ICE' AND "sri_tax_code" = '3' AND "rate_kind" = 'PER_NORMATIVE'
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'irbpnr-rate' THEN "tax_kind" = 'IRBPNR' AND "sri_tax_code" = '5' AND "rate_kind" = 'PER_UNIT'
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'tax' THEN "tax_kind" IN ('IVA', 'ICE', 'IRBPNR') AND "sri_tax_code" IS NULL
      AND "rate_kind" IS NULL AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'identification-type' THEN "identification_rule" IS NOT NULL
      AND ("reserved_for" IS NULL OR "reserved_for" = 'CONSUMER_FINAL')
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL AND "percentage" IS NULL
    WHEN 'payment-method' THEN "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    ELSE FALSE
  END);

ALTER TABLE "consumer_final_policy" ADD CONSTRAINT "consumer_final_policy_values_check" CHECK (
  "max_amount" >= 0 AND "currency" = 'USD' AND "identification_type" = '07'
  AND "identification" = '9999999999999' AND "canonical_name" <> '');
ALTER TABLE "consumer_final_policy" ADD CONSTRAINT "consumer_final_policy_basis_check" CHECK ("effective_from_basis" IN ('SOURCE_STATED', 'PROJECT_BASELINE'));
ALTER TABLE "consumer_final_policy" ADD CONSTRAINT "consumer_final_policy_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

ALTER TABLE "schema_registry_entry" ADD CONSTRAINT "schema_registry_entry_values_check" CHECK (
  "document_type" IN ('01', '03', '04', '05', '06', '07') AND "sha256" ~ '^[0-9a-f]{64}$'
  AND "version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$');

ALTER TABLE "special_case_support" ADD CONSTRAINT "special_case_support_values_check" CHECK (
  "annex" >= 1 AND "category" IN ('CORE', 'CONDITIONAL_ISSUER_RULE', 'CONDITIONAL_GO_LIVE', 'NOT_APPLICABLE', 'OUT_OF_MVP'));

ALTER TABLE "company_fiscal_catalog_setting" ADD CONSTRAINT "company_fiscal_catalog_setting_catalog_type_check" CHECK (
  "catalog_type" IN ('iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method'));

-- Operaciones no permitidas sobre los datos normativos del sistema.
CREATE FUNCTION "fiscal_catalog_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Nada del sistema se borra ni se trunca; datasets, claves, registro y matriz tampoco se actualizan.
CREATE TRIGGER "fiscal_catalog_dataset_immutable" BEFORE UPDATE OR DELETE ON "fiscal_catalog_dataset"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "fiscal_catalog_dataset_no_truncate" BEFORE TRUNCATE ON "fiscal_catalog_dataset"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "fiscal_catalog_key_immutable" BEFORE UPDATE OR DELETE ON "fiscal_catalog_key"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "fiscal_catalog_key_no_truncate" BEFORE TRUNCATE ON "fiscal_catalog_key"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "fiscal_catalog_entry_no_delete" BEFORE DELETE ON "fiscal_catalog_entry"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "fiscal_catalog_entry_no_truncate" BEFORE TRUNCATE ON "fiscal_catalog_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "consumer_final_policy_no_delete" BEFORE DELETE ON "consumer_final_policy"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "consumer_final_policy_no_truncate" BEFORE TRUNCATE ON "consumer_final_policy"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "schema_registry_entry_immutable" BEFORE UPDATE OR DELETE ON "schema_registry_entry"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "schema_registry_entry_no_truncate" BEFORE TRUNCATE ON "schema_registry_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "special_case_support_immutable" BEFORE UPDATE OR DELETE ON "special_case_support"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_reject_change"();
CREATE TRIGGER "special_case_support_no_truncate" BEFORE TRUNCATE ON "special_case_support"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_catalog_reject_change"();

-- Transiciones permitidas de una versión publicada (design D4): cerrar una vigencia abierta o
-- retirarla, registrando la versión del dataset que lo hizo. Nada más cambia.
CREATE FUNCTION "fiscal_catalog_entry_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  movable TEXT[] := ARRAY['effective_to', 'closed_in_dataset_version', 'normative_status',
    'status_changed_in_dataset_version'];
BEGIN
  IF (to_jsonb(NEW) - movable) <> (to_jsonb(OLD) - movable) THEN
    RAISE EXCEPTION 'fiscal_catalog_entry: una versión publicada no cambia sus datos'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."effective_to" IS DISTINCT FROM OLD."effective_to" AND NOT (
    OLD."effective_to" IS NULL AND NEW."effective_to" IS NOT NULL
    AND OLD."closed_in_dataset_version" IS NULL AND NEW."closed_in_dataset_version" IS NOT NULL) THEN
    RAISE EXCEPTION 'fiscal_catalog_entry: solo se cierra una vigencia abierta'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."effective_to" IS NOT DISTINCT FROM OLD."effective_to"
     AND NEW."closed_in_dataset_version" IS DISTINCT FROM OLD."closed_in_dataset_version" THEN
    RAISE EXCEPTION 'fiscal_catalog_entry: el cierre registra su vigencia'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."normative_status" IS DISTINCT FROM OLD."normative_status" AND NOT (
    OLD."normative_status" IN ('OFFICIAL', 'OFFICIAL_REFERENCE') AND NEW."normative_status" = 'WITHDRAWN'
    AND OLD."status_changed_in_dataset_version" IS NULL
    AND NEW."status_changed_in_dataset_version" IS NOT NULL) THEN
    RAISE EXCEPTION 'fiscal_catalog_entry: solo se retira una entrada vigente'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."normative_status" IS NOT DISTINCT FROM OLD."normative_status"
     AND NEW."status_changed_in_dataset_version" IS DISTINCT FROM OLD."status_changed_in_dataset_version" THEN
    RAISE EXCEPTION 'fiscal_catalog_entry: el retiro registra su estado'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fiscal_catalog_entry_guard" BEFORE UPDATE ON "fiscal_catalog_entry"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_entry_guard"();

CREATE FUNCTION "consumer_final_policy_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  movable TEXT[] := ARRAY['effective_to', 'closed_in_dataset_version'];
BEGIN
  IF (to_jsonb(NEW) - movable) <> (to_jsonb(OLD) - movable)
     OR NOT (OLD."effective_to" IS NULL AND NEW."effective_to" IS NOT NULL
             AND OLD."closed_in_dataset_version" IS NULL AND NEW."closed_in_dataset_version" IS NOT NULL) THEN
    RAISE EXCEPTION 'consumer_final_policy: solo se cierra una vigencia abierta'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "consumer_final_policy_guard" BEFORE UPDATE ON "consumer_final_policy"
  FOR EACH ROW EXECUTE FUNCTION "consumer_final_policy_guard"();

-- Las versiones de una entrada no se superponen (fechas inclusivas, sin fin = abierta).
CREATE FUNCTION "fiscal_catalog_entry_no_overlap"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "fiscal_catalog_entry"
    WHERE "catalog_type" = NEW."catalog_type" AND "entry_key" = NEW."entry_key" AND "id" <> NEW."id"
      AND daterange("effective_from", "effective_to", '[]')
          && daterange(NEW."effective_from", NEW."effective_to", '[]')
  ) THEN
    RAISE EXCEPTION 'fiscal_catalog_entry: versiones superpuestas de %/%', NEW."catalog_type", NEW."entry_key"
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fiscal_catalog_entry_no_overlap" BEFORE INSERT OR UPDATE ON "fiscal_catalog_entry"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_catalog_entry_no_overlap"();

CREATE FUNCTION "consumer_final_policy_no_overlap"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "consumer_final_policy"
    WHERE "id" <> NEW."id"
      AND daterange("effective_from", "effective_to", '[]')
          && daterange(NEW."effective_from", NEW."effective_to", '[]')
  ) THEN
    RAISE EXCEPTION 'consumer_final_policy: versiones superpuestas'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "consumer_final_policy_no_overlap" BEFORE INSERT OR UPDATE ON "consumer_final_policy"
  FOR EACH ROW EXECUTE FUNCTION "consumer_final_policy_no_overlap"();
