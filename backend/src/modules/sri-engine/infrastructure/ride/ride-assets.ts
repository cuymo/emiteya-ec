// Fuentes del RIDE como parte del artefacto de ejecución (ADR 0022; add-document-archive, design
// D7): Noto Sans 2.015 Regular y Bold (OFL 1.1), su licencia y su manifiesto. El código fija los
// valores esperados: un manifiesto reescrito junto con una fuente cambiada también falla. Este
// módulo no carga pdfmake: lo usan el arranque (readiness), el build, `check:ride-assets` y el
// worker del RIDE, que lee de aquí las fuentes verificadas.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Gauge, type Registry } from "@prometheus-io/client";
import type { Logger } from "pino";

/** El manifiesto esperado, tal como está en `assets/fonts/noto-sans/manifest.json`. */
export const RIDE_FONTS_MANIFEST = {
  family: "Noto Sans",
  version: "2.015",
  license: "OFL-1.1",
  source: "https://github.com/notofonts/latin-greek-cyrillic",
  licenseFile: {
    file: "OFL.txt",
    sha256: "087020faf4dbe0483fb7363a47e1a1bcb90667f89090b942a9b9aeb25bf81363",
  },
  fonts: {
    regular: {
      file: "NotoSans-Regular.ttf",
      sha256: "478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823",
      sizeBytes: 621572,
    },
    bold: {
      file: "NotoSans-Bold.ttf",
      sha256: "1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913",
      sizeBytes: 631484,
    },
  },
} as const;

export const RIDE_FONTS_MANIFEST_FILE = "manifest.json";

/** Archivos del paquete de fuentes, relativos a su directorio. */
export const RIDE_ASSET_FILES = [
  RIDE_FONTS_MANIFEST_FILE,
  RIDE_FONTS_MANIFEST.licenseFile.file,
  RIDE_FONTS_MANIFEST.fonts.regular.file,
  RIDE_FONTS_MANIFEST.fonts.bold.file,
] as const;

/**
 * Directorio de las fuentes: `backend/assets/fonts/noto-sans/` en desarrollo y pruebas, y
 * `dist/assets/fonts/noto-sans/` en el build, adonde las copia `copy-ride-assets.ts`.
 */
export function defaultRideFontsDirectory(): string {
  return fileURLToPath(
    new URL(
      import.meta.url.endsWith(".ts")
        ? "../../../../../assets/fonts/noto-sans/"
        : "../../../../assets/fonts/noto-sans/",
      import.meta.url,
    ),
  );
}

export type RideAssetFailure = Readonly<{
  file: string;
  reason: "MISSING" | "HASH_MISMATCH" | "MANIFEST_INVALID" | "MANIFEST_MISMATCH";
}>;

export type RideFonts = Readonly<{ regular: Buffer; bold: Buffer }>;

export type LoadedRideAssets =
  | Readonly<{ ok: true; fonts: RideFonts }>
  | Readonly<{ ok: false; failures: readonly RideAssetFailure[] }>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function readOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** Lee el manifiesto, la licencia y las fuentes, y comprueba cada uno contra lo esperado. */
export function loadRideAssets(directory: string): LoadedRideAssets {
  const failures: RideAssetFailure[] = [];
  const manifest = readOrNull(join(directory, RIDE_FONTS_MANIFEST_FILE));
  if (manifest === null) {
    failures.push({ file: RIDE_FONTS_MANIFEST_FILE, reason: "MISSING" });
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest.toString("utf8"));
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
      failures.push({ file: RIDE_FONTS_MANIFEST_FILE, reason: "MANIFEST_INVALID" });
    } else if (!isDeepStrictEqual(parsed, RIDE_FONTS_MANIFEST)) {
      failures.push({ file: RIDE_FONTS_MANIFEST_FILE, reason: "MANIFEST_MISMATCH" });
    }
  }
  const expected = [
    RIDE_FONTS_MANIFEST.licenseFile,
    RIDE_FONTS_MANIFEST.fonts.regular,
    RIDE_FONTS_MANIFEST.fonts.bold,
  ];
  const contents = new Map<string, Buffer>();
  for (const { file, sha256: hash } of expected) {
    const bytes = readOrNull(join(directory, file));
    if (bytes === null) failures.push({ file, reason: "MISSING" });
    else if (sha256(bytes) !== hash) failures.push({ file, reason: "HASH_MISMATCH" });
    else contents.set(file, bytes);
  }
  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    fonts: {
      regular: contents.get(RIDE_FONTS_MANIFEST.fonts.regular.file)!,
      bold: contents.get(RIDE_FONTS_MANIFEST.fonts.bold.file)!,
    },
  };
}

/**
 * Verificación al arrancar: sin las fuentes íntegras el RIDE no está listo. El resultado entra en
 * `/health/ready` (detalle `rideAssets`) y en la métrica `ride_assets_available`; el log nombra los
 * archivos y el motivo, nunca rutas absolutas.
 */
export function verifyRideAssets({
  directory,
  metrics,
  logger,
}: {
  directory: string;
  metrics: Registry;
  logger: Pick<Logger, "info" | "error">;
}): boolean {
  const gauge = new Gauge({
    name: "ride_assets_available",
    help: "1 si las fuentes del RIDE, su licencia y su manifiesto están completos y con sus hashes, 0 si no.",
    registers: [metrics],
  });
  const loaded = loadRideAssets(directory);
  if (loaded.ok) {
    logger.info(
      { fonts: `${RIDE_FONTS_MANIFEST.family} ${RIDE_FONTS_MANIFEST.version}` },
      "fuentes del RIDE verificadas",
    );
  } else {
    logger.error(
      { failures: loaded.failures },
      "las fuentes del RIDE están incompletas o alteradas",
    );
  }
  gauge.set(loaded.ok ? 1 : 0);
  return loaded.ok;
}
