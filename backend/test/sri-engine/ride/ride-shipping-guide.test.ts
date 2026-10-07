// RIDE de la guía de remisión (add-shipping-guides, tarea 10.1, design D20): distribución propia de la
// ficha v2.34 (anexo 2, página 64) con golden del texto de las páginas: el transporte con el
// transportista, la placa, el punto de partida y las fechas, y un bloque por destinatario con su
// comprobante de venta (vacío sin factura, como en el modelo), su motivo, su destino, su
// identificación, su ruta y su tabla de cantidad, descripción y códigos; sin importes ni una fila de
// fecha de emisión; la paginación con el máximo de filas; el Code128 con la clave de la guía; el
// contenido que el sistema no emite que detiene la generación; los mismos bytes en otro proceso y la
// versión de su distribución. El RIDE de los demás tipos no cambia (lo prueban sus propias pruebas y
// sus golden).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SHIPPING_GUIDE_LIMITS_MAX } from "@facturador/contracts";
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
  SHIPPING_GUIDE_RIDE_RENDERER_VERSION,
  WITHHOLDING_RIDE_RENDERER_VERSION,
  createInProcessRideRenderer,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { decodeCode128, pageTexts } from "../../support/pdf-inspection.ts";
import {
  THREE_RECIPIENTS,
  authorizedGuide,
  detail,
  type AuthorizedGuide,
  type GuideRecipient,
} from "../../support/ride-shipping-guides.ts";

