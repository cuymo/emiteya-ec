// Formato `PORTABILITY_FORMAT_V1` (add-data-portability, design D2, D3 y D13; Q-28): la gramática y
// la construcción de las rutas del paquete, el nombre del archivo, la política de los artefactos
// esperados y ausentes, y las líneas de `SHA256SUMS`. Toda ruta sale de componentes que genera y
// valida el servidor: el ambiente, el tipo y el número del comprobante, el orden de un intento y
// nombres fijos. Nunca del RUC, de un nombre, de un correo ni de texto escrito por un usuario.
import type { ArtifactRef, DocumentRow, Environment, ResponseRef } from "../application/ports.ts";

export const PORTABILITY_FORMAT = "PORTABILITY_FORMAT_V1";
export const FORMAT_VERSION = "1";
/** Versión de las columnas de los libros: cambia si cambia una hoja o una columna. */
export const SHEET_COLUMNS_VERSION = "1";

/** La ruta de una entrada: segmentos alfanuméricos con `.`, `_` y `-`, separados por `/`. */
export const PATH_GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
export const MAX_PATH_LENGTH = 200;

/** La ruta no cumple la gramática del formato: nunca se escribe. */
export class PackagePathError extends Error {}

export function assertPackagePath(path: string): string {
  if (path.length > MAX_PATH_LENGTH || !PATH_GRAMMAR.test(path)) {
    throw new PackagePathError("ruta de entrada inválida");
  }
  return path;
}

export const ENVIRONMENT_FOLDERS: Readonly<Record<Environment, string>> = {
  PRODUCTION: "produccion",
  TEST: "pruebas",
};

export const DOCUMENT_TYPE_FOLDERS: Readonly<Record<string, string>> = {
  "01": "01-factura",
  "03": "03-liquidacion-de-compra",
  "04": "04-nota-de-credito",
  "05": "05-nota-de-debito",
  "06": "06-guia-de-remision",
  "07": "07-comprobante-de-retencion",
};

export const ARTIFACT_FILES: Readonly<Record<ArtifactRef["kind"], string>> = {
  SIGNED_XML: "firmado.xml",
  AUTHORIZED_XML: "autorizado.xml",
  RIDE_PDF: "ride.pdf",
};

const OPERATION_FILES: Readonly<Record<string, string>> = {
  RECEPTION: "recepcion",
  AUTHORIZATION: "autorizacion",
  VALIDITY: "validez",
};

const DOCUMENT_NUMBER = /^\d{3}-\d{3}-\d{9}$/;

/** La carpeta de un comprobante: `documents/<ambiente>/<tipo>/<número>`. */
export function documentFolder(
  document: Pick<DocumentRow, "environment" | "documentType" | "documentNumber">,
) {
  const type = DOCUMENT_TYPE_FOLDERS[document.documentType];
  if (!type || !DOCUMENT_NUMBER.test(document.documentNumber)) {
    throw new PackagePathError("comprobante sin una carpeta válida");
  }
  return assertPackagePath(
    `documents/${ENVIRONMENT_FOLDERS[document.environment]}/${type}/${document.documentNumber}`,
  );
}

/** El archivo de la respuesta original de un intento: `sri/<intento>-<operación>.<xml|bin>`. */
export function responseFile(
  response: Pick<ResponseRef, "attemptNumber" | "operation" | "contentType">,
) {
  const operation = OPERATION_FILES[response.operation];
  if (!operation || !Number.isInteger(response.attemptNumber) || response.attemptNumber < 1) {
    throw new PackagePathError("intento sin un archivo válido");
  }
  const extension = response.contentType && /xml/i.test(response.contentType) ? "xml" : "bin";
  return `sri/${String(response.attemptNumber).padStart(3, "0")}-${operation}.${extension}`;
}

const LOGO_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function logoFile(logo: { sha256: string; mimeType: string }) {
  const extension = LOGO_EXTENSIONS[logo.mimeType];
  if (!extension || !/^[0-9a-f]{64}$/.test(logo.sha256)) {
    throw new PackagePathError("logo sin un archivo válido");
  }
  return assertPackagePath(`assets/logos/${logo.sha256}.${extension}`);
}

