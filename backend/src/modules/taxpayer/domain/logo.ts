// Logo de la empresa (ADR 0017, design D5). Los formatos admitidos, el máximo de píxeles y el
// tamaño por defecto son valores de diseño y configuración, no requisitos funcionales: ninguna
// fuente los fija. La inspección de PNG y JPEG es la compartida de `platform/images`
// (redesign-account-profile, design D5), con el mismo comportamiento.
import {
  IMAGE_MAX_DIMENSION,
  IMAGE_MIME_TYPES,
  formatKilobytes,
  inspectImage,
  type ImageInspection,
  type ImageMimeType,
} from "../../../platform/images/inspection.ts";

/** Tamaño máximo por defecto del logo; la variable LOGO_MAX_BYTES lo configura. */
export const DEFAULT_LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MAX_BYTES_RANGE = { min: 16 * 1024, max: 2 * 1024 * 1024 } as const;

/** Lados de más píxeles arriesgan la memoria del renderizador del RIDE. */
export const LOGO_MAX_DIMENSION = IMAGE_MAX_DIMENSION;

/** PNG y JPEG: los admite cualquier librería PDF candidata (Q-34). SVG puede contener scripts. */
export const LOGO_MIME_TYPES = IMAGE_MIME_TYPES;
export type LogoMimeType = ImageMimeType;
export type LogoInspection = ImageInspection;

/** Reconoce el formato por su firma y lee las dimensiones de la cabecera. */
export function inspectLogo(bytes: Uint8Array): LogoInspection {
  return inspectImage(bytes, LOGO_MAX_DIMENSION);
}

export { formatKilobytes };
