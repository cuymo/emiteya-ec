// Límite del cuerpo de los borradores de liquidación de compra contra el backend real
// (add-purchase-settlements, tarea 6.3, design D22): main.ts como proceso, con los límites de la
// liquidación en sus máximos absolutos (500 líneas y 20 pagos). Crear y actualizar un borrador
// admiten un cuerpo de hasta 4 MiB, de modo que un borrador en los máximos absolutos con textos
// multibyte de longitud máxima, también escapados como `\u`, llega a la validación del dominio; un
// cuerpo mayor recibe 413 antes de ella; dentro de los 4 MiB rigen el contrato y los límites de
// recursos; y la emisión y las demás rutas conservan el límite global de 100 KB. Es una defensa de
// recursos HTTP del sistema: no guarda relación con Q-47 ni con el tamaño del XML.
import { randomBytes } from "node:crypto";
import type { PurchaseSettlementDraftView } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-liquidacion-cuerpo.ec", password: "contrasena-admin-e2e-1" };
const DRAFT_LIMIT = 4_194_304;
const GLOBAL_LIMIT = 100 * 1024;
/**
 * Texto de exactamente `length` unidades con caracteres de 4 bytes (al inicio) y de 2 y 3 bytes en
 * UTF-8: el peor caso de bytes por carácter que admite el contrato, sin saltos de línea.
 */
const multibyte = (prefix: string, length: number) =>
  `📦 ${prefix} ${"€中ñÁ漢字ü".repeat(length)}`.slice(0, length);

