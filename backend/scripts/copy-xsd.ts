// Copia el paquete de XSD del registro al artefacto del build (design D11): `tsc` no copia `.xsd`.
import { ARTIFACT_ROOT, bundleFiles, checkBundle, copyBundle } from "./xsd-bundle.ts";

const files = bundleFiles();
copyBundle(files);
const failures = checkBundle(files);
if (failures.length > 0) {
  console.error("copy-xsd: el paquete copiado no coincide con el registro", failures);
  process.exit(1);
}
console.log(`copy-xsd: ${files.length} XSD en ${ARTIFACT_ROOT}`);
