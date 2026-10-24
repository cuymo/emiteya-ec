// Inspección compartida de imágenes (redesign-account-profile, tarea 1.1, design D5): PNG y JPEG por
// su contenido, con sus dimensiones; SVG, GIF, una firma falsa y lados excesivos se rechazan.
import { describe, expect, it } from "vitest";
import { IMAGE_MAX_DIMENSION, inspectImage } from "../../src/platform/images/inspection.ts";
import { GIF_BYTES, SVG_BYTES, jpegBytes, pngBytes } from "../fixtures/images.ts";

describe("inspección de imágenes", () => {
  it("reconoce PNG y JPEG con sus dimensiones", () => {
    expect(inspectImage(pngBytes(512, 384))).toEqual({
      ok: true,
      mimeType: "image/png",
      width: 512,
      height: 384,
    });
    expect(inspectImage(jpegBytes(640, 480))).toMatchObject({ ok: true, mimeType: "image/jpeg" });
  });

  it("rechaza SVG, GIF y un archivo que dice ser PNG sin serlo", () => {
    const fakePng = Buffer.concat([Buffer.from("PNG"), pngBytes(10, 10).subarray(3)]);
    for (const bytes of [SVG_BYTES, GIF_BYTES, fakePng]) {
      expect(inspectImage(bytes)).toEqual({ ok: false, reason: "UNSUPPORTED_FORMAT" });
    }
  });

  it("rechaza lados de más de 4096 píxeles, o del límite que se pida", () => {
    expect(IMAGE_MAX_DIMENSION).toBe(4096);
    expect(inspectImage(pngBytes(4097, 10))).toEqual({
      ok: false,
      reason: "DIMENSIONS_TOO_LARGE",
    });
    expect(inspectImage(pngBytes(4096, 4096))).toMatchObject({ ok: true });
    expect(inspectImage(pngBytes(600, 10), 512)).toEqual({
      ok: false,
      reason: "DIMENSIONS_TOO_LARGE",
    });
  });
});
