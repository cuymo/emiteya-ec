-- add-signing-certificate (design D2; ADR 0011): metadatos de la firma, su secreto cifrado
-- aparte y la anticipación del aviso por empresa.

-- CreateTable
CREATE TABLE "signing_certificate" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "active_company_id" TEXT,
    "subject" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "fingerprint_sha256" CHAR(64) NOT NULL,
    "not_before" TIMESTAMPTZ(3) NOT NULL,
    "not_after" TIMESTAMPTZ(3) NOT NULL,
    "detected_ruc" CHAR(13) NOT NULL,
    "key_algorithm" TEXT NOT NULL,
    "key_bits" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_at" TIMESTAMPTZ(3),
    "replaced_by_id" TEXT,

    CONSTRAINT "signing_certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_certificate_secret" (
    "certificate_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "format_version" SMALLINT NOT NULL,
    "key_version" TEXT NOT NULL,
    "key_check" BYTEA NOT NULL,
    "wrapped_key" BYTEA NOT NULL,
    "wrapped_key_nonce" BYTEA NOT NULL,
    "p12_ciphertext" BYTEA NOT NULL,
    "p12_nonce" BYTEA NOT NULL,
    "password_ciphertext" BYTEA NOT NULL,
    "password_nonce" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signing_certificate_secret_pkey" PRIMARY KEY ("certificate_id")
);

-- CreateTable
CREATE TABLE "signing_certificate_settings" (
    "company_id" TEXT NOT NULL,
    "expiry_alert_days" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "signing_certificate_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signing_certificate_active_company_id_key" ON "signing_certificate"("active_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "signing_certificate_company_id_id_key" ON "signing_certificate"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "signing_certificate_secret_company_id_certificate_id_key" ON "signing_certificate_secret"("company_id", "certificate_id");

-- AddForeignKey
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_company_id_replaced_by_id_fkey" FOREIGN KEY ("company_id", "replaced_by_id") REFERENCES "signing_certificate"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_certificate_secret" ADD CONSTRAINT "signing_certificate_secret_company_id_certificate_id_fkey" FOREIGN KEY ("company_id", "certificate_id") REFERENCES "signing_certificate"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_certificate_settings" ADD CONSTRAINT "signing_certificate_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones propias que Prisma no expresa (add-signing-certificate, design D2).
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_status_check" CHECK ("status" IN ('ACTIVE', 'REPLACED'));
-- A lo sumo una firma ACTIVE por empresa: active_company_id es company_id mientras está ACTIVE y
-- NULL una vez reemplazada; su índice UNIQUE ignora los NULL.
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_active_state_check" CHECK (
  ("status" = 'ACTIVE' AND "active_company_id" IS NOT NULL AND "active_company_id" = "company_id"
   AND "replaced_at" IS NULL AND "replaced_by_id" IS NULL)
  OR ("status" = 'REPLACED' AND "active_company_id" IS NULL AND "replaced_at" IS NOT NULL)
);
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_key_check" CHECK ("key_algorithm" = 'RSA' AND "key_bits" >= 2048);
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_ruc_check" CHECK ("detected_ruc" ~ '^[0-9]{10}001$');
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_validity_check" CHECK ("not_after" > "not_before");
ALTER TABLE "signing_certificate" ADD CONSTRAINT "signing_certificate_fingerprint_check" CHECK ("fingerprint_sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "signing_certificate_secret" ADD CONSTRAINT "signing_certificate_secret_format_check" CHECK ("format_version" >= 1);
ALTER TABLE "signing_certificate_secret" ADD CONSTRAINT "signing_certificate_secret_sizes_check" CHECK (
  octet_length("key_check") = 32 AND octet_length("wrapped_key_nonce") = 12
  AND octet_length("p12_nonce") = 12 AND octet_length("password_nonce") = 12
);
ALTER TABLE "signing_certificate_settings" ADD CONSTRAINT "signing_certificate_settings_expiry_alert_days_check" CHECK ("expiry_alert_days" BETWEEN 1 AND 90);

-- Operaciones no permitidas sobre la firma.
CREATE FUNCTION "signing_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Los metadatos no se borran: conservan la historia de las firmas reemplazadas.
CREATE TRIGGER "signing_certificate_no_delete"
  BEFORE DELETE ON "signing_certificate"
  FOR EACH ROW EXECUTE FUNCTION "signing_reject_change"();
CREATE TRIGGER "signing_certificate_no_truncate"
  BEFORE TRUNCATE ON "signing_certificate"
  FOR EACH STATEMENT EXECUTE FUNCTION "signing_reject_change"();

-- Dos actualizaciones posibles, en este orden dentro del reemplazo: ACTIVE -> REPLACED con su fecha,
-- y después, una sola vez, el enlace a la firma que la sustituye (que solo existe cuando la
-- anterior ya no es ACTIVE). Nada más cambia.
CREATE FUNCTION "signing_certificate_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  same_data BOOLEAN := (to_jsonb(NEW) - ARRAY['status', 'active_company_id', 'replaced_at', 'replaced_by_id'])
    = (to_jsonb(OLD) - ARRAY['status', 'active_company_id', 'replaced_at', 'replaced_by_id']);
BEGIN
  IF same_data AND OLD."status" = 'ACTIVE' AND NEW."status" = 'REPLACED' THEN
    RETURN NEW;
  END IF;
  IF same_data AND OLD."status" = 'REPLACED' AND NEW."status" = 'REPLACED'
     AND OLD."replaced_by_id" IS NULL AND NEW."replaced_by_id" IS NOT NULL
     AND NEW."replaced_at" = OLD."replaced_at" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'signing_certificate: solo admite la transición de ACTIVE a REPLACED y el enlace a su reemplazo'
    USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "signing_certificate_guard"
  BEFORE UPDATE ON "signing_certificate"
  FOR EACH ROW EXECUTE FUNCTION "signing_certificate_guard"();

-- El secreto no se actualiza: reemplazar es borrarlo (destrucción intencional, ADR 0011) e
-- insertar el de la firma nueva. Solo una firma ACTIVE puede tener secreto.
CREATE TRIGGER "signing_certificate_secret_no_update"
  BEFORE UPDATE ON "signing_certificate_secret"
  FOR EACH ROW EXECUTE FUNCTION "signing_reject_change"();

CREATE FUNCTION "signing_certificate_secret_active_only"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "signing_certificate"
    WHERE "id" = NEW."certificate_id" AND "company_id" = NEW."company_id" AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'signing_certificate_secret: solo una firma ACTIVE tiene secreto'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "signing_certificate_secret_active_only"
  BEFORE INSERT ON "signing_certificate_secret"
  FOR EACH ROW EXECUTE FUNCTION "signing_certificate_secret_active_only"();