const run = promisify(execFile);
const p12Dir = inject("p12FixturesDir");
const GOLDEN = fileURLToPath(new URL("../../fixtures/shipping-guide-ride/", import.meta.url));
const UPDATE = process.env.SHIPPING_GUIDE_RIDE_UPDATE === "1";
/** Para revisar la distribución a ojo: escribe el PDF en esa carpeta. */
const PREVIEW = process.env.SHIPPING_GUIDE_RIDE_PREVIEW;
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const renderer = createInProcessRideRenderer(assets.fonts);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let guide: AuthorizedGuide;
let outcome: RideRenderOutcome & { status: "RENDERED" };

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${GOLDEN}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con SHIPPING_GUIDE_RIDE_UPDATE=1`).toBe(
      true,
    );
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

const renderOk = async (input: AuthorizedGuide["input"], preview?: string) => {
  const rendered = await renderer.render(input);
  if (rendered.status !== "RENDERED") throw new Error(JSON.stringify(rendered));
  if (PREVIEW && preview) writeFileSync(join(PREVIEW, `${preview}.pdf`), rendered.pdf);
  return rendered;
};

beforeAll(async () => {
  guide = await authorizedGuide(
    {
      name: "tres-destinatarios",
      issueDate: "2026-10-06",
      sequential: "000000012",
      recipients: THREE_RECIPIENTS,
    },
    p12Dir,
  );
  outcome = await renderOk(guide.input, "tres-destinatarios");
});

describe("RIDE de la guía de remisión (ficha v2.34, anexo 2, página 64)", () => {
  it("dibuja su distribución: título, transporte y un bloque por destinatario con su sustento y su detalle", async () => {
    const pages = await pageTexts(outcome.pdf);
    // El tercer bloque no cabe entero en la primera página: pasa completo a la segunda.
    expect(outcome.pages).toBe(2);
    matchesGolden("tres-destinatarios.txt", `${pages.join("\n---\n")}\n`);
    const text = pages.join(" ");
    const ordered = [
      "R.U.C.:",
      "GUÍA DE REMISIÓN",
      "001-001-000000012",
      "NÚMERO DE AUTORIZACIÓN",
      "CLAVE DE ACCESO",
      "Identificación (Transportista): 1791111111001",
      "Razón Social / Nombres y Apellidos: TRANSPORTES ANDINOS S.A.",
      "Placa: PAA-1234",
      "Punto de Partida: Av. Amazonas N24-03, Quito",
      "Fecha inicio Transporte: 06/10/2026",
      "Fecha fin Transporte: 08/10/2026",
      // Destinatario con su factura sustento.
      "Comprobante de Venta: FACTURA 001-001-000000123",
      "Fecha de Emisión: 05/10/2026",
      "Número de Autorización: 0510202601179001234500110010010000001231234567815",
      "Motivo Traslado: Venta",
      "Destino (Punto de llegada): Av. Quito y Guayaquil, Guayaquil",
      "Identificación (Destinatario): 0992877878001",
      "Razón Social / Nombres y Apellidos: FERRETERIA EL PERNO CIA. LTDA.",
      "Documento Aduanero:",
      "Código Establecimiento Destino:",
      "Ruta: Quito - Guayaquil",
      "Cantidad Descripción Código Principal Código Auxiliar",
      "10 Cemento 50 kg en sacos CEM-50 AUX-1",
      "2.5 Varilla corrugada 12 mm VAR-12",
      // En consignación: los rótulos del comprobante de venta quedan vacíos.
      "Motivo Traslado: Consignación",
      "Código Establecimiento Destino: 003",
      "Ruta: Quito - Cayambe",
      "3.125000 Arena fina, 3 metros cúbicos",
      // Traslado entre establecimientos propios.
      "Identificación (Destinatario): 1790012345001",
      "Código Establecimiento Destino: 002",
      "100 Cemento 50 kg en sacos CEM-50",
    ];
    const positions = ordered.map((needle) => {
      const index = text.indexOf(needle);
      expect(index, `falta "${needle}"`).toBeGreaterThanOrEqual(0);
      return index;
    });
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Sin factura, el comprobante de venta, su fecha y su autorización quedan vacíos.
    expect(text).toContain(
      "Comprobante de Venta: Fecha de Emisión: Número de Autorización: Motivo Traslado: Consignación",
    );
    // Sin importes ni una fila de fecha de emisión de la guía; sin las tablas de los demás tipos.
    expect(text).not.toMatch(
      /Fecha Emisión:|Precio|SUBTOTAL|VALOR TOTAL|Forma de pago|IVA|Comprobante que se modifica/,
    );
  });

  it("el código de barras y la clave impresa son los de la guía", async () => {
    expect(guide.accessKey.slice(8, 10)).toBe("06");
    expect(await decodeCode128(outcome.pdf)).toEqual([guide.accessKey]);
    expect((await pageTexts(outcome.pdf)).join(" ")).toContain(guide.accessKey);
  });

  it("registra la versión de su propia distribución, distinta de la de los demás tipos", () => {
    expect(outcome.versions.rendererVersion).toBe(SHIPPING_GUIDE_RIDE_RENDERER_VERSION);
    expect(SHIPPING_GUIDE_RIDE_RENDERER_VERSION).toBe("guia-remision-1");
    expect(
      new Set([
        SHIPPING_GUIDE_RIDE_RENDERER_VERSION,
        WITHHOLDING_RIDE_RENDERER_VERSION,
        RIDE_RENDERER_VERSION,
        CREDIT_NOTE_RIDE_RENDERER_VERSION,
        DEBIT_NOTE_RIDE_RENDERER_VERSION,
      ]).size,
    ).toBe(5);
  });

  it("con el máximo de destinatarios y detalles pagina sin partir filas y repite el bloque del destinatario", async () => {
    const { recipients, details } = SHIPPING_GUIDE_LIMITS_MAX;
    // 50 destinatarios y 300 detalles: el primero con 100 y los demás con 4.
    const perRecipient = (index: number) => (index === 0 ? details - 4 * (recipients - 1) : 4);
    const many: GuideRecipient[] = Array.from({ length: recipients }, (_, r) => ({
      ...THREE_RECIPIENTS[1]!,
      identification: `17${String(r + 1).padStart(8, "0")}`,
      legalName: `Destinatario ${r + 1}`,
      details: Array.from({ length: perRecipient(r) }, (_, d) =>
        detail(`Mercadería ${r + 1}.${d + 1}`, `${d + 1}`, `C-${r + 1}-${d + 1}`),
      ),
    }));
    expect(many.reduce((sum, recipient) => sum + recipient.details.length, 0)).toBe(details);
    const largest = await authorizedGuide(
      { name: "maximo", issueDate: "2026-10-06", sequential: "000000099", recipients: many },
      p12Dir,
    );
    const rendered = await renderOk(largest.input, "maximo");
    const pages = await pageTexts(rendered.pdf);
    expect(rendered.pages).toBe(pages.length);
    expect(pages.length).toBeGreaterThanOrEqual(10);
    pages.forEach((page, index) => {
      expect(page, `página ${index + 1}`).toContain(`Página ${index + 1} de ${pages.length}`);
      if (index > 0) {
        expect(page).toContain(
          `GUÍA DE REMISIÓN No. 001-001-000000099 · R.U.C. 1790012345001 · Clave de acceso ${largest.accessKey}`,
        );
      }
    });
    // Cada fila aparece entera en una página, en una que también muestra su destinatario y el
    // encabezado de la tabla.
    many.forEach((recipient, r) => {
      recipient.details.forEach((item, d) => {
        const row = `${item.quantity} Mercadería ${r + 1}.${d + 1} C-${r + 1}-${d + 1}`;
        const page = pages.find((content) => content.includes(row));
        expect(page, row).toBeDefined();
        expect(page).toContain(`Identificación (Destinatario): ${recipient.identification}`);
        expect(page).toContain("Cantidad Descripción Código Principal Código Auxiliar");
      });
    });
    expect(pages[0]).toContain("NÚMERO DE AUTORIZACIÓN");
    expect(pages[0]).toContain("CLAVE DE ACCESO");
  }, 120_000);

  it("un contenido que el sistema no emite detiene la generación indicando el elemento", async () => {
    const cases: [string, (xml: string) => string, string[]][] = [
      [
        "con-rise",
        (xml) =>
          xml.replace(
            "<obligadoContabilidad>",
            "<rise>Contribuyente Régimen Simplificado RISE</rise><obligadoContabilidad>",
          ),
        ["guiaRemision.infoGuiaRemision.rise"],
      ],
      [
        "con-documento-aduanero",
        (xml) =>
          xml.replace(
            "<motivoTraslado>Venta</motivoTraslado>",
            "<motivoTraslado>Venta</motivoTraslado><docAduaneroUnico>0041324846887</docAduaneroUnico>",
          ),
        ["guiaRemision.destinatarios.destinatario.docAduaneroUnico"],
      ],
      [
        "con-detalles-adicionales",
        (xml) =>
          xml.replace(
            "<cantidad>10</cantidad>",
            '<cantidad>10</cantidad><detallesAdicionales><detAdicional nombre="Marca" valor="X"/></detallesAdicionales>',
          ),
        ["guiaRemision.destinatarios.destinatario.detalles.detalle.detallesAdicionales"],
      ],
      [
        "con-maquina-fiscal",
        (xml) =>
          xml.replace(
            "</destinatarios>",
            "</destinatarios><maquinaFiscal><marca>X</marca><modelo>Y</modelo><serie>Z</serie></maquinaFiscal>",
          ),
        ["guiaRemision.maquinaFiscal"],
      ],
      [
        "con-informacion-adicional",
        (xml) =>
          xml.replace(
            "</destinatarios>",
            '</destinatarios><infoAdicional><campoAdicional nombre="Email">x@y.ec</campoAdicional></infoAdicional>',
          ),
        ["guiaRemision.infoAdicional"],
      ],
      [
        "sustento-nota-de-venta",
        (xml) =>
          xml.replace("<codDocSustento>01</codDocSustento>", "<codDocSustento>02</codDocSustento>"),
        ["destinatario.codDocSustento:02"],
      ],
    ];
    for (const [index, [name, tamper, detailPath]] of cases.entries()) {
      const tampered = await authorizedGuide(
        {
          name,
          issueDate: "2026-10-06",
          sequential: String(20 + index).padStart(9, "0"),
          recipients: THREE_RECIPIENTS,
          tamper,
        },
        p12Dir,
      );
      expect(await renderer.render(tampered.input), name).toEqual({
        status: "REJECTED",
        code: "RIDE_SOURCE_UNSUPPORTED",
        detail: detailPath,
      });
    }
  });

  it("la misma guía da los mismos bytes, también en otro proceso", async () => {
    const first = sha256(outcome.pdf);
    const again = await renderer.render(guide.input);
    expect(again.status === "RENDERED" ? sha256(again.pdf) : null).toBe(first);
    const work = mkdtempSync(join(tmpdir(), "ride-guia-determinism-"));
    try {
      writeFileSync(join(work, "source.xml"), guide.xml);
      const script = [
        `import { readFileSync } from "node:fs";`,
        `import { createHash } from "node:crypto";`,
        `const assets = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts", import.meta.url).href)});`,
        `const renderer = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts", import.meta.url).href)});`,
        `const loaded = assets.loadRideAssets(assets.defaultRideFontsDirectory());`,
        `const input = ${JSON.stringify({ ...guide.input, xml: null })};`,
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
