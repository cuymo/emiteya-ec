// Utilidades de los ensayos de despliegue (harden-deployment-proxy-and-recovery, design D12): Docker sin
// shell, comprobaciones con resultado legible y limpieza garantizada. Ningún comando recibe un secreto
// por argumento: los secretos viajan en archivos temporales o por stdin.
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");
export const NODE_IMAGE = "node:24.21.0-bookworm-slim";
export const NGINX_IMAGE = "nginx:1.30.5-alpine";

export type Result = { status: number; stdout: string; stderr: string };

/** Ejecuta un binario sin shell; nunca lanza por un código distinto de 0. */
export function run(
  command: string,
  args: string[],
  options: SpawnSyncOptions & { input?: string | Buffer } = {},
): Result {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/** Como `run`, pero falla con el comando y la salida de error si no termina con 0. */
export function must(
  command: string,
  args: string[],
  options: SpawnSyncOptions & { input?: string | Buffer } = {},
): Result {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.slice(0, 3).join(" ")}… terminó con ${result.status}: ${result.stderr.slice(-2000)}`,
    );
  }
  return result;
}

export class Checks {
  private readonly results: { name: string; ok: boolean }[] = [];

  /** Registra una comprobación; el detalle solo lleva datos no secretos. */
  record(name: string, ok: boolean, detail = ""): boolean {
    this.results.push({ name, ok });
    console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    return ok;
  }

  get failed(): number {
    return this.results.filter((result) => !result.ok).length;
  }

  summary(label: string): number {
    const total = this.results.length;
    console.log(`${label}: ${total - this.failed}/${total} comprobaciones en verde.`);
    return this.failed === 0 ? 0 : 1;
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a que `probe` devuelva verdadero o vence; devuelve si lo logró. */
export async function until(probe: () => boolean | Promise<boolean>, ms: number, every = 500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return true;
    } catch {
      // Todavía no responde.
    }
    await sleep(every);
  }
  return false;
}
