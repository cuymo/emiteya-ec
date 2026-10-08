// Archivo temporal de una exportación (add-reports-export, design D10): un directorio propio con
// modo 0700 en el directorio temporal del sistema y un nombre aleatorio; el escritor crea el archivo
// con modo 0600 y nunca reemplaza uno existente. Nunca se expone por una ruta ni se registra su
// ubicación, y `dispose` borra el directorio entero.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TemporaryFiles } from "../application/ports.ts";

export function createTemporaryFiles(root: string = tmpdir()): TemporaryFiles {
  return {
    async create() {
      const directory = await mkdtemp(join(root, "facturador-report-"));
      return {
        path: join(directory, `${randomUUID()}.xlsx`),
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    },
  };
}