describe("límite del cuerpo de los borradores de liquidación de compra", () => {
  let backend: E2eBackend;
  let cookie: string;
  let ids: { point: string; supplier: string; product: string };

  const send = (method: string, path: string, body: string) =>
    fetch(`${backend.base}/api/v1${path}`, {
      method,
      headers: { cookie, origin: E2E_ORIGIN, "content-type": "application/json" },
      body,
    });
  const json = async (res: Response) =>
    (await res.json()) as {
      data: PurchaseSettlementDraftView;
      error?: { code: string; message: string };
    };
  const draftBody = (lines: unknown[], payments: unknown[]) => ({
    emissionPointId: ids.point,
    supplierPartyId: ids.supplier,
    supplierAddress: multibyte("Dirección", 300),
    lines,
    payments,
  });
  /**
   * El peor caso de los máximos absolutos: 500 líneas con códigos, unidad y descripción multibyte en
   * su longitud máxima, y 20 pagos con la unidad de tiempo al máximo. Cada línea vale 1.00 al 0 %, y
   * los pagos de 25.00 suman el importe total de 500.00.
   */
  const maximal = () =>
    draftBody(
      Array.from({ length: 500 }, (_, index) => ({
        productId: index === 0 ? ids.product : null,
        mainCode: multibyte(`M${index}`, 25),
        auxiliaryCode: multibyte(`A${index}`, 25),
        description: multibyte(`Línea ${index}`, 300),
        unit: multibyte(`U${index}`, 50),
        quantity: "1.000000",
        unitPrice: "1.000000",
        discount: "0.00",
        ivaRate: "0",
      })),
      Array.from({ length: 20 }, (_, index) => ({
        paymentMethod: index % 2 === 0 ? "01" : "20",
        total: "25.00",
        term: "99999999999999",
        timeUnit: multibyte(`${index}`, 10),
      })),
    );
  /** El mismo JSON con cada carácter no ASCII escapado como `\uXXXX`: el cuerpo más pesado. */
  const escaped = (value: unknown) =>
    JSON.stringify(value).replace(
      /[\u007f-￿]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );

  beforeAll(async () => {
    backend = await startE2eBackend({
      label: "end_to_end_purchase_settlement_body",
      admin: ADMIN,
      env: {
        CERTIFICATE_CUSTODY: "enabled",
        CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
        PURCHASE_SETTLEMENT_MAX_LINES: "500",
        PURCHASE_SETTLEMENT_MAX_PAYMENTS: "20",
        RIDE_SWEEP_INTERVAL_SECONDS: "86400",
      },
    });
    const session = await backend.signIn(ADMIN.email, ADMIN.password);
    expect(session.status).toBe(200);
    cookie = session.cookie;
    const call = async (method: string, path: string, body: unknown) => {
      const res = await backend.fetchApi(method, path, cookie, body);
      const data = (await res.json()) as { data: { id: string } };
      expect(res.status, JSON.stringify(data)).toBeLessThan(300);
      return data.data;
    };
    await call("PUT", "/taxpayer", {
      ruc: FIXTURE_RUC,
      legalName: "COMERCIAL ANDINA S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    const establishment = await call("POST", "/establishments", {
      code: "001",
      address: "Av. 6 de Diciembre, Quito",
    });
    const point = await call("POST", `/establishments/${establishment.id}/emission-points`, {
      code: "001",
    });
    // La firma sintética de los fixtures: la vista previa exige una firma utilizable.
    await call("PUT", "/signing-certificate", {
      file: readFixture(inject("p12FixturesDir"), "sd-utf8.modern.p12").toString("base64"),
      password: FIXTURE_PASSWORD,
      expectedCurrentId: null,
    });
    const supplier = await call("POST", "/parties", {
      identificationType: "05",
      identification: "1710034065",
      legalName: "María Quishpe",
      address: "Comunidad San Pablo, Cayambe",
      roles: ["SUPPLIER"],
    });
    const product = await call("POST", "/products", {
      kind: "GOOD",
      mainCode: "CAC-01",
      name: "Cacao en grano",
      unitPrice: "4.50",
      taxes: { iva: "0" },
    });
    ids = { point: point.id, supplier: supplier.id, product: product.id };
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
  });

  it("A. un borrador dentro de los valores por defecto se acepta", async () => {
    const res = await send(
      "POST",
      "/purchase-settlements/drafts",
      JSON.stringify(
        draftBody(
          [
            {
              productId: null,
              description: "Saco de cacao en grano, 45 kg",
              quantity: "10",
              unitPrice: "4.50",
              discount: "5.00",
              ivaRate: "4",
            },
          ],
          [{ paymentMethod: "01", total: "46.00", term: "0", timeUnit: "días" }],
        ),
      ),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).data.preview.issues).toEqual([]);
  });

  it("B. un borrador en los máximos absolutos con textos multibyte no recibe 413 y llega a la validación del dominio", async () => {
    const body = maximal();
    const raw = JSON.stringify(body);
    const heavy = escaped(body);
    const bytes = (text: string) => Buffer.byteLength(text);
    // Muy por encima del límite global y dentro del de los borradores, también con escapes.
    expect(bytes(raw)).toBeGreaterThan(5 * GLOBAL_LIMIT);
    expect(bytes(heavy)).toBeGreaterThan(bytes(raw));
    expect(bytes(heavy)).toBeLessThan(DRAFT_LIMIT);

    const created = await send("POST", "/purchase-settlements/drafts", raw);
    expect(created.status).toBe(201);
    const draft = (await json(created)).data;
    expect(draft.preview.issues).toEqual([]);
    expect(draft.lines).toHaveLength(500);
    expect(draft.payments).toHaveLength(20);
    expect(draft.preview.totals?.total).toBe("500.00");
    // El texto multibyte llega intacto al borrador.
    expect(draft.lines[1]!.description).toBe(multibyte("Línea 1", 300));
    expect(draft.supplierAddress).toBe(multibyte("Dirección", 300));

    // Actualizar con el mismo contenido escapado: el cuerpo más pesado también pasa.
    const updated = await send(
      "PUT",
      `/purchase-settlements/drafts/${draft.id}`,
      heavy.replace(/^\{/, `{"expectedVersion":${draft.version},`),
    );
    expect(updated.status).toBe(200);
    const again = (await json(updated)).data;
    expect(again.preview.issues).toEqual([]);
    expect(again.payments[19]!.timeUnit).toBe(multibyte("19", 10));
  });

  it("C. un cuerpo de más de 4 MiB recibe 413 antes del dominio, al crear y al actualizar", async () => {
    const oversized = JSON.stringify({ ...draftBody([], []), filler: "x".repeat(DRAFT_LIMIT) });
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(DRAFT_LIMIT);
    const created = await send("POST", "/purchase-settlements/drafts", oversized);
    expect([created.status, (await json(created)).error?.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    const updated = await send("PUT", "/purchase-settlements/drafts/cualquiera", oversized);
    expect([updated.status, (await json(updated)).error?.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
  });

  it("D. un cuerpo de menos de 4 MiB por encima de los límites se rechaza por esos límites, no por tamaño", async () => {
    const line = {
      productId: null,
      description: multibyte("Línea", 300),
      quantity: "1",
      unitPrice: "1",
      ivaRate: "0",
    };
    const payment = { paymentMethod: "01", total: "1.00", term: "0", timeUnit: "días" };
    const tooManyLines = JSON.stringify(
      draftBody(
        Array.from({ length: 501 }, () => line),
        [payment],
      ),
    );
    expect(Buffer.byteLength(tooManyLines)).toBeGreaterThan(GLOBAL_LIMIT);
    expect(Buffer.byteLength(tooManyLines)).toBeLessThan(DRAFT_LIMIT);
    const lines = await send("POST", "/purchase-settlements/drafts", tooManyLines);
    expect(lines.status).toBe(400);
    expect((await json(lines)).error).toMatchObject({
      code: "VALIDATION_ERROR",
      message:
        "La liquidación admite como máximo 500 líneas. Es una defensa de recursos del sistema, no un límite del SRI.",
    });
    const tooManyPayments = JSON.stringify(
      draftBody(
        Array.from({ length: 200 }, () => line),
        Array.from({ length: 21 }, () => payment),
      ),
    );
    expect(Buffer.byteLength(tooManyPayments)).toBeGreaterThan(GLOBAL_LIMIT);
    const payments = await send("POST", "/purchase-settlements/drafts", tooManyPayments);
    expect(payments.status).toBe(400);
    expect((await json(payments)).error?.message).toBe(
      "La liquidación admite como máximo 20 pagos. Es una defensa de recursos del sistema, no un límite del SRI.",
    );
  });

  it("E. la emisión, la eliminación del borrador y las demás rutas conservan el límite de 100 KB", async () => {
    const filler = "x".repeat(GLOBAL_LIMIT + 1024);
    for (const [method, path, body] of [
      [
        "POST",
        "/purchase-settlements",
        { draftId: "x", expectedVersion: 1, declarations: { policyVersion: 1, statements: [] } },
      ],
      ["DELETE", "/purchase-settlements/drafts/x", {}],
      ["POST", "/purchase-settlements/x/reconciliations", { reason: "Revisión" }],
      ["POST", "/parties", { identificationType: "05", identification: "1710034065" }],
      ["POST", "/invoices/drafts", { emissionPointId: "x" }],
      ["POST", "/withholding-receipts/drafts", { partyId: "x" }],
    ] as const) {
      const res = await send(method, path, JSON.stringify({ ...body, filler }));
      expect([method, path, res.status]).toEqual([method, path, 413]);
    }
  });
});
