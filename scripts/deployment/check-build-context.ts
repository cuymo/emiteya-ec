// Prueba del contexto de build (harden-deployment-proxy-and-recovery, design D10). Construye, con el
// .dockerignore del repositorio, un árbol temporal de archivos permitidos y prohibidos sintéticos, y
// exporta lo que de verdad recibe el build (`FROM scratch` + `COPY . /`). Con `--image <nombre>`,
// además busca archivos prohibidos en las imágenes finales. Nunca lee un archivo privado real.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Checks, ROOT, must, run } from "./docker.ts";

/** Entradas que las imágenes necesitan: deben llegar al contexto. */
export const ALLOWED = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "packages/contracts/package.json",
  "packages/contracts/src/index.ts",
  "backend/package.json",
  "backend/prisma/schema.prisma",
  "backend/prisma/migrations/0001/migration.sql",
  "backend/src/main.ts",
  "backend/scripts/copy-xsd.ts",
  "backend/assets/fonts/noto-sans/manifest.json",
  "frontend/package.json",
  "frontend/next.config.ts",
  "frontend/src/lib/api-internal-url.ts",
  "docs/product/sri-xsd/factura.xsd",
  "docs/product/w3c-xsd/xmldsig.xsd",
];

/** Entradas sintéticas que nunca deben llegar al contexto, aunque estén bajo una ruta permitida. */
export const FORBIDDEN = [
  ".env",
  ".env.production",
  "archivosensible.env",
  "certificado.p12",
  "firma.PFX",
  "tls.key",
  "privada.pem",
  ".git/config",
  "node_modules/paquete/index.js",
  "coverage/lcov.info",
  "debug.log",
  "openspec/changes/x/proposal.md",
  "docs/product/project-requirements.md",
  "backend/.env",
  "backend/.env.example",
  "backend/archivosensible.env",
  "backend/src/firma.p12",
  "backend/src/clave.key",
  "backend/src/certificado.pem",
  "backend/src/generated/prisma/client.ts",
  "backend/node_modules/paquete/index.js",
  "backend/dist/main.js",
  "backend/test/env.test.ts",
  "backend/scripts/bench-reports.ts",
  "backend/data-exports/paquete.zip",
  "frontend/.env.local",
  "frontend/.next/cache/x",
  "frontend/test/setup.ts",
  "frontend/tsconfig.tsbuildinfo",
  "packages/contracts/dist/index.js",
  "packages/contracts/test/x.test.ts",
  "exports/paquete.zip",
];

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path, base) : [relative(base, path)];
  });
}

/** Archivos que recibe el build con el .dockerignore del repositorio, sobre el árbol sintético. */
export function receivedContext(): string[] {
  const work = mkdtempSync(join(tmpdir(), "emiteya-contexto-"));
  try {
    const context = join(work, "contexto");
    for (const path of [...ALLOWED, ...FORBIDDEN]) {
      mkdirSync(dirname(join(context, path)), { recursive: true });
      writeFileSync(join(context, path), "contenido sintético de prueba\n");
    }
    copyFileSync(join(ROOT, ".dockerignore"), join(context, ".dockerignore"));
    writeFileSync(join(work, "sonda.Dockerfile"), "FROM scratch\nCOPY . /\n");
    const output = join(work, "salida");
    must("docker", [
      "build",
      "--quiet",
      "--file",
      join(work, "sonda.Dockerfile"),
      "--output",
      `type=local,dest=${output}`,
      context,
    ]);
    return listFiles(output).sort();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Busca en el directorio de la aplicación de una imagen archivos de entorno, PKCS#12 o claves. */
export function forbiddenInImage(image: string): string[] {
  const result = run("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "find",
    image,
    "/app",
    "-path",
    "/app/node_modules",
    "-prune",
    "-o",
    "(",
    "-name",
    ".env",
    "-o",
    "-name",
    ".env.*",
    "-o",
    "-name",
    "*.env",
    "-o",
    "-iname",
    "*.p12",
    "-o",
    "-iname",
    "*.pfx",
    "-o",
    "-name",
    "*.key",
    "-o",
    "-name",
    "*.pem",
    ")",
    "-print",
  ]);
  if (result.status !== 0) throw new Error(`no se pudo inspeccionar ${image}: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean);
}

export function main(args: string[]): number {
  const checks = new Checks();
  const received = new Set(receivedContext());
  const leaked = FORBIDDEN.filter((path) => received.has(path));
  const missing = ALLOWED.filter((path) => !received.has(path));
  checks.record(
    "ningún archivo prohibido sintético llega al contexto",
    leaked.length === 0,
    leaked.length ? `filtrados: ${leaked.join(", ")}` : `${FORBIDDEN.length} prohibidos excluidos`,
  );
  checks.record(
    "las entradas necesarias llegan al contexto",
    missing.length === 0,
    missing.length ? `faltan: ${missing.join(", ")}` : `${ALLOWED.length} permitidos incluidos`,
  );
  for (let i = args.indexOf("--image"); i >= 0; i = args.indexOf("--image", i + 1)) {
    const image = args[i + 1];
    if (!image) continue;
    const found = forbiddenInImage(image);
    checks.record(
      `la imagen ${image} no trae entornos, PKCS#12 ni claves en /app`,
      found.length === 0,
      found.length ? `${found.length} archivos` : "",
    );
  }
  return checks.summary("deployment:context");
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
