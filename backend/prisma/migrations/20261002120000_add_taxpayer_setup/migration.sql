-- add-taxpayer-setup: configuración tributaria versionada, assets de configuración,
-- establecimientos, puntos de emisión y punto predeterminado por membresía (design D13).

-- CreateTable
CREATE TABLE "company_config" (
    "company_id" TEXT NOT NULL,
    "current_version_id" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL,
    "tax_identity_locked_at" TIMESTAMPTZ(3),
    "locked_ruc" CHAR(13),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_config_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "company_config_version" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "ruc" CHAR(13) NOT NULL,
    "legal_name" VARCHAR(300) NOT NULL,
    "trade_name" VARCHAR(300),
    "head_office_address" VARCHAR(300) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "accounting_required" BOOLEAN NOT NULL,
    "special_taxpayer_number" VARCHAR(13),
    "withholding_agent_resolution" VARCHAR(8),
    "large_taxpayer" BOOLEAN NOT NULL,
    "rimpe_category" TEXT,
    "provider_ruc" CHAR(13),
    "environment" TEXT NOT NULL,
    "logo_asset_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "company_config_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_asset" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "configuration_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishment" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" CHAR(3) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "establishment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emission_point" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "code" CHAR(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emission_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_default_emission_point" (
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emission_point_id" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "member_default_emission_point_pkey" PRIMARY KEY ("company_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_config_version_company_id_version_key" ON "company_config_version"("company_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "company_config_version_company_id_id_key" ON "company_config_version"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_asset_company_id_sha256_key" ON "configuration_asset"("company_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_asset_company_id_id_key" ON "configuration_asset"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "establishment_company_id_code_key" ON "establishment"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "establishment_company_id_id_key" ON "establishment"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "emission_point_establishment_id_code_key" ON "emission_point"("establishment_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "emission_point_company_id_id_key" ON "emission_point"("company_id", "id");

-- CreateIndex
CREATE INDEX "member_default_emission_point_company_id_emission_point_id_idx" ON "member_default_emission_point"("company_id", "emission_point_id");

-- AddForeignKey
ALTER TABLE "company_config" ADD CONSTRAINT "company_config_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_config" ADD CONSTRAINT "company_config_company_id_current_version_id_fkey" FOREIGN KEY ("company_id", "current_version_id") REFERENCES "company_config_version"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_company_id_logo_asset_id_fkey" FOREIGN KEY ("company_id", "logo_asset_id") REFERENCES "configuration_asset"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_asset" ADD CONSTRAINT "configuration_asset_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_asset" ADD CONSTRAINT "configuration_asset_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishment" ADD CONSTRAINT "establishment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emission_point" ADD CONSTRAINT "emission_point_company_id_establishment_id_fkey" FOREIGN KEY ("company_id", "establishment_id") REFERENCES "establishment"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_default_emission_point" ADD CONSTRAINT "member_default_emission_point_company_id_user_id_fkey" FOREIGN KEY ("company_id", "user_id") REFERENCES "member"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_default_emission_point" ADD CONSTRAINT "member_default_emission_point_company_id_emission_point_id_fkey" FOREIGN KEY ("company_id", "emission_point_id") REFERENCES "emission_point"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones propias que Prisma no expresa (add-taxpayer-setup, design D2 a D8 y D13;
-- docs/architecture/database.md). Las funciones fijan su search_path para resolver las tablas del
-- esquema en que se crean, también en los esquemas aislados de las pruebas.

-- Formatos de los XSD oficiales del SRI (design D3) y textos de una línea no vacíos.
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_version_check" CHECK ("version" >= 1);
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_ruc_check" CHECK ("ruc" ~ '^[0-9]{10}001$');
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_provider_ruc_check" CHECK ("provider_ruc" IS NULL OR "provider_ruc" ~ '^[0-9]{10}001$');
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_special_taxpayer_check" CHECK ("special_taxpayer_number" IS NULL OR "special_taxpayer_number" ~ '^[A-Za-z0-9]{3,13}$');
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_withholding_check" CHECK ("withholding_agent_resolution" IS NULL OR "withholding_agent_resolution" ~ '^[0-9]{1,8}$');
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_environment_check" CHECK ("environment" IN ('TEST', 'PRODUCTION'));
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_rimpe_check" CHECK ("rimpe_category" IS NULL OR "rimpe_category" IN ('EMPRENDEDOR', 'NEGOCIO_POPULAR'));
ALTER TABLE "company_config_version" ADD CONSTRAINT "company_config_version_texts_check" CHECK (
  "legal_name" <> '' AND "legal_name" !~ '[\r\n]'
  AND "head_office_address" <> '' AND "head_office_address" !~ '[\r\n]'
  AND ("trade_name" IS NULL OR ("trade_name" <> '' AND "trade_name" !~ '[\r\n]'))
);

-- Identidad tributaria (design D4): fecha y RUC bloqueados van juntos.
ALTER TABLE "company_config" ADD CONSTRAINT "company_config_current_version_check" CHECK ("current_version" >= 1);
ALTER TABLE "company_config" ADD CONSTRAINT "company_config_tax_identity_lock_check" CHECK (("tax_identity_locked_at" IS NULL) = ("locked_ruc" IS NULL));

-- Assets de configuración (ADR 0017, design D5).
ALTER TABLE "configuration_asset" ADD CONSTRAINT "configuration_asset_kind_check" CHECK ("kind" IN ('LOGO'));
ALTER TABLE "configuration_asset" ADD CONSTRAINT "configuration_asset_mime_type_check" CHECK ("mime_type" IN ('image/png', 'image/jpeg'));
ALTER TABLE "configuration_asset" ADD CONSTRAINT "configuration_asset_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" = octet_length("content"));
ALTER TABLE "configuration_asset" ADD CONSTRAINT "configuration_asset_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Establecimientos y puntos de emisión (design D7): códigos de tres dígitos (XSD estab y ptoEmi).
ALTER TABLE "establishment" ADD CONSTRAINT "establishment_code_check" CHECK ("code" ~ '^[0-9]{3}$');
ALTER TABLE "establishment" ADD CONSTRAINT "establishment_address_check" CHECK ("address" <> '' AND "address" !~ '[\r\n]');
ALTER TABLE "emission_point" ADD CONSTRAINT "emission_point_code_check" CHECK ("code" ~ '^[0-9]{3}$');

-- Versiones y assets de solo agregado: rechazan UPDATE, DELETE y TRUNCATE (design D2 y D5).
CREATE FUNCTION "taxpayer_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es de solo agregado: % no está permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "company_config_version_append_only"
  BEFORE UPDATE OR DELETE ON "company_config_version"
  FOR EACH ROW EXECUTE FUNCTION "taxpayer_reject_change"();
CREATE TRIGGER "company_config_version_no_truncate"
  BEFORE TRUNCATE ON "company_config_version"
  FOR EACH STATEMENT EXECUTE FUNCTION "taxpayer_reject_change"();
CREATE TRIGGER "configuration_asset_append_only"
  BEFORE UPDATE OR DELETE ON "configuration_asset"
  FOR EACH ROW EXECUTE FUNCTION "taxpayer_reject_change"();
CREATE TRIGGER "configuration_asset_no_truncate"
  BEFORE TRUNCATE ON "configuration_asset"
  FOR EACH STATEMENT EXECUTE FUNCTION "taxpayer_reject_change"();

-- La cabecera de la configuración no se borra.
CREATE TRIGGER "company_config_no_delete"
  BEFORE DELETE ON "company_config"
  FOR EACH ROW EXECUTE FUNCTION "taxpayer_reject_change"();
CREATE TRIGGER "company_config_no_truncate"
  BEFORE TRUNCATE ON "company_config"
  FOR EACH STATEMENT EXECUTE FUNCTION "taxpayer_reject_change"();

-- RUC bloqueado (design D4): ninguna versión nueva cambia el RUC de una identidad bloqueada.
CREATE FUNCTION "company_config_version_guard_locked_ruc"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  locked CHAR(13);
BEGIN
  SELECT "locked_ruc" INTO locked FROM "company_config" WHERE "company_id" = NEW."company_id";
  IF locked IS NOT NULL AND NEW."ruc" <> locked THEN
    RAISE EXCEPTION 'TAX_IDENTITY_LOCKED: el RUC de la empresa está bloqueado'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "company_config_version_locked_ruc"
  BEFORE INSERT ON "company_config_version"
  FOR EACH ROW EXECUTE FUNCTION "company_config_version_guard_locked_ruc"();

-- El bloqueo es permanente, fija el RUC de la versión vigente y la empresa no cambia.
CREATE FUNCTION "company_config_guard_lock"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  current_ruc CHAR(13);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."company_id" <> OLD."company_id" THEN
    RAISE EXCEPTION 'company_config: la empresa no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."tax_identity_locked_at" IS NOT NULL
     AND (NEW."tax_identity_locked_at" IS DISTINCT FROM OLD."tax_identity_locked_at"
          OR NEW."locked_ruc" IS DISTINCT FROM OLD."locked_ruc") THEN
    RAISE EXCEPTION 'TAX_IDENTITY_LOCKED: la identidad tributaria no se desbloquea'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."locked_ruc" IS NOT NULL THEN
    SELECT "ruc" INTO current_ruc FROM "company_config_version" WHERE "id" = NEW."current_version_id";
    IF current_ruc IS DISTINCT FROM NEW."locked_ruc" THEN
      RAISE EXCEPTION 'TAX_IDENTITY_LOCKED: el RUC bloqueado debe ser el de la versión vigente'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "company_config_lock"
  BEFORE INSERT OR UPDATE ON "company_config"
  FOR EACH ROW EXECUTE FUNCTION "company_config_guard_lock"();

-- Códigos y pertenencia inmutables tras el alta (design D7).
CREATE FUNCTION "establishment_guard_identity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" <> OLD."code" OR NEW."company_id" <> OLD."company_id" THEN
    RAISE EXCEPTION 'establishment: el código y la empresa no cambian' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "establishment_identity"
  BEFORE UPDATE ON "establishment"
  FOR EACH ROW EXECUTE FUNCTION "establishment_guard_identity"();

CREATE FUNCTION "emission_point_guard_identity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" <> OLD."code" OR NEW."company_id" <> OLD."company_id"
     OR NEW."establishment_id" <> OLD."establishment_id" THEN
    RAISE EXCEPTION 'emission_point: el código, la empresa y el establecimiento no cambian'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "emission_point_identity"
  BEFORE UPDATE ON "emission_point"
  FOR EACH ROW EXECUTE FUNCTION "emission_point_guard_identity"();
