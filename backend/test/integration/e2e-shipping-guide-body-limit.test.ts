// Límite del cuerpo de los borradores de guía contra el backend real (add-shipping-guides, tarea 6.3,
// design D23, segunda capa): main.ts como proceso, con los límites de la guía en sus máximos
// absolutos. Crear y actualizar un borrador admiten un cuerpo de hasta 2 MiB, de modo que un
// borrador en los máximos absolutos con textos multibyte de longitud máxima llega a la validación del
// dominio; un cuerpo mayor recibe 413 antes de ella; dentro de los 2 MiB rigen el contrato y los
// límites estructurales; y la emisión y las demás rutas conservan el límite global de 100 KB.
import { randomBytes } from "node:crypto";
import type { ShippingGuideDraftView } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-guia-cuerpo.ec", password: "contrasena-admin-e2e-1" };
const DRAFT_LIMIT = 2_097_152;
const GLOBAL_LIMIT = 100 * 1024;
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
  new Date(),
);
/**
 * Texto de exactamente `length` unidades con caracteres de 4 bytes (al inicio) y de 2 y 3 bytes en
 * UTF-8: el peor caso de bytes por carácter que admite el contrato, sin saltos de línea.
 */
const multibyte = (prefix: string, length: number) =>
  `📦 ${prefix} ${"€中ñÁ漢字ü".repeat(length)}`.slice(0, length);

