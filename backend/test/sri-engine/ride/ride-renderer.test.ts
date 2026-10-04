// RIDE de la factura (ADR 0022; add-document-archive, design D7): contenido del anexo 2 para la
// factura que el sistema emite, importes exactos, paginación, determinismo por versión, fuentes
// embebidas sin sustitución y seguridad del PDF. Se renderiza en el hilo de la prueba; el worker
// del RIDE usa este mismo renderer.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
// eslint-disable-next-line no-restricted-imports -- la prueba comprueba la política de recursos de pdfmake
import pdfmake from "pdfmake";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { RideRenderOutcome } from "../../../src/modules/sri-engine/application/ride.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import {
  RIDE_LIBRARY_VERSIONS,
  RIDE_VERSIONS,
  createInProcessRideRenderer,
  drawnStrings,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { readRideSource } from "../../../src/modules/sri-engine/infrastructure/ride/ride-source.ts";
import { pageTexts } from "../../support/pdf-inspection.ts";
import {
  INVOICE_CASES,
  authorizedInvoice,
  line,
  type AuthorizedInvoice,
  type InvoiceCase,
} from "../../support/ride-invoices.ts";

const run = promisify(execFile);
const p12Dir = inject("p12FixturesDir");
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const renderer = createInProcessRideRenderer(assets.fonts);
const invoices = new Map<keyof typeof INVOICE_CASES, AuthorizedInvoice>();
const rendered = new Map<keyof typeof INVOICE_CASES, Uint8Array>();

async function renderOk(invoice: AuthorizedInvoice) {
  const outcome = await renderer.render(invoice.input);
  if (outcome.status !== "RENDERED") throw new Error(`rechazado: ${JSON.stringify(outcome)}`);
  return outcome;
}
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const text = async (name: keyof typeof INVOICE_CASES) =>
  (await pageTexts(rendered.get(name)!)).join(" ");
/** Las posiciones de cada texto, en orden; falla si alguno falta. */
const positions = (haystack: string, needles: readonly string[]) =>
  needles.map((needle) => {
    const index = haystack.indexOf(needle);
    if (index < 0) throw new Error(`falta "${needle}"`);
    return index;
  });

beforeAll(async () => {
  for (const name of Object.keys(INVOICE_CASES) as (keyof typeof INVOICE_CASES)[]) {
    const invoice = await authorizedInvoice(INVOICE_CASES[name], p12Dir);
    invoices.set(name, invoice);
    rendered.set(name, (await renderOk(invoice)).pdf);
  }
});

