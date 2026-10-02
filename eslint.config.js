// ESLint de la raíz: scripts y configuración compartida. Cada paquete tiene su propia configuración.
import { nodeConfig } from "./eslint.config.base.js";

export default [
  { ignores: ["backend/**", "frontend/**", "packages/**", "openspec/**", "docs/**"] },
  ...nodeConfig({ tsconfigRootDir: import.meta.dirname, typedFiles: ["scripts/**/*.ts"] }),
];
