// Registro de idempotencia en PostgreSQL (add-invoice-emission, tarea 8.1, design D8): alcance
// empresa, operación y clave, con el índice único como última defensa también entre transacciones
// simultáneas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  IdempotencyCollisionError,
  requestFingerprint,
} from "../../src/platform/idempotency/idempotency.ts";
import { createIdempotencyStore } from "../../src/platform/idempotency/prisma-idempotency-store.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertReservedDocument, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { deferred } from "./fiscal-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

describe("registro de idempotencia", () => {
  let db: MigratedSchema;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const fingerprint = requestFingerprint("invoice.emit", { draftId: "d", expectedVersion: 1 });

  beforeAll(async () => {
    db = await createMigratedSchema("idempotency_store");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const api = buildTaxpayerApp(db);
    a = await readyCompany(api, db, { slug: "a" });
    b = await readyCompany(api, db, { slug: "b" });
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  const record = (company: ReadyCompany, documentId: string, key: string) => ({
    companyId: company.companyId,
    operation: "invoice.emit" as const,
    key,
    fingerprint,
    documentId,
    createdBy: company.adminId,
  });

  it("guarda y encuentra por empresa, operación y clave", async () => {
    const store = createIdempotencyStore(db.database.prisma);
    const document = await insertReservedDocument(db, a);
    await store.insert(record(a, document.id, "clave-1"));
    expect(await store.find(a.companyId, "invoice.emit", "clave-1")).toMatchObject({
      key: "clave-1",
      fingerprint,
      documentId: document.id,
      createdBy: a.adminId,
    });
    expect(await store.find(b.companyId, "invoice.emit", "clave-1")).toBeNull();
    // La misma clave en otra empresa es otro registro.
    const other = await insertReservedDocument(db, b);
    await store.insert(record(b, other.id, "clave-1"));
    expect((await store.find(b.companyId, "invoice.emit", "clave-1"))?.documentId).toBe(other.id);
  });

  it("una segunda inserción de la misma clave es una colisión", async () => {
    const store = createIdempotencyStore(db.database.prisma);
    const first = await insertReservedDocument(db, a);
    const second = await insertReservedDocument(db, a);
    await store.insert(record(a, first.id, "clave-2"));
    await expect(store.insert(record(a, second.id, "clave-2"))).rejects.toBeInstanceOf(
      IdempotencyCollisionError,
    );
  });

  it("entre transacciones simultáneas, la segunda espera y colisiona al confirmar la primera", async () => {
    const prisma = db.database.prisma;
    const first = await insertReservedDocument(db, a);
    const second = await insertReservedDocument(db, a);
    const inserted = deferred();
    const release = deferred();
    const winner = prisma.$transaction(async (tx) => {
      await createIdempotencyStore(tx).insert(record(a, first.id, "clave-3"));
      inserted.resolve();
      await release.promise;
    });
    await inserted.promise;
    const loser = prisma.$transaction((tx) =>
      createIdempotencyStore(tx).insert(record(a, second.id, "clave-3")),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release.resolve();
    await winner;
    await expect(loser).rejects.toBeInstanceOf(IdempotencyCollisionError);
    expect(
      (await createIdempotencyStore(prisma).find(a.companyId, "invoice.emit", "clave-3"))
        ?.documentId,
    ).toBe(first.id);
  });
});
