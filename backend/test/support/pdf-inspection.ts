// Inspección de PDF en las pruebas del RIDE (ADR 0022): texto por página con pdf.js, y lectura
// real del Code128 rasterizando con pdf.js y @napi-rs/canvas y decodificando con zxing (WASM). zbar
// con poppler es un segundo decodificador opcional, solo si el equipo lo tiene.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let modules:
  | Promise<{
      pdfjs: PdfJs;
      canvas: typeof import("@napi-rs/canvas");
      zxing: typeof import("zxing-wasm/reader");
    }>
  | undefined;
const load = () =>
  (modules ??= (async () => ({
    pdfjs: (await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"))) as PdfJs,
    canvas: await import("@napi-rs/canvas"),
    zxing: await import("zxing-wasm/reader"),
  }))());

/** Texto de cada página, con los espacios normalizados. */
export async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const { pdfjs } = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf) });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const content = await (await document.getPage(index)).getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " "),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Code128 leídos en una página: pdf.js la rasteriza y zxing-cpp la decodifica. */
export async function decodeCode128(pdf: Uint8Array, pageNumber = 1, dpi = 300) {
  const { pdfjs, canvas: canvasModule, zxing } = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf) });
  try {
    const page = await (await task.promise).getPage(pageNumber);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context as never, viewport, canvas: canvas as never })
      .promise;
    const raw = context.getImageData(0, 0, canvas.width, canvas.height);
    const results = await zxing.readBarcodesFromImageData(
      {
        data: new Uint8ClampedArray(raw.data),
        width: raw.width,
        height: raw.height,
        colorSpace: "srgb",
      },
      { formats: ["Code128"], tryHarder: true },
    );
    return results.map((result) => result.text);
  } finally {
    await task.destroy();
  }
}

/** ¿Están zbar y poppler instalados? */
export const systemDecoderAvailable = (): Promise<boolean> =>
  run("zbarimg", ["--version"]).then(
    () => run("pdftoppm", ["-v"]).then(() => true),
    () => false,
  );

/** Code128 leídos con poppler y zbar, a una resolución dada. */
export async function decodeCode128WithZbar(pdf: Uint8Array, pageNumber = 1, dpi = 200) {
  const work = mkdtempSync(join(tmpdir(), "ride-zbar-"));
  try {
    writeFileSync(join(work, "ride.pdf"), pdf);
    await run("pdftoppm", [
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-r",
      String(dpi),
      "-png",
      "-singlefile",
      join(work, "ride.pdf"),
      join(work, "page"),
    ]);
    const { stdout } = await run("zbarimg", [
      "-q",
      "--raw",
      "-Sdisable",
      "-Scode128.enable",
      join(work, "page.png"),
    ]).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
    return stdout.split("\n").filter(Boolean);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
