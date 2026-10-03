// Adaptador XsdValidator sobre xmllint-wasm, libxml2 en WebAssembly (ADR 0021). Valida contra los
// XSD versionados del producto, nunca contra los empaquetados en facturacion-electronica-ec: no usa
// validateXmlAgainstXsd ni registerXsdSearchPath, que buscan en rutas globales del proceso y, si
// falta un archivo, caen en silencio a los XSD de la librería (spike S-2). Cada validación arranca
// un worker de WebAssembly: la concurrencia y la cola están acotadas.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateXML, type XMLValidationError } from "xmllint-wasm";
import {
  XsdValidatorError,
  type RegisteredSchema,
  type XsdValidation,
  type XsdValidator,
  type XsdViolation,
} from "../application/ports.ts";

/** Un XSD por nombre de archivo y hash. */
export type XsdFile = Readonly<{ file: string; sha256: string }>;

/** XSD de la firma XML del W3C que importan los seis esquemas del SRI (`docs/product/w3c-xsd/`). */
export const XMLDSIG_SCHEMA: XsdFile = {
  file: "xmldsig-core-schema.xsd",
  sha256: "d102ad3df7664c307e0c2c776ba4a90513b1969974d8a940bae1a77f9f21e15d",
};

export type XmllintXsdValidatorOptions = Readonly<{
  /** Directorio de los XSD del registro de esquemas. */
  schemaDirectory: string;
  /** Directorio de los XSD que esos esquemas importan. */
  importDirectory: string;
  /** XSD importados; por defecto, el de la firma XML. */
  imports?: readonly XsdFile[];
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
// Solo un nombre de archivo, sin rutas: el registro nunca debe salir de su directorio.
const SCHEMA_FILE_NAME = /^[A-Za-z0-9_.-]+\.xsd$/;

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
  const imports = options.imports ?? [XMLDSIG_SCHEMA];
  const engine = options.engine ?? validateXML;
  const limited = createLimiter(
    Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
    Math.max(0, options.maxQueue ?? DEFAULT_MAX_QUEUE),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  // Contenido verificado, por instancia y no global: cada XSD se lee y se comprueba una vez.
  const verified = new Map<string, Promise<Uint8Array>>();

  function load(directory: string, schema: XsdFile): Promise<Uint8Array> {
    const key = `${directory}\0${schema.file}\0${schema.sha256}`;
    const cached = verified.get(key);
    if (cached) return cached;
    const pending = (async () => {
      if (!SCHEMA_FILE_NAME.test(schema.file)) throw new XsdValidatorError("SCHEMA_UNAVAILABLE");
      let bytes: Uint8Array;
      try {
        bytes = await read(join(directory, schema.file));
      } catch {
        throw new XsdValidatorError("SCHEMA_UNAVAILABLE");
      }
      if (sha256(bytes) !== schema.sha256) throw new XsdValidatorError("SCHEMA_HASH_MISMATCH");
      return bytes;
    })();
    // Un fallo no se recuerda: el siguiente intento vuelve a leer y comprobar el archivo.
    pending.catch(() => verified.delete(key));
    verified.set(key, pending);
    return pending;
  }

  return {
    async validate(xml: string, schema: RegisteredSchema): Promise<XsdValidation> {
      const [main, ...imported] = await Promise.all([
        load(options.schemaDirectory, schema),
        ...imports.map((file) => load(options.importDirectory, file)),
      ]);
      try {
        const result = await limited(() =>
          engine({
            xml: { fileName: XML_FILE, contents: xml },
            schema: { fileName: schema.file, contents: main },
            preload: imports.map((file, index) => ({
              fileName: file.file,
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
