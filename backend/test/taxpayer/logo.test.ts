import { describe, expect, it } from "vitest";
import {
  LOGO_MAX_DIMENSION,
  formatKilobytes,
  inspectLogo,
} from "../../src/modules/taxpayer/domain/logo.ts";
import { GIF_BYTES, SVG_BYTES, WEBP_BYTES, jpegBytes, pngBytes } from "../fixtures/images.ts";

describe("inspección del logo por contenido (design D5)", () => {
  it("reconoce PNG y JPEG y lee sus dimensiones", () => {
    expect(inspectLogo(pngBytes(120, 40))).toEqual({
      ok: true,
      mimeType: "image/png",
      width: 120,
      height: 40,
    });
    expect(inspectLogo(jpegBytes(300, 200))).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      width: 300,
      height: 200,
    });
  });

  it("rechaza SVG, GIF, WebP y texto aunque se declaren como imagen", () => {
    for (const bytes of [SVG_BYTES, GIF_BYTES, WEBP_BYTES, Buffer.from("no es una imagen")]) {
      expect(inspectLogo(bytes)).toEqual({ ok: false, reason: "UNSUPPORTED_FORMAT" });
    }
  });

  it("rechaza una cabecera ilegible o truncada", () => {
    expect(inspectLogo(pngBytes(10, 10).subarray(0, 20))).toEqual({
      ok: false,
      reason: "UNREADABLE",
    });
    expect(inspectLogo(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toEqual({
      ok: false,
      reason: "UNREADABLE",
    });
    expect(inspectLogo(pngBytes(0, 10))).toEqual({ ok: false, reason: "UNREADABLE" });
  });

  it("acepta hasta 4096 px por lado y rechaza más", () => {
    expect(inspectLogo(pngBytes(LOGO_MAX_DIMENSION, 1)).ok).toBe(true);
    expect(inspectLogo(pngBytes(LOGO_MAX_DIMENSION + 1, 1))).toEqual({
      ok: false,
      reason: "DIMENSIONS_TOO_LARGE",
    });
    expect(inspectLogo(jpegBytes(10, LOGO_MAX_DIMENSION + 1))).toEqual({
      ok: false,
      reason: "DIMENSIONS_TOO_LARGE",
    });
  });

  it("expresa el límite en kilobytes", () => {
    expect(formatKilobytes(512 * 1024)).toBe("512 KB");
  });
});
