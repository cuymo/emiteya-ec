// Comprueba, después del build, que el artefacto lleva cada XSD del registro con su SHA-256
// (design D11). Sin descargas ni sustitutos: un archivo ausente o alterado es un fallo. Admite otra
// raíz como argumento, para las pruebas.
import { ARTIFACT_ROOT, bundleFiles, checkBundle } from "./xsd-bundle.ts";

const root = process.argv[2] ?? ARTIFACT_ROOT;
const files = bundleFiles();
const failures = checkBundle(files, root);
if (failures.length > 0) {
  console.error(`check:xsd-artifact: paquete incompleto o alterado en ${root}`);
  for (const failure of failures) console.error(`  ${failure.path}: ${failure.reason}`);
  process.exit(1);
}
console.log(`check:xsd-artifact: ${files.length} XSD con su hash en ${root}`);
