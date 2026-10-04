// Clave de acceso legible por máquina (ADR 0022; add-document-archive, design D7): el Code128 del
// RIDE de varios comprobantes, rasterizado y leído de verdad, devuelve exactamente su clave. No es
// una comparación visual: clave → Code128 → PDF → imagen → decodificador → la misma clave.
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import {
  BARCODE_MIN_HEIGHT_MM,
  BARCODE_MIN_MODULE_MM,
  BARCODE_QUIET_ZONE_MODULES,
  barcodeGeometry,
  createInProcessRideRenderer,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import {
  decodeCode128,
  decodeCode128WithZbar,
  pageTexts,
  systemDecoderAvailable,
} from "../../support/pdf-inspection.ts";
import { INVOICE_CASES, authorizedInvoice } from "../../support/ride-invoices.ts";

const MM_PER_PT = 25.4 / 72;
const p12Dir = inject("p12FixturesDir");
const rides: { name: string; accessKey: string; pdf: Uint8Array }[] = [];
const zbar = await systemDecoderAvailable();

beforeAll(async () => {
  const assets = loadRideAssets(defaultRideFontsDirectory());
  if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
  const renderer = createInProcessRideRenderer(assets.fonts);
  for (const invoiceCase of Object.values(INVOICE_CASES)) {
    const invoice = await authorizedInvoice(invoiceCase, p12Dir);
    const outcome = await renderer.render(invoice.input);
    if (outcome.status !== "RENDERED") throw new Error(JSON.stringify(outcome));
    rides.push({ name: invoice.name, accessKey: invoice.snapshot.accessKey, pdf: outcome.pdf });
  }
});

describe("Code128 de la clave de acceso", () => {
  it("cada RIDE se lee con zxing y devuelve exactamente su clave", async () => {
    expect(new Set(rides.map((ride) => ride.accessKey)).size).toBe(rides.length);
    for (const ride of rides) {
      expect(await decodeCode128(ride.pdf), ride.name).toEqual([ride.accessKey]);
    }
  });

  it.runIf(zbar)("zbar con poppler también los lee, a 150, 200 y 300 ppp", async () => {
    for (const ride of rides) {
      for (const dpi of [150, 200, 300]) {
        expect(await decodeCode128WithZbar(ride.pdf, 1, dpi), `${ride.name} ${dpi}`).toEqual([
          ride.accessKey,
        ]);
      }
    }
  });

  it("la clave aparece completa como texto, y el código tiene un tamaño legible en la práctica", async () => {
    for (const ride of rides) {
      const [first] = await pageTexts(ride.pdf);
      // Una vez como número de autorización y otra debajo del código de barras.
      expect(first!.split(ride.accessKey).length - 1, ride.name).toBe(2);
      const geometry = barcodeGeometry(ride.accessKey);
      expect(geometry.moduleWidth * MM_PER_PT).toBeGreaterThanOrEqual(BARCODE_MIN_MODULE_MM);
      expect(geometry.height).toBeGreaterThanOrEqual(0.15 * geometry.width);
      expect(geometry.height * MM_PER_PT).toBeGreaterThanOrEqual(BARCODE_MIN_HEIGHT_MM);
      expect(geometry.width).toBeCloseTo(
        geometry.moduleWidth * (geometry.modules + 2 * BARCODE_QUIET_ZONE_MODULES),
      );
    }
  });

  it("en varias páginas, el código está entero en la primera y no se repite", async () => {
    const multiPage = rides.find((ride) => ride.name === "varias-paginas")!;
    const pages = await pageTexts(multiPage.pdf);
    expect(await decodeCode128(multiPage.pdf, 1)).toEqual([multiPage.accessKey]);
    expect(await decodeCode128(multiPage.pdf, pages.length)).toEqual([]);
  });
});
