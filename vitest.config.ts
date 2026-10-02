import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "backend",
      "packages/contracts",
      "frontend",
      { test: { name: "scripts", include: ["scripts/**/*.test.ts"], environment: "node" } },
    ],
  },
});
