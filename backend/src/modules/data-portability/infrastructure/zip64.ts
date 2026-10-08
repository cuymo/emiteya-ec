// Contenedor ZIP64 del paquete de portabilidad (add-data-portability, design D9; ADR 0024). Cada
// entrada conoce su tamaño, su tamaño comprimido y su CRC-32 antes de su cabecera local, así que
// nunca usa el descriptor de datos. El directorio central se vuelca a un temporal a medida que se
// agregan las entradas: la memoria no depende de su número. El SHA-256 del paquete se calcula sobre
// los bytes escritos. No lee archivos ZIP ni escribe directorios, cifrado, comentarios ni enlaces.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat, type FileHandle } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createDeflateRaw, crc32, deflateRaw } from "node:zlib";

const deflateRawAsync = promisify(deflateRaw);

export type ZipMethod = "store" | "deflate";
export type ZipResult = Readonly<{ sizeBytes: number; sha256: string; entries: number }>;

/** El contenedor no puede representar la entrada pedida (un nombre inválido o demasiado largo). */
export class ZipEntryError extends Error {}

const MAX32 = 0xffff_ffff;
const MAX16 = 0xffff;
const FLAG_UTF8 = 0x0800;
const METHOD = { store: 0, deflate: 8 } as const;
/** "Hecho por" Unix con APPNOTE 4.5: los atributos externos llevan el modo de un archivo regular. */
const MADE_BY = (3 << 8) | 45;
const REGULAR_FILE = (0o100644 << 16) >>> 0;
/** Fecha DOS fija, 1980-01-01 00:00: el momento del paquete va en su manifiesto. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const CHUNK = 1 << 20;
const DEFLATE_LEVEL = 6;

const u64 = (value: number) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};

/** Escritura secuencial por trozos de hasta 1 MiB, con la contrapresión de cada `write`. */
function bufferedFile(handle: FileHandle, onBytes?: (chunk: Buffer) => void) {
  let parts: Buffer[] = [];
  let pending = 0;
  let position = 0;
  const flush = async () => {
    if (pending === 0) return;
    const all = parts.length === 1 ? parts[0]! : Buffer.concat(parts, pending);
    parts = [];
    pending = 0;
    await handle.write(all);
  };
  return {
    position: () => position,
    async write(bytes: Uint8Array) {
      const chunk = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      onBytes?.(chunk);
      position += chunk.length;
      if (chunk.length >= CHUNK) {
        await flush();
        await handle.write(chunk);
        return;
      }
      parts.push(chunk);
      pending += chunk.length;
      if (pending >= CHUNK) await flush();
    },
    flush,
  };
}

function entryName(name: string) {
  if (name.length === 0 || name.includes("\0"))
    throw new ZipEntryError("nombre de entrada inválido");
  const bytes = Buffer.from(name, "utf8");
  if (bytes.length > MAX16) throw new ZipEntryError("nombre de entrada demasiado largo");
  return bytes;
}

async function fileCrc(path: string) {
  let crc = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: CHUNK }))
    crc = crc32(chunk as Buffer, crc);
  return crc;
}

/**
 * Abre el paquete en `path` (`wx`, `0600`). `workPath` es el prefijo de los temporales propios del
 * contenedor (el directorio central y los archivos comprimidos antes de copiarlos), en un
 * directorio privado. El llamador borra el paquete parcial si algo falla.
 */
