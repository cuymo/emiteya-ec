// RIDE de la liquidación de compra (add-purchase-settlements, tarea 10.1, design D19): distribución
// propia de la ficha v2.34 (anexo 2, página 65) con golden del texto de las páginas: el título, el
// proveedor con su identificación, la fecha de emisión y su dirección, el detalle con sus códigos, su
// unidad cuando la trae, su cantidad, su descripción, su precio unitario, su descuento y su precio
// total, cada forma de pago con su plazo y su valor, los subtotales llenados, el IVA por tarifa y el
// valor total; sin "Placa / Matrícula", "Guía Remisión", "Detalle Adicional" ni subsidios; la
// paginación con el máximo de líneas; el Code128 con la clave de la liquidación; el contenido que el
// sistema no emite que detiene la generación; los mismos bytes en otro proceso y la versión de su
// distribución. El RIDE de los demás tipos no cambia (lo prueban sus propias pruebas y sus golden).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PURCHASE_SETTLEMENT_LIMITS_MAX } from "@facturador/contracts";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { RideRenderOutcome } from "../../../src/modules/sri-engine/application/ride.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import {
  CREDIT_NOTE_RIDE_RENDERER_VERSION,
  DEBIT_NOTE_RIDE_RENDERER_VERSION,
  PURCHASE_SETTLEMENT_RIDE_RENDERER_VERSION,
  PURCHASE_SETTLEMENT_RIDE_VERSIONS,
  RIDE_RENDERER_VERSION,
  RIDE_VERSIONS,
  SHIPPING_GUIDE_RIDE_RENDERER_VERSION,
  WITHHOLDING_RIDE_RENDERER_VERSION,
  createInProcessRideRenderer,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { decodeCode128, pageTexts } from "../../support/pdf-inspection.ts";
import { INVOICE_CASES, authorizedInvoice } from "../../support/ride-invoices.ts";
import {
  TWO_LINES,
  authorizedSettlement,
  iva,
  type AuthorizedSettlement,
  type SettlementCase,
} from "../../support/ride-purchase-settlements.ts";

