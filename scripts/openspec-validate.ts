// Validación estricta de OpenSpec con la CLI fijada en el repositorio (pin-openspec-ci-validation,
// design D2). Resuelve el paquete con la resolución de módulos de Node anclada en la raíz, comprueba
// que la versión instalada es la declarada y ejecuta su `bin` con el Node actual, sin shell ni PATH:
// una CLI global nunca interviene. La telemetría va desactivada y el resultado es el de la CLI;
// ningún error ni señal se convierte en un éxito.
import { spawnSync, type StdioOptions } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export const PACKAGE = "@fission-ai/openspec";
export const VALIDATE_ARGS = ["validate", "--all", "--strict"] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

type Manifest = {
  name?: string;
  version?: string;
  bin?: string | Record<string, string>;
  devDependencies?: Record<string, string>;
};

export class OpenSpecResolutionError extends Error {}

const readManifest = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Manifest;

/** La CLI instalada para la raíz dada: su versión y la ruta absoluta de su `bin`. */
export function resolveOpenSpec(root: string): { version: string; bin: string } {
  const declared = readManifest(join(root, "package.json")).devDependencies?.[PACKAGE];
  if (!declared || !EXACT_VERSION.test(declared)) {
    throw new OpenSpecResolutionError(`package.json no declara ${PACKAGE} con una versión exacta.`);
  }
  let entry: string;
  try {
    entry = createRequire(join(root, "package.json")).resolve(PACKAGE);
  } catch {
    throw new OpenSpecResolutionError(
      `${PACKAGE} no está instalado; ejecuta \`corepack pnpm install\`.`,
    );
  }
  // Los `exports` del paquete solo exponen su entrada: se sube hasta su package.json.
  let dir = dirname(entry);
  let manifest: Manifest | undefined;
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate) && readManifest(candidate).name === PACKAGE) {
      manifest = readManifest(candidate);
      break;
    }
    if (dirname(dir) === dir) break;
    dir = dirname(dir);
  }
  if (!manifest)
    throw new OpenSpecResolutionError(`no se encuentra el package.json de ${PACKAGE}.`);
  if (manifest.version !== declared) {
    throw new OpenSpecResolutionError(
      `la CLI instalada es ${manifest.version ?? "desconocida"} y package.json declara ${declared}; ejecuta \`corepack pnpm install\`.`,
    );
  }
  const binField = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.openspec;
  const bin = binField ? resolve(dir, binField) : "";
  if (!bin || !existsSync(bin)) {
    throw new OpenSpecResolutionError(`${PACKAGE} ${declared} no trae el binario openspec.`);
  }
  return { version: declared, bin };
}

export type RunOptions = {
  root?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

/** Ejecuta `openspec validate --all --strict` con la CLI del repositorio y devuelve su código. */
export function run(options: RunOptions = {}): number {
  const root = options.root ?? join(import.meta.dirname, "..");
  const out = options.out ?? ((line: string) => console.log(line));
  const err = options.err ?? ((line: string) => console.error(line));
  let cli: { version: string; bin: string };
  try {
    cli = resolveOpenSpec(root);
  } catch (error) {
    err(`openspec:validate: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  out(`OpenSpec ${cli.version} del repositorio, telemetría desactivada.`);
  const result = spawnSync(process.execPath, [cli.bin, ...VALIDATE_ARGS], {
    cwd: options.cwd ?? root,
    env: { ...(options.env ?? process.env), OPENSPEC_TELEMETRY: "0" },
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) {
    err(`openspec:validate: no se pudo ejecutar la CLI (${result.error.message}).`);
    return 1;
  }
  if (result.signal) {
    err(`openspec:validate: la CLI terminó por la señal ${result.signal}.`);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) process.exitCode = run();
