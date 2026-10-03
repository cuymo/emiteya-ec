// Genera los P12 sintéticos una vez por ejecución en un directorio temporal y lo comparte con las
// pruebas (inject("p12FixturesDir")). Al terminar, se borra.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { generateP12Fixtures } from "./p12-fixtures.ts";

declare module "vitest" {
  export interface ProvidedContext {
    p12FixturesDir: string;
  }
}

export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), "facturador-p12-"));
  generateP12Fixtures(dir);
  project.provide("p12FixturesDir", dir);
  return () => rmSync(dir, { recursive: true, force: true });
}
