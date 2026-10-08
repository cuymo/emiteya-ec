// Manifiesto y `LEEME.txt` del paquete (add-data-portability, design D3; Q-28). El manifiesto dice
// qué es el paquete, de qué momento, de qué empresa y con qué alcance, cuenta cada conjunto, nombra
// las versiones de los formatos, declara las exclusiones y cada artefacto esperado pero ausente con
// su motivo. Nunca lleva el inventario de los archivos: esa autoridad es `SHA256SUMS`.
import type { Environment } from "../application/ports.ts";
import {
  FORMAT_VERSION,
  PORTABILITY_FORMAT,
  SHEET_COLUMNS_VERSION,
  type AbsentArtifact,
} from "./format.ts";

export type DatasetEntry = Readonly<{
  dataset: string;
  workbook: string;
  sheets: readonly string[];
  rows: number;
}>;

export type PackageCounts = Readonly<{
  documents: Readonly<{
    TEST: number;
    PRODUCTION: number;
    byType: Readonly<Record<string, number>>;
    byState: Readonly<Record<string, number>>;
  }>;
  artifacts: Readonly<{
    signedXml: number;
    authorizedXml: number;
    ride: number;
    sriResponses: number;
    logos: number;
  }>;
  /** Entradas del paquete, incluido `SHA256SUMS`. */
  files: number;
}>;

export type ManifestInput = Readonly<{
  generatedAt: Date;
  snapshotAt: Date;
  applicationVersion: string;
  company: Readonly<{ ruc: string; legalName: string; tradeName: string | null }> | null;
  counts: PackageCounts;
  datasets: readonly DatasetEntry[];
  snapshotVersions: Readonly<Record<string, readonly number[]>>;
  xmlSchemas: Readonly<Record<string, readonly string[]>>;
  absent: readonly AbsentArtifact[];
}>;

