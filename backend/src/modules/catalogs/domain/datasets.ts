// Formato de los datasets normativos (add-fiscal-catalogs, design D3, D6 y D8). Cada archivo es
// el estado completo de un catálogo en una versión del dataset; una versión nueva añade un archivo
// y nunca edita el anterior. Se valida todo en memoria antes de tocar la base de datos.
import { createHash } from "node:crypto";
import {
  DECIMAL_SPECS,
  decimalString,
  effectiveFromBasisSchema,
  enablementPolicySchema,
  normativeStatusSchema,
  specialCaseCategorySchema,
  taxKindSchema,
} from "@facturador/contracts";
import { z } from "zod";
import { isEnableable } from "./catalog-types.ts";
import { rangesOverlap } from "./validity.ts";

const isoDate = z.iso.date();
const text = z.string().trim().min(1);

const sourceSchema = z.strictObject({
  document: text,
  version: text,
  publishedOn: isoDate,
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const versionFields = {
  entryKey: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,63}$/),
  code: z.string().regex(/^[0-9]{1,4}$/),
  officialLabel: text,
  effectiveFrom: isoDate,
  effectiveFromBasis: effectiveFromBasisSchema,
  effectiveTo: isoDate.nullable(),
  normativeStatus: normativeStatusSchema,
  sourceRef: text,
};

const identificationEntry = z.strictObject({
  ...versionFields,
  identificationPattern: z.string().min(1).nullable(),
  identificationRule: text,
  reservedFor: z.literal("CONSUMER_FINAL").nullable(),
});
const taxEntry = z.strictObject({ ...versionFields, taxKind: taxKindSchema });
const ivaEntry = z
  .strictObject({
    ...versionFields,
    rateKind: z.enum(["PERCENTAGE", "NOT_SUBJECT", "EXEMPT", "DIFFERENTIATED"]),
    percentage: decimalString(DECIMAL_SPECS.tarifa).nullable(),
  })
  .refine((entry) => (entry.percentage !== null) === (entry.rateKind === "PERCENTAGE"), {
    message: "el porcentaje existe solo en tarifas PERCENTAGE",
  });
// ICE, IRBPNR y formas de pago no tienen atributos propios: el esquema estricto no admite tarifas.
const plainEntry = z.strictObject(versionFields);

// Registro de esquemas. La versión 1 publicó solo documentos, sin ruta ni imports: su forma se
// conserva tal cual para que su checksum no cambie. Desde la versión 2 cada entrada declara su
// clase y su ruta lógica en el paquete de XSD (add-invoice-emission, design D11).
const schemaDocumentFields = {
  documentType: z.enum(["01", "03", "04", "05", "06", "07"]),
  root: text,
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  file: text,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source: text,
  downloadedAt: z.iso.datetime(),
  supported: z.boolean(),
};
const schemaPath = z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9_.-]+\.xsd$/);
const legacySchemaEntry = z.strictObject(schemaDocumentFields);
const documentSchemaEntry = z.strictObject({
  kind: z.literal("DOCUMENT"),
  path: schemaPath,
  ...schemaDocumentFields,
  imports: z.array(schemaPath),
});
const importSchemaEntry = z.strictObject({
  kind: z.literal("IMPORT"),
  path: schemaPath,
  file: text,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source: text,
  revision: text,
  downloadedAt: z.iso.datetime(),
  supported: z.boolean(),
});

const header = {
  version: z.number().int().min(1),
  source: sourceSchema,
  enablementPolicy: enablementPolicySchema,
};

const entriesDataset = <T extends string, S extends z.ZodType>(catalogType: T, entry: S) =>
  z.strictObject({
    catalogType: z.literal(catalogType),
    ...header,
    entries: z.array(entry).min(1),
  });