const run = promisify(execFile);
const p12Dir = inject("p12FixturesDir");
const GOLDEN = fileURLToPath(new URL("../../fixtures/purchase-settlement-ride/", import.meta.url));
const UPDATE = process.env.PURCHASE_SETTLEMENT_RIDE_UPDATE === "1";
/** Para revisar la distribución a ojo: escribe el PDF en esa carpeta. */
const PREVIEW = process.env.PURCHASE_SETTLEMENT_RIDE_PREVIEW;
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const renderer = createInProcessRideRenderer(assets.fonts);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const BASE: SettlementCase = {
  name: "dos-lineas",
  issueDate: "2026-10-07",
  sequential: "000000003",
  ...TWO_LINES,
};
let settlement: AuthorizedSettlement;
let outcome: RideRenderOutcome & { status: "RENDERED" };

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${GOLDEN}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con PURCHASE_SETTLEMENT_RIDE_UPDATE=1`).toBe(
      true,
    );
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

const renderOk = async (input: AuthorizedSettlement["input"], preview?: string) => {
  const rendered = await renderer.render(input);
  if (rendered.status !== "RENDERED") throw new Error(JSON.stringify(rendered));
  if (PREVIEW && preview) writeFileSync(join(PREVIEW, `${preview}.pdf`), rendered.pdf);
  return rendered;
};

beforeAll(async () => {
  settlement = await authorizedSettlement(BASE, p12Dir);
  outcome = await renderOk(settlement.input, "dos-lineas");
});

describe("RIDE de la liquidación de compra (ficha v2.34, anexo 2, página 65)", () => {
  it("dibuja su distribución: título, proveedor, detalle, pagos con su plazo y totales de IVA", async () => {
    const pages = await pageTexts(outcome.pdf);
    expect(outcome.pages).toBe(1);
    matchesGolden("dos-lineas.txt", `${pages.join("\n---\n")}\n`);
    const text = pages.join(" ");
    const ordered = [
      "R.U.C.:",
      "LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS",
      "001-001-000000003",
      "NÚMERO DE AUTORIZACIÓN",
      settlement.accessKey,
      "AMBIENTE: PRUEBAS",
      "EMISIÓN: NORMAL",
      "CLAVE DE ACCESO",
      "Razón Social / Nombres y Apellidos: María Quishpe",
      "Identificación: 0102030405",
      "Fecha Emisión: 07/10/2026",
      "Dirección: Comunidad San Pablo, Cayambe",
      "Cod. Principal Cod. Auxiliar Cantidad Descripción Unidad Precio Unitario Descuento Precio Total",
      "CAC-01 GR-45 10 Saco de cacao en grano, 45 kg saco 4.5 5.00 40.00",
      "JOR-01 2 Jornal de cosecha 30 0.00 60.00",
      "Forma de pago Plazo Valor",
      "01 - SIN UTILIZACION DEL SISTEMA FINANCIERO 0 días 50.00",
      "20 - OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO 30 días 56.00",
    ];
    const positions = ordered.map((needle) => {
      const index = text.indexOf(needle);
      expect(index, `falta "${needle}"`).toBeGreaterThanOrEqual(0);
      return index;
    });
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Los subtotales llenados, el IVA del 15 % y el valor total, en el orden del anexo 2.
    const totals = [
      "SUBTOTAL 15% 40.00",
      "SUBTOTAL 0% 60.00",
      "SUBTOTAL SIN IMPUESTOS 100.00",
      "IVA 15% 6.00",
      "VALOR TOTAL 106.00",
    ].map((needle) => {
      const index = text.indexOf(needle);
      expect(index, `falta "${needle}"`).toBeGreaterThanOrEqual(0);
      return index;
    });
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
    // Solo los subtotales que el comprobante llenó.
    expect(text).not.toMatch(/NO OBJETO DE IVA|EXENTO DE IVA/);
  });

  it("no muestra los campos que la liquidación no tiene aunque el dibujo los herede de la factura", async () => {
    const text = (await pageTexts(outcome.pdf)).join(" ");
    expect(text).not.toMatch(
      /Placa|Matrícula|Gu[ií]a Remisi[oó]n|Detalle Adicional|Subsidio|TOTAL DESCUENTO|Comprador|Información Adicional/i,
    );
  });

  it("tiene su propio título y su bloque del proveedor: no es el RIDE de la factura con otro título", async () => {
    const invoice = await authorizedInvoice(INVOICE_CASES.oneLine, p12Dir);
    const invoiceOutcome = await renderer.render(invoice.input);
    if (invoiceOutcome.status !== "RENDERED") throw new Error(JSON.stringify(invoiceOutcome));
    const invoiceText = (await pageTexts(invoiceOutcome.pdf)).join(" ");
    const text = (await pageTexts(outcome.pdf)).join(" ");
    expect(invoiceText).toContain("FACTURA");
    expect(text).not.toMatch(/\bFACTURA\b/);
    // La factura lleva el total de descuentos y sus pagos sin plazo; la liquidación, el plazo.
    expect(invoiceText).toContain("TOTAL DESCUENTO");
    expect(invoiceText).not.toContain("Plazo");
    expect(text).toContain("Forma de pago Plazo Valor");
    expect(invoiceOutcome.versions).toEqual(RIDE_VERSIONS);
    expect(outcome.versions).toEqual(PURCHASE_SETTLEMENT_RIDE_VERSIONS);
  });

  it("sin unidades ni códigos en ninguna línea, esas columnas no se dibujan", async () => {
    const plain = await authorizedSettlement(
      {
        ...BASE,
        name: "sin-codigos",
        sequential: "000000004",
        lines: TWO_LINES.lines.map((line) => ({
          ...line,
          mainCode: null,
          auxiliaryCode: null,
          unit: null,
        })),
      },
      p12Dir,
    );
    const text = (await pageTexts((await renderOk(plain.input, "sin-codigos")).pdf)).join(" ");
    expect(text).toContain("Cantidad Descripción Precio Unitario Descuento Precio Total");
    expect(text).not.toMatch(/Cod\. Principal|Cod\. Auxiliar|Unidad/);
    expect(text).toContain("10 Saco de cacao en grano, 45 kg 4.5 5.00 40.00");
  });

  it("el pasaporte, seis decimales y caracteres especiales salen tal como están en el XML", async () => {
    const special = await authorizedSettlement(
      {
        ...BASE,
        name: "pasaporte",
        sequential: "000000005",
        supplier: {
          identificationType: "06",
          identification: "AB1234567",
          legalName: "Juan Pérez & Hijos “El Ñandú”",
          address: "Sector La Esperanza, km 12 vía a Tulcán",
        },
        lines: [
          {
            mainCode: null,
            auxiliaryCode: null,
            description: "Leña <seca> & astillas",
            unit: "carga",
            quantity: "1.123456",
            unitPrice: "0.123456",
            discount: "0.00",
            taxableBase: "0.14",
            tax: iva("0", "0", "0.14", "0.00"),
          },
        ],
        totals: {
          withoutTaxes: "0.14",
          discount: "0.00",
          taxes: [iva("0", "0", "0.14", "0.00")],
          total: "0.14",
        },
        payments: [{ method: "01", total: "0.14", term: "0", timeUnit: "días" }],
      },
      p12Dir,
    );
    const text = (await pageTexts((await renderOk(special.input, "pasaporte")).pdf)).join(" ");
    expect(text).toContain("Razón Social / Nombres y Apellidos: Juan Pérez & Hijos “El Ñandú”");
    expect(text).toContain("Identificación: AB1234567");
    expect(text).toContain("1.123456 Leña <seca> & astillas carga 0.123456 0.00 0.14");
    expect(text).toContain("VALOR TOTAL 0.14");
  });

  it("el código de barras y la clave impresa son los de la liquidación", async () => {
    expect(settlement.accessKey.slice(8, 10)).toBe("03");
    expect(await decodeCode128(outcome.pdf)).toEqual([settlement.accessKey]);
    expect((await pageTexts(outcome.pdf)).join(" ")).toContain(settlement.accessKey);
  });

  it("registra la versión de su propia distribución, distinta de la de los demás tipos", () => {
    expect(outcome.versions.rendererVersion).toBe(PURCHASE_SETTLEMENT_RIDE_RENDERER_VERSION);
    expect(PURCHASE_SETTLEMENT_RIDE_RENDERER_VERSION).toBe("liquidacion-compra-1");
    expect(
      new Set([
        PURCHASE_SETTLEMENT_RIDE_RENDERER_VERSION,
        SHIPPING_GUIDE_RIDE_RENDERER_VERSION,
        WITHHOLDING_RIDE_RENDERER_VERSION,
        RIDE_RENDERER_VERSION,
        CREDIT_NOTE_RIDE_RENDERER_VERSION,
        DEBIT_NOTE_RIDE_RENDERER_VERSION,
      ]).size,
    ).toBe(6);
  });

  it("con el máximo de líneas pagina sin partir filas, repite el encabezado y no parte los totales", async () => {
    const count = PURCHASE_SETTLEMENT_LIMITS_MAX.lines;
    const largest = await authorizedSettlement(
      {
        name: "maximo",
        issueDate: "2026-10-07",
        sequential: "000000099",
        lines: Array.from({ length: count }, (_, index) => ({
          mainCode: `P-${index + 1}`,
          auxiliaryCode: null,
          description: `Producto agrícola ${index + 1}`,
          unit: "kg",
          quantity: "1",
          unitPrice: "1",
          discount: "0.00",
          taxableBase: "1.00",
          tax: iva("0", "0", "1.00", "0.00"),
        })),
        totals: {
          withoutTaxes: `${count}.00`,
          discount: "0.00",
          taxes: [iva("0", "0", `${count}.00`, "0.00")],
          total: `${count}.00`,
        },
        payments: [{ method: "20", total: `${count}.00`, term: "90", timeUnit: "días" }],
      },
      p12Dir,
    );
    const rendered = await renderOk(largest.input, "maximo");
    const pages = await pageTexts(rendered.pdf);
    expect(rendered.pages).toBe(pages.length);
    expect(pages.length).toBeGreaterThanOrEqual(8);
    pages.forEach((page, index) => {
      expect(page, `página ${index + 1}`).toContain(`Página ${index + 1} de ${pages.length}`);
      if (index > 0) {
        expect(page).toContain(
          `LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS No. 001-001-000000099 · R.U.C. 1790012345001 · Clave de acceso ${largest.accessKey}`,
        );
      }
    });
    // Cada fila aparece entera en una página que también muestra el encabezado de la tabla.
    for (let index = 1; index <= count; index += 1) {
      const row = `P-${index} 1 Producto agrícola ${index} kg 1 0.00 1.00`;
      const page = pages.find((content) => content.includes(row));
      expect(page, row).toBeDefined();
      expect(page).toContain(
        "Cod. Principal Cantidad Descripción Unidad Precio Unitario Descuento Precio Total",
      );
    }
    // Los pagos y los totales quedan juntos en la última página; la autorización, en la primera.
    const last = pages.at(-1)!;
    expect(last).toContain(`20 - OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO 90 días ${count}.00`);
    expect(last).toContain(`VALOR TOTAL ${count}.00`);
    expect(pages[0]).toContain("NÚMERO DE AUTORIZACIÓN");
    expect(pages[0]).toContain("CLAVE DE ACCESO");
  }, 180_000);

  it("un contenido que el sistema no emite detiene la generación indicando el elemento", async () => {
    const cases: [string, (xml: string) => string, string[]][] = [
      [
        "con-reembolsos",
        (xml) =>
          xml.replace(
            "</detalles>",
            "</detalles><reembolsos><reembolsoDetalle><tipoIdentificacionProveedorReembolso>05</tipoIdentificacionProveedorReembolso></reembolsoDetalle></reembolsos>",
          ),
        ["liquidacionCompra.reembolsos"],
      ],
      [
        "con-cod-doc-reembolso",
        (xml) =>
          xml.replace(
            "<moneda>",
            "<codDocReembolso>41</codDocReembolso><totalComprobantesReembolso>1.00</totalComprobantesReembolso><moneda>",
          ),
        [
          "liquidacionCompra.infoLiquidacionCompra.codDocReembolso",
          "liquidacionCompra.infoLiquidacionCompra.totalComprobantesReembolso",
        ],
      ],
      [
        "con-precio-sin-subsidio",
        (xml) =>
          xml.replace(
            "<descuento>5.00</descuento>",
            "<descuento>5.00</descuento><precioSinSubsidio>5.00</precioSinSubsidio>",
          ),
        ["liquidacionCompra.detalles.detalle.precioSinSubsidio"],
      ],
      [
        "con-detalles-adicionales",
        (xml) =>
          xml.replace(
            "<cantidad>10</cantidad>",
            '<cantidad>10</cantidad><detallesAdicionales><detAdicional nombre="Marca" valor="X"/></detallesAdicionales>',
          ),
        ["liquidacionCompra.detalles.detalle.detallesAdicionales"],
      ],
      [
        "con-maquina-fiscal",
        (xml) =>
          xml.replace(
            "</detalles>",
            "</detalles><maquinaFiscal><marca>X</marca><modelo>Y</modelo><serie>Z</serie></maquinaFiscal>",
          ),
        ["liquidacionCompra.maquinaFiscal"],
      ],
      [
        "con-informacion-adicional",
        (xml) =>
          xml.replace(
            "</detalles>",
            '</detalles><infoAdicional><campoAdicional nombre="Email">x@y.ec</campoAdicional></infoAdicional>',
          ),
        ["liquidacionCompra.infoAdicional"],
      ],
      [
        "con-ice",
        (xml) => xml.replace(/(<impuestos>\s*<impuesto>\s*<codigo>)2(<\/codigo>)/, "$13$2"),
        ["impuesto.codigo:3"],
      ],
    ];
    for (const [index, [name, tamper, detailPath]] of cases.entries()) {
      const tampered = await authorizedSettlement(
        { ...BASE, name, sequential: String(20 + index).padStart(9, "0"), tamper },
        p12Dir,
      );
      expect(await renderer.render(tampered.input), name).toEqual({
        status: "REJECTED",
        code: "RIDE_SOURCE_UNSUPPORTED",
        detail: detailPath,
      });
    }
    const otherVersion = await authorizedSettlement(
      {
        ...BASE,
        name: "version-1-0-0",
        sequential: "000000040",
        tamper: (xml) =>
          xml.replace(
            '<liquidacionCompra id="comprobante" version="1.1.0">',
            '<liquidacionCompra id="comprobante" version="1.0.0">',
          ),
      },
      p12Dir,
    );
    expect(await renderer.render(otherVersion.input)).toEqual({
      status: "REJECTED",
      code: "RIDE_SOURCE_INVALID",
      detail: ["UNSUPPORTED_VERSION"],
    });
  });

  it("la misma liquidación da los mismos bytes, también en otro proceso", async () => {
    const first = sha256(outcome.pdf);
    const again = await renderer.render(settlement.input);
    expect(again.status === "RENDERED" ? sha256(again.pdf) : null).toBe(first);
    const work = mkdtempSync(join(tmpdir(), "ride-liquidacion-determinism-"));
    try {
      writeFileSync(join(work, "source.xml"), settlement.xml);
      const script = [
        `import { readFileSync } from "node:fs";`,
        `import { createHash } from "node:crypto";`,
        `const assets = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts", import.meta.url).href)});`,
        `const renderer = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts", import.meta.url).href)});`,
        `const loaded = assets.loadRideAssets(assets.defaultRideFontsDirectory());`,
        `const input = ${JSON.stringify({ ...settlement.input, xml: null })};`,
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
  });
});
