// Build de `corepack pnpm verify` (harden-production-configuration-and-clock-ownership, design D5).
// El build de producción del frontend exige API_INTERNAL_URL, y `verify` construye el que después
// sirve check:web-security-policy con su backend en el puerto del manifiesto. Este script declara el
// mismo destino de bucle local de siempre, de forma explícita, ejecuta `corepack pnpm build` sin
// shell y devuelve su código; ningún error ni señal se convierte en un éxito.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";

export const VERIFICATION_API_INTERNAL_URL = "http://127.0.0.1:4000";

type Spawn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" },
) => Pick<SpawnSyncReturns<Buffer>, "status" | "signal" | "error">;

export type RunOptions = {
  root?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: Spawn;
  err?: (line: string) => void;
};

/** Ejecuta el build del repositorio con el destino interno de verificación y devuelve su código. */
export function run(options: RunOptions = {}): number {
  const spawn = options.spawn ?? spawnSync;
  const err = options.err ?? ((line: string) => console.error(line));
  const result = spawn("corepack", ["pnpm", "build"], {
    cwd: options.root ?? join(import.meta.dirname, ".."),
    env: { ...(options.env ?? process.env), API_INTERNAL_URL: VERIFICATION_API_INTERNAL_URL },
    stdio: "inherit",
  });
  if (result.error) {
    err(`build:verification: no se pudo ejecutar el build (${result.error.message}).`);
    return 1;
  }
  if (result.signal) {
    err(`build:verification: el build terminó por la señal ${result.signal}.`);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.main) process.exitCode = run();