const ecuador = (moment: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(moment);

export const ENVIRONMENTS: readonly Environment[] = ["PRODUCTION", "TEST"];

/** Lo que el paquete nunca contiene, con su motivo (design D6; Q-28). */
export const EXCLUSIONS = [
  {
    data: "La firma electrónica: el archivo P12, cifrado o no, su contraseña, la clave de datos envuelta, sus datos de cifrado y la clave maestra de la custodia",
    reason:
      "Solo sirven para firmar y nunca salen del sistema por ninguna vía. De cada firma se exportan sus metadatos; para operar en otro sistema se vuelve a cargar la propia firma.",
  },
  {
    data: "Los datos internos de autenticación: hashes de contraseñas, cuentas, sesiones, tokens de verificación e invitaciones",
    reason:
      "Son internos del sistema. De cada usuario se exportan su nombre, su correo, su rol y su estado.",
  },
  {
    data: "Los borradores de los seis tipos de comprobante",
    reason:
      "La versión 1 exporta el estado fiscal y operativo durable y sus artefactos, no el espacio de trabajo incompleto. Los borradores siguen en el sistema.",
  },
  {
    data: "Los catálogos globales del SRI y el registro de esquemas XSD",
    reason:
      "Son datos públicos del SRI; cada comprobante congeló en su snapshot lo que usó, y se exportan las habilitaciones de la empresa.",
  },
  {
    data: "Los datos técnicos: la cola de trabajos, las claves de idempotencia y las capacidades y reservas derivadas",
    reason: "Son derivados o técnicos: su verdad está en los snapshots, el kárdex y la auditoría.",
  },
  {
    data: "Las direcciones IP y los user agents",
    reason: "El sistema no los guarda en la auditoría.",
  },
] as const;

export function buildManifest(input: ManifestInput) {
  return {
    format: PORTABILITY_FORMAT,
    formatVersion: FORMAT_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    generatedAtEcuador: ecuador(input.generatedAt),
    snapshotAt: input.snapshotAt.toISOString(),
    snapshotAtEcuador: ecuador(input.snapshotAt),
    generator: { application: "facturador-sri", version: input.applicationVersion },
    company: input.company,
    scope: {
      description:
        "Datos y artefactos de la empresa: configuración, terceros, productos, comprobantes de los seis tipos desde la reserva en todos sus estados, inventario y auditoría. No es un respaldo y no se importa ni se restaura.",
      environments: ENVIRONMENTS,
      documentTypes: ["01", "03", "04", "05", "06", "07"],
      documentStates: "Todos, desde la reserva del número; nunca los borradores",
    },
    counts: input.counts,
    datasets: input.datasets,
    formats: {
      snapshots: input.snapshotVersions,
      xmlSchemas: input.xmlSchemas,
      sheetColumnsVersion: SHEET_COLUMNS_VERSION,
      checksums: "SHA256SUMS, compatible con sha256sum -c: cubre cada archivo salvo él mismo",
    },
    exclusions: EXCLUSIONS,
    absent: input.absent,
  };
}

export type Manifest = ReturnType<typeof buildManifest>;

export function manifestBytes(input: ManifestInput): Uint8Array {
  return Buffer.from(`${JSON.stringify(buildManifest(input), null, 2)}\n`, "utf8");
}

/** `LEEME.txt`: qué es el paquete, qué no es y cómo verificarlo, en español. */
export function readmeBytes(input: Pick<ManifestInput, "snapshotAt" | "counts">): Uint8Array {
  const { documents } = input.counts;
  const text = [
    "PAQUETE DE PORTABILIDAD DE DATOS",
    `Formato ${PORTABILITY_FORMAT} (versión ${FORMAT_VERSION})`,
    "",
    `Datos de la empresa al ${ecuador(input.snapshotAt)} (hora de Ecuador).`,
    `Comprobantes: ${documents.PRODUCTION} de Producción y ${documents.TEST} de Pruebas.`,
    "",
    "QUÉ ES",
    "Una copia de los datos y artefactos que el sistema conserva de la empresa, para leerlos fuera de",
    "la aplicación. NO es un respaldo: no contiene la firma electrónica ni los datos internos de",
    "autenticación, y no se puede importar ni restaurar en el sistema.",
    "",
    "QUÉ CONTIENE",
    "- manifest.json: el momento, la empresa, el alcance, los conteos, las versiones de los formatos,",
    "  las exclusiones y los artefactos que faltan con su motivo.",
    "- data/: libros XLSX de la empresa, los terceros, los productos, los comprobantes, el inventario",
    "  y la auditoría.",
    "- documents/<produccion|pruebas>/<tipo>/<número>/: por comprobante, su snapshot.json con los",
    "  datos que congeló al reservar su número, y los bytes exactos de su XML firmado, su XML",
    "  autorizado, su RIDE y las respuestas originales del SRI (sri/), cuando existen.",
    "- assets/logos/: los logos de la configuración.",
    "- SHA256SUMS: el SHA-256 de cada archivo del paquete, salvo él mismo.",
    "",
    "QUÉ NO CONTIENE",
    ...EXCLUSIONS.map((exclusion) => `- ${exclusion.data}.`),
    "",
    "Contiene siempre los comprobantes de Pruebas y de Producción, cada uno en su carpeta.",
    "",
    "CÓMO VERIFICARLO",
    "Descomprima el paquete y, en la carpeta resultante, ejecute:",
    "  sha256sum -c SHA256SUMS          (Linux)",
    "  shasum -a 256 -c SHA256SUMS      (macOS)",
    "Cada archivo debe responder OK. El SHA-256 del paquete completo se muestra en la pantalla",
    "Portabilidad de datos del sistema, para compararlo con el del archivo descargado.",
    "",
    "El paquete usa ZIP64: ábralo con una herramienta actual (7-Zip, unzip, el explorador de",
    "Windows, la utilidad de archivos de macOS o Python). El formato se documenta en",
    "docs/architecture/data-portability-format.md del proyecto.",
    "",
  ].join("\n");
  return Buffer.from(text, "utf8");
}
