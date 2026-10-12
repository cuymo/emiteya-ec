// Concurrencia de la reserva de una nota de débito con PostgreSQL real (add-debit-notes, tarea 6.3,
// design D14): dos notas simultáneas de una misma factura son válidas y reciben secuenciales
// distintos, sin bloquear la factura; dos emisiones simultáneas del mismo borrador con claves
// distintas dejan una sola nota y la otra responde 409. Se repite varias rondas para descartar
// fallos intermitentes.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { DebitNoteView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = { data: DebitNoteView & { id: string; version: number }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] };
const ROUNDS = 4;

describe("concurrencia de la reserva de una nota de débito", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let good: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const invoice = () =>
    insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: good, quantity: "10", unitPrice: "10.00" }],
    );
  const draft = async (invoiceId: string, amount = "20.00") => {
    const res = await request(api.app)
      .post("/api/v1/debit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId,
        emissionPointId: a.emissionPointId,
        paymentMethod: "20",
        concepts: [
          {
            cause: "LATE_PAYMENT_INTEREST",
            description: "Intereses de mora",
            amount,
            taxTreatment: "2:4",
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (created: { id: string; version: number }, key = randomUUID()) =>
    request(api.app)
      .post("/api/v1/debit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({ draftId: created.id, expectedVersion: created.version, declarations: DECLARATIONS });

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_concurrency");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "concurrencia-nd",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    good = await insertProduct(db.database.prisma, {
      companyId: a.companyId,
      adminId: a.adminId,
      points: [],
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("dos notas simultáneas de una misma factura son válidas y tienen secuenciales distintos", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const target = await invoice();
      const [first, second] = await Promise.all([draft(target.id), draft(target.id, "5.00")]);
      const [one, two] = await Promise.all([emit(first), emit(second)]);
      expect([one.status, two.status], JSON.stringify([one.body, two.body])).toEqual([201, 201]);
      expect(bodyOf(one).data.documentNumber).not.toBe(bodyOf(two).data.documentNumber);
      const supports = await db.database.prisma.debitNoteSupport.findMany({
        where: { invoiceId: target.id },
      });
      expect(supports.map((support) => support.debitNoteId).sort()).toEqual(
        [bodyOf(one).data.id, bodyOf(two).data.id].sort(),
      );
    }
    // Los secuenciales de las notas no tienen huecos ni repetidos.
    const numbers = (
      await db.database.prisma.electronicDocument.findMany({
        where: { companyId: a.companyId, documentType: "05" },
        select: { sequential: true },
      })
    )
      .map((document) => document.sequential)
      .sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
  });

  it("dos emisiones simultáneas del mismo borrador con claves distintas dejan una sola nota", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const created = await draft((await invoice()).id);
      const before = await db.database.prisma.electronicDocument.count({
        where: { documentType: "05" },
      });
      const results = await Promise.all([emit(created), emit(created)]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses, JSON.stringify(results.map((res) => res.body as unknown))).toEqual([
        201, 409,
      ]);
      const conflict = results.find((res) => res.status === 409)!;
      expect(bodyOf(conflict).error.code).toBe("DEBIT_NOTE_DRAFT_ALREADY_EMITTED");
      expect(
        await db.database.prisma.electronicDocument.count({ where: { documentType: "05" } }),
      ).toBe(before + 1);
    }
  });
});
