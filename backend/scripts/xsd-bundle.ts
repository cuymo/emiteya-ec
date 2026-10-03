// Paquete de XSD del registro de esquemas (add-invoice-emission, design D11). Los archivos del
// registro vigente se copian al artefacto del build (`dist/xsd/<ruta lógica>`) y se comprueban por
// su SHA-256. Lo usan `copy-xsd.ts`, al final del build, y `check-xsd-artifact.ts`, en `verify`.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATASET_FILES } from "../src/modules/catalogs/datasets/index.ts";
import {
  validateDatasets,
  type ValidatedDataset,
} from "../src/modules/catalogs/domain/datasets.ts";

/** XSD canónicos versionados del producto: `sri-xsd/` y `w3c-xsd/`. */
export const SOURCE_ROOT = fileURLToPath(new URL("../../docs/product/", import.meta.url));
/** Raíz del paquete dentro del artefacto del build. */
export const ARTIFACT_ROOT = fileURLToPath(new URL("../dist/xsd/", import.meta.url));

export type BundleFile = { path: string; sha256: string };
export type BundleFailure = { path: string; reason: "MISSING" | "HASH_MISMATCH" };

type SchemaRegistry = Extract<ValidatedDataset, { catalogType: "schema-registry" }>;

/** Archivos del registro de esquemas vigente; la versión 1 no declaraba ruta (`sri-xsd/<archivo>`). */
export function bundleFiles(): BundleFile[] {
  const registries = validateDatasets(DATASET_FILES).filter(
    (dataset): dataset is SchemaRegistry => dataset.catalogType === "schema-registry",
  );
  const latest = registries.reduce((a, b) => (b.version > a.version ? b : a));
  return latest.entries.map((entry) => ({
    path: "path" in entry ? entry.path : `sri-xsd/${entry.file}`,
    sha256: entry.sha256,
  }));
}

export function copyBundle(files: readonly BundleFile[], from = SOURCE_ROOT, to = ARTIFACT_ROOT) {
  for (const file of files) {
    const target = join(to, file.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(from, file.path), target);
  }
}

/** Archivos que faltan o no coinciden con su hash bajo `root`. */
export function checkBundle(files: readonly BundleFile[], root = ARTIFACT_ROOT): BundleFailure[] {
  const failures: BundleFailure[] = [];
  for (const file of files) {
    const target = join(root, file.path);
    if (!existsSync(target)) {
      failures.push({ path: file.path, reason: "MISSING" });
    } else if (createHash("sha256").update(readFileSync(target)).digest("hex") !== file.sha256) {
      failures.push({ path: file.path, reason: "HASH_MISMATCH" });
    }
  }
  return failures;
}