/** `datos-AAAAMMDD-HHMMSS.zip` con la fecha y la hora de Ecuador: nunca el RUC ni un nombre. */
export function packageFileName(moment: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guayaquil",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(moment)
      .map((part) => [part.type, part.value]),
  );
  return `datos-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}.zip`;
}

/**
 * Comprueba la unicidad de las rutas sin memoria creciente: cada carpeta de comprobante debe ser
 * estrictamente mayor que la anterior (el orden de las carpetas es el del paquete), y cada archivo
 * de una carpeta, único dentro de ella. Una ruta repetida falla, nunca se acepta en silencio.
 */
export function createPathGuard() {
  let folder: string | null = null;
  let inFolder = new Set<string>();
  const loose = new Set<string>();
  return {
    folder(path: string) {
      assertPackagePath(path);
      if (folder !== null && path <= folder)
        throw new PackagePathError("carpeta repetida o fuera de orden");
      folder = path;
      inFolder = new Set();
    },
    /** Un archivo de la carpeta actual. */
    file(name: string): string {
      if (folder === null) throw new PackagePathError("archivo sin carpeta");
      const path = assertPackagePath(`${folder}/${name}`);
      if (inFolder.has(name)) throw new PackagePathError("ruta repetida");
      inFolder.add(name);
      return path;
    },
    /** Una entrada fuera de las carpetas de comprobantes (pocas: manifiesto, libros y logos). */
    loose(path: string): string {
      assertPackagePath(path);
      if (loose.has(path)) throw new PackagePathError("ruta repetida");
      loose.add(path);
      return path;
    },
  };
}

/** Una línea de `SHA256SUMS`, compatible con `sha256sum -c` y `shasum -a 256 -c`. */
export function checksumLine(sha256: string, path: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("SHA-256 inválido");
  return `${sha256}  ${assertPackagePath(path)}\n`;
}

export type AbsentReason = "RIDE_PENDING" | "RIDE_STOPPED";
export type AbsentArtifact = Readonly<{
  environment: Environment;
  documentType: string;
  documentNumber: string;
  accessKey: string;
  artifact: ArtifactRef["kind"];
  reason: AbsentReason;
}>;

/** Falta un artefacto que el estado del comprobante exige: la exportación falla cerrada. */
export class MissingArtifactError extends Error {}

/**
 * Los artefactos del comprobante y sus ausentes legítimos (design D13): el XML firmado se espera en
 * todo estado salvo `RESERVED`; el XML autorizado y el RIDE, en `AUTHORIZED`. Un RIDE pendiente o
 * detenido es un ausente legítimo; un XML exigido que falta viola un invariante.
 */
export function artifactPlan(document: DocumentRow): {
  artifacts: readonly ArtifactRef[];
  absent: readonly AbsentArtifact[];
} {
  const has = (kind: ArtifactRef["kind"]) => document.artifacts.some((x) => x.kind === kind);
  if (document.state !== "RESERVED" && !has("SIGNED_XML")) {
    throw new MissingArtifactError("falta el XML firmado");
  }
  const absent: AbsentArtifact[] = [];
  if (document.state === "AUTHORIZED") {
    if (!has("AUTHORIZED_XML")) throw new MissingArtifactError("falta el XML autorizado");
    if (!has("RIDE_PDF")) {
      absent.push({
        environment: document.environment,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        accessKey: document.accessKey,
        artifact: "RIDE_PDF",
        reason: document.rideJobStatus === "STOPPED" ? "RIDE_STOPPED" : "RIDE_PENDING",
      });
    }
  }
  const order: ArtifactRef["kind"][] = ["SIGNED_XML", "AUTHORIZED_XML", "RIDE_PDF"];
  const artifacts = [...document.artifacts].sort(
    (x, y) => order.indexOf(x.kind) - order.indexOf(y.kind),
  );
  return { artifacts, absent };
}
