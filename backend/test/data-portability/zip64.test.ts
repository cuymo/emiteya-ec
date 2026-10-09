// Contenedor ZIP64 del paquete (add-data-portability, design D9; ADR 0024), leído con zipfile de
// Python, un lector independiente del contenedor.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, truncate, writeFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openZip64,
  ZipEntryError,
  type ZipMethod,
} from "../../src/modules/data-portability/infrastructure/zip64.ts";
import { inspectZip } from "../support/zip-inspect.ts";

const run = promisify(execFile);
const PROBE = fileURLToPath(new URL("../support/zip64-probe.ts", import.meta.url));
const HEAP_LIMIT_MIB = 32;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("contenedor ZIP64 del paquete de portabilidad", () => {
  let dir: string;
  let counter = 0;
  const target = () => join(dir, `paquete-${++counter}.zip`);
  const work = () => join(dir, `trabajo-${counter}`);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zip64-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "escribe más de 65 535 entradas con los registros ZIP64 y la memoria acotada",
    { timeout: 240_000 },
    async () => {
      type Probe = {
        result: { sizeBytes: number; sha256: string; entries: number };
        peakHeap: number;
        peakExternal: number;
        peakRss: number;
        directoryOnDisk: number;
        retainedExternal: number;
      };
      const probe = async (entries: number) => {
        const path = target();
        const { stdout } = await run(process.execPath, [
          "--conditions=development",
          "--expose-gc",
          `--max-old-space-size=${HEAP_LIMIT_MIB}`,
          PROBE,
          path,
          work(),
          String(entries),
        ]);
        return { path, probe: JSON.parse(stdout) as Probe };
      };
      const { probe: small } = await probe(30_000);
      const { path, probe: large } = await probe(250_000);
      const bytes = await readFile(path);
      expect(large.result).toEqual({
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
        entries: 250_000,
      });
      // Registro y localizador ZIP64 del fin del directorio, y el cierre clásico saturado.
      const tail = bytes.subarray(bytes.length - 98);
      expect(tail.readUInt32LE(0)).toBe(0x06064b50);
      expect(Number(tail.readBigUInt64LE(32))).toBe(250_000);
      expect(tail.readUInt32LE(56)).toBe(0x07064b50);
      expect(tail.readUInt32LE(76)).toBe(0x06054b50);
      expect(tail.readUInt16LE(76 + 10)).toBe(0xffff);
      const directoryBytes = Number(tail.readBigUInt64LE(40));
      // El directorio central se vuelca a un temporal mientras se escribe (todo salvo el último
      // trozo de 1 MiB), el heap no pasó de su límite, y la memoria fuera del heap que el
      // contenedor retiene tras una recolección completa no crece al pasar de 30 000 a 250 000
      // entradas: un directorio en memoria le sumaría sus ~24 MB. No se compara la memoria
      // residente: depende del asignador del sistema y falló así en el runner de la CI.
      expect(large.directoryOnDisk).toBeGreaterThanOrEqual(directoryBytes - 2 ** 20);
      expect(large.peakHeap).toBeLessThan(HEAP_LIMIT_MIB * 2 ** 20);
      expect(directoryBytes).toBeGreaterThan(16 * 2 ** 20);
      expect(large.retainedExternal - small.retainedExternal).toBeLessThan(8 * 2 ** 20);
      await expect(stat(`${work()}.cd`)).rejects.toThrow();
      const zip = await inspectZip(path);
      expect(zip).toMatchObject({
        count: 250_000,
        bad: null,
        regular: true,
        symlinks: 0,
        utf8: true,
        dataDescriptor: false,
      });
    },
  );

  it("guarda los bytes exactos de búferes y archivos con STORE y DEFLATE", async () => {
    const random = randomBytes(100_000);
    const text = Buffer.from("<comprobante>ñandú</comprobante>\n".repeat(20_000));
    const randomFile = join(dir, "aleatorio.bin");
    const textFile = join(dir, "texto.txt");
    await writeFile(randomFile, randomBytes(3_000_000));
    await writeFile(textFile, text);
    const path = target();
    const zip = await openZip64(path, work());
    const cases: [string, Uint8Array | string, ZipMethod, "store" | "deflate"][] = [
      ["a/aleatorio-store.bin", random, "store", "store"],
      ["a/texto.xml", text, "deflate", "deflate"],
      ["a/aleatorio-deflate.bin", random, "deflate", "store"],
      ["b/aleatorio-store.bin", randomFile, "store", "store"],
      ["b/texto.txt", textFile, "deflate", "deflate"],
      ["b/aleatorio-deflate.bin", randomFile, "deflate", "store"],
      ["a/vacio.json", Buffer.alloc(0), "deflate", "store"],
    ];
    for (const [name, source, method] of cases) {
      if (typeof source === "string") await zip.addFile(name, source, method);
      else await zip.addBuffer(name, source, method);
    }
    const result = await zip.close();
    const inspection = await inspectZip(
      path,
      cases.map(([name]) => name),
    );
    expect(inspection.bad).toBeNull();
    for (const [name, source, , used] of cases) {
      const expected = typeof source === "string" ? await readFile(source) : source;
      expect([name, inspection.entries[name]]).toEqual([
        name,
        expect.objectContaining({ size: expected.length, sha256: sha256(expected), method: used }),
      ]);
    }
    expect(result.sha256).toBe(sha256(await readFile(path)));
    expect(result.entries).toBe(cases.length);
  });

  it("da los mismos bytes con las mismas entradas y conserva los nombres UTF-8", async () => {
    const write = async () => {
      const path = target();
      const zip = await openZip64(path, work());
      await zip.addBuffer("manifest.json", Buffer.from('{"formatVersion":"1"}\n'), "deflate");
      await zip.addBuffer("documentos/ñandú.txt", Buffer.from("hola\n"), "deflate");
      await zip.addBuffer("ride.pdf", Buffer.alloc(4096, 7), "store");
      return { path, result: await zip.close() };
    };
    const first = await write();
    const second = await write();
    expect(second.result).toEqual(first.result);
    expect(await readFile(second.path)).toEqual(await readFile(first.path));
    const zip = await inspectZip(first.path);
    expect(zip.names).toEqual(["manifest.json", "documentos/ñandú.txt", "ride.pdf"]);
    expect(zip.utf8).toBe(true);
  });

  it("rechaza nombres inválidos, no reemplaza un archivo y no deja temporales al abortar", async () => {
    const path = target();
    const zip = await openZip64(path, work());
    for (const name of ["", "a\0b", "x".repeat(70_000)])
      await expect(zip.addBuffer(name, Buffer.from("x"), "store")).rejects.toBeInstanceOf(
        ZipEntryError,
      );
    await zip.abort();
    await expect(stat(`${work()}.cd`)).rejects.toThrow();
    await expect(openZip64(path, join(dir, "otro-trabajo"))).rejects.toThrow(/EEXIST/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  // Escribe unos 5 GB: se ejecuta en el apply y en el benchmark, fuera de verify (ADR 0024).
  it.runIf(process.env.PORTABILITY_ZIP64_LARGE === "1")(
    "escribe una entrada y desplazamientos de más de 4 GiB que leen los lectores independientes",
    { timeout: 1_800_000 },
    async () => {
      const largeDir = process.env.PORTABILITY_ZIP64_LARGE_DIR ?? dir;
      const big = join(largeDir, `grande-${process.pid}.bin`);
      const path = join(largeDir, `grande-${process.pid}.zip`);
      try {
        await (await open(big, "wx", 0o600)).close();
        await truncate(big, 4.5 * 2 ** 30);
        const zip = await openZip64(path, join(largeDir, `trabajo-${process.pid}`));
        await zip.addFile("data/grande.bin", big, "store");
        const tail = Buffer.from("<factura>después de 4 GiB</factura>\n");
        for (let i = 0; i < 5; i++) await zip.addBuffer(`documents/f-${i}.xml`, tail, "deflate");
        const result = await zip.close();
        expect(result.sizeBytes).toBeGreaterThan(2 ** 32);
        const inspection = await inspectZip(path, ["data/grande.bin", "documents/f-4.xml"]);
        expect(inspection.bad).toBeNull();
        expect(inspection.entries["data/grande.bin"]!.size).toBe(4.5 * 2 ** 30);
        expect(inspection.entries["documents/f-4.xml"]!.headerOffset).toBeGreaterThan(2 ** 32);
        expect(inspection.entries["documents/f-4.xml"]!.sha256).toBe(sha256(tail));
        await run("unzip", ["-tqq", path]);
        expect((await run("7z", ["t", path])).stdout).toMatch(/Everything is Ok/);
        expect((await run("bsdtar", ["-tf", path])).stdout.trim().split("\n")).toHaveLength(6);
      } finally {
        await rm(big, { force: true });
        await rm(path, { force: true });
      }
    },
  );
});
