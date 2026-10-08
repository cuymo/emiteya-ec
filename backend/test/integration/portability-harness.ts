// Arnés de las pruebas de la portabilidad (add-data-portability): las fuentes compuestas como en
// main.ts, la lectura de un conjunto entero en una transacción de solo lectura y los datos que la
// portabilidad suma a los de los reportes: versiones de la configuración con su logo, firmas con
// sus secretos marcados, artefactos autorizados y RIDE, intentos con sus respuestas, transiciones,
// entregas, habilitaciones de catálogos, un punto predeterminado y eventos de auditoría.
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createAuditPortabilitySources } from "../../src/modules/audit/infrastructure/portability-sources.ts";
import { createCatalogPortabilitySources } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { PortabilitySources } from "../../src/modules/data-portability/application/ports.ts";
import { createFiscalPortabilitySources } from "../../src/modules/fiscal/infrastructure/index.ts";
import { createIdentityPortabilitySources } from "../../src/modules/identity/infrastructure/portability-sources.ts";
import { createInventoryPortabilitySources } from "../../src/modules/inventory/infrastructure/index.ts";
import { createPartiesPortabilitySources } from "../../src/modules/parties/infrastructure/index.ts";
import { createProductsPortabilitySources } from "../../src/modules/products/infrastructure/index.ts";
import { createSigningPortabilitySources } from "../../src/modules/signing/infrastructure/index.ts";
import { createTaxpayerPortabilitySources } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { createWithholdingPortabilitySources } from "../../src/modules/withholding-receipts/infrastructure/index.ts";
import { readOnlySnapshot } from "../../src/platform/db/read-only-snapshot.ts";
import type { GeneratorDeps } from "../../src/modules/data-portability/application/generate.ts";
import { createPackageFiles } from "../../src/modules/data-portability/infrastructure/package-files.ts";
import { createPortabilityDatabase } from "../../src/modules/data-portability/infrastructure/prisma-portability-database.ts";
import { openZip64 } from "../../src/modules/data-portability/infrastructure/zip64.ts";
import { writeXlsx } from "../../src/platform/xlsx/xlsx-writer.ts";
import type { MigratedSchema } from "./database.ts";
import type { CompanyBatches } from "../../src/platform/db/report-source.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { REPORT_PROJECTIONS } from "./reports-harness.ts";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Las fuentes de todos los módulos dueños, compuestas como en main.ts. */
export function portabilitySources(schema: string): PortabilitySources {
  const taxpayer = createTaxpayerPortabilitySources(schema);
  const fiscal = createFiscalPortabilitySources(schema, REPORT_PROJECTIONS);
  return {
    ...taxpayer,
    ...fiscal,
    ...createCatalogPortabilitySources(schema),
    ...createSigningPortabilitySources(schema),
    ...createIdentityPortabilitySources(schema),
    ...createPartiesPortabilitySources(schema),
    ...createProductsPortabilitySources(schema),
    ...createInventoryPortabilitySources(schema),
    ...createAuditPortabilitySources(schema),
    ...createWithholdingPortabilitySources(schema),
  };
}

/** Todas las filas de un conjunto, por lotes, en una transacción `REPEATABLE READ` de solo lectura. */
export function collect<R>(
  prisma: PrismaClient,
  batches: CompanyBatches<R>,
  companyId: string,
  size = 2,
): Promise<R[]> {
  return readOnlySnapshot(prisma, async (db) => {
    const rows: R[] = [];
    for await (const batch of batches.batches(db, companyId, size)) rows.push(...batch);
    // El conteo usa la misma consulta: coincide con las filas recorridas.
    if ((await batches.count(db, companyId)) !== rows.length) throw new Error("conteo distinto");
    return rows;
  });
}

