// Lee un ZIP con zipfile de Python, un lector independiente del contenedor (ADR 0024).
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./zip_inspect.py", import.meta.url));

export type ZipInspection = Readonly<{
  count: number;
  bad: string | null;
  regular: boolean;
  symlinks: number;
  utf8: boolean;
  dataDescriptor: boolean;
  names: string[];
  entries: Record<
    string,
    { size: number; method: "store" | "deflate"; sha256: string; headerOffset: number }
  >;
}>;

export async function inspectZip(path: string, names: readonly string[] = []) {
  const { stdout } = await run("python3", ["-I", SCRIPT, path, ...names], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as ZipInspection;
}

/** Extrae el paquete con zipfile de Python y devuelve sus entradas en el orden del archivo. */
export async function extractZip(path: string, destination: string): Promise<string[]> {
  const { stdout } = await run("python3", ["-I", SCRIPT, "--extract", path, destination], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(stdout) as string[];
}
