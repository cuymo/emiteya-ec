-- Detalle del diagnóstico del último intento (add-invoice-emission, design D10): para XSD_INVALID,
-- solo la línea y el nombre del elemento, nunca el valor ni la salida de libxml2.
ALTER TABLE "electronic_document" ADD COLUMN "last_attempt_detail" JSONB;

ALTER TABLE "electronic_document" ADD CONSTRAINT "electronic_document_attempt_detail_check" CHECK (
  "last_attempt_detail" IS NULL OR jsonb_typeof("last_attempt_detail") = 'object');
