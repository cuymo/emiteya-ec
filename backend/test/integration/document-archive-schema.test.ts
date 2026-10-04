// Invariantes de la migración add_document_archive en PostgreSQL (design D4 y D9): el `RIDE_PDF`
// único e inmutable con `application/pdf`, los artefactos XML anteriores intactos, y el historial de
// entregas de solo agregado, por empresa, atado a un artefacto existente y a un usuario que no se
// puede borrar. Aplica las migraciones anteriores, escribe artefactos como los de una instalación
// existente y después aplica la del archivo.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertMember } from "./fixtures.ts";
import { insertDocument, sha256, type TestDocument } from "./transmission-harness.ts";

const ARCHIVE_MIGRATION = "20261006100000_add_document_archive";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const PDF = Buffer.from("%PDF-1.3\n%RIDE sintético\n%%EOF\n");
const REQUEST_ID = "req-archivo-0001";

describe("archivo documental en la base de datos", () => {
  const name = `t_archive_schema_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let authorized: TestDocument;
  let existingXml: { kind: string; sha256: string }[];

  const execute = (migration: string) => {
    const result = runBin(
      "prisma",
      ["db", "execute", "--file", `prisma/migrations/${migration}/migration.sql`],
      { DATABASE_URL: url },
    );
    if (result.status !== 0) throw new Error(`${migration}:\n${result.stdout}${result.stderr}`);
  };
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const artifact = (document: TestDocument, kind: string, mediaType: string, content: Buffer) =>
    database.prisma.documentArtifact.create({
      data: {
        companyId: document.companyId,
        documentId: document.id,
        kind,
        mediaType,
        content: new Uint8Array(content),
        sizeBytes: content.length,
        sha256: sha256(content),
        metadata: {},
      },
    });
  const delivery = (
    document: TestDocument,
    data: Partial<{
      companyId: string;
      event: string;
      artifactKind: string;
      actorUserId: string;
      requestId: string;
    }> = {},
  ) =>
    database.prisma.documentDeliveryEvent.create({
      data: {
        companyId: data.companyId ?? document.companyId,
        documentId: document.id,
        event: data.event ?? "DOWNLOAD",
        artifactKind: data.artifactKind ?? "RIDE_PDF",
        artifactSha256: sha256(PDF),
        actorUserId: data.actorUserId ?? companyA.adminId,
        requestId: data.requestId ?? REQUEST_ID,
      },
    });

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < ARCHIVE_MIGRATION)) execute(migration);

    // Una instalación con comprobantes autorizados antes del archivo documental.
    companyA = await insertFiscalCompany(database.prisma, "Archivo A", 1);
    companyB = await insertFiscalCompany(database.prisma, "Archivo B", 1);
    authorized = await insertDocument(database.prisma, companyA, "AUTHORIZED");
    await artifact(
      authorized,
      "AUTHORIZED_XML",
      "application/xml",
      Buffer.from(`<autorizacion>${authorized.accessKey}</autorizacion>`),
    );
    existingXml = await database.prisma.documentArtifact.findMany({
      where: { documentId: authorized.id },
      select: { kind: true, sha256: true },
      orderBy: { kind: "asc" },
    });

    execute(ARCHIVE_MIGRATION);
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("conserva los artefactos XML existentes y aplica el CHECK nuevo", async () => {
    expect(
      await database.prisma.documentArtifact.findMany({
        where: { documentId: authorized.id },
        select: { kind: true, sha256: true },
        orderBy: { kind: "asc" },
      }),
    ).toEqual(existingXml);
    expect(existingXml.map((row) => row.kind)).toEqual(["AUTHORIZED_XML", "SIGNED_XML"]);
    const [check] = await database.prisma.$queryRawUnsafe<{ definition: string }[]>(
      `SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = '${name}' AND c.conname = 'document_artifact_values_check'`,
    );
    expect(check!.definition).toContain("RIDE_PDF");
  });

  it("guarda un RIDE_PDF único con application/pdf y rechaza otro tipo de medio", async () => {
    const document = await insertDocument(database.prisma, companyA, "AUTHORIZED");
    expect(await fails(artifact(document, "RIDE_PDF", "application/xml", PDF))).toContain(
      "document_artifact_values_check",
    );
    expect(await fails(artifact(document, "SIGNED_XML", "application/pdf", PDF))).not.toBeNull();
    await artifact(document, "RIDE_PDF", "application/pdf", PDF);
    expect(await fails(artifact(document, "RIDE_PDF", "application/pdf", PDF))).toContain(
      "Unique constraint",
    );
  });

  it("impide cambiar o borrar un RIDE guardado", async () => {
    const document = await insertDocument(database.prisma, companyA, "AUTHORIZED");
    const ride = await artifact(document, "RIDE_PDF", "application/pdf", PDF);
    expect(
      await fails(
        database.prisma.documentArtifact.update({
          where: { id: ride.id },
          data: { metadata: { regenerated: true } },
        }),
      ),
    ).toContain("document_artifact no admite UPDATE");
    expect(
      await fails(database.prisma.documentArtifact.delete({ where: { id: ride.id } })),
    ).toContain("document_artifact no admite DELETE");
  });

  it("guarda entregas y las hace de solo agregado, sin truncado", async () => {
    const document = await insertDocument(database.prisma, companyA, "AUTHORIZED");
    await artifact(document, "RIDE_PDF", "application/pdf", PDF);
    const download = await delivery(document);
    const print = await delivery(document, { event: "PRINT_REQUESTED" });
    await delivery(document, { artifactKind: "SIGNED_XML" });
    expect([download.event, print.event]).toEqual(["DOWNLOAD", "PRINT_REQUESTED"]);
    expect(
      await fails(
        database.prisma.documentDeliveryEvent.update({
          where: { id: download.id },
          data: { event: "PRINT_REQUESTED" },
        }),
      ),
    ).toContain("document_delivery_event no admite UPDATE");
    expect(
      await fails(database.prisma.documentDeliveryEvent.delete({ where: { id: download.id } })),
    ).toContain("document_delivery_event no admite DELETE");
    expect(
      await fails(
        database.prisma.$executeRawUnsafe(`TRUNCATE "${name}"."document_delivery_event"`),
      ),
    ).toContain("document_delivery_event no admite TRUNCATE");
  });

  it("rechaza entregas de otra empresa, de un artefacto inexistente o con valores fuera de la lista", async () => {
    const document = await insertDocument(database.prisma, companyA, "AUTHORIZED");
    await artifact(document, "RIDE_PDF", "application/pdf", PDF);
    expect(await fails(delivery(document, { companyId: companyB.companyId }))).toContain(
      "document_delivery_event_company_id_document_id_fkey",
    );
    expect(await fails(delivery(document, { artifactKind: "AUTHORIZED_XML" }))).toContain(
      "document_delivery_event_document_id_artifact_kind_fkey",
    );
    for (const event of ["PRINTED", "DELIVERED", "RECEIVED_BY_CUSTOMER", "EMAIL_SUBMITTED"]) {
      expect(await fails(delivery(document, { event }))).toContain(
        "document_delivery_event_values_check",
      );
    }
    expect(
      await fails(delivery(document, { event: "PRINT_REQUESTED", artifactKind: "SIGNED_XML" })),
    ).toContain("document_delivery_event_values_check");
    expect(await fails(delivery(document, { requestId: "corto" }))).toContain(
      "document_delivery_event_values_check",
    );
  });

  it("impide borrar un usuario con entregas", async () => {
    const document = await insertDocument(database.prisma, companyA, "AUTHORIZED");
    await artifact(document, "RIDE_PDF", "application/pdf", PDF);
    const operator = await insertMember(database.prisma, companyA.companyId, {
      name: "Operador con entregas",
      role: "OPERATOR",
    });
    await delivery(document, { actorUserId: operator.userId });
    expect(await fails(database.prisma.user.delete({ where: { id: operator.userId } }))).toContain(
      "document_delivery_event_actor_user_id_fkey",
    );
  });
});
