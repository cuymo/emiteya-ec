// Comprueba, después del build, que el artefacto lleva las fuentes del RIDE, su licencia y su
// manifiesto con los hashes esperados (ADR 0022; add-document-archive, design D7). Es distinto de
// `check:xsd-artifact`, que solo comprueba los esquemas. Admite otra raíz como argumento, para las
// pruebas.
import { fileURLToPath } from "node:url";
import {
  RIDE_ASSET_FILES,
  loadRideAssets,
} from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";

const root =
  process.argv[2] ?? fileURLToPath(new URL("../dist/assets/fonts/noto-sans/", import.meta.url));
const loaded = loadRideAssets(root);
if (!loaded.ok) {
  console.error(`check:ride-assets: fuentes del RIDE incompletas o alteradas en ${root}`);
  for (const failure of loaded.failures) console.error(`  ${failure.file}: ${failure.reason}`);
  process.exit(1);
}
console.log(`check:ride-assets: ${RIDE_ASSET_FILES.length} archivos con su hash en ${root}`);