describe("contenido del RIDE", () => {
  it("una factura completa muestra emisor, autorización, comprador, líneas, pagos y totales", async () => {
    const page = await text("complete");
    const { snapshot } = invoices.get("complete")!;
    for (const expected of [
      snapshot.issuer.legalName,
      snapshot.issuer.tradeName!,
      `Dirección Matriz: ${snapshot.issuer.headOfficeAddress}`,
      `Dirección Sucursal: ${snapshot.issuer.establishmentAddress!}`,
      "Contribuyente Especial Nro: 13216",
      "OBLIGADO A LLEVAR CONTABILIDAD: SI",
      "Agente de Retención Resolución No.: 1",
      "CONTRIBUYENTE RÉGIMEN RIMPE",
      `R.U.C.: ${snapshot.issuer.ruc}`,
      "FACTURA",
      "No. 001-001-000000315",
      `NÚMERO DE AUTORIZACIÓN ${snapshot.accessKey}`,
      "FECHA Y HORA DE AUTORIZACIÓN: 04/10/2026 15:20:11",
      "AMBIENTE: PRODUCCIÓN",
      "EMISIÓN: NORMAL",
      `Razón Social / Nombres y Apellidos: ${snapshot.buyer.legalName}`,
      `Identificación: ${snapshot.buyer.identification}`,
      "Fecha Emisión: 04/10/2026",
      `Dirección: ${snapshot.buyer.address!}`,
    ]) {
      expect(page).toContain(expected.replace(/\s+/g, " "));
    }
    for (const lineSnapshot of snapshot.lines) {
      expect(page).toContain(
        [
          lineSnapshot.mainCode,
          lineSnapshot.auxiliaryCode ?? "",
          lineSnapshot.quantity,
          lineSnapshot.description,
          lineSnapshot.unitPrice,
          lineSnapshot.discount,
          lineSnapshot.taxableBase,
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    expect(page).toContain(
      `20 - OTROS CON UTILIZACION DEL SISTEMA FINANCIERO ${snapshot.payments[0]!.total}`,
    );
    expect(page).toContain(
      `01 - SIN UTILIZACION DEL SISTEMA FINANCIERO ${snapshot.payments[1]!.total}`,
    );
    const tax = (code: string) => snapshot.totals.taxes.find((t) => t.rateCode === code)!;
    // Orden del anexo 2: tarifas de menor a mayor, 0 %, no objeto, exento, y después los totales.
    const order = positions(page, [
      `SUBTOTAL 5% ${tax("5").base}`,
      `SUBTOTAL 15% ${tax("4").base}`,
      `SUBTOTAL 0% ${tax("0").base}`,
      `SUBTOTAL NO OBJETO DE IVA ${tax("6").base}`,
      `SUBTOTAL EXENTO DE IVA ${tax("7").base}`,
      `SUBTOTAL SIN IMPUESTOS ${snapshot.totals.withoutTaxes}`,
      `TOTAL DESCUENTO ${snapshot.totals.discount}`,
      `IVA 5% ${tax("5").amount}`,
      `IVA 15% ${tax("4").amount}`,
      `VALOR TOTAL ${snapshot.totals.total}`,
    ]);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it("solo muestra lo que el comprobante trae: sin propina, ICE, IRBPNR ni información adicional", async () => {
    const page = await text("oneLine");
    for (const absent of ["PROPINA", "ICE", "IRBPNR", "Información Adicional", "Cod. Auxiliar"]) {
      expect(page).not.toContain(absent);
    }
    for (const absent of ["SUBTOTAL 0%", "SUBTOTAL NO OBJETO", "SUBTOTAL EXENTO"]) {
      expect(page).not.toContain(absent);
    }
  });

  it("el consumidor final y el ambiente de pruebas", async () => {
    const page = await text("consumerFinal");
    expect(page).toContain("Razón Social / Nombres y Apellidos: CONSUMIDOR FINAL");
    expect(page).toContain("Identificación: 9999999999999");
    expect(page).toContain("AMBIENTE: PRUEBAS");
  });

  it("los importes se dibujan exactos, sin redondear ni dar formato", async () => {
    const page = await text("largeValues");
    expect(page).toContain("999999.999999");
    expect(page).toContain("1.000001");
  });
});

describe("paginación", () => {
  it("una factura corta ocupa una página", async () => {
    expect(await pageTexts(rendered.get("oneLine")!)).toHaveLength(1);
    expect((await renderOk(invoices.get("oneLine")!)).pages).toBe(1);
  });

  it("varias páginas repiten identificación, encabezado del detalle y número, sin partir filas", async () => {
    const pages = await pageTexts(rendered.get("multiPage")!);
    const { accessKey } = invoices.get("multiPage")!.snapshot;
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect((await renderOk(invoices.get("multiPage")!)).pages).toBe(pages.length);
    pages.forEach((page, index) => {
      expect(page, `página ${index + 1}`).toContain(`Página ${index + 1} de ${pages.length}`);
      expect(page, `página ${index + 1}`).toContain(
        "Cod. Principal Cantidad Descripción Precio Unitario Descuento Precio Total",
      );
      if (index > 0) {
        expect(page).toContain(
          `FACTURA No. 001-001-999999999 · R.U.C. 1790012345001 · Clave de acceso ${accessKey}`,
        );
      }
    });
    for (let row = 1; row <= 120; row++) {
      const code = `L${String(row).padStart(3, "0")}`;
      const page = pages.findIndex((content) => content.includes(`${code} `));
      expect(page, code).toBeGreaterThanOrEqual(0);
      // La descripción termina en `fin{n}`: si la fila se partiera, su final quedaría en otra página.
      expect(pages[page], code).toMatch(new RegExp(`Producto ${row} .*fin${row}(\\s|$)`));
    }
  });

  it("los totales y las formas de pago van juntos, y la autorización queda en la primera página", async () => {
    const pages = await pageTexts(rendered.get("multiPage")!);
    const totalsPage = pages.findIndex((page) => page.includes("VALOR TOTAL"));
    for (const label of ["Forma de pago", "SUBTOTAL SIN IMPUESTOS", "TOTAL DESCUENTO", "IVA 15%"]) {
      expect(pages[totalsPage]).toContain(label);
    }
    expect(pages[0]).toContain("NÚMERO DE AUTORIZACIÓN");
    expect(pages[0]).toContain("CLAVE DE ACCESO");
  });
});

describe("determinismo por versión", () => {
  it("el mismo comprobante da los mismos bytes, también en otro proceso sin configuración de fuentes", async () => {
    const invoice = invoices.get("complete")!;
    const first = sha256(rendered.get("complete")!);
    expect(sha256((await renderOk(invoice)).pdf)).toBe(first);
    const work = mkdtempSync(join(tmpdir(), "ride-determinism-"));
    try {
      writeFileSync(join(work, "source.xml"), invoice.xml);
      const script = [
        `import { readFileSync } from "node:fs";`,
        `import { createHash } from "node:crypto";`,
        `const assets = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts", import.meta.url).href)});`,
        `const renderer = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts", import.meta.url).href)});`,
        `const loaded = assets.loadRideAssets(assets.defaultRideFontsDirectory());`,
        `const input = ${JSON.stringify({ ...invoice.input, xml: null })};`,
        `input.xml = readFileSync(${JSON.stringify(join(work, "source.xml"))});`,
        `input.authorization.authorizedAt = new Date(input.authorization.authorizedAt);`,
        `const outcome = await renderer.createInProcessRideRenderer(loaded.fonts).render(input);`,
        `process.stdout.write(createHash("sha256").update(outcome.pdf).digest("hex"));`,
      ].join("\n");
      const { stdout } = await run(
        process.execPath,
        ["--conditions=development", "--input-type=module", "-e", script],
        {
          timeout: 60_000,
          env: { PATH: process.env.PATH, FONTCONFIG_FILE: "/nonexistent", HOME: work },
        },
      );
      expect(stdout).toBe(first);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    expect(sha256(rendered.get("oneLine")!)).not.toBe(first);
  });

  it("informa las versiones con que se generó, iguales a los paquetes instalados", async () => {
    const outcome = await renderOk(invoices.get("oneLine")!);
    expect(outcome.versions).toEqual(RIDE_VERSIONS);
    const require = createRequire(import.meta.url);
    const packageJson = (resolved: string, name: string) => {
      let dir = dirname(resolved);
      while (!fs.existsSync(join(dir, "package.json")) || !dir.endsWith(name)) dir = dirname(dir);
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string };
    };
    const pdfmakeMain = require.resolve("pdfmake");
    expect({
      pdfmake: packageJson(pdfmakeMain, "pdfmake").version,
      pdfkit: packageJson(createRequire(pdfmakeMain).resolve("pdfkit"), "pdfkit").version,
      bwipJs: packageJson(require.resolve("bwip-js"), "bwip-js").version,
      fontkit: packageJson(require.resolve("fontkit"), "fontkit").version,
    }).toEqual(RIDE_LIBRARY_VERSIONS);
  });
});

describe("caracteres y fuentes", () => {
  it("tildes, eñes, diéresis y comillas tipográficas salen tal como están", async () => {
    const page = await text("complete");
    for (const expected of [
      "JOSÉ ÁNGEL MUÑOZ IBÁÑEZ Ñ Ü ü ç “Pepe”",
      "Señalética «PELIGRO» – cinta amarilla 3″ × 100 m",
      "Ñandú decorativo de cerámica (artesanía, añejo)",
      "FERRETERÍA NÚÑEZ — PEÑA & CÍA. «EL MAÑANERO»",
    ]) {
      expect(page).toContain(expected);
    }
  });

  it("las fuentes van embebidas como subconjunto de Noto Sans, nunca una estándar del visor", () => {
    const raw = Buffer.from(rendered.get("complete")!).toString("latin1");
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Bold/);
    expect(raw).toContain("/FontFile2");
    expect(raw).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier)/);
  });

  it("un carácter sin glifo detiene el RIDE con sus puntos de código, sin sustituirlo", async () => {
    const invoice = await authorizedInvoice(
      {
        ...INVOICE_CASES.oneLine,
        name: "sin-glifo",
        sequential: "000000901",
        buyer: {
          identificationType: "04",
          identification: "0992877878001",
          legalName: "EMPRESA 漢字 𝔘",
          address: null,
        },
      },
      p12Dir,
    );
    expect(await renderer.render(invoice.input)).toEqual({
      status: "REJECTED",
      code: "RIDE_GLYPH_MISSING",
      detail: ["U+6F22", "U+5B57", "U+1D518"],
    } satisfies RideRenderOutcome);
  });

  it("la comprobación de glifos incluye la cabecera: número, autorización, ambiente, emisión y clave", () => {
    const ride = readRideSource(invoices.get("oneLine")!.input);
    expect(drawnStrings(ride)).toEqual(
      expect.arrayContaining([
        `${ride.establishment}-${ride.emissionPoint}-${ride.sequential}`,
        ride.authorization.number,
        "PRUEBAS",
        "NORMAL",
        ride.accessKey,
      ]),
    );
  });

  it("un logo que no es PNG ni JPEG se rechaza", async () => {
    expect(
      await renderer.render({
        ...invoices.get("oneLine")!.input,
        logo: { bytes: new TextEncoder().encode("<svg/>"), mediaType: "image/png" },
      }),
    ).toEqual({ status: "REJECTED", code: "RIDE_LOGO_INVALID", detail: ["image/png"] });
  });
});

describe("seguridad del PDF", () => {
  const hostile =
    "<script>alert(1)</script> javascript:alert(1) file:///etc/passwd https://malo.example/x.png";
  const hostileCase: InvoiceCase = {
    ...INVOICE_CASES.oneLine,
    name: "hostil",
    sequential: "000000666",
    buyer: {
      identificationType: "04",
      identification: "0992877878001",
      legalName: hostile,
      address: hostile,
    },
    lines: [line(1, { description: hostile, rateCode: "4" })],
  };

  afterEach(() => vi.restoreAllMocks());

  it("el contenido se dibuja literal, sin enlaces, acciones, scripts ni archivos embebidos", async () => {
    const { pdf } = await renderOk(await authorizedInvoice(hostileCase, p12Dir));
    // El ajuste de línea puede partir una URL después de "/": se compara sin espacios.
    const compact = (await pageTexts(pdf)).join("").replace(/\s/g, "");
    expect(compact.split(hostile.replace(/\s/g, "")).length - 1).toBe(3);
    const raw = Buffer.from(pdf).toString("latin1");
    for (const marker of [
      "/URI",
      "/Launch",
      "/JavaScript",
      "/JS ",
      "/OpenAction",
      "/AA ",
      "/EmbeddedFile",
      "/RichMedia",
      "/SubmitForm",
      "/GoToR",
    ]) {
      expect(raw, marker).not.toContain(marker);
    }
  });

  it("el render no accede a la red ni a ningún archivo: fuentes y logo llegan en memoria", async () => {
    const invoice = await authorizedInvoice({ ...hostileCase, sequential: "000000667" }, p12Dir);
    const reads: string[] = [];
    const record =
      (name: string) =>
      (path: unknown): never => {
        reads.push(`${name}:${String(path)}`);
        throw new Error("acceso a archivo no permitido en la prueba");
      };
    for (const name of ["readFileSync", "openSync", "readFile", "createReadStream"] as const) {
      vi.spyOn(fs, name).mockImplementation(record(name));
    }
    const network: string[] = [];
    const deny = (name: string) => (): never => {
      network.push(name);
      throw new Error("red no permitida en la prueba");
    };
    vi.spyOn(http, "request").mockImplementation(deny("http.request"));
    vi.spyOn(https, "request").mockImplementation(deny("https.request"));
    vi.spyOn(net, "connect").mockImplementation(deny("net.connect"));
    vi.spyOn(globalThis, "fetch").mockImplementation(deny("fetch"));
    // Los espías los ven también los módulos CommonJS, como pdfkit: comparten el mismo objeto.
    const cjs = createRequire(import.meta.url);
    expect((cjs("node:fs") as typeof fs).readFileSync).toBe(fs.readFileSync);
    expect(vi.isMockFunction((cjs("node:https") as typeof https).request)).toBe(true);
    const outcome = await renderer.render(invoice.input);
    vi.restoreAllMocks();
    expect(outcome.status).toBe("RENDERED");
    expect(reads).toEqual([]);
    expect(network).toEqual([]);
  });

  it("pdfmake niega toda URL y todo archivo local: solo usa lo que recibe en memoria", async () => {
    for (const image of ["https://malo.example/x.png", "/etc/passwd", "file:///etc/passwd"]) {
      await expect(
        pdfmake.createPdf({ content: [{ image }], defaultStyle: { font: "NotoSans" } }).getBuffer(),
        image,
      ).rejects.toThrow(/denied by resource access policy|Invalid image|Unknown image format/);
    }
  });
});
