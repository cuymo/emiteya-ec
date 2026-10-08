// Fuentes de portabilidad de los módulos dueños (add-data-portability, design D1, D4 y D6; tareas
// 3.1 a 3.3) contra PostgreSQL: cada conjunto completo de la empresa, en todos sus estados, en un
// orden total, sin columnas excluidas y sin datos de otra empresa.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PortabilitySources } from "../../src/modules/data-portability/application/ports.ts";
import type { CompanyBatches } from "../../src/platform/db/report-source.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertMember } from "./fixtures.ts";
import {
  AUTHORIZATION_RESPONSE,
  LOGO,
  RECEPTION_RESPONSE,
  RIDE_PDF,
  collect,
  portabilitySources,
  seedPortabilityExtras,
  type PortabilityIds,
} from "./portability-harness.ts";
import { seedReportData } from "./reports-api-harness.ts";
import { insertGuideParty } from "./shipping-guide-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("fuentes de portabilidad de los módulos dueños", () => {
  let db: MigratedSchema;
  let sources: PortabilitySources;
  let a: FiscalCompany;
  let b: FiscalCompany;
  let ids: Record<string, string>;
  let extras: PortabilityIds;
  const rows = <R>(batches: CompanyBatches<R>, company = a) =>
    collect(db.database.prisma, batches, company.companyId);

  beforeAll(async () => {
    db = await createMigratedSchema("portability_sources");
    const prisma = db.database.prisma;
    sources = portabilitySources(db.name);
    a = await insertFiscalCompany(prisma, "Empresa A", 2);
    b = await insertFiscalCompany(prisma, "Empresa B", 1);
    ids = await seedReportData(prisma, a);
    extras = await seedPortabilityExtras(prisma, a, ids.invoice!);
    await insertMember(prisma, a.companyId, {
      name: "Olga Operadora",
      email: "olga@empresa-a.ec",
      role: "OPERATOR",
      status: "DEACTIVATED",
    });
    // Un tercero corregido después de emitir: el comprobante conserva lo que congeló.
    ids.frozen = (
      await insertDocument(prisma, a, "SIGNED", {
        issueDate: "2026-09-25",
        buyer: { identification: "0912345678", name: "Cliente Original" },
      })
    ).id;
    ids.corrected = await insertGuideParty(prisma, a, "0912345678", {
      legalName: "Cliente Corregido",
      roles: ["CUSTOMER"],
    });
    await prisma.party.update({ where: { id: ids.corrected }, data: { status: "INACTIVE" } });
    // Una factura autorizada sin RIDE con su generación detenida.
    ids.stopped = (await insertDocument(prisma, a, "AUTHORIZED", { issueDate: "2026-09-26" })).id;
    await prisma.job.create({
      data: {
        companyId: a.companyId,
        type: "document.render_ride",
        dedupeKey: `document.render_ride:${ids.stopped}`,
        documentId: ids.stopped,
        status: "STOPPED",
        scheduledAt: new Date("2026-09-26T12:00:00Z"),
        nextAttemptAt: new Date("2026-09-26T12:00:00Z"),
        attemptCount: 5,
        maxAttempts: 5,
        origin: "AUTOMATIC",
        lastErrorCode: "RIDE_SOURCE_INTEGRITY",
        lastErrorClass: "DETERMINISTIC",
        completedAt: new Date("2026-09-26T12:05:00Z"),
      },
    });
    // La otra empresa: un comprobante, un tercero y un evento propios.
    ids.other = (await insertDocument(prisma, b, "SIGNED")).id;
    ids.otherParty = await insertGuideParty(prisma, b, "1790099999001", { legalName: "Otra S.A." });
  }, 300_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe("configuración, firmas y secuenciales (tarea 3.1)", () => {
    it("da cada versión de la configuración con su vigencia y la actual marcada", async () => {
      const versions = await rows(sources.configVersions);
      expect(
        versions.map((v) => [v.version, v.current, v.environment, v.legalName, v.logoAssetId]),
      ).toEqual([
        [1, false, "TEST", "COMERCIAL ANDINA", extras.logo],
        [2, true, "PRODUCTION", "COMERCIAL ANDINA S.A.", extras.logo],
      ]);
      expect(await rows(sources.configVersions, b)).toEqual([]);
    });

    it("lista los logos con lo que los verifica y los lee por identificador", async () => {
      expect(await rows(sources.logos)).toEqual([
        {
          assetId: extras.logo,
          mimeType: "image/png",
          sizeBytes: LOGO.length,
          sha256: sha256(LOGO),
        },
      ]);
      const read = await sources.readLogo(db.database.prisma, a.companyId, extras.logo!);
      expect(Buffer.from(read!.content)).toEqual(LOGO);
      expect(await sources.readLogo(db.database.prisma, b.companyId, extras.logo!)).toBeNull();
    });

    it("da los establecimientos, los puntos en todos sus estados y el punto predeterminado", async () => {
      const establishments = await rows<{ code: string; active: boolean }>(sources.establishments);
      expect(establishments.map((e) => [e.code, e.active])).toEqual([
        ["001", true],
        ["002", true],
      ]);
      const points = await rows<{ id: string; active: boolean }>(sources.emissionPoints);
      expect(points).toHaveLength(2);
      expect(points.find((p) => p.id === a.points[1]!.emissionPointId)?.active).toBe(false);
      expect(await rows(sources.defaultEmissionPoints)).toEqual([
        { userId: a.adminId, emissionPointId: a.points[0]!.emissionPointId },
      ]);
      expect((await rows(sources.establishments, b)).length).toBe(1);
    });

    it("da los secuenciales y las habilitaciones de catálogos de la empresa", async () => {
      const sequences = await rows<{
        environment: string;
        documentType: string;
        nextNumber: number;
      }>(sources.sequences);
      expect(sequences.length).toBeGreaterThan(0);
      // El arnés reserva en Pruebas; cada contador tiene su ambiente, su tipo y su siguiente número.
      expect(
        sequences.every((s) => ["TEST", "PRODUCTION"].includes(s.environment) && s.nextNumber > 0),
      ).toBe(true);
      expect(new Set(sequences.map((s) => s.documentType))).toEqual(
        new Set(["01", "03", "04", "05", "06", "07"]),
      );
      expect(await rows(sources.catalogSettings)).toEqual([
        expect.objectContaining({ catalogType: "iva-rate", entryKey: "4", enabled: false }),
      ]);
      expect(await rows(sources.catalogSettings, b)).toEqual([]);
    });

    it("da solo los metadatos de cada firma, también la reemplazada", async () => {
      const certificates = await rows<Record<string, unknown>>(sources.certificates);
      expect(certificates.map((c) => [c.status, c.serialNumber])).toEqual([
        ["REPLACED", "01"],
        ["ACTIVE", "02"],
      ]);
      // Solo metadatos: ninguna columna de la custodia.
      for (const certificate of certificates)
        expect(Object.keys(certificate).sort()).toEqual(
          [
            "createdAt",
            "detectedRuc",
            "fingerprintSha256",
            "issuer",
            "keyAlgorithm",
            "keyBits",
            "notAfter",
            "notBefore",
            "replacedAt",
            "serialNumber",
            "status",
            "subject",
            "uploadedBy",
          ].sort(),
        );
      expect(await rows(sources.certificates, b)).toEqual([]);
    });
  });

  describe("usuarios, terceros, productos, inventario y auditoría (tarea 3.2)", () => {
    it("da los miembros con su nombre, su correo, su rol y su estado, y nada de la autenticación", async () => {
      const users = await rows<Record<string, unknown>>(sources.users);
      expect(users.map((u) => [u.role, u.status])).toEqual(
        expect.arrayContaining([
          ["ADMIN", "ACTIVE"],
          ["OPERATOR", "DEACTIVATED"],
        ]),
      );
      for (const user of users)
        expect(Object.keys(user).sort()).toEqual(
          ["email", "memberSince", "name", "role", "status", "userId"].sort(),
        );
      expect(users.some((u) => u.email === "olga@empresa-a.ec")).toBe(true);
    });

    it("da los terceros en todos sus estados con sus datos vigentes", async () => {
      const parties = await rows<{
        identification: string;
        legalName: string;
        status: string;
        systemRecord: string | null;
      }>(sources.parties);
      expect(parties.find((p) => p.identification === "0912345678")).toMatchObject({
        legalName: "Cliente Corregido",
        status: "INACTIVE",
      });
      expect(parties.some((p) => p.systemRecord !== null)).toBe(true);
      expect(parties.some((p) => p.legalName === "Otra S.A.")).toBe(false);
    });

    it("da los productos con su precio exacto y sus impuestos", async () => {
      const products = await rows<{ id: string; name: string; unitPrice: string }>(
        sources.products,
      );
      expect(products.map((p) => p.name)).toEqual(
        expect.arrayContaining(["Tornillo", "Arena a granel"]),
      );
      expect(products.every((p) => /^-?\d+(\.\d+)?$/.test(p.unitPrice))).toBe(true);
      const taxes = await rows<{ productId: string }>(sources.productTaxes);
      expect(taxes.every((t) => products.some((p) => p.id === t.productId))).toBe(true);
    });

    it("da las existencias y el kárdex como los registra el inventario", async () => {
      const balances = await rows<{ productId: string; balance: string }>(sources.stockBalances);
      expect(balances).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ productId: ids.product, balance: "14.5" }),
          expect.objectContaining({ productId: ids.hugeProduct, balance: "999999999999.999999" }),
        ]),
      );
      const movements = await rows<{
        productId: string;
        movementType: string;
        delta: string;
        balanceAfter: string;
      }>(sources.stockMovements);
      expect(
        movements
          .filter((m) => m.productId === ids.product)
          .map((m) => [m.movementType, m.delta, m.balanceAfter]),
      ).toEqual([
        ["INICIAL", "20", "20"],
        ["SALIDA_FACTURA", "-5", "15"],
        ["AJUSTE", "-0.5", "14.5"],
      ]);
    });

    it("da los eventos de auditoría con lo que la auditoría conserva", async () => {
      const events = await rows<Record<string, unknown>>(sources.auditEvents);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "taxpayer.configured",
            actorType: "USER",
            actorUserId: a.adminId,
            changes: { legalName: "COMERCIAL ANDINA S.A." },
          }),
        ]),
      );
      for (const event of events)
        expect(Object.keys(event).sort()).toEqual(
          ["action", "actorType", "actorUserId", "changes", "occurredAt", "targetUserId"].sort(),
        );
    });
  });

  describe("comprobantes, intentos, entregas y retenciones (tarea 3.3)", () => {
    it("da los comprobantes de los seis tipos en los dos ambientes, en el orden de las carpetas", async () => {
      const documents = await rows<{
        id: string;
        environment: string;
        documentType: string;
        documentNumber: string;
      }>(sources.documents);
      expect(new Set(documents.map((d) => d.documentType))).toEqual(
        new Set(["01", "03", "04", "05", "06", "07"]),
      );
      expect(new Set(documents.map((d) => d.environment))).toEqual(new Set(["TEST", "PRODUCTION"]));
      const keys = documents.map((d) => `${d.environment}/${d.documentType}/${d.documentNumber}`);
      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(keys.length);
      expect(documents.map((d) => d.id)).not.toContain(ids.other);
    });

    it("conserva el tercero congelado y los importes por tipo, sin inventar los de la guía", async () => {
      const documents = await rows<Record<string, unknown> & { id: string }>(sources.documents);
      expect(documents.find((d) => d.id === ids.frozen)).toMatchObject({
        counterpartIdentification: "0912345678",
        counterpartName: "Cliente Original",
      });
      expect(documents.find((d) => d.id === ids.guideMany)).toMatchObject({
        counterpartName: null,
        recipientCount: 3,
        subtotal: null,
        taxes: null,
        total: null,
      });
      expect(documents.find((d) => d.id === ids.withholding)).toMatchObject({
        subtotal: null,
        taxes: null,
      });
    });

    it("lleva el inventario de los artefactos, las respuestas y el estado del RIDE", async () => {
      const documents = await rows(sources.documents);
      const invoice = documents.find((d) => d.id === ids.invoice)!;
      expect(invoice.artifacts.map((x) => x.kind)).toEqual([
        "AUTHORIZED_XML",
        "RIDE_PDF",
        "SIGNED_XML",
      ]);
      expect(invoice.artifacts.find((x) => x.kind === "RIDE_PDF")?.sha256).toBe(sha256(RIDE_PDF));
      expect(
        invoice.responses.map((r) => [r.attemptNumber, r.operation, r.truncated, r.sha256]),
      ).toEqual([
        [1, "RECEPTION", false, sha256(RECEPTION_RESPONSE)],
        [2, "AUTHORIZATION", true, sha256(AUTHORIZATION_RESPONSE)],
      ]);
      expect(documents.find((d) => d.id === ids.stopped)?.rideJobStatus).toBe("STOPPED");
    });

    it("da los intentos, el que no tuvo respuesta sin archivo, las transiciones y las entregas", async () => {
      const attempts = await rows<{
        attemptNumber: number;
        transportOutcome: string;
        response: unknown;
      }>(sources.attempts);
      expect(
        attempts.map((x) => [x.attemptNumber, x.transportOutcome, x.response === null]),
      ).toEqual([
        [1, "RESPONSE", false],
        [2, "RESPONSE", false],
        [3, "NOT_SENT", true],
      ]);
      const transitions = await rows<{ toState: string; actorType: string }>(sources.transitions);
      expect(transitions.map((t) => [t.toState, t.actorType])).toEqual([
        ["RESERVED", "USER"],
        ["SIGNED", "SYSTEM"],
      ]);
      expect(await rows(sources.deliveries)).toEqual([
        expect.objectContaining({
          event: "DOWNLOAD",
          artifactKind: "RIDE_PDF",
          actorUserId: a.adminId,
        }),
      ]);
      expect(await rows(sources.attempts, b)).toEqual([]);
    });

    it("da los destinatarios de las guías y las líneas de las retenciones", async () => {
      const recipients = await rows<{ position: number }>(sources.recipients);
      expect(recipients.length).toBeGreaterThanOrEqual(4);
      const lines = await rows<{ accessKey: string; base: string; amount: string }>(
        sources.withholdingLines,
      );
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => /^\d{49}$/.test(l.accessKey))).toBe(true);
    });

    it("lee el snapshot, los artefactos y las respuestas por identificador, solo de la empresa", async () => {
      const prisma = db.database.prisma;
      const snapshot = (await sources.readSnapshot(prisma, a.companyId, ids.invoice!)) as {
        snapshotVersion: number;
      };
      expect(snapshot.snapshotVersion).toEqual(expect.any(Number));
      expect(await sources.readSnapshot(prisma, b.companyId, ids.invoice!)).toBeNull();
      const ride = await sources.readArtifact(prisma, a.companyId, extras.ride!);
      expect(Buffer.from(ride!.content)).toEqual(RIDE_PDF);
      expect(ride!.sha256).toBe(sha256(RIDE_PDF));
      expect(await sources.readArtifact(prisma, b.companyId, extras.ride!)).toBeNull();
      const response = await sources.readSriResponse(
        prisma,
        a.companyId,
        extras.authorizationAttempt!,
      );
      expect(Buffer.from(response!.content)).toEqual(AUTHORIZATION_RESPONSE);
      expect(await sources.readSriResponse(prisma, a.companyId, randomUUID())).toBeNull();
    });
  });
});
