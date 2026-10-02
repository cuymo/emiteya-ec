import { nodeConfig } from "../../eslint.config.base.js";

export default nodeConfig({
  tsconfigRootDir: import.meta.dirname,
  typedFiles: ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"],
});