/** Marcadores sembrados en los secretos y en los datos excluidos: nunca deben salir en un paquete. */
export const SECRET_MARKERS = {
  p12: "MARCADOR-P12-NUNCA-SALE",
  certificatePassword: "MARCADOR-CONTRASENA-DE-LA-FIRMA",
  wrappedKey: "MARCADOR-CLAVE-DE-DATOS-ENVUELTA",
  keyCheck: "MARCADOR-COMPROBACION-DE-CLAVE",
  passwordHash: "MARCADOR-HASH-DE-CONTRASENA",
  sessionToken: "MARCADOR-TOKEN-DE-SESION",
  ipAddress: "203.0.113.77",
  userAgent: "MARCADOR-USER-AGENT",
  verification: "MARCADOR-VERIFICACION",
  invitation: "marcador-invitacion@ejemplo.invalid",
} as const;

const bytesOf = (marker: string, length = 64) => {
  const bytes = Buffer.alloc(Math.max(length, marker.length), 0x20);
  bytes.write(marker);
  return new Uint8Array(bytes);
};

/** Un PNG sintético mínimo: el logo solo se copia con sus bytes y su hash. */
export const LOGO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("logo sintético de la portabilidad"),
]);
export const AUTHORIZED_XML = (accessKey: string) =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${accessKey}</numeroAutorizacion></autorizacion>`,
  );
export const RIDE_PDF = Buffer.from("%PDF-1.3\n%RIDE sintético de la portabilidad\n%%EOF\n");
export const RECEPTION_RESPONSE = Buffer.from(
  "<RespuestaRecepcionComprobante><estado>RECIBIDA</estado></RespuestaRecepcionComprobante>",
);
export const AUTHORIZATION_RESPONSE = Buffer.from("<RespuestaAutorizacionComprobante>truncada");

export type PortabilityIds = Record<string, string>;

/**
 * Suma a una empresa con los datos de los reportes lo que solo exporta la portabilidad. `invoiceId`
 * es una factura autorizada: recibe su XML autorizado, su RIDE, tres intentos (dos con respuesta,
 * uno truncado) y una entrega.
 */
export async function seedPortabilityExtras(
  prisma: PrismaClient,
  company: FiscalCompany,
  invoiceId: string,
): Promise<PortabilityIds> {
  const ids: PortabilityIds = {};
  const { companyId, adminId } = company;
  const logo = await prisma.configurationAsset.create({
    data: {
      companyId,
      kind: "LOGO",
      mimeType: "image/png",
      sizeBytes: LOGO.length,
      sha256: sha256(LOGO),
      content: new Uint8Array(LOGO),
      createdById: adminId,
    },
  });
  ids.logo = logo.id;
  const base = {
    companyId,
    ruc: "1790012345001",
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    accountingRequired: true,
    largeTaxpayer: false,
    createdById: adminId,
  };
  await prisma.companyConfigVersion.create({
    data: {
      ...base,
      version: 1,
      legalName: "COMERCIAL ANDINA",
      environment: "TEST",
      logoAssetId: logo.id,
      createdAt: new Date("2026-09-01T12:00:00Z"),
    },
  });
  const current = await prisma.companyConfigVersion.create({
    data: {
      ...base,
      version: 2,
      legalName: "COMERCIAL ANDINA S.A.",
      tradeName: "Andina",
      environment: "PRODUCTION",
      logoAssetId: logo.id,
      createdAt: new Date("2026-10-01T12:00:00Z"),
    },
  });
  await prisma.companyConfig.create({
    data: { companyId, currentVersionId: current.id, currentVersion: 2, updatedAt: new Date() },
  });
  // Un punto inactivo y el punto predeterminado del administrador.
  const second = company.points[1]!;
  await prisma.emissionPoint.update({
    where: { id: second.emissionPointId },
    data: { active: false },
  });
  await prisma.memberDefaultEmissionPoint.create({
    data: { companyId, userId: adminId, emissionPointId: company.points[0]!.emissionPointId },
  });
  await prisma.companyFiscalCatalogSetting.create({
    data: { companyId, catalogType: "iva-rate", entryKey: "4", enabled: false, updatedBy: adminId },
  });
  // Dos firmas: la reemplazada sin secretos y la activa con sus secretos marcados.
  const certificate = (status: string, serialNumber: string, replacedAt: Date | null) =>
    prisma.signingCertificate.create({
      data: {
        id: randomUUID(),
        companyId,
        status,
        activeCompanyId: status === "ACTIVE" ? companyId : null,
        subject: `CN=TITULAR ${serialNumber}`,
        issuer: "CN=AC DE PRUEBAS",
        serialNumber,
        fingerprintSha256: sha256(Buffer.from(serialNumber)),
        notBefore: new Date("2026-01-01T00:00:00Z"),
        notAfter: new Date("2027-01-01T00:00:00Z"),
        detectedRuc: "1790012345001",
        keyAlgorithm: "RSA",
        keyBits: 2048,
        uploadedBy: adminId,
        replacedAt,
      },
    });
  const replaced = await certificate("REPLACED", "01", new Date("2026-06-01T00:00:00Z"));
  const active = await certificate("ACTIVE", "02", null);
  await prisma.signingCertificate.update({
    where: { id: replaced.id },
    data: { replacedById: active.id },
  });
  await prisma.signingCertificateSecret.create({
    data: {
      certificateId: active.id,
      companyId,
      formatVersion: 1,
      keyVersion: "1",
      keyCheck: bytesOf(SECRET_MARKERS.keyCheck, 32),
      wrappedKey: bytesOf(SECRET_MARKERS.wrappedKey, 48),
      wrappedKeyNonce: bytesOf("n", 12),
      p12Ciphertext: bytesOf(SECRET_MARKERS.p12),
      p12Nonce: bytesOf("n", 12),
      passwordCiphertext: bytesOf(SECRET_MARKERS.certificatePassword),
      passwordNonce: bytesOf("n", 12),
    },
  });
  ids.certificate = active.id;
  // Datos internos de autenticación del administrador, marcados.
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: adminId,
      providerId: "credential",
      userId: adminId,
      password: SECRET_MARKERS.passwordHash,
    },
  });
  await prisma.session.create({
    data: {
      id: randomUUID(),
      token: `${SECRET_MARKERS.sessionToken}-${companyId}`,
      userId: adminId,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      ipAddress: SECRET_MARKERS.ipAddress,
      userAgent: SECRET_MARKERS.userAgent,
      activeOrganizationId: companyId,
    },
  });
  await prisma.verification.create({
    data: {
      id: randomUUID(),
      identifier: `reset:${adminId}`,
      value: SECRET_MARKERS.verification,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    },
  });
  await prisma.invitation.create({
    data: {
      id: randomUUID(),
      organizationId: companyId,
      email: SECRET_MARKERS.invitation,
      role: "OPERATOR",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      inviterId: adminId,
    },
  });
  // La factura autorizada: su XML autorizado, su RIDE, sus intentos y una entrega.
  const invoice = await prisma.electronicDocument.findUniqueOrThrow({ where: { id: invoiceId } });
  const artifact = (kind: string, mediaType: string, content: Buffer) =>
    prisma.documentArtifact.create({
      data: {
        companyId,
        documentId: invoiceId,
        kind,
        mediaType,
        content: new Uint8Array(content),
        sizeBytes: content.length,
        sha256: sha256(content),
        metadata: {},
      },
    });
  if (
    !(await prisma.documentArtifact.findFirst({
      where: { documentId: invoiceId, kind: "AUTHORIZED_XML" },
    }))
  )
    await artifact("AUTHORIZED_XML", "application/xml", AUTHORIZED_XML(invoice.accessKey));
  const ride = await artifact("RIDE_PDF", "application/pdf", RIDE_PDF);
  ids.ride = ride.id;
  const attempt = async (
    attemptNumber: number,
    operation: string,
    response: { body: Buffer; truncated: boolean } | null,
  ) => {
    const created = await prisma.sriAttempt.create({
      data: {
        companyId,
        documentId: invoiceId,
        attemptNumber,
        operation,
        environment: invoice.environment,
        endpoint: "https://sri-simulado.invalid/servicio",
        origin: "AUTOMATIC",
        startedAt: new Date(`2026-09-20T15:00:0${attemptNumber}Z`),
        completedAt: new Date(`2026-09-20T15:00:0${attemptNumber + 1}Z`),
        transportOutcome: response ? "RESPONSE" : "NOT_SENT",
        httpStatus: response ? 200 : null,
        envelopeSha256: "e".repeat(64),
        envelopeSize: 900 + attemptNumber,
      },
    });
    if (response)
      await prisma.sriResponse.create({
        data: {
          attemptId: created.id,
          companyId,
          body: new Uint8Array(response.body),
          sizeBytes: response.body.length,
          sha256: sha256(response.body),
          contentType: "text/xml",
          truncated: response.truncated,
        },
      });
    return created.id;
  };
  ids.receptionAttempt = await attempt(1, "RECEPTION", {
    body: RECEPTION_RESPONSE,
    truncated: false,
  });
  ids.authorizationAttempt = await attempt(2, "AUTHORIZATION", {
    body: AUTHORIZATION_RESPONSE,
    truncated: true,
  });
  ids.unsentAttempt = await attempt(3, "AUTHORIZATION", null);
  await prisma.documentStateTransition.createMany({
    data: [
      {
        companyId,
        documentId: invoiceId,
        fromState: null,
        toState: "RESERVED",
        cause: "reservation",
        actorType: "USER",
        actorUserId: adminId,
        occurredAt: new Date("2026-09-20T14:59:00Z"),
      },
      {
        companyId,
        documentId: invoiceId,
        fromState: "RESERVED",
        toState: "SIGNED",
        cause: "signed",
        actorType: "SYSTEM",
        occurredAt: new Date("2026-09-20T14:59:30Z"),
      },
    ],
  });
  await prisma.documentDeliveryEvent.create({
    data: {
      companyId,
      documentId: invoiceId,
      event: "DOWNLOAD",
      artifactKind: "RIDE_PDF",
      artifactSha256: sha256(RIDE_PDF),
      actorUserId: adminId,
      requestId: "req-portabilidad-0001",
    },
  });
  await prisma.auditEvent.create({
    data: {
      companyId,
      actorType: "USER",
      actorUserId: adminId,
      action: "taxpayer.configured",
      changes: { legalName: "COMERCIAL ANDINA S.A." },
      correlationId: "req-portabilidad-0002",
    },
  });
  return ids;
}

/** Los artefactos autorizados que los arneses de los reportes no escriben: el XML autorizado. */
export async function completeAuthorizedArtifacts(prisma: PrismaClient, companyId: string) {
  const documents = await prisma.electronicDocument.findMany({
    where: { companyId, state: "AUTHORIZED" },
    select: { id: true, accessKey: true, artifacts: { select: { kind: true } } },
  });
  for (const document of documents) {
    if (document.artifacts.some((artifact) => artifact.kind === "AUTHORIZED_XML")) continue;
    const content = AUTHORIZED_XML(document.accessKey);
    await prisma.documentArtifact.create({
      data: {
        companyId,
        documentId: document.id,
        kind: "AUTHORIZED_XML",
        mediaType: "application/xml",
        content: new Uint8Array(content),
        sizeBytes: content.length,
        sha256: sha256(content),
        metadata: {},
      },
    });
  }
}

/** Las dependencias de la generación sobre el esquema de la prueba y un directorio privado. */
export function generatorDeps(
  db: MigratedSchema,
  root: string,
  overrides: Partial<GeneratorDeps> = {},
): GeneratorDeps & { packages: ReturnType<typeof createPackageFiles> } {
  const packages = createPackageFiles(root);
  return {
    sources: portabilitySources(db.name),
    database: createPortabilityDatabase(db.database.prisma),
    writeXlsx,
    openZip: openZip64,
    files: packages.files,
    limits: { headroomPercent: 10, reserveBytes: 1024 * 1024, snapshotTimeoutMs: 120_000 },
    applicationVersion: "pruebas",
    now: () => new Date(),
    batchSize: 3,
    ...overrides,
    packages,
  };
}
