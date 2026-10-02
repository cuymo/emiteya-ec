import { defineProject } from "vitest/config";

export default defineProject({
  resolve: { conditions: ["development"] },
  test: {
    name: "backend",
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixtures/**"],
  },
});
