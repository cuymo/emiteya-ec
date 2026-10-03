// Esquema registrado de un comprobante desde el registro de esquemas (add-invoice-emission, design
// D11): el XSD de su tipo y versión, soportado, con los archivos que importa y sus hashes. Recibe
// las entradas por su forma, sin depender del módulo de catálogos.
import type { DocumentType } from "@facturador/contracts";
import type { RegisteredSchema, SchemaFile } from "./ports.ts";

export type SchemaRegistryEntry = Readonly<{
  kind: "DOCUMENT" | "IMPORT";
  path: string;
  documentType: string | null;
  version: string | null;
  sha256: string;
  imports: readonly string[];
  supported: boolean;
}>;

/** El esquema soportado del tipo y la versión, con sus imports, o null si falta algún archivo. */
export function registeredSchema(
  entries: readonly SchemaRegistryEntry[],
  documentType: DocumentType,
  version: string,
): RegisteredSchema | null {
  const document = entries.find(
    (entry) =>
      entry.kind === "DOCUMENT" &&
      entry.documentType === documentType &&
      entry.version === version &&
      entry.supported,
  );
  if (!document) return null;
  const imports: SchemaFile[] = [];
  for (const path of document.imports) {
    const imported = entries.find((entry) => entry.kind === "IMPORT" && entry.path === path);
    if (!imported) return null;
    imports.push({ path: imported.path, sha256: imported.sha256 });
  }
  return { documentType, version, path: document.path, sha256: document.sha256, imports };
}

/** Todos los archivos del registro vigente, para verificar el paquete completo al arrancar. */
export const registryFiles = (entries: readonly SchemaRegistryEntry[]): SchemaFile[] =>
  entries.map((entry) => ({ path: entry.path, sha256: entry.sha256 }));
