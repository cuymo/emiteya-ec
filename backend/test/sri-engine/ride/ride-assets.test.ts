// Fuentes del RIDE como artefacto verificable (ADR 0022; add-document-archive, design D7): el
// manifiesto, la licencia y las dos fuentes, cada uno con su hash esperado fijado en el código, y
// `check:ride-assets` sobre el artefacto, separado de `check:xsd-artifact`.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "@prometheus-io/client";
import type { Logger } from "pino";
import { afterAll, describe, expect, it } from "vitest";
import {
  RIDE_FONTS_MANIFEST,
  defaultRideFontsDirectory,
  loadRideAssets,
  verifyRideAssets,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";

const backendRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SOURCE = defaultRideFontsDirectory();
const scratch = mkdtempSync(join(tmpdir(), "facturador-ride-assets-"));

/** Copia del paquete de fuentes con un cambio aplicado. */
function copyWith(name: string, change: (root: string) => void = () => {}): string {
  const root = join(scratch, name);
  cpSync(SOURCE, root, { recursive: true });
  change(root);
  return root;
}
const flipByte = (path: string) => {
  const bytes = readFileSync(path);
  bytes[1024] = (bytes[1024] ?? 0) ^ 0x01;
  writeFileSync(path, bytes);
};

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("fuentes del RIDE", () => {
  it("el directorio por defecto del código fuente es backend/assets/fonts/noto-sans", () => {
    expect(SOURCE).toBe(join(backendRoot, "assets/fonts/noto-sans/"));
  });

  it("carga Regular y Bold cuando todo coincide con el manifiesto fijado en el código", () => {
    const loaded = loadRideAssets(SOURCE);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.fonts.regular.length).toBe(RIDE_FONTS_MANIFEST.fonts.regular.sizeBytes);
    expect(loaded.fonts.bold.length).toBe(RIDE_FONTS_MANIFEST.fonts.bold.sizeBytes);
  });

  it("detecta una fuente ausente, una alterada y una licencia alterada", () => {
    const root = copyWith("broken", (dir) => {
      rmSync(join(dir, "NotoSans-Regular.ttf"));
      flipByte(join(dir, "NotoSans-Bold.ttf"));
      writeFileSync(join(dir, "OFL.txt"), "otra licencia");
    });
    expect(loadRideAssets(root)).toEqual({
      ok: false,
      failures: [
        { file: "OFL.txt", reason: "HASH_MISMATCH" },
        { file: "NotoSans-Regular.ttf", reason: "MISSING" },
        { file: "NotoSans-Bold.ttf", reason: "HASH_MISMATCH" },
      ],
    });
  });

  it("detecta un manifiesto ausente, ilegible o reescrito", () => {
    const missing = copyWith("no-manifest", (dir) => rmSync(join(dir, "manifest.json")));
    expect(loadRideAssets(missing)).toEqual({
      ok: false,
      failures: [{ file: "manifest.json", reason: "MISSING" }],
    });
    const invalid = copyWith("invalid-manifest", (dir) =>
      writeFileSync(join(dir, "manifest.json"), "{ no es json"),
    );
    expect(loadRideAssets(invalid)).toEqual({
      ok: false,
      failures: [{ file: "manifest.json", reason: "MANIFEST_INVALID" }],
    });
    // Una fuente cambiada junto con su manifiesto también falla: lo esperado está en el código.
    const rewritten = copyWith("rewritten-manifest", (dir) => {
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
        version: string;
      };
      manifest.version = "2.016";
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    });
    expect(loadRideAssets(rewritten)).toEqual({
      ok: false,
      failures: [{ file: "manifest.json", reason: "MANIFEST_MISMATCH" }],
    });
  });

  it("al arrancar publica la métrica y registra los archivos sin la ruta absoluta", async () => {
    const lines: { details: unknown; message: string }[] = [];
    const record = (details: unknown, message: string) => void lines.push({ details, message });
    const logger = { info: record, error: record } as unknown as Pick<Logger, "info" | "error">;
    const metrics = new Registry();
    const root = copyWith("startup", (dir) => flipByte(join(dir, "NotoSans-Regular.ttf")));
    expect(verifyRideAssets({ directory: root, metrics, logger })).toBe(false);
    expect(await metrics.metrics()).toMatch(/^ride_assets_available 0$/m);
    expect(lines).toEqual([
      {
        details: { failures: [{ file: "NotoSans-Regular.ttf", reason: "HASH_MISMATCH" }] },
        message: "las fuentes del RIDE están incompletas o alteradas",
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(scratch);
    const healthy = new Registry();
    expect(verifyRideAssets({ directory: SOURCE, metrics: healthy, logger })).toBe(true);
    expect(await healthy.metrics()).toMatch(/^ride_assets_available 1$/m);
  });

  it("check:ride-assets pasa sobre un artefacto íntegro y falla sobre uno alterado", () => {
    const check = (root: string) =>
      spawnSync(
        process.execPath,
        ["--conditions=development", "scripts/check-ride-assets.ts", root],
        { cwd: backendRoot, encoding: "utf8", timeout: 30_000 },
      );
    const intact = check(copyWith("artifact-intact"));
    expect(intact.status).toBe(0);
    expect(intact.stdout).toContain("check:ride-assets: 4 archivos con su hash");
    const broken = check(
      copyWith("artifact-broken", (dir) => rmSync(join(dir, "NotoSans-Bold.ttf"))),
    );
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain("NotoSans-Bold.ttf: MISSING");
  });
});
