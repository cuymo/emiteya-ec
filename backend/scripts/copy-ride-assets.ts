// Copia las fuentes del RIDE, su licencia y su manifiesto al artefacto del build (ADR 0022;
// add-document-archive, design D7): `tsc` no copia assets. Falla si la copia no coincide.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RIDE_ASSET_FILES,
  loadRideAssets,
} from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";

const RIDE_ASSETS_SOURCE = fileURLToPath(new URL("../assets/fonts/noto-sans/", import.meta.url));
const RIDE_ASSETS_ARTIFACT = fileURLToPath(
  new URL("../dist/assets/fonts/noto-sans/", import.meta.url),
);

mkdirSync(RIDE_ASSETS_ARTIFACT, { recursive: true });
for (const file of RIDE_ASSET_FILES) {
  copyFileSync(join(RIDE_ASSETS_SOURCE, file), join(RIDE_ASSETS_ARTIFACT, file));
}
const loaded = loadRideAssets(RIDE_ASSETS_ARTIFACT);
if (!loaded.ok) {
  console.error("copy-ride-assets: la copia no coincide con el manifiesto", loaded.failures);
  process.exit(1);
}
console.log(`copy-ride-assets: ${RIDE_ASSET_FILES.length} archivos en ${RIDE_ASSETS_ARTIFACT}`);
