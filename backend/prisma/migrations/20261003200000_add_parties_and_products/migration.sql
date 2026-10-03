-- Terceros, productos y referencias fiscales de los productos (add-parties-and-products, design D3
-- a D7, D14 y D15). La parte generada por Prisma va primero; los CHECK y los triggers, que Prisma no
-- expresa, después. Las claves de búsqueda por prefijo usan la colación C, para que su índice btree
-- sirva a LIKE 'prefijo%' con cualquier colación de la base (design D10); Prisma no conserva
-- text_pattern_ops en un índice btree. El consumidor final obligatorio por empresa llega en la migración siguiente,
-- junto con su creación al aprovisionar y su reposición al arrancar.

-- CreateTable
CREATE TABLE "party" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "identification_type" CHAR(2) NOT NULL,
    "identification" VARCHAR(20) NOT NULL,
    "legal_name" VARCHAR(300) NOT NULL,
    "address" VARCHAR(300),
    "email" VARCHAR(300),
    "phone" VARCHAR(50),
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "system_record" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "search_name" TEXT NOT NULL,
    "search_identification" TEXT COLLATE "C" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "main_code" VARCHAR(25),
    "auxiliary_code" VARCHAR(25),
    "name" VARCHAR(300) NOT NULL,
    "description" VARCHAR(1000),
    "unit_price" DECIMAL(18,6) NOT NULL,
    "stock_tracked" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "search_name" TEXT NOT NULL,
    "search_main_code" TEXT COLLATE "C",
    "search_auxiliary_code" TEXT COLLATE "C",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tax" (
    "product_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "catalog_type" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,

    CONSTRAINT "product_tax_pkey" PRIMARY KEY ("product_id","catalog_type")
);

-- CreateIndex
CREATE INDEX "party_company_id_search_identification_idx" ON "party"("company_id", "search_identification");

