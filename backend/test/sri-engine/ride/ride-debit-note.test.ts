// RIDE de la nota de débito (add-debit-notes, tarea 9.1, design D18): distribución propia de la
// ficha v2.34 (anexo 2, página 62) con golden del texto de las páginas, las razones y valores de la
// modificación, la forma de pago con la denominación del snapshot, los subtotales por tratamiento,
// el Code128 con la clave de la nota, el contenido que el sistema no emite que detiene la
// generación, los mismos bytes en otro proceso y la versión de su distribución. El RIDE de la
// factura y el de la nota de crédito no cambian (lo prueban sus propias pruebas y sus golden).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  createInProcessRideRenderer,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { decodeCode128, pageTexts } from "../../support/pdf-inspection.ts";
import { authorizedDebitNote, type AuthorizedDebitNote } from "../../support/ride-debit-notes.ts";

const run = promisify(execFile);
const p12Dir = inject("p12FixturesDir");
const GOLDEN = fileURLToPath(new URL("../../fixtures/debit-note-ride/", import.meta.url));
const UPDATE = process.env.DEBIT_NOTE_RIDE_UPDATE === "1";
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const renderer = createInProcessRideRenderer(assets.fonts);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let note: AuthorizedDebitNote;
let outcome: RideRenderOutcome & { status: "RENDERED" };

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${GOLDEN}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con DEBIT_NOTE_RIDE_UPDATE=1`).toBe(true);
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

beforeAll(async () => {
  note = await authorizedDebitNote(
    { name: "varias-tarifas", issueDate: "2026-10-09", sequential: "000000007" },
    p12Dir,
  );
  const rendered = await renderer.render(note.input);
  if (rendered.status !== "RENDERED") throw new Error(JSON.stringify(rendered));
  outcome = rendered;
});

describe("RIDE de la nota de débito (ficha v2.34, anexo 2, página 62)", () => {
  it("dibuja su distribución: título, comprobante modificado, razones y valores, forma de pago y subtotales por tratamiento", async () => {
    const pages = await pageTexts(outcome.pdf);
    expect(outcome.pages).toBe(1);
    matchesGolden("varias-tarifas.txt", `${pages.join("\n---\n")}\n`);
    const text = pages.join(" ");
    const ordered = [
      "R.U.C.:",
      "NOTA DE DÉBITO",
      "001-001-000000007",
      "NÚMERO DE AUTORIZACIÓN",
      "Razón Social / Nombres y Apellidos:",
      "Comprobante que se modifica:",
      "FACTURA",
      "001-001-000000041",
      "Fecha Emisión (Comprobante a modificar):",
      "01/09/2026",
      "RAZÓN DE LA MODIFICACIÓN",
      "VALOR DE LA MODIFICACIÓN",
      "Intereses por 30 días de mora",
      "50.00",
      "Flete posterior a la venta",
      "20.00",
      "Forma de pago",
      "20 - OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
      "77.50",
      "SUBTOTAL 15%",
      "SUBTOTAL 0%",
      "SUBTOTAL SIN IMPUESTOS",
      "IVA 15%",
      "VALOR TOTAL",
    ];
    const positions = ordered.map((needle) => {
      const index = text.indexOf(needle);
      expect(index, `falta "${needle}"`).toBeGreaterThanOrEqual(0);
      return index;
    });
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).not.toMatch(/TOTAL DESCUENTO|Precio Unitario|Razón de Modificación:/);
  });

  it("la forma de pago lleva la denominación del snapshot, nunca la del catálogo vigente", async () => {
    const relabeled = await renderer.render({
      ...note.input,
      paymentLabels: { "20": "DENOMINACIÓN CONGELADA EN EL SNAPSHOT" },
    });
    if (relabeled.status !== "RENDERED") throw new Error(JSON.stringify(relabeled));
    expect((await pageTexts(relabeled.pdf)).join(" ")).toContain(
      "20 - DENOMINACIÓN CONGELADA EN EL SNAPSHOT",
    );
  });

  it("el código de barras y la clave impresa son los de la nota", async () => {
    expect(note.accessKey.slice(8, 10)).toBe("05");
    expect(await decodeCode128(outcome.pdf)).toEqual([note.accessKey]);
    expect((await pageTexts(outcome.pdf)).join(" ")).toContain(note.accessKey);
  });

  it("registra la versión de su propia distribución, distinta de la de la factura y la nota de crédito", () => {
    expect(outcome.versions.rendererVersion).toBe(DEBIT_NOTE_RIDE_RENDERER_VERSION);
    expect(
      new Set([
        DEBIT_NOTE_RIDE_RENDERER_VERSION,
        RIDE_RENDERER_VERSION,
        CREDIT_NOTE_RIDE_RENDERER_VERSION,
      ]).size,
    ).toBe(3);
  });

  it("un contenido que el sistema no emite detiene la generación indicando el elemento", async () => {
    const withAdditional = await authorizedDebitNote(
      {
        name: "con-informacion-adicional",
        issueDate: "2026-10-09",
        sequential: "000000008",
        tamper: (xml) =>
          xml.replace(
            "</motivos>",
            '</motivos><infoAdicional><campoAdicional nombre="Email">x@y.ec</campoAdicional></infoAdicional>',
          ),
      },
      p12Dir,
    );
    expect(await renderer.render(withAdditional.input)).toEqual({
      status: "REJECTED",
      code: "RIDE_SOURCE_UNSUPPORTED",
      detail: ["notaDebito.infoAdicional"],
    });
    const twoPayments = await authorizedDebitNote(
      {
        name: "dos-pagos",
        issueDate: "2026-10-09",
        sequential: "000000009",
        tamper: (xml) =>
          xml.replace(
            "</pago>",
            "</pago><pago><formaPago>01</formaPago><total>0.00</total></pago>",
          ),
      },
      p12Dir,
    );
    expect(await renderer.render(twoPayments.input)).toEqual({
      status: "REJECTED",
      code: "RIDE_SOURCE_UNSUPPORTED",
      detail: ["notaDebito.infoNotaDebito.pagos.pago"],
    });
  });

  it("la misma nota da los mismos bytes, también en otro proceso", async () => {
    const first = sha256(outcome.pdf);
    const again = await renderer.render(note.input);
    expect(again.status === "RENDERED" ? sha256(again.pdf) : null).toBe(first);
    const work = mkdtempSync(join(tmpdir(), "ride-nd-determinism-"));
    try {
      writeFileSync(join(work, "source.xml"), note.xml);
      const script = [
        `import { readFileSync } from "node:fs";`,
        `import { createHash } from "node:crypto";`,
        `const assets = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts", import.meta.url).href)});`,
        `const renderer = await import(${JSON.stringify(new URL("../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts", import.meta.url).href)});`,
        `const loaded = assets.loadRideAssets(assets.defaultRideFontsDirectory());`,
        `const input = ${JSON.stringify({ ...note.input, xml: null })};`,
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
