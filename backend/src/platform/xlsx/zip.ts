// Contenedor ZIP mínimo del XLSX (ADR 0023): cada entrada se comprime por streaming con el deflate
// nativo de node:zlib, fuera del hilo principal, con su CRC-32 por trozos. Cabecera local con
// descriptor de datos y nombre en UTF-8, directorio central y su cierre. Sin ZIP64: falla antes de
// pasar de 4 GiB, nunca deja un archivo corrupto. Todas las entradas llevan la misma fecha fija, así
// que los bytes no dependen del momento ni de la zona horaria.
import { Readable, pipeline } from "node:stream";
import { createDeflateRaw, crc32 } from "node:zlib";

export type ZipEntry = {
  readonly name: string;
  readonly chunks: () => AsyncIterable<string> | Iterable<string>;
};

const LOCAL_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const VERSION = 20;
// Bit 3: tamaños y CRC en el descriptor de datos; bit 11: nombre en UTF-8.
const FLAGS = 0x0808;
const DEFLATE = 8;
// 1980-01-01 00:00:00 en formato DOS.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const MAX_32 = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;

export class ZipLimitError extends Error {
  constructor() {
    super("El archivo superaría el tamaño que admite un ZIP sin ZIP64.");
    this.name = "ZipLimitError";
  }
}

/** Bytes del ZIP, producidos a medida que el destino los pide. */
export async function* zipBytes(entries: Iterable<ZipEntry>): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  const advance = (bytes: number) => {
    offset += bytes;
    if (offset > MAX_32) throw new ZipLimitError();
  };
  for (const entry of entries) {
    count += 1;
    if (count > MAX_ENTRIES) throw new ZipLimitError();
    const name = Buffer.from(entry.name, "utf8");
    const headerOffset = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.concat([local, name]);
    advance(header.length);
    yield header;

    let crc = 0;
    let size = 0;
    let compressed = 0;
    const source = Readable.from(
      (async function* () {
        for await (const text of entry.chunks()) {
          const bytes = Buffer.from(text, "utf8");
          crc = crc32(bytes, crc);
          size += bytes.length;
          if (size > MAX_32) throw new ZipLimitError();
          yield bytes;
        }
      })(),
    );
    // pipeline propaga el error de la fuente al deflate, y el deflate lo entrega al iterarlo.
    const deflate = pipeline(source, createDeflateRaw({ level: 6 }), () => {});
    for await (const chunk of deflate as AsyncIterable<Buffer>) {
      compressed += chunk.length;
      advance(chunk.length);
      yield chunk;
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    advance(descriptor.length);
    yield descriptor;

    const record = Buffer.alloc(46);
    record.writeUInt32LE(CENTRAL_HEADER, 0);
    record.writeUInt16LE(VERSION, 4);
    record.writeUInt16LE(VERSION, 6);
    record.writeUInt16LE(FLAGS, 8);
    record.writeUInt16LE(DEFLATE, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(headerOffset, 42);
    central.push(record, name);
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  advance(directory.length + end.length);
  yield Buffer.concat([directory, end]);
}