-- CreateIndex
CREATE INDEX "party_company_id_status_search_name_id_idx" ON "party"("company_id", "status", "search_name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "party_company_id_identification_type_identification_key" ON "party"("company_id", "identification_type", "identification");

-- CreateIndex
CREATE INDEX "product_company_id_search_main_code_idx" ON "product"("company_id", "search_main_code");

-- CreateIndex
CREATE INDEX "product_company_id_search_auxiliary_code_idx" ON "product"("company_id", "search_auxiliary_code");

-- CreateIndex
CREATE INDEX "product_company_id_status_search_name_id_idx" ON "product"("company_id", "status", "search_name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_company_id_main_code_key" ON "product"("company_id", "main_code");

-- CreateIndex
CREATE UNIQUE INDEX "product_company_id_id_key" ON "product"("company_id", "id");

-- CreateIndex
CREATE INDEX "product_tax_company_id_catalog_type_entry_key_idx" ON "product_tax"("company_id", "catalog_type", "entry_key");

-- AddForeignKey
ALTER TABLE "party" ADD CONSTRAINT "party_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party" ADD CONSTRAINT "party_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party" ADD CONSTRAINT "party_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tax" ADD CONSTRAINT "product_tax_company_id_product_id_fkey" FOREIGN KEY ("company_id", "product_id") REFERENCES "product"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tax" ADD CONSTRAINT "product_tax_catalog_type_entry_key_fkey" FOREIGN KEY ("catalog_type", "entry_key") REFERENCES "fiscal_catalog_key"("catalog_type", "entry_key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Terceros (design D3 a D5).
ALTER TABLE "party" ADD CONSTRAINT "party_identification_check" CHECK (
  "identification_type" ~ '^[0-9]{2}$'
  AND "identification" <> '' AND "identification" !~ '[\r\n]'
);
ALTER TABLE "party" ADD CONSTRAINT "party_text_check" CHECK (
  "legal_name" <> '' AND "legal_name" !~ '[\r\n]'
  AND ("address" IS NULL OR ("address" <> '' AND "address" !~ '[\r\n]'))
  AND ("email" IS NULL OR ("email" <> '' AND "email" !~ '[\r\n]'))
  AND ("phone" IS NULL OR ("phone" <> '' AND "phone" !~ '[\r\n]'))
);
ALTER TABLE "party" ADD CONSTRAINT "party_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE "party" ADD CONSTRAINT "party_roles_check" CHECK (
  "roles" IS NOT NULL AND "roles" <@ ARRAY['CUSTOMER', 'SUPPLIER', 'CARRIER']::TEXT[]
);
ALTER TABLE "party" ADD CONSTRAINT "party_version_check" CHECK ("version" >= 1);
-- Un tercero normal nunca usa el 07; el registro del sistema es exactamente el consumidor final,
-- activo, cliente y sin autor. Con la unicidad por empresa, tipo e identificación, como mucho hay
-- uno por empresa.
ALTER TABLE "party" ADD CONSTRAINT "party_system_record_check" CHECK (
  ("system_record" IS NULL AND "identification_type" <> '07' AND "created_by" IS NOT NULL)
  OR (
    "system_record" = 'CONSUMER_FINAL'
    AND "identification_type" = '07'
    AND "identification" = '9999999999999'
    AND "status" = 'ACTIVE'
    AND "roles" = ARRAY['CUSTOMER']::TEXT[]
    AND "created_by" IS NULL
    AND "updated_by" IS NULL
  )
);

-- El consumidor final es inmutable: ni se corrige, ni se desactiva, ni se borra, y ningún tercero
-- cambia su marca de registro del sistema.
CREATE FUNCTION party_system_record_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."system_record" IS NOT NULL THEN
    RAISE EXCEPTION 'el consumidor final es un registro del sistema y no se modifica (%)', TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."system_record" IS DISTINCT FROM OLD."system_record" THEN
    RAISE EXCEPTION 'un tercero no cambia su marca de registro del sistema'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "party_system_record_guard" BEFORE UPDATE OR DELETE ON "party"
  FOR EACH ROW EXECUTE FUNCTION party_system_record_guard();
CREATE FUNCTION party_reject_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'los terceros no se truncan' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "party_no_truncate" BEFORE TRUNCATE ON "party"
  FOR EACH STATEMENT EXECUTE FUNCTION party_reject_truncate();

-- Productos (design D6 y D9).
ALTER TABLE "product" ADD CONSTRAINT "product_kind_check" CHECK ("kind" IN ('GOOD', 'SERVICE'));
ALTER TABLE "product" ADD CONSTRAINT "product_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE "product" ADD CONSTRAINT "product_text_check" CHECK (
  "name" <> '' AND "name" !~ '[\r\n]'
  AND ("main_code" IS NULL OR ("main_code" <> '' AND "main_code" !~ '[\r\n]'))
  AND ("auxiliary_code" IS NULL OR ("auxiliary_code" <> '' AND "auxiliary_code" !~ '[\r\n]'))
  AND ("description" IS NULL OR "description" <> '')
);
ALTER TABLE "product" ADD CONSTRAINT "product_unit_price_check" CHECK ("unit_price" >= 0);
ALTER TABLE "product" ADD CONSTRAINT "product_stock_tracked_check" CHECK (
  NOT "stock_tracked" OR "kind" = 'GOOD'
);
ALTER TABLE "product" ADD CONSTRAINT "product_version_check" CHECK ("version" >= 1);

-- Referencias fiscales de los productos (design D7).
ALTER TABLE "product_tax" ADD CONSTRAINT "product_tax_catalog_type_check" CHECK (
  "catalog_type" IN ('iva-rate', 'ice-rate', 'irbpnr-rate')
);

-- Al confirmar, cada producto tiene exactamente un IVA y, si es un servicio, ningún IRBPNR.
-- Diferido para que el resultado no dependa del orden de las sentencias de la transacción.
CREATE FUNCTION product_check_invariants(p_product_id TEXT) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  p_kind TEXT;
BEGIN
  SELECT "kind" INTO p_kind FROM "product" WHERE "id" = p_product_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "product_tax" WHERE "product_id" = p_product_id AND "catalog_type" = 'iva-rate'
  ) THEN
    RAISE EXCEPTION 'el producto % no tiene IVA', p_product_id USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind <> 'GOOD' AND EXISTS (
    SELECT 1 FROM "product_tax" WHERE "product_id" = p_product_id AND "catalog_type" = 'irbpnr-rate'
  ) THEN
    RAISE EXCEPTION 'el servicio % no admite IRBPNR', p_product_id USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
CREATE FUNCTION product_invariants_on_product() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM product_check_invariants(NEW."id");
  RETURN NULL;
END;
$$;
CREATE FUNCTION product_invariants_on_tax() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM product_check_invariants(OLD."product_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM product_check_invariants(NEW."product_id");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_invariants" AFTER INSERT OR UPDATE ON "product"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION product_invariants_on_product();
CREATE CONSTRAINT TRIGGER "product_tax_invariants" AFTER INSERT OR UPDATE OR DELETE ON "product_tax"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION product_invariants_on_tax();