export const datasetFileSchema = z.discriminatedUnion("catalogType", [
  entriesDataset("identification-type", identificationEntry),
  entriesDataset("tax", taxEntry),
  entriesDataset("iva-rate", ivaEntry),
  entriesDataset("ice-rate", plainEntry),
  entriesDataset("irbpnr-rate", plainEntry),
  entriesDataset("payment-method", plainEntry),
  z.strictObject({
    catalogType: z.literal("consumer-final-policy"),
    ...header,
    versions: z
      .array(
        z.strictObject({
          maxAmount: decimalString(DECIMAL_SPECS.importe),
          currency: z.literal("USD"),
          identificationType: z.literal("07"),
          identification: z.literal("9999999999999"),
          canonicalName: text,
          effectiveFrom: isoDate,
          effectiveFromBasis: effectiveFromBasisSchema,
          effectiveTo: isoDate.nullable(),
          sourceRef: text,
        }),
      )
      .min(1),
  }),
  // Límite de tamaño del envío al SRI (add-sri-transmission, design D17): la cita de la fuente, su
  // sección, la unidad literal y la interpretación exacta en bytes con su justificación.
  z.strictObject({
    catalogType: z.literal("sri-transmission-policy"),
    ...header,
    versions: z
      .array(
        z.strictObject({
          maxSignedDocumentBytes: z.number().int().positive(),
          sourceText: text,
          sourceSection: text,
          literalUnit: text,
          interpretation: text,
          effectiveFrom: isoDate,
          effectiveFromBasis: effectiveFromBasisSchema,
          effectiveTo: isoDate.nullable(),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    catalogType: z.literal("schema-registry"),
    ...header,
    entries: z.array(z.union([legacySchemaEntry, documentSchemaEntry, importSchemaEntry])).min(1),
  }),
  z.strictObject({
    catalogType: z.literal("special-case-matrix"),
    ...header,
    entries: z
      .array(
        z.strictObject({
          annex: z.number().int().min(1),
          topic: text,
          category: specialCaseCategorySchema,
          sourceRef: text,
        }),
      )
      .min(1),
  }),
]);

export type DatasetFile = z.infer<typeof datasetFileSchema>;
export type EntriesDatasetFile = Extract<DatasetFile, { entries: { entryKey: string }[] }>;
export type DatasetEntry = EntriesDatasetFile["entries"][number];
export type ConsumerFinalPolicyDataset = Extract<
  DatasetFile,
  { catalogType: "consumer-final-policy" }
>;
export type SriTransmissionPolicyDataset = Extract<
  DatasetFile,
  { catalogType: "sri-transmission-policy" }
>;
/** Datasets de una política con versiones por vigencia, sin entradas. */
export type PolicyDataset = ConsumerFinalPolicyDataset | SriTransmissionPolicyDataset;
export const isPolicyDataset = (dataset: DatasetFile): dataset is PolicyDataset =>
  dataset.catalogType === "consumer-final-policy" ||
  dataset.catalogType === "sri-transmission-policy";
export type SchemaRegistryDataset = Extract<DatasetFile, { catalogType: "schema-registry" }>;
export type SpecialCaseDataset = Extract<DatasetFile, { catalogType: "special-case-matrix" }>;

/** Dataset validado, con el checksum de su contenido canónico. */
export type ValidatedDataset = DatasetFile & { checksum: string };

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetValidationError";
  }
}

export const isEntriesDataset = (dataset: DatasetFile): dataset is EntriesDatasetFile =>
  "entries" in dataset &&
  dataset.catalogType !== "schema-registry" &&
  dataset.catalogType !== "special-case-matrix";

/** JSON canónico: claves ordenadas y sin espacios, para que el checksum no dependa del formato. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const datasetChecksum = (dataset: DatasetFile): string =>
  createHash("sha256").update(canonicalJson(dataset)).digest("hex");

/** Campos que una versión publicada nunca cambia (design D4). */
export function immutableVersionFields(entry: DatasetEntry): string {
  const { effectiveTo: _to, normativeStatus: _status, ...rest } = entry;
  return canonicalJson(rest);
}

type VersionedEntry = { entryKey: string; effectiveFrom: string; effectiveTo: string | null };

function checkVersions(label: string, versions: readonly VersionedEntry[]): void {
  for (let i = 0; i < versions.length; i++) {
    for (let j = i + 1; j < versions.length; j++) {
      const a = versions[i]!;
      const b = versions[j]!;
      if (a.entryKey === b.entryKey && rangesOverlap(a, b)) {
        throw new DatasetValidationError(`${label}: versiones superpuestas de ${a.entryKey}`);
      }
    }
  }
}

/**
 * Registro de esquemas desde la versión 2: rutas únicas que terminan en su archivo, y cada import
 * declarado por un documento está registrado en el mismo archivo.
 */
function checkSchemaRegistry(label: string, dataset: SchemaRegistryDataset): void {
  if (dataset.version === 1) return;
  const paths = new Set<string>();
  const imports = new Set<string>();
  for (const entry of dataset.entries) {
    if (!("kind" in entry)) {
      throw new DatasetValidationError(`${label}: ${entry.file} sin clase ni ruta lógica`);
    }
    if (paths.has(entry.path) || !entry.path.endsWith(`/${entry.file}`)) {
      throw new DatasetValidationError(
        `${label}: ruta repetida o ajena a su archivo ${entry.path}`,
      );
    }
    paths.add(entry.path);
    if (entry.kind === "IMPORT") imports.add(entry.path);
  }
  for (const entry of dataset.entries) {
    if ("kind" in entry && entry.kind === "DOCUMENT") {
      for (const path of entry.imports) {
        if (!imports.has(path)) {
          throw new DatasetValidationError(
            `${label}: ${entry.path} importa ${path}, no registrado`,
          );
        }
      }
    }
  }
}

/** Reglas dentro de un archivo: política coherente, claves únicas por fecha, sin superposición. */
function checkFile(dataset: DatasetFile): void {
  const label = `${dataset.catalogType} v${dataset.version}`;
  const enableable = isEnableable(dataset.catalogType);
  if (enableable !== (dataset.enablementPolicy !== "NOT_ENABLEABLE")) {
    throw new DatasetValidationError(`${label}: política de habilitación incoherente`);
  }
  if (isEntriesDataset(dataset)) {
    const seen = new Set<string>();
    const codes = new Map<string, string>();
    for (const entry of dataset.entries) {
      const id = `${entry.entryKey}@${entry.effectiveFrom}`;
      if (seen.has(id)) throw new DatasetValidationError(`${label}: versión repetida ${id}`);
      seen.add(id);
      if ((codes.get(entry.entryKey) ?? entry.code) !== entry.code) {
        throw new DatasetValidationError(`${label}: ${entry.entryKey} cambia de código`);
      }
      codes.set(entry.entryKey, entry.code);
      if (entry.effectiveTo !== null && entry.effectiveTo < entry.effectiveFrom) {
        throw new DatasetValidationError(`${label}: vigencia invertida en ${id}`);
      }
      if (entry.normativeStatus === "WITHDRAWN" && entry.effectiveTo === null) {
        throw new DatasetValidationError(`${label}: ${id} retirada sin vigencia cerrada`);
      }
    }
    checkVersions(label, dataset.entries);
  }
  if (dataset.catalogType === "schema-registry") checkSchemaRegistry(label, dataset);
  if (isPolicyDataset(dataset)) {
    for (const version of dataset.versions) {
      if (version.effectiveTo !== null && version.effectiveTo < version.effectiveFrom) {
        throw new DatasetValidationError(
          `${label}: vigencia invertida en ${version.effectiveFrom}`,
        );
      }
    }
    checkVersions(
      label,
      dataset.versions.map((version) => ({ ...version, entryKey: "policy" })),
    );
  }
}

/**
 * Transiciones entre versiones consecutivas de un catálogo (design D4): toda versión publicada
 * sigue presente con sus datos; solo puede cerrar una vigencia abierta o retirarse.
 */
function checkTransition(previous: DatasetFile, next: DatasetFile): void {
  const label = `${next.catalogType} v${previous.version}→v${next.version}`;
  if (!isEntriesDataset(previous) || !isEntriesDataset(next)) {
    if (isPolicyDataset(previous) && isPolicyDataset(next)) {
      const nextVersions: readonly PolicyDataset["versions"][number][] = next.versions;
      const nextByStart = new Map(nextVersions.map((version) => [version.effectiveFrom, version]));
      for (const version of previous.versions) {
        const now = nextByStart.get(version.effectiveFrom);
        const { effectiveTo: _a, ...before } = version;
        if (!now)
          throw new DatasetValidationError(
            `${label}: desaparece la versión ${version.effectiveFrom}`,
          );
        const { effectiveTo: _b, ...after } = now;
        if (canonicalJson(before) !== canonicalJson(after)) {
          throw new DatasetValidationError(`${label}: altera la versión ${version.effectiveFrom}`);
        }
        if (version.effectiveTo !== null && now.effectiveTo !== version.effectiveTo) {
          throw new DatasetValidationError(`${label}: reabre la versión ${version.effectiveFrom}`);
        }
      }
    }
    return;
  }
  const nextById = new Map(
    next.entries.map((entry) => [`${entry.entryKey}@${entry.effectiveFrom}`, entry]),
  );
  for (const entry of previous.entries) {
    const id = `${entry.entryKey}@${entry.effectiveFrom}`;
    const now = nextById.get(id);
    if (!now) throw new DatasetValidationError(`${label}: desaparece la versión ${id}`);
    if (immutableVersionFields(entry) !== immutableVersionFields(now)) {
      throw new DatasetValidationError(`${label}: altera la versión publicada ${id}`);
    }
    if (entry.effectiveTo !== null && now.effectiveTo !== entry.effectiveTo) {
      throw new DatasetValidationError(`${label}: cambia la vigencia cerrada de ${id}`);
    }
    if (entry.normativeStatus === "WITHDRAWN" && now.normativeStatus !== "WITHDRAWN") {
      throw new DatasetValidationError(`${label}: reactiva la versión retirada ${id}`);
    }
    if (entry.normativeStatus !== now.normativeStatus && now.normativeStatus !== "WITHDRAWN") {
      throw new DatasetValidationError(`${label}: cambia el estado normativo de ${id}`);
    }
  }
}

/**
 * Valida todos los archivos antes de abrir ninguna transacción (design D3, paso 1): esquema,
 * reglas por archivo, versiones contiguas por catálogo y transiciones permitidas.
 */
export function validateDatasets(files: readonly unknown[]): ValidatedDataset[] {
  const parsed = files.map((file, index) => {
    const result = datasetFileSchema.safeParse(file);
    if (!result.success) {
      throw new DatasetValidationError(
        `dataset ${index + 1} inválido: ${result.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    checkFile(result.data);
    return { ...result.data, checksum: datasetChecksum(result.data) };
  });
  const byCatalog = new Map<string, ValidatedDataset[]>();
  for (const dataset of parsed) {
    byCatalog.set(dataset.catalogType, [...(byCatalog.get(dataset.catalogType) ?? []), dataset]);
  }
  for (const [catalogType, datasets] of byCatalog) {
    datasets.sort((a, b) => a.version - b.version);
    datasets.forEach((dataset, index) => {
      if (dataset.version !== index + 1) {
        throw new DatasetValidationError(
          `${catalogType}: versiones no contiguas (falta v${index + 1})`,
        );
      }
      if (index > 0) checkTransition(datasets[index - 1]!, dataset);
    });
  }
  return [...byCatalog.values()].flat();
}
