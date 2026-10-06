// RIDE del comprobante de retención (add-withholding-receipts, tarea 10.1, design D19): distribución
// propia de la ficha v2.34 (anexo 2, página 63) con golden del texto de las páginas, una fila por
// retención con los datos de su documento sustento, el bloque adicional con los impuestos declarados
// de cada documento, las denominaciones del snapshot, la paginación con el máximo de filas, el
// Code128 con la clave de la retención, el contenido que el sistema no emite que detiene la
// generación, los mismos bytes en otro proceso y la versión de su distribución. El RIDE de la
// factura y el de las notas no cambian (lo prueban sus propias pruebas y sus golden).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WITHHOLDING_LIMITS_MAX } from "@facturador/contracts";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { RideRenderOutcome } from "../../../src/modules/sri-engine/application/ride.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import {
  CREDIT_NOTE_RIDE_RENDERER_VERSION,
  DEBIT_NOTE_RIDE_RENDERER_VERSION,
  RIDE_RENDERER_VERSION,
  WITHHOLDING_RIDE_RENDERER_VERSION,
  createInProcessRideRenderer,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { decodeCode128, pageTexts } from "../../support/pdf-inspection.ts";
import {
  TWO_SUPPORTS,
  WITHHOLDING_LABELS,
  authorizedWithholding,
  supportTax,
  withheld,
  type AuthorizedWithholding,
  type WithholdingSupport,
} from "../../support/ride-withholdings.ts";

