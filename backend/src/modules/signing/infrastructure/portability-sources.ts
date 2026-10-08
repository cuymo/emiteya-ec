// Fuente de portabilidad de las firmas (add-data-portability, design D6): solo los metadatos de
// cada firma de la empresa, incluidas las reemplazadas. Nunca lee `signing_certificate_secret`: ni
// el archivo de la firma, cifrado o no, ni su contraseña ni sus claves salen por ninguna vía (spec
// signing-certificate; ADR 0011).
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createSigningPortabilitySources(schema: string) {
  const certificates = qualifiedTable(schema, "signing_certificate");
  return {
    certificates: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`c.status, c.subject, c.issuer, c.serial_number, c.fingerprint_sha256,
          c.not_before, c.not_after, c.detected_ruc, c.key_algorithm, c.key_bits, c.uploaded_by,
          c.created_at, c.replaced_at`,
        from: Prisma.sql`${certificates} c WHERE c.company_id = ${companyId}`,
        orderBy: Prisma.sql`c.created_at, c.id`,
      }),
      map: (raw: {
        status: string;
        subject: string;
        issuer: string;
        serial_number: string;
        fingerprint_sha256: string;
        not_before: Date;
        not_after: Date;
        detected_ruc: string;
        key_algorithm: string;
        key_bits: number;
        uploaded_by: string;
        created_at: Date;
        replaced_at: Date | null;
      }) => ({
        status: raw.status,
        subject: raw.subject,
        issuer: raw.issuer,
        serialNumber: raw.serial_number,
        fingerprintSha256: raw.fingerprint_sha256,
        notBefore: raw.not_before,
        notAfter: raw.not_after,
        detectedRuc: raw.detected_ruc,
        keyAlgorithm: raw.key_algorithm,
        keyBits: raw.key_bits,
        uploadedBy: raw.uploaded_by,
        createdAt: raw.created_at,
        replacedAt: raw.replaced_at,
      }),
    }),
  };
}
