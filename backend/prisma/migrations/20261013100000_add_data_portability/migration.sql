-- add-data-portability (design D10 y D24): el registro de las exportaciones de portabilidad. Aditiva:
-- ninguna tabla existente cambia. Primero el DDL que genera Prisma; después las restricciones y el
-- trigger que Prisma no expresa.

-- CreateTable
CREATE TABLE "data_export" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "active_company_id" TEXT,
    "ready_company_id" TEXT,
    "phase" TEXT,
    "progress_done" INTEGER,
    "progress_total" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "format_version" TEXT NOT NULL DEFAULT '1',
    "snapshot_at" TIMESTAMPTZ(3),
    "generated_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "file_name" TEXT,
    "size_bytes" BIGINT,
    "sha256" CHAR(64),
    "counts" JSONB,
    "error_code" TEXT,
    "expired_reason" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_export_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_export_active_company_id_key" ON "data_export"("active_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_export_ready_company_id_key" ON "data_export"("ready_company_id");

-- CreateIndex
CREATE INDEX "data_export_company_id_requested_at_idx" ON "data_export"("company_id", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_export_company_id_id_key" ON "data_export"("company_id", "id");

-- AddForeignKey
ALTER TABLE "data_export" ADD CONSTRAINT "data_export_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export" ADD CONSTRAINT "data_export_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Estados explícitos (design D10): cada estado exige sus campos y nunca se deduce de un nulo.
-- - Una generación activa y un paquete vigente por empresa: las columnas de unicidad llevan la
--   empresa solo en esos estados.
-- - READY exige el momento del snapshot, la generación, la caducidad posterior, el archivo, su tamaño,
--   su SHA-256 y sus conteos; EXPIRED solo sale de un READY (conserva su SHA-256) por TTL o REPLACED;
--   FAILED exige uno de los códigos seguros de la falla, incluidos los del paquete listo perdido o
--   alterado (READY → FAILED).
-- - La fase y el progreso solo existen mientras se genera.
ALTER TABLE "data_export" ADD CONSTRAINT "data_export_values_check" CHECK (
  "status" IN ('QUEUED', 'GENERATING', 'READY', 'FAILED', 'EXPIRED')
  AND ("status" IN ('QUEUED', 'GENERATING')) = ("active_company_id" IS NOT NULL)
  AND ("active_company_id" IS NULL OR "active_company_id" = "company_id")
  AND ("status" = 'READY') = ("ready_company_id" IS NOT NULL)
  AND ("ready_company_id" IS NULL OR "ready_company_id" = "company_id")
  AND ("phase" IS NULL OR ("status" = 'GENERATING'
    AND "phase" IN ('SNAPSHOT', 'ARTIFACTS', 'PUBLISHING')))
  AND ("progress_done" IS NULL) = ("progress_total" IS NULL)
  AND ("progress_done" IS NULL OR ("status" = 'GENERATING'
    AND "progress_done" BETWEEN 0 AND "progress_total"))
  AND "attempt" >= 0
  AND "format_version" = '1'
  AND ("status" <> 'QUEUED' OR "started_at" IS NULL)
  AND ("status" NOT IN ('GENERATING', 'READY', 'EXPIRED') OR "started_at" IS NOT NULL)
  AND ("status" IN ('FAILED', 'EXPIRED')) = ("finished_at" IS NOT NULL)
  AND ("status" <> 'READY' OR ("snapshot_at" IS NOT NULL AND "generated_at" IS NOT NULL
    AND "expires_at" > "generated_at" AND "file_name" IS NOT NULL AND "size_bytes" > 0
    AND "sha256" IS NOT NULL AND "counts" IS NOT NULL))
  AND ("status" = 'FAILED') = ("error_code" IS NOT NULL)
  AND ("error_code" IS NULL OR "error_code" IN ('DATA_EXPORT_ARTIFACT_INTEGRITY',
    'DATA_EXPORT_ARTIFACT_MISSING', 'DATA_EXPORT_INSUFFICIENT_SPACE',
    'DATA_EXPORT_SNAPSHOT_TIMEOUT', 'DATA_EXPORT_LIMIT', 'DATA_EXPORT_FAILED',
    'DATA_EXPORT_PACKAGE_MISSING', 'DATA_EXPORT_PACKAGE_INTEGRITY'))
  AND ("status" = 'EXPIRED') = ("expired_reason" IS NOT NULL)
  AND ("expired_reason" IS NULL OR ("expired_reason" IN ('TTL', 'REPLACED')
    AND "generated_at" IS NOT NULL AND "sha256" IS NOT NULL))
  AND ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$')
  AND ("file_name" IS NULL OR "file_name" ~ '^[0-9a-f-]{36}-[0-9]+\.zip$')
  AND ("counts" IS NULL OR (jsonb_typeof("counts") = 'object'
    AND octet_length("counts"::text) <= 65536)));

-- Transiciones (design D10): QUEUED → GENERATING o FAILED; GENERATING → GENERATING (fase, progreso,
-- intento), READY o FAILED; READY → EXPIRED o FAILED; FAILED y EXPIRED no cambian. La empresa, quien
-- la pidió y el momento de la solicitud nunca cambian, y lo publicado de un paquete listo tampoco.
-- Las filas no se borran: son la historia de las exportaciones.
CREATE FUNCTION data_export_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'data_export no admite %', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."company_id" <> OLD."company_id" OR NEW."requested_by" <> OLD."requested_by"
      OR NEW."requested_at" <> OLD."requested_at" THEN
    RAISE EXCEPTION 'la empresa y la solicitud de una exportación no cambian'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD."status" = 'QUEUED' AND NEW."status" IN ('GENERATING', 'FAILED'))
      OR (OLD."status" = 'GENERATING' AND NEW."status" IN ('GENERATING', 'READY', 'FAILED'))
      OR (OLD."status" = 'READY' AND NEW."status" IN ('EXPIRED', 'FAILED'))) THEN
    RAISE EXCEPTION 'transición de exportación no permitida: % → %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'READY' AND (NEW."snapshot_at" IS DISTINCT FROM OLD."snapshot_at"
      OR NEW."generated_at" IS DISTINCT FROM OLD."generated_at"
      OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
      OR NEW."file_name" IS DISTINCT FROM OLD."file_name"
      OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
      OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
      OR NEW."counts" IS DISTINCT FROM OLD."counts"
      OR NEW."attempt" <> OLD."attempt") THEN
    RAISE EXCEPTION 'un paquete listo no cambia lo publicado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "data_export_guard" BEFORE UPDATE OR DELETE ON "data_export"
  FOR EACH ROW EXECUTE FUNCTION data_export_guard();
CREATE FUNCTION data_export_reject_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'data_export no admite %', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "data_export_no_truncate" BEFORE TRUNCATE ON "data_export"
  FOR EACH STATEMENT EXECUTE FUNCTION data_export_reject_truncate();