export async function openZip64(path: string, workPath: string) {
  const outHandle = await open(path, "wx", 0o600);
  const directoryPath = `${workPath}.cd`;
  let directoryHandle: FileHandle;
  try {
    directoryHandle = await open(directoryPath, "wx", 0o600);
  } catch (error) {
    await outHandle.close();
    throw error;
  }
  const hash = createHash("sha256");
  const out = bufferedFile(outHandle, (chunk) => hash.update(chunk));
  const directory = bufferedFile(directoryHandle);
  let entries = 0;
  let closed = false;
  let deflatedFiles = 0;

  async function writeEntry(
    name: Buffer,
    method: number,
    crc: number,
    size: number,
    compressedSize: number,
    body: (write: (bytes: Uint8Array) => Promise<void>) => Promise<void>,
  ) {
    const offset = out.position();
    const zip64Sizes = size >= MAX32 || compressedSize >= MAX32;
    const localExtra = zip64Sizes
      ? Buffer.concat([Buffer.from([1, 0, 16, 0]), u64(size), u64(compressedSize)])
      : Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64Sizes ? 45 : 20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(zip64Sizes ? MAX32 : compressedSize, 18);
    local.writeUInt32LE(zip64Sizes ? MAX32 : size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    await out.write(local);
    await out.write(name);
    if (localExtra.length > 0) await out.write(localExtra);
    await body((bytes) => out.write(bytes));

    // En el directorio central, el extra ZIP64 lleva solo los valores que no caben en 32 bits, en
    // el orden de APPNOTE 4.5.3: tamaño, tamaño comprimido y desplazamiento.
    const large = [size >= MAX32, compressedSize >= MAX32, offset >= MAX32] as const;
    const values = [
      ...(large[0] ? [u64(size)] : []),
      ...(large[1] ? [u64(compressedSize)] : []),
      ...(large[2] ? [u64(offset)] : []),
    ];
    const extra =
      values.length > 0
        ? Buffer.concat([Buffer.from([1, 0, values.length * 8, 0]), ...values])
        : Buffer.alloc(0);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(MADE_BY, 4);
    record.writeUInt16LE(values.length > 0 || zip64Sizes ? 45 : 20, 6);
    record.writeUInt16LE(FLAG_UTF8, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc >>> 0, 16);
    record.writeUInt32LE(large[1] ? MAX32 : compressedSize, 20);
    record.writeUInt32LE(large[0] ? MAX32 : size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(extra.length, 30);
    // Comentario, disco de inicio y atributos internos en cero.
    record.writeUInt32LE(REGULAR_FILE, 38);
    record.writeUInt32LE(large[2] ? MAX32 : offset, 42);
    await directory.write(record);
    await directory.write(name);
    if (extra.length > 0) await directory.write(extra);
    entries += 1;
  }

  const assertOpen = () => {
    if (closed) throw new Error("el contenedor ya está cerrado");
  };

  return {
    /** Agrega bytes ya en memoria. Con DEFLATE, si comprimir no ahorra nada se guarda con STORE. */
    async addBuffer(entry: string, data: Uint8Array, method: ZipMethod) {
      assertOpen();
      const name = entryName(entry);
      const crc = crc32(data);
      let payload: Uint8Array = data;
      let used: number = METHOD.store;
      if (method === "deflate") {
        const deflated = await deflateRawAsync(data, { level: DEFLATE_LEVEL });
        if (deflated.length < data.length) {
          payload = deflated;
          used = METHOD.deflate;
        }
      }
      await writeEntry(name, used, crc, data.length, payload.length, (write) => write(payload));
    },

    /** Agrega un archivo por trozos: STORE en dos pasadas, o DEFLATE a un temporal y su copia. */
    async addFile(entry: string, source: string, method: ZipMethod) {
      assertOpen();
      const name = entryName(entry);
      const size = (await stat(source)).size;
      if (method === "store") {
        const crc = await fileCrc(source);
        await writeEntry(name, METHOD.store, crc, size, size, async (write) => {
          for await (const chunk of createReadStream(source, { highWaterMark: CHUNK }))
            await write(chunk as Buffer);
        });
        return;
      }
      const deflatedPath = `${workPath}.deflate-${deflatedFiles++}`;
      try {
        let crc = 0;
        const measure = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            crc = crc32(chunk, crc);
            done(null, chunk);
          },
        });
        await pipeline(
          createReadStream(source, { highWaterMark: CHUNK }),
          measure,
          createDeflateRaw({ level: DEFLATE_LEVEL }),
          createWriteStream(deflatedPath, { flags: "wx", mode: 0o600 }),
        );
        const compressedSize = (await stat(deflatedPath)).size;
        const stored = compressedSize >= size;
        const bodyPath = stored ? source : deflatedPath;
        await writeEntry(
          name,
          stored ? METHOD.store : METHOD.deflate,
          crc,
          size,
          stored ? size : compressedSize,
          async (write) => {
            for await (const chunk of createReadStream(bodyPath, { highWaterMark: CHUNK }))
              await write(chunk as Buffer);
          },
        );
      } finally {
        await rm(deflatedPath, { force: true });
      }
    },

    /** Copia el directorio central y escribe el cierre (ZIP64 cuando hace falta) y el `fsync`. */
    async close(): Promise<ZipResult> {
      assertOpen();
      closed = true;
      await directory.flush();
      const directorySize = directory.position();
      await directoryHandle.close();
      const directoryOffset = out.position();
      for await (const chunk of createReadStream(directoryPath, { highWaterMark: CHUNK }))
        await out.write(chunk as Buffer);
      await rm(directoryPath, { force: true });
      if (entries >= MAX16 || directoryOffset >= MAX32 || directorySize >= MAX32) {
        const recordOffset = out.position();
        const record = Buffer.alloc(56);
        record.writeUInt32LE(0x06064b50, 0);
        record.writeBigUInt64LE(44n, 4);
        record.writeUInt16LE(MADE_BY, 12);
        record.writeUInt16LE(45, 14);
        record.writeBigUInt64LE(BigInt(entries), 24);
        record.writeBigUInt64LE(BigInt(entries), 32);
        record.writeBigUInt64LE(BigInt(directorySize), 40);
        record.writeBigUInt64LE(BigInt(directoryOffset), 48);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        locator.writeBigUInt64LE(BigInt(recordOffset), 8);
        locator.writeUInt32LE(1, 16);
        await out.write(record);
        await out.write(locator);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(Math.min(entries, MAX16), 8);
      end.writeUInt16LE(Math.min(entries, MAX16), 10);
      end.writeUInt32LE(Math.min(directorySize, MAX32), 12);
      end.writeUInt32LE(Math.min(directoryOffset, MAX32), 16);
      await out.write(end);
      await out.flush();
      await outHandle.sync();
      await outHandle.close();
      return { sizeBytes: out.position(), sha256: hash.digest("hex"), entries };
    },

    /** Cierra los descriptores tras un fallo; el llamador borra el paquete parcial. */
    async abort() {
      closed = true;
      await Promise.allSettled([outHandle.close(), directoryHandle.close()]);
      await rm(directoryPath, { force: true });
    },
  };
}

export type Zip64 = Awaited<ReturnType<typeof openZip64>>;
