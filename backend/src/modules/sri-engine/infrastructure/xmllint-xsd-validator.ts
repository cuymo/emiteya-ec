// Adaptador XsdValidator sobre xmllint-wasm, libxml2 en WebAssembly (ADR 0021). Valida contra los
// XSD versionados del producto, nunca contra los empaquetados en facturacion-electronica-ec: no usa
// validateXmlAgainstXsd ni registerXsdSearchPath, que buscan en rutas globales del proceso y, si
// falta un archivo, caen en silencio a los XSD de la librería (spike S-2). Cada validación arranca
// un worker de WebAssembly: la concurrencia y la cola están acotadas.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { validateXML, type XMLValidationError } from "xmllint-wasm";
import {
  XsdValidatorError,
  type RegisteredSchema,
  type SchemaBundleFailure,
  type SchemaFile,
  type XsdValidation,
  type XsdValidator,
  type XsdViolation,
} from "../application/ports.ts";

export type XmllintXsdValidatorOptions = Readonly<{
  /**
   * Raíz del paquete de XSD: las rutas lógicas del registro (`sri-xsd/…`, `w3c-xsd/…`) se
   * resuelven bajo ella. En el build es `dist/xsd/`; en desarrollo, `docs/product/` (design D11).
   */
  root: string;
  /** Lectura de archivos; se inyecta en las pruebas. */
  readFile?: (path: string) => Promise<Uint8Array>;
  /** Validaciones simultáneas, cada una con su worker; por defecto 2. */
  concurrency?: number;
  /** Validaciones en espera; con la cola llena, `VALIDATOR_BUSY`. Por defecto 16. */
  maxQueue?: number;
  /** Duración máxima de una validación en curso; por defecto 10 s. */
  timeoutMs?: number;
  /** Motor de validación; se inyecta en las pruebas. */
  engine?: typeof validateXML;
}>;

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_QUEUE = 16;
const DEFAULT_TIMEOUT_MS = 10_000;

// Nombre del XML dentro del sistema de archivos en memoria de xmllint.
const XML_FILE = "comprobante.xml";
// Ruta lógica de un directorio y un archivo: el registro nunca sale de la raíz del paquete.
const SCHEMA_PATH = /^[a-z0-9-]+\/[A-Za-z0-9_.-]+\.xsd$/;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Mensaje de libxml2 sin el prefijo de su fase: `Element 'x': ...`. */
function violation(error: XMLValidationError): XsdViolation {
  const message = error.message.replace(/^(Schemas validity error|parser error)\s*:\s*/, "");
  return { line: error.loc?.lineNumber ?? null, message };
}

/** Errores del XML, también si no está bien formado; descarta líneas vacías y de otros archivos. */
function violationsOf(errors: readonly XMLValidationError[]): XsdViolation[] {
  return errors.filter((error) => error.loc?.fileName === XML_FILE).map(violation);
}

/**
 * Ejecuta como máximo `concurrency` tareas a la vez y deja esperar hasta `maxQueue`. El tiempo
 * cuenta desde que la tarea empieza. xmllint-wasm no permite cancelar su worker: al vencer el
 * plazo, quien espera recibe `VALIDATOR_TIMEOUT`, pero el lugar sigue ocupado hasta que el worker
 * termina, para que el límite de workers simultáneos se cumpla siempre.
 */
function createLimiter(concurrency: number, maxQueue: number, timeoutMs: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < concurrency) active++;
    else if (waiting.length < maxQueue) await new Promise<void>((resolve) => waiting.push(resolve));
    else throw new XsdValidatorError("VALIDATOR_BUSY");
    const work = task().finally(release);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new XsdValidatorError("VALIDATOR_TIMEOUT")), timeoutMs);
    });
    // El que pierde la carrera no debe quedar como rechazo sin manejar.
    work.catch(() => undefined);
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createXmllintXsdValidator(options: XmllintXsdValidatorOptions): XsdValidator {
  const read = options.readFile ?? ((path: string) => readFile(path));
  const engine = options.engine ?? validateXML;
  const limited = createLimiter(
    Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
    Math.max(0, options.maxQueue ?? DEFAULT_MAX_QUEUE),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  // Contenido verificado, por instancia y no global: cada XSD se lee y se comprueba una vez.
  const verified = new Map<string, Promise<Uint8Array>>();

  function load(file: SchemaFile): Promise<Uint8Array> {
    const key = `${file.path}\0${file.sha256}`;
    const cached = verified.get(key);
    if (cached) return cached;
    const pending = (async () => {
      if (!SCHEMA_PATH.test(file.path)) throw new XsdValidatorError("SCHEMA_UNAVAILABLE");
      let bytes: Uint8Array;
      try {
        bytes = await read(join(options.root, file.path));
      } catch {
        throw new XsdValidatorError("SCHEMA_UNAVAILABLE");
      }
      if (sha256(bytes) !== file.sha256) throw new XsdValidatorError("SCHEMA_HASH_MISMATCH");
      return bytes;
    })();
    // Un fallo no se recuerda: el siguiente intento vuelve a leer y comprobar el archivo.
    pending.catch(() => verified.delete(key));
    verified.set(key, pending);
    return pending;
  }

  const loadAll = (schema: RegisteredSchema) =>
    Promise.all([load(schema), ...schema.imports.map((file) => load(file))]);

  return {
    async ensureAvailable(schema: RegisteredSchema): Promise<void> {
      await loadAll(schema);
    },

    async verifyBundle(files: readonly SchemaFile[]): Promise<readonly SchemaBundleFailure[]> {
      const failures: SchemaBundleFailure[] = [];
      for (const file of files) {
        if (!SCHEMA_PATH.test(file.path)) {
          failures.push({ path: file.path, reason: "INVALID_PATH" });
          continue;
        }
        await load(file).catch((error: unknown) => {
          const mismatch =
            error instanceof XsdValidatorError && error.code === "SCHEMA_HASH_MISMATCH";
          failures.push({ path: file.path, reason: mismatch ? "HASH_MISMATCH" : "MISSING" });
        });
      }
      return failures;
    },

    async validate(xml: string, schema: RegisteredSchema): Promise<XsdValidation> {
      const [main, ...imported] = await loadAll(schema);
      try {
        const result = await limited(() =>
          engine({
            xml: { fileName: XML_FILE, contents: xml },
            // El nombre del import es el de su `schemaLocation` relativo dentro del XSD.
            schema: { fileName: basename(schema.path), contents: main },
            preload: schema.imports.map((file, index) => ({
              fileName: basename(file.path),
              contents: imported[index]!,
            })),
          }),
        );
        if (result.valid) return { valid: true };
        const violations = violationsOf(result.errors);
        // Sin errores del XML, el problema es del esquema o del motor: no se informa como válido.
        if (violations.length === 0) throw new XsdValidatorError("VALIDATOR_FAILED");
        return { valid: false, violations };
      } catch (error) {
        if (error instanceof XsdValidatorError) throw error;
        // Esquema que no compila, import ausente o fallo del worker: la salida no sale de aquí.
        throw new XsdValidatorError("VALIDATOR_FAILED");
      }
    },
  };
}
