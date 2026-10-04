-- Transmisión al SRI (add-sri-transmission, design D3, D5, D7 y D16): estados de la transmisión,
-- autorización inmutable, cola de jobs, intentos, respuestas originales y resultados.

-- AlterTable
ALTER TABLE "electronic_document" ADD COLUMN     "authorization_date" TIMESTAMPTZ(3),
ADD COLUMN     "authorization_environment" TEXT,
ADD COLUMN     "authorization_number" CHAR(49);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "active_dedupe_key" TEXT,
    "document_id" TEXT,
    "active_sri_document_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "deadline_at" TIMESTAMPTZ(3),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "last_error_class" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "last_error_detail" JSONB,
    "origin" TEXT NOT NULL,
    "requested_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sri_attempt" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "job_id" TEXT,
    "attempt_number" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "initiated_by" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "headers_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "transport_outcome" TEXT NOT NULL,
    "http_status" INTEGER,
    "response_headers" JSONB,
    "transport_error_code" TEXT,
    "envelope_sha256" CHAR(64) NOT NULL,
    "envelope_size" INTEGER NOT NULL,
    "sent_artifact_sha256" CHAR(64),
    "sent_artifact_size" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sri_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sri_response" (
    "attempt_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "body" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content_type" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sri_response_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateTable
CREATE TABLE "sri_attempt_result" (
    "attempt_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "parsed" JSONB,
    "classifier_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sri_attempt_result_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_active_dedupe_key_key" ON "job"("active_dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "job_active_sri_document_id_key" ON "job"("active_sri_document_id");

-- CreateIndex
CREATE INDEX "job_status_next_attempt_at_idx" ON "job"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "job_company_id_document_id_idx" ON "job"("company_id", "document_id");

-- CreateIndex
CREATE INDEX "sri_attempt_company_id_document_id_started_at_idx" ON "sri_attempt"("company_id", "document_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "sri_attempt_document_id_attempt_number_key" ON "sri_attempt"("document_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "sri_attempt_company_id_id_key" ON "sri_attempt"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sri_response_company_id_attempt_id_key" ON "sri_response"("company_id", "attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "sri_attempt_result_company_id_attempt_id_key" ON "sri_attempt_result"("company_id", "attempt_id");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "electronic_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sri_attempt" ADD CONSTRAINT "sri_attempt_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sri_attempt" ADD CONSTRAINT "sri_attempt_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sri_attempt" ADD CONSTRAINT "sri_attempt_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sri_response" ADD CONSTRAINT "sri_response_company_id_attempt_id_fkey" FOREIGN KEY ("company_id", "attempt_id") REFERENCES "sri_attempt"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sri_attempt_result" ADD CONSTRAINT "sri_attempt_result_company_id_attempt_id_fkey" FOREIGN KEY ("company_id", "attempt_id") REFERENCES "sri_attempt"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Comprobante (design D3 y D16): estados de la transmisión; firmado desde SIGNED; los datos de la
-- autorización existen solo en AUTHORIZED, con el número igual a la clave y el ambiente del
-- comprobante.
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
  AND "total" >= 0 AND scale("total") <= 2
  AND "total" < power(10::numeric, 14 - scale("total"))
  AND "attempt_count" >= 0
  AND ("last_attempt_class" IS NULL OR "last_attempt_class" IN
    ('RETRYABLE_OPERATIONAL', 'DETERMINISTIC_CONFIGURATION', 'DETERMINISTIC_VALIDATION')));

ALTER TABLE "electronic_document" ADD CONSTRAINT "electronic_document_authorization_check" CHECK (
  (("state" = 'AUTHORIZED') = ("authorization_number" IS NOT NULL))
  AND ("authorization_number" IS NULL) = ("authorization_date" IS NULL)
  AND ("authorization_number" IS NULL) = ("authorization_environment" IS NULL)
  AND ("authorization_number" IS NULL OR "authorization_number" = "access_key")
  AND ("authorization_environment" IS NULL OR "authorization_environment" = "environment"));

-- Los datos fiscales siguen inmutables; el estado cambia solo por la tabla de transiciones de
-- design D3 (los terminales no cambian); la firma y la autorización no cambian una vez escritas.
CREATE OR REPLACE FUNCTION electronic_document_guard() RETURNS trigger
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
  IF NEW."state" <> OLD."state" AND (OLD."state", NEW."state") NOT IN (
      ('RESERVED', 'SIGNED'),
      ('SIGNED', 'RECEIVED'), ('SIGNED', 'RETURNED'), ('SIGNED', 'SEND_UNKNOWN'),
      ('SEND_UNKNOWN', 'RECEIVED'), ('SEND_UNKNOWN', 'AUTHORIZED'), ('SEND_UNKNOWN', 'NOT_AUTHORIZED'),
      ('SEND_UNKNOWN', 'RETURNED'), ('SEND_UNKNOWN', 'MANUAL_REVIEW'),
      ('RECEIVED', 'AUTHORIZED'), ('RECEIVED', 'NOT_AUTHORIZED'), ('RECEIVED', 'MANUAL_REVIEW'),
      ('MANUAL_REVIEW', 'RECEIVED'), ('MANUAL_REVIEW', 'AUTHORIZED'),
      ('MANUAL_REVIEW', 'NOT_AUTHORIZED')) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % → %', OLD."state", NEW."state"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> 'RESERVED' AND NEW."signed_at" IS DISTINCT FROM OLD."signed_at" THEN
    RAISE EXCEPTION 'un comprobante firmado no cambia su firma' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."authorization_number" IS NOT NULL
     AND (NEW."authorization_number", NEW."authorization_date", NEW."authorization_environment")
       IS DISTINCT FROM
         (OLD."authorization_number", OLD."authorization_date", OLD."authorization_environment") THEN
    RAISE EXCEPTION 'la autorización de un comprobante no cambia' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Todo comprobante firmado, y todo estado posterior, conserva su artefacto firmado exacto.
CREATE OR REPLACE FUNCTION electronic_document_requires_artifact() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW."state" <> 'RESERVED' AND NOT EXISTS (
    SELECT 1 FROM "document_artifact" WHERE "document_id" = NEW."id" AND "kind" = 'SIGNED_XML'
  ) THEN
    RAISE EXCEPTION 'el comprobante % está firmado sin su artefacto', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

ALTER TABLE "document_state_transition" DROP CONSTRAINT "document_state_transition_values_check";
ALTER TABLE "document_state_transition" ADD CONSTRAINT "document_state_transition_values_check" CHECK (
  "to_state" IN ('RESERVED', 'SIGNED', 'SEND_UNKNOWN', 'RECEIVED', 'RETURNED', 'AUTHORIZED',
    'NOT_AUTHORIZED', 'MANUAL_REVIEW')
  AND ("from_state" IS NULL OR "from_state" IN ('RESERVED', 'SIGNED', 'SEND_UNKNOWN', 'RECEIVED',
    'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED', 'MANUAL_REVIEW'))
  AND "actor_type" IN ('USER', 'SYSTEM')
  AND ("actor_user_id" IS NOT NULL) = ("actor_type" = 'USER')
  AND "cause" <> '');

-- Artefactos (design D16): lo enviado (SIGNED_XML) y lo recibido (AUTHORIZED_XML).
ALTER TABLE "document_artifact" DROP CONSTRAINT "document_artifact_values_check";
ALTER TABLE "document_artifact" ADD CONSTRAINT "document_artifact_values_check" CHECK (
  "kind" IN ('SIGNED_XML', 'AUTHORIZED_XML')
  AND "media_type" = 'application/xml'
  AND "size_bytes" > 0 AND "size_bytes" = octet_length("content")
  AND "sha256" ~ '^[0-9a-f]{64}$');

-- Cola de jobs (ADR 0012, design D5): las claves activas existen solo mientras el job está activo.
ALTER TABLE "job" ADD CONSTRAINT "job_values_check" CHECK (
  "status" IN ('PENDING', 'LEASED', 'DONE', 'STOPPED')
  AND "type" ~ '^[a-z]+(\.[a-z_]+)+$'
  AND "dedupe_key" <> ''
  AND "origin" IN ('AUTOMATIC', 'MANUAL')
  AND ("origin" = 'MANUAL') = ("requested_by" IS NOT NULL)
  AND ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500)
  AND "attempt_count" >= 0 AND "max_attempts" >= 1
  AND (("status" = 'LEASED') = ("lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL))
  AND (("status" IN ('PENDING', 'LEASED')) = ("active_dedupe_key" IS NOT NULL))
  AND ("active_dedupe_key" IS NULL OR "active_dedupe_key" = "dedupe_key")
  AND (("status" IN ('PENDING', 'LEASED') AND "type" LIKE 'sri.%' AND "document_id" IS NOT NULL)
    = ("active_sri_document_id" IS NOT NULL))
  AND ("active_sri_document_id" IS NULL OR "active_sri_document_id" = "document_id")
  AND (("status" IN ('DONE', 'STOPPED')) = ("completed_at" IS NOT NULL))
  AND ("last_error_class" IS NULL OR "last_error_class" IN ('RETRYABLE', 'DETERMINISTIC', 'INTEGRITY'))
  AND ("last_error_detail" IS NULL OR jsonb_typeof("last_error_detail") = 'object')
  AND jsonb_typeof("payload") = 'object');

-- Evidencia (design D7): intentos, respuestas originales y resultados, de solo agregado.
ALTER TABLE "sri_attempt" ADD CONSTRAINT "sri_attempt_values_check" CHECK (
  "operation" IN ('RECEPTION', 'AUTHORIZATION', 'VALIDITY')
  AND "environment" IN ('TEST', 'PRODUCTION')
  AND "origin" IN ('AUTOMATIC', 'MANUAL')
  AND ("origin" = 'MANUAL') = ("initiated_by" IS NOT NULL)
  AND "attempt_number" >= 1
  AND "transport_outcome" IN ('NOT_SENT', 'REQUEST_TIMEOUT', 'BODY_TIMEOUT', 'CONNECTION_LOST', 'RESPONSE')
  AND (("transport_outcome" = 'RESPONSE') = ("http_status" IS NOT NULL))
  AND ("response_headers" IS NULL OR jsonb_typeof("response_headers") = 'object')
  AND "envelope_sha256" ~ '^[0-9a-f]{64}$' AND "envelope_size" > 0
  AND ("sent_artifact_sha256" IS NULL) = ("sent_artifact_size" IS NULL)
  AND ("sent_artifact_sha256" IS NULL OR "sent_artifact_sha256" ~ '^[0-9a-f]{64}$')
  AND "completed_at" >= "started_at");

ALTER TABLE "sri_response" ADD CONSTRAINT "sri_response_values_check" CHECK (
  "size_bytes" = octet_length("body")
  AND "sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "sri_attempt_result" ADD CONSTRAINT "sri_attempt_result_values_check" CHECK (
  "outcome" IN ('RECEIVED', 'RETURNED', 'KEY_IN_PROCESS', 'KEY_REGISTERED', 'SEQUENTIAL_REGISTERED',
    'UNKNOWN', 'INCONSISTENT', 'AUTHORIZED', 'NOT_AUTHORIZED', 'NO_CONCLUSION', 'KEY_UNKNOWN',
    'KEY_KNOWN', 'NO_EVIDENCE', 'NOT_SENT', 'UNPARSEABLE')
  AND jsonb_typeof("messages") = 'array'
  AND ("parsed" IS NULL OR jsonb_typeof("parsed") = 'object')
  AND "classifier_version" <> '');

CREATE TRIGGER "sri_attempt_append_only" BEFORE UPDATE OR DELETE ON "sri_attempt"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "sri_attempt_no_truncate" BEFORE TRUNCATE ON "sri_attempt"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "sri_response_append_only" BEFORE UPDATE OR DELETE ON "sri_response"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "sri_response_no_truncate" BEFORE TRUNCATE ON "sri_response"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "sri_attempt_result_append_only" BEFORE UPDATE OR DELETE ON "sri_attempt_result"
  FOR EACH ROW EXECUTE FUNCTION fiscal_document_reject_change();
CREATE TRIGGER "sri_attempt_result_no_truncate" BEFORE TRUNCATE ON "sri_attempt_result"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_document_reject_change();
