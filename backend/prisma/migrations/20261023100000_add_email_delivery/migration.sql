-- add-email-delivery (design D2, D6 y D8; Migration Plan): el servidor de correo de cada empresa,
-- su contraseña cifrada aparte, los envíos de los comprobantes y sus intentos de solo agregado.
-- Aditiva: no toca datos existentes.
-- CreateTable
CREATE TABLE "email_settings" (
    "company_id" TEXT NOT NULL,
    "host" VARCHAR(253) NOT NULL,
    "port" INTEGER NOT NULL,
    "security" TEXT NOT NULL,
    "username" VARCHAR(320),
    "from_name" VARCHAR(120) NOT NULL,
    "from_address" VARCHAR(320) NOT NULL,
    "bcc_address" VARCHAR(320),
    "auto_send" BOOLEAN NOT NULL DEFAULT true,
    "test_recipient" VARCHAR(320),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "email_settings_secret" (
    "company_id" TEXT NOT NULL,
    "format_version" SMALLINT NOT NULL,
    "key_version" TEXT NOT NULL,
    "key_check" BYTEA NOT NULL,
    "wrapped_key" BYTEA NOT NULL,
    "wrapped_key_nonce" BYTEA NOT NULL,
    "password_ciphertext" BYTEA NOT NULL,
    "password_nonce" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_settings_secret_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "email_delivery" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "requested_by" TEXT,
    "idempotency_key" VARCHAR(100),
    "request_fingerprint" CHAR(64),
    "environment" TEXT NOT NULL,
    "test_redirect" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "message_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_code" TEXT,
    "failure_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_delivery_attempt" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "smtp_code" INTEGER,
    "detail" VARCHAR(200),

    CONSTRAINT "email_delivery_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_delivery_company_id_status_idx" ON "email_delivery"("company_id", "status");

-- CreateIndex
CREATE INDEX "email_delivery_company_id_document_id_created_at_idx" ON "email_delivery"("company_id", "document_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_delivery_company_id_idempotency_key_key" ON "email_delivery"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "email_delivery_attempt_delivery_id_number_key" ON "email_delivery_attempt"("delivery_id", "number");

-- AddForeignKey
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_settings_secret" ADD CONSTRAINT "email_settings_secret_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "email_settings"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery_attempt" ADD CONSTRAINT "email_delivery_attempt_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "email_delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Servidor de correo (design D5 y D8): puerto válido, seguridad conocida, sin saltos de línea en los
-- textos que van a las cabeceras y direcciones con forma de correo. La validación completa es la
-- del contrato; esto es la última defensa.
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_values_check" CHECK (
  "port" BETWEEN 1 AND 65535
  AND "security" IN ('TLS', 'STARTTLS', 'NONE')
  AND "version" >= 1
  AND "host" ~ '^[^\s]+$'
  AND ("username" IS NULL OR ("username" <> '' AND "username" !~ '[\r\n]'))
  AND btrim("from_name") <> '' AND "from_name" !~ '[\r\n]'
  AND "from_address" ~ '^[^\s@]+@[^\s@]+$'
  AND ("bcc_address" IS NULL OR "bcc_address" ~ '^[^\s@]+@[^\s@]+$')
  AND ("test_recipient" IS NULL OR "test_recipient" ~ '^[^\s@]+@[^\s@]+$'));

-- Sobre de la contraseña (design D9): formato 1, nonces de 12 bytes, la clave de datos envuelta con
-- su etiqueta (32 + 16 bytes) y la comprobación HMAC-SHA-256.
ALTER TABLE "email_settings_secret" ADD CONSTRAINT "email_settings_secret_values_check" CHECK (
  "format_version" = 1
  AND "key_version" <> ''
  AND octet_length("key_check") = 32
  AND octet_length("wrapped_key") = 48
  AND octet_length("wrapped_key_nonce") = 12
  AND octet_length("password_nonce") = 12
  AND octet_length("password_ciphertext") > 16);

-- Envíos (design D2, D6 y D8): el automático sin actor ni clave; el reenvío con su actor, su clave y
-- la huella de la solicitud. Enviado con su momento; los estados finales con su código y su cierre.
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_values_check" CHECK (
  (("origin" = 'AUTOMATIC' AND "requested_by" IS NULL AND "idempotency_key" IS NULL
      AND "request_fingerprint" IS NULL)
    OR ("origin" = 'MANUAL' AND "requested_by" IS NOT NULL
      AND "idempotency_key" ~ '^[!-~]{1,100}$' AND "request_fingerprint" ~ '^[0-9a-f]{64}$'))
  AND "environment" IN ('TEST', 'PRODUCTION')
  AND "status" IN ('PENDING', 'RETRYING', 'SENT', 'FAILED', 'NO_RECIPIENT', 'DISABLED')
  AND jsonb_typeof("recipients") = 'array'
  AND "attempt_count" >= 0
  AND ("status" NOT IN ('PENDING', 'RETRYING') OR "finished_at" IS NULL)
  AND ("status" <> 'SENT' OR ("sent_at" IS NOT NULL AND "finished_at" IS NOT NULL))
  AND ("status" NOT IN ('FAILED', 'NO_RECIPIENT', 'DISABLED')
    OR ("failure_code" IS NOT NULL AND "finished_at" IS NOT NULL)));

-- Un solo envío automático por comprobante (spec, «Envío automático al autorizar»).
CREATE UNIQUE INDEX "email_delivery_automatic_document_key" ON "email_delivery"("document_id")
  WHERE "origin" = 'AUTOMATIC';

-- Intentos (design D6): numerados desde 1, con un resultado conocido; de solo agregado.
ALTER TABLE "email_delivery_attempt" ADD CONSTRAINT "email_delivery_attempt_values_check" CHECK (
  "number" >= 1
  AND "outcome" IN ('SENT', 'RETRYABLE', 'DETERMINISTIC')
  AND ("smtp_code" IS NULL OR "smtp_code" BETWEEN 200 AND 599));
CREATE TRIGGER "email_delivery_attempt_append_only" BEFORE UPDATE OR DELETE ON "email_delivery_attempt"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "email_delivery_attempt_no_truncate" BEFORE TRUNCATE ON "email_delivery_attempt"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
