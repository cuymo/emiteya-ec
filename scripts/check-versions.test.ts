import { describe, expect, it } from "vitest";
import { findPrismaViolations, findRangeViolations } from "./check-versions.ts";

const lockfile = (prismaVersion: string) => `lockfileVersion: '9.0'

packages:

  '@prisma/client@${prismaVersion}':
    resolution: {integrity: sha512-x}

  prisma@${prismaVersion}:
    resolution: {integrity: sha512-y}

  express@5.2.1:
    resolution: {integrity: sha512-z}

  '@prisma/studio-core@0.33.0':
    resolution: {integrity: sha512-w}
`;

describe("check:versions", () => {
  it("acepta Prisma 7 e ignora los paquetes @prisma/* con versionado propio", () => {
    expect(findPrismaViolations(lockfile("7.10.0"))).toEqual([]);
  });

  it("rechaza un lockfile que resuelve Prisma 8", () => {
    const violations = findPrismaViolations(lockfile("8.0.0-rc.19"));
    expect(violations).toHaveLength(2);
    expect(violations.join()).toContain("major 8");
  });

  it("rechaza dependencias directas con rango y acepta versiones exactas y workspace", () => {
    const violations = findRangeViolations([
      {
        name: "a",
        dependencies: { express: "5.2.1", zod: "^4.0.0", "@facturador/contracts": "workspace:*" },
      },
      { name: "b", devDependencies: { vitest: "~5.0.0", typescript: "6.0.3" } },
    ]);
    expect(violations).toEqual([
      "a: zod@^4.0.0 no es una versión exacta",
      "b: vitest@~5.0.0 no es una versión exacta",
    ]);
  });
});
