// Prueba de arranque del paquete de XSD (add-invoice-emission, tarea 2.3, design D11): main.ts
// verifica al arrancar cada archivo del registro de esquemas vigente. Con un XSD ausente o
// alterado, el proceso atiende /health/live pero no se declara listo: /health/ready responde 503 y
// `xsd_registry_available` vale 0. Sin descargas ni sustitutos.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { startE2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-xsd.ec", password: "contrasena-admin-e2e-1" };
const PRODUCT_DIR = fileURLToPath(new URL("../../../docs/product/", import.meta.url));

describe("paquete de XSD al arrancar", () => {
  let db: MigratedSchema;
  const scratch = mkdtempSync(join(tmpdir(), "facturador-xsd-bundle-"));

  /** Copia del paquete canónico con un cambio aplicado. */
  function bundle(name: string, change: (root: string) => void): string {
    const root = join(scratch, name);
    for (const dir of ["sri-xsd", "w3c-xsd"]) {
      cpSync(join(PRODUCT_DIR, dir), join(root, dir), { recursive: true });
    }
    change(root);
    return root;
  }

  async function startWith(env: Record<string, string>) {
    const backend = await startE2eBackend({
      label: "end_to_end_xsd",
      admin: ADMIN,
      db,
      env,
      waitFor: "live",
    });
    try {
      const ready = await fetch(`${backend.base}/health/ready`);
      const metrics = await (await fetch(`${backend.base}/metrics`)).text();
      return { ready: ready.status, metrics, output: backend.output() };
    } finally {
      await backend.stop();
    }
  }

  beforeAll(async () => {
    db = await createMigratedSchema("end_to_end_xsd");
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("con el paquete completo queda listo", async () => {
    const result = await startWith({});
    expect(result.ready).toBe(200);
    expect(result.metrics).toMatch(/^xsd_registry_available 1$/m);
  }, 120_000);

  it("con un XSD alterado no se declara listo", async () => {
    const root = bundle("altered", (dir) => {
      const target = join(dir, "sri-xsd", "factura_V1.1.0.xsd");
      const bytes = readFileSync(target);
      bytes[100] = (bytes[100] ?? 0) ^ 0x01;
      writeFileSync(target, bytes);
    });
    const result = await startWith({ XSD_DIRECTORY: root });
    expect(result.ready).toBe(503);
    expect(result.metrics).toMatch(/^xsd_registry_available 0$/m);
    expect(result.output).toContain("el paquete de XSD del registro está incompleto o alterado");
    expect(result.output).toContain('"path":"sri-xsd/factura_V1.1.0.xsd","reason":"HASH_MISMATCH"');
  }, 120_000);

  it("sin el import requerido no se declara listo", async () => {
    const root = bundle("missing-import", (dir) =>
      rmSync(join(dir, "w3c-xsd"), { recursive: true }),
    );
    const result = await startWith({ XSD_DIRECTORY: root });
    expect(result.ready).toBe(503);
    expect(result.metrics).toMatch(/^xsd_registry_available 0$/m);
    expect(result.output).toContain('"path":"w3c-xsd/xmldsig-core-schema.xsd","reason":"MISSING"');
  }, 120_000);
});
