// Falla si el lockfile resuelve Prisma fuera de la major 7 o si una dependencia directa usa un
// rango en lugar de una versión exacta. Se ejecuta con el type stripping nativo de Node 24.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const REQUIRED_PRISMA_MAJOR = 7;
/** Paquetes que siguen la versión de Prisma. Otros @prisma/* (dev, studio-core…) versionan aparte. */
export const PRISMA_CORE_PACKAGES = new Set([
  "prisma",
  "@prisma/client",
  "@prisma/adapter-pg",
  "@prisma/engines",
  "@prisma/config",
  "@prisma/client-runtime-utils",
  "@prisma/driver-adapter-utils",
]);
const PRISMA_ENTRY = /^\s{2}'?(prisma|@prisma\/[a-z0-9-]+)@(\d+)\.\d+\.\d+[^:']*'?:\s*$/gm;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

export function findPrismaViolations(lockfile: string): string[] {
  const violations = new Set<string>();
  for (const match of lockfile.matchAll(PRISMA_ENTRY)) {
    const [, name, major] = match;
    if (name && PRISMA_CORE_PACKAGES.has(name) && Number(major) !== REQUIRED_PRISMA_MAJOR) {
      violations.add(`${name} resuelve la major ${major}; se exige ${REQUIRED_PRISMA_MAJOR}`);
    }
  }
  return [...violations];
}

type Manifest = { name?: string } & Partial<
  Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>
>;

export function findRangeViolations(manifests: Manifest[]): string[] {
  const violations: string[] = [];
  for (const manifest of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
        if (version.startsWith("workspace:")) continue;
        if (!EXACT_VERSION.test(version)) {
          violations.push(
            `${manifest.name ?? "?"}: ${dependency}@${version} no es una versión exacta`,
          );
        }
      }
    }
  }
  return violations;
}

function readManifests(root: string): Manifest[] {
  const dirs = [".", "backend", "frontend", "packages/contracts"];
  return dirs
    .map((dir) => join(root, dir, "package.json"))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as Manifest);
}

function main(): void {
  const args = process.argv.slice(2);
  const lockfileArg = args.indexOf("--lockfile");
  const root = process.cwd();
  const lockfilePath = lockfileArg >= 0 ? args[lockfileArg + 1] : join(root, "pnpm-lock.yaml");
  if (!lockfilePath || !existsSync(lockfilePath)) {
    console.error(`check:versions: no se encuentra el lockfile (${lockfilePath ?? "sin ruta"})`);
    process.exit(1);
  }
  const violations = [
    ...findPrismaViolations(readFileSync(lockfilePath, "utf8")),
    ...findRangeViolations(readManifests(root)),
  ];
  if (violations.length > 0) {
    console.error("check:versions falló:\n" + violations.map((v) => `  - ${v}`).join("\n"));
    process.exit(1);
  }
  console.log("check:versions: Prisma en la major 7 y dependencias directas con versión exacta.");
}

if (import.meta.main) main();