describe("límite del cuerpo de los borradores de guía", () => {
  let backend: E2eBackend;
  let cookie: string;
  let ids: { point: string; origin: string; destination: string; party: string; product: string };

  const send = (method: string, path: string, body: string) =>
    fetch(`${backend.base}/api/v1${path}`, {
      method,
      headers: { cookie, origin: E2E_ORIGIN, "content-type": "application/json" },
      body,
    });
  const json = async (res: Response) =>
    (await res.json()) as {
      data: ShippingGuideDraftView;
      error?: { code: string; message: string };
    };
  const draftBody = (recipients: unknown[]) => ({
    emissionPointId: ids.point,
    originEstablishmentId: ids.origin,
    transporter: { source: "SELF" },
    plate: "PAA-1234",
    transportStart: TODAY,
    transportEnd: TODAY,
    recipients,
  });
  /** El peor caso de los máximos absolutos: 50 destinatarios × 6 detalles, textos multibyte al máximo. */
  const maximal = () =>
    draftBody(
      Array.from({ length: 50 }, (_, r) => {
        const details = Array.from({ length: 6 }, (_, k) =>
          k === 0
            ? {
                productId: ids.product,
                description: multibyte(`Producto ${r}`, 300),
                quantity: "999999999999.999999",
              }
            : {
                productId: null,
                mainCode: multibyte(`M${r}${k}`, 25),
                auxiliaryCode: multibyte(`A${r}${k}`, 25),
                description: multibyte(`Mercancía ${r}.${k}`, 300),
                quantity: "999999999999.999999",
              },
        );
        const texts = {
          motive: multibyte(`Motivo ${r}`, 300),
          route: multibyte(`Ruta ${r}`, 300),
          details,
        };
        return r === 49
          ? {
              recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: ids.destination },
              support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
              ...texts,
            }
          : {
              recipient: { kind: "PARTY", partyId: ids.party },
              address: multibyte(`Dirección ${r}`, 300),
              destinationEstablishmentCode: "001",
              support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
              ...texts,
            };
      }),
    );
  /** El mismo JSON con cada carácter no ASCII escapado como `\uXXXX`: el cuerpo más pesado. */
  const escaped = (value: unknown) =>
    JSON.stringify(value).replace(
      /[\u007f-￿]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );

  beforeAll(async () => {
    backend = await startE2eBackend({
      label: "end_to_end_shipping_guide_body",
      admin: ADMIN,
      env: {
        CERTIFICATE_CUSTODY: "enabled",
        CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
        SHIPPING_GUIDE_MAX_RECIPIENTS: "50",
        SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT: "100",
        SHIPPING_GUIDE_MAX_DETAILS: "300",
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
    const origin = await call("POST", "/establishments", {
      code: "001",
      address: "Av. 6 de Diciembre, Quito",
    });
    const point = await call("POST", `/establishments/${origin.id}/emission-points`, {
      code: "001",
    });
    const destination = await call("POST", "/establishments", {
      code: "002",
      address: "Bodega sur, Quito",
    });
    // La firma sintética de los fixtures: la vista previa exige una firma utilizable.
    await call("PUT", "/signing-certificate", {
      file: readFixture(inject("p12FixturesDir"), "sd-utf8.modern.p12").toString("base64"),
      password: FIXTURE_PASSWORD,
      expectedCurrentId: null,
    });
    const party = await call("POST", "/parties", {
      identificationType: "04",
      identification: "0992877878001",
      legalName: "FERRETERÍA EL PERNO CÍA. LTDA.",
      address: "Guayaquil",
      roles: ["CUSTOMER"],
    });
    const product = await call("POST", "/products", {
      kind: "GOOD",
      mainCode: "CEM-50",
      name: "Cemento 50 kg",
      unitPrice: "8.75",
      taxes: { iva: "4" },
    });
    ids = {
      point: point.id,
      origin: origin.id,
      destination: destination.id,
      party: party.id,
      product: product.id,
    };
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
  });

  it("A. un borrador dentro de los valores por defecto se acepta", async () => {
    const res = await send(
      "POST",
      "/shipping-guides/drafts",
      JSON.stringify(
        draftBody([
          {
            recipient: { kind: "PARTY", partyId: ids.party },
            address: "Av. Quito y Guayaquil, Guayaquil",
            motive: "Consignación",
            support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
            details: [{ productId: null, description: "Varilla de 12 mm", quantity: "10" }],
          },
        ]),
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
    expect(bytes(raw)).toBeGreaterThan(3 * GLOBAL_LIMIT);
    expect(bytes(heavy)).toBeGreaterThan(bytes(raw));
    expect(bytes(heavy)).toBeLessThan(DRAFT_LIMIT);

    const created = await send("POST", "/shipping-guides/drafts", raw);
    expect(created.status).toBe(201);
    const draft = (await json(created)).data;
    expect(draft.preview.issues).toEqual([]);
    expect(draft.preview.counts).toEqual({ recipients: 50, details: 300 });
    // El texto multibyte llega intacto al borrador.
    expect(draft.recipients[0]!.details[1]!.description).toBe(multibyte("Mercancía 0.1", 300));

    // Actualizar con el mismo contenido escapado: el cuerpo más pesado también pasa.
    const updated = await send(
      "PUT",
      `/shipping-guides/drafts/${draft.id}`,
      heavy.replace(/^\{/, `{"expectedVersion":${draft.version},`),
    );
    expect(updated.status).toBe(200);
    const again = (await json(updated)).data;
    expect(again.preview.issues).toEqual([]);
    expect(again.recipients[49]!.motive).toBe(multibyte("Motivo 49", 300));
  });

  it("C. un cuerpo de más de 2 MiB recibe 413 antes del dominio, al crear y al actualizar", async () => {
    const oversized = JSON.stringify({ ...draftBody([]), filler: "x".repeat(DRAFT_LIMIT) });
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(DRAFT_LIMIT);
    const created = await send("POST", "/shipping-guides/drafts", oversized);
    expect([created.status, (await json(created)).error?.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    const updated = await send("PUT", "/shipping-guides/drafts/cualquiera", oversized);
    expect([updated.status, (await json(updated)).error?.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
  });

  it("D. un cuerpo de menos de 2 MiB con 301 detalles se rechaza por el límite de detalles, no por tamaño", async () => {
    const detail = { productId: null, description: multibyte("Detalle", 300), quantity: "1" };
    const recipient = (count: number) => ({
      recipient: { kind: "PARTY", partyId: ids.party },
      address: "Guayaquil",
      motive: "Consignación",
      support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
      details: Array.from({ length: count }, () => detail),
    });
    const body = JSON.stringify(
      draftBody([recipient(100), recipient(100), recipient(100), recipient(1)]),
    );
    expect(Buffer.byteLength(body)).toBeGreaterThan(GLOBAL_LIMIT);
    expect(Buffer.byteLength(body)).toBeLessThan(DRAFT_LIMIT);
    const res = await send("POST", "/shipping-guides/drafts", body);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({
      code: "VALIDATION_ERROR",
      message:
        "La guía admite como máximo 300 detalles. Es una defensa de recursos del sistema, no un límite del SRI.",
    });
  });

  it("E. la emisión, la eliminación del borrador y las demás rutas conservan el límite de 100 KB", async () => {
    const filler = "x".repeat(GLOBAL_LIMIT + 1024);
    for (const [method, path, body] of [
      [
        "POST",
        "/shipping-guides",
        { draftId: "x", expectedVersion: 1, exceptionDeclaration: null },
      ],
      ["DELETE", "/shipping-guides/drafts/x", {}],
      ["POST", "/shipping-guides/x/reconciliations", { reason: "Revisión" }],
      ["POST", "/parties", { identificationType: "05", identification: "1710034065" }],
      ["POST", "/invoices/drafts", { emissionPointId: "x" }],
      ["POST", "/withholding-receipts/drafts", { partyId: "x" }],
    ] as const) {
      const res = await send(method, path, JSON.stringify({ ...body, filler }));
      expect([method, path, res.status]).toEqual([method, path, 413]);
    }
  });
});