const run = promisify(execFile);
const p12Dir = inject("p12FixturesDir");
const GOLDEN = fileURLToPath(new URL("../../fixtures/withholding-receipt-ride/", import.meta.url));
const UPDATE = process.env.WITHHOLDING_RIDE_UPDATE === "1";
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const renderer = createInProcessRideRenderer(assets.fonts);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let receipt: AuthorizedWithholding;
let outcome: RideRenderOutcome & { status: "RENDERED" };

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${GOLDEN}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con WITHHOLDING_RIDE_UPDATE=1`).toBe(true);
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

const renderOk = async (input: AuthorizedWithholding["input"]) => {
  const rendered = await renderer.render(input);
  if (rendered.status !== "RENDERED") throw new Error(JSON.stringify(rendered));
  return rendered;
};

beforeAll(async () => {
  receipt = await authorizedWithholding(
    {
      name: "dos-documentos",
      issueDate: "2026-10-06",
      sequential: "000000012",
      supports: TWO_SUPPORTS,
    },
    p12Dir,
  );
  outcome = await renderOk(receipt.input);
});

describe("RIDE del comprobante de retención (ficha v2.34, anexo 2, página 63)", () => {
  it("dibuja su distribución: título, sujeto retenido, una fila por retención y los impuestos declarados", async () => {
    const pages = await pageTexts(outcome.pdf);
    expect(outcome.pages).toBe(1);
    matchesGolden("dos-documentos.txt", `${pages.join("\n---\n")}\n`);
    const text = pages.join(" ");
    const ordered = [
      "R.U.C.:",
      "COMPROBANTE DE RETENCIÓN",
      "001-001-000000012",
      "NÚMERO DE AUTORIZACIÓN",
      "Razón Social / Nombres y Apellidos:",
      "PROVEEDORA DEL SUR S.A.",
      "1791234567001",
      "Fecha Emisión: 06/10/2026",
      "Comprobante Número Fecha Emisión Ejercicio Fiscal Base Imponible para la Retención Impuesto Porcentaje Retención Valor Retenido",
      // Renta e IVA de la factura, en su orden, con los datos de su documento.
      // Redondeo: 312C del 1.75 % sobre 100.29 retiene 1.76, el valor del cálculo único.
      "Factura 001-001-000000123 01/10/2026 10/2026 100.29 RENTA 1.75 1.76",
      "Factura 001-001-000000123 01/10/2026 10/2026 15.04 IVA 70 10.53",
      // Renta de la liquidación de compra.
      "002-005-000004567 28/09/2026 10/2026 1000.00 RENTA 10 100.00",
      "DATOS ADICIONALES: IMPUESTOS DECLARADOS DE LOS DOCUMENTOS SUSTENTO",
      "Factura 001-001-000000123 Impuesto Código Porcentaje Base Imponible Tarifa Valor",
      // Varias entradas tributarias en su orden: IVA 15 %, IVA 0 % e ICE.
      "2 - IVA 4 100.29 15 15.04",
      "2 - IVA 0 10.00 0 0.00",
      "3 - ICE 3011 100.00 10 10.00",
      "002-005-000004567 Impuesto Código Porcentaje Base Imponible Tarifa Valor",
      "2 - IVA 4 1000.00 15 150.00",
      "5 - IRBPNR 5001 1 0.02 0.02",
    ];
    const positions = ordered.map((needle) => {
      const index = text.indexOf(needle);
      expect(index, `falta "${needle}"`).toBeGreaterThanOrEqual(0);
      return index;
    });
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Su propia tabla: sin el detalle de líneas, las formas de pago ni los subtotales de los demás.
    expect(text).not.toMatch(
      /Precio Unitario|Forma de pago|SUBTOTAL|VALOR TOTAL|RAZÓN DE LA MODIFICACIÓN|Comprobante que se modifica/,
    );
  });

  it("las denominaciones son las del snapshot, nunca las del catálogo vigente", async () => {
    const relabeled = await renderOk({
      ...receipt.input,
      withholdingLabels: {
        documentTypes: { ...WITHHOLDING_LABELS.documentTypes, "01": "FACTURA CONGELADA" },
        taxes: { "1": "RENTA X", "2": "IVA" },
        supportTaxes: { ...WITHHOLDING_LABELS.supportTaxes, "3": "ICE CONGELADO" },
      },
    });
    const text = (await pageTexts(relabeled.pdf)).join(" ");
    expect(text).toContain(
      "FACTURA CONGELADA 001-001-000000123 01/10/2026 10/2026 100.29 RENTA X 1.75",
    );
    expect(text).toContain("3 - ICE CONGELADO 3011");
    // Sin denominación en el snapshot, el código literal; el RIDE nunca consulta el catálogo.
    const { withholdingLabels: _omitted, ...withoutLabels } = receipt.input;
    const coded = (await pageTexts((await renderOk(withoutLabels)).pdf)).join(" ");
    expect(coded).toContain("01 001-001-000000123 01/10/2026 10/2026 100.29 1 1.75 1.76");
    expect(coded).toContain("3 3011 100.00 10 10.00");
  });

  it("el código de barras y la clave impresa son los de la retención", async () => {
    expect(receipt.accessKey.slice(8, 10)).toBe("07");
    expect(await decodeCode128(outcome.pdf)).toEqual([receipt.accessKey]);
    expect((await pageTexts(outcome.pdf)).join(" ")).toContain(receipt.accessKey);
  });

  it("registra la versión de su propia distribución, distinta de la de la factura y las notas", () => {
    expect(outcome.versions.rendererVersion).toBe(WITHHOLDING_RIDE_RENDERER_VERSION);
    expect(WITHHOLDING_RIDE_RENDERER_VERSION).toBe("retencion-1");
    expect(
      new Set([
        WITHHOLDING_RIDE_RENDERER_VERSION,
        RIDE_RENDERER_VERSION,
        CREDIT_NOTE_RIDE_RENDERER_VERSION,
        DEBIT_NOTE_RIDE_RENDERER_VERSION,
      ]).size,
    ).toBe(4);
  });

  it("con el máximo de documentos y retenciones pagina sin partir filas ni bloques", async () => {
    const { supports, itemsPerSupport, taxesPerSupport } = WITHHOLDING_LIMITS_MAX;
    const documents: WithholdingSupport[] = Array.from({ length: supports }, (_, s) => ({
      ...TWO_SUPPORTS[0]!,
      number: `001001${String(s + 1).padStart(9, "0")}`,
      taxes: Array.from({ length: taxesPerSupport }, (_, t) =>
        supportTax("2", "4", "15", `${s + 1}${t}.00`, "1.00"),
      ),
      withholdings: Array.from({ length: itemsPerSupport }, (_, i) =>
        withheld("1", "312", `${s + 1}.${String(i).padStart(2, "0")}`, "1.75", "0.01"),
      ),
    }));
    const largest = await authorizedWithholding(
      { name: "maximo", issueDate: "2026-10-06", sequential: "000000099", supports: documents },
      p12Dir,
    );
    const rendered = await renderOk(largest.input);
    const pages = await pageTexts(rendered.pdf);
    expect(rendered.pages).toBe(pages.length);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    const tableHeader =
      "Comprobante Número Fecha Emisión Ejercicio Fiscal Base Imponible para la Retención Impuesto Porcentaje Retención Valor Retenido";
    const withholdingPages = pages.filter((page) => page.includes("RENTA"));
    withholdingPages.forEach((page) => expect(page).toContain(tableHeader));
    pages.forEach((page, index) => {
      expect(page, `página ${index + 1}`).toContain(`Página ${index + 1} de ${pages.length}`);
      if (index > 0) {
        expect(page).toContain(
          `COMPROBANTE DE RETENCIÓN No. 001-001-000000099 · R.U.C. 1790012345001 · Clave de acceso ${largest.accessKey}`,
        );
      }
    });
    // Cada fila de retención aparece entera en una página.
    for (let s = 1; s <= supports; s++) {
      for (let i = 0; i < itemsPerSupport; i++) {
        const number = `001-001-${String(s).padStart(9, "0")}`;
        const row = `${number} 01/10/2026 10/2026 ${s}.${String(i).padStart(2, "0")} RENTA 1.75 0.01`;
        expect(
          pages.some((page) => page.includes(row)),
          row,
        ).toBe(true);
      }
    }
    // Cada bloque de impuestos declarados queda entero en una página.
    for (let s = 1; s <= supports; s++) {
      const heading = `Factura 001-001-${String(s).padStart(9, "0")} Impuesto Código Porcentaje`;
      const page = pages.find((content) => content.includes(heading));
      expect(page, heading).toBeDefined();
      expect(page).toContain(`2 - IVA 4 ${s}${taxesPerSupport - 1}.00 15 1.00`);
    }
    expect(pages[0]).toContain("NÚMERO DE AUTORIZACIÓN");
    expect(pages[0]).toContain("CLAVE DE ACCESO");
  }, 120_000);

  it("un contenido que el sistema no emite detiene la generación indicando el elemento", async () => {
    const cases: [string, (xml: string) => string, string[]][] = [
      [
        "con-informacion-adicional",
        (xml) =>
          xml.replace(
            "</docsSustento>",
            '</docsSustento><infoAdicional><campoAdicional nombre="Email">x@y.ec</campoAdicional></infoAdicional>',
          ),
        ["comprobanteRetencion.infoAdicional"],
      ],
      [
        "con-isd",
        (xml) => xml.replace("<codigo>2</codigo>", "<codigo>6</codigo>"),
        ["retencion.codigo:6"],
      ],
      [
        "pago-exterior",
        (xml) =>
          xml.replace(
            "<pagoLocExt>01</pagoLocExt>",
            "<pagoLocExt>02</pagoLocExt><tipoRegi>01</tipoRegi>",
          ),
        ["comprobanteRetencion.docsSustento.docSustento.tipoRegi", "docSustento.pagoLocExt:02"],
      ],
      [
        "con-reembolso",
        (xml) =>
          xml.replace("<codDocSustento>01</codDocSustento>", "<codDocSustento>41</codDocSustento>"),
        ["docSustento.codDocSustento:41"],
      ],
    ];
    for (const [name, tamper, detail] of cases) {
      const tampered = await authorizedWithholding(
        {
          name,
          issueDate: "2026-10-06",
          sequential: String(20 + cases.findIndex(([n]) => n === name)).padStart(9, "0"),
          supports: TWO_SUPPORTS,
          tamper,
        },
        p12Dir,
      );
      expect(await renderer.render(tampered.input), name).toEqual({
        status: "REJECTED",
        code: "RIDE_SOURCE_UNSUPPORTED",
        detail,
      });
    }
  });

  it("la misma retención da los mismos bytes, también en otro proceso", async () => {
    const first = sha256(outcome.pdf);
    const again = await renderer.render(receipt.input);
    expect(again.status === "RENDERED" ? sha256(again.pdf) : null).toBe(first);
    const work = mkdtempSync(join(tmpdir(), "ride-ret-determinism-"));
    try {
      writeFileSync(join(work, "source.xml"), receipt.xml);
      const script = [
        `import { readFileSync } from "node:fs";`,
        `import { createHash } from "node:crypto";`,
        `const assets = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts", import.meta.url).href)});`,
        `const renderer = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts", import.meta.url).href)});`,
        `const loaded = assets.loadRideAssets(assets.defaultRideFontsDirectory());`,
        `const input = ${JSON.stringify({ ...receipt.input, xml: null })};`,
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
