// Sistema de archivos privado de la portabilidad (add-data-portability, design D14). Un directorio
// propio (`0700`) con el trabajo de cada intento en `work/<exportId>-<intento>/` (`0700`), el
// paquete en curso como `<exportId>-<intento>.partial` (`0600`) y el publicado como
// `<exportId>-<intento>.zip` (`0400`), renombrado de forma atómica en el mismo sistema de archivos
// con el `fsync` del archivo y del directorio. Solo toca nombres de esa gramática, nunca sigue un
// enlace simbólico, nunca expone una ruta y nunca registra su ubicación.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import type { GenerationFiles } from "../application/generate.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Nombres que la portabilidad crea en su directorio; el barrido no toca ningún otro. */
export const PACKAGE_NAME = new RegExp(`^(${UUID})-(\\d+)\\.(zip|partial)$`);
export const WORK_NAME = new RegExp(`^(${UUID})-(\\d+)$`);
const WORK = "work";

export type PackageEntry = Readonly<{
  name: string;
  exportId: string;
  attempt: number;
  kind: "zip" | "partial" | "work";
}>;

export const defaultDirectory = () => join(tmpdir(), "facturador-data-exports");

export function createPackageFiles(root: string) {
  const work = join(root, WORK);
  const at = (name: string) => {
    if (!PACKAGE_NAME.test(name)) throw new Error("nombre de paquete inválido");
    return join(root, name);
  };

  /** Crea o comprueba un directorio privado propio: nunca un enlace, nunca accesible a otros. */
  async function privateDirectory(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("el directorio de la portabilidad no es un directorio propio");
    }
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new Error("el directorio de la portabilidad no pertenece al proceso");
    }
    if ((info.mode & 0o777) !== 0o700) await chmod(path, 0o700);
  }

  async function syncDirectory(path: string) {
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, "r");
      await handle.sync();
    } catch {
      // Algunas plataformas no permiten el `fsync` de un directorio; la recuperación es el barrido
      // (design D14): un renombrado perdido deja un parcial o un archivo sin fila lista.
    } finally {
      await handle?.close();
    }
  }

  const files: GenerationFiles = {
    async freeBytes(path) {
      const info = await statfs(path);
      return Number(info.bavail) * Number(info.bsize);
    },
    async sha256OfFile(path) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 }))
        hash.update(chunk as Buffer);
      return hash.digest("hex");
    },
    async size(path) {
      return (await stat(path)).size;
    },
    async lineWriter(path) {
      const stream = createWriteStream(path, { flags: "wx", mode: 0o600 });
      await once(stream, "open");
      let failure: Error | undefined;
      stream.on("error", (error: Error) => (failure = error));
      return {
        async write(line) {
          if (failure) throw failure;
          if (!stream.write(line)) await once(stream, "drain");
        },
        async close() {
          if (stream.closed) return;
          await new Promise<void>((resolve, reject) =>
            stream.end((error?: Error | null) => (error ? reject(error) : resolve())),
          );
          if (failure) throw failure;
        },
      };
    },
    async *readLines(path) {
      const lines = createInterface({
        input: createReadStream(path, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      for await (const line of lines) if (line.length > 0) yield line;
    },
  };

  return {
    root,
    files,

    /** Al arrancar: el directorio y el de trabajo, privados (design D14). */
    async init() {
      await privateDirectory(root);
      await privateDirectory(work);
    },

    /** Un directorio de trabajo nuevo para el intento; si quedó uno anterior, se reemplaza. */
    async workDir(exportId: string, attempt: number) {
      const path = join(work, `${exportId}-${attempt}`);
      if (!WORK_NAME.test(`${exportId}-${attempt}`)) throw new Error("nombre de trabajo inválido");
      await rm(path, { recursive: true, force: true });
      await mkdir(path, { mode: 0o700 });
      return path;
    },

    partialPath(exportId: string, attempt: number) {
      return at(`${exportId}-${attempt}.partial`);
    },

    fileName(exportId: string, attempt: number) {
      const name = `${exportId}-${attempt}.zip`;
      at(name);
      return name;
    },

    /** Publica el paquete cerrado: renombrado atómico, `0400` y `fsync` del directorio. */
    async publish(partialPath: string, fileName: string) {
      const target = at(fileName);
      await rename(partialPath, target);
      await chmod(target, 0o400);
      await syncDirectory(root);
    },

    /** El tamaño de un paquete publicado, sin seguir enlaces; null si no es un archivo regular. */
    async packageSize(fileName: string): Promise<number | null> {
      try {
        const info = await lstat(at(fileName));
        return info.isFile() ? info.size : null;
      } catch {
        return null;
      }
    },

    /** Abre un paquete publicado para verificarlo y enviarlo por el mismo descriptor. */
    async openPackage(fileName: string): Promise<FileHandle | null> {
      try {
        const info = await lstat(at(fileName));
        if (!info.isFile()) return null;
        return await open(at(fileName), "r");
      } catch {
        return null;
      }
    },

    async remove(fileName: string) {
      await rm(at(fileName), { force: true });
    },

    async removePartial(path: string) {
      await rm(path, { force: true });
    },

    async removeWork(path: string) {
      await rm(path, { recursive: true, force: true });
    },

    /** Lo que hay en el directorio y en el de trabajo con la gramática de la portabilidad. */
    async list(): Promise<PackageEntry[]> {
      const entries: PackageEntry[] = [];
      for (const name of await readdir(root).catch(() => [] as string[])) {
        const match = PACKAGE_NAME.exec(name);
        if (match) {
          entries.push({
            name,
            exportId: match[1]!,
            attempt: Number(match[2]),
            kind: match[3] === "zip" ? "zip" : "partial",
          });
        }
      }
      for (const name of await readdir(work).catch(() => [] as string[])) {
        const match = WORK_NAME.exec(name);
        if (match) {
          entries.push({ name, exportId: match[1]!, attempt: Number(match[2]), kind: "work" });
        }
      }
      return entries;
    },

    /** Borra una entrada listada por `list`, nunca siguiendo un enlace. */
    async removeEntry(entry: PackageEntry) {
      const path = entry.kind === "work" ? join(work, entry.name) : at(entry.name);
      await rm(path, { recursive: entry.kind === "work", force: true });
    },
  };
}

export type PackageFiles = ReturnType<typeof createPackageFiles>;
