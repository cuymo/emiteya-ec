// Logo de la empresa (ADR 0017, design D5). Los formatos admitidos, el máximo de píxeles y el
// tamaño por defecto son valores de diseño y configuración, no requisitos funcionales: ninguna
// fuente los fija. El formato se reconoce por el contenido, nunca por el nombre ni el tipo declarado.

/** Tamaño máximo por defecto del logo; la variable LOGO_MAX_BYTES lo configura. */
export const DEFAULT_LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MAX_BYTES_RANGE = { min: 16 * 1024, max: 2 * 1024 * 1024 } as const;

/** Lados de más píxeles arriesgan la memoria del renderizador del RIDE. */
export const LOGO_MAX_DIMENSION = 4096;

/** PNG y JPEG: los admite cualquier librería PDF candidata (Q-34). SVG puede contener scripts. */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

export type LogoInspection =
  | { ok: true; mimeType: LogoMimeType; width: number; height: number }
  | { ok: false; reason: "UNSUPPORTED_FORMAT" | "UNREADABLE" | "DIMENSIONS_TOO_LARGE" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Marcadores SOFn de JPEG con dimensiones: todos los C0-CF salvo DHT (C4), JPG (C8) y DAC (CC).
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const uint16 = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const uint32 = (bytes: Uint8Array, at: number) =>
  uint16(bytes, at) * 0x10000 + uint16(bytes, at + 2);

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // Firma, longitud del primer chunk (13) y su tipo IHDR, con ancho y alto a continuación.
  const ihdr = String.fromCharCode(...bytes.subarray(12, 16));
  if (bytes.length < 24 || uint32(bytes, 8) !== 13 || ihdr !== "IHDR") return null;
  return { width: uint32(bytes, 16), height: uint32(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let marker = bytes[at + 1] ?? 0;
    while (marker === 0xff && at + 2 < bytes.length) marker = bytes[++at + 1] ?? 0;
    at += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = uint16(bytes, at);
    if (length < 2 || at + length > bytes.length) return null;
    if (JPEG_SOF.has(marker)) {
      if (length < 7) return null;
      return { height: uint16(bytes, at + 3), width: uint16(bytes, at + 5) };
    }
    at += length;
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Reconoce el formato por su firma y lee las dimensiones de la cabecera. */
export function inspectLogo(bytes: Uint8Array): LogoInspection {
  const isPng = startsWith(bytes, PNG_SIGNATURE);
  const isJpeg = startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (!isPng && !isJpeg) return { ok: false, reason: "UNSUPPORTED_FORMAT" };
  const size = isPng ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (!size || size.width === 0 || size.height === 0) return { ok: false, reason: "UNREADABLE" };
  if (size.width > LOGO_MAX_DIMENSION || size.height > LOGO_MAX_DIMENSION) {
    return { ok: false, reason: "DIMENSIONS_TOO_LARGE" };
  }
  return { ok: true, mimeType: isPng ? "image/png" : "image/jpeg", ...size };
}

/** Tamaño legible para mensajes: 524288 -> "512 KB". */
export function formatKilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}
