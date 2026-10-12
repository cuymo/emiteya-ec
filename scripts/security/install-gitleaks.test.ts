// Instalador de Gitleaks (add-ci-dependency-and-secret-scanning, design D4): con una suma incorrecta
// no extrae ni ejecuta nada y termina en ERROR. Un servidor HTTP local sirve un artefacto falso cuyo
// binario deja una marca si llega a ejecutarse.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const INSTALLER = join(import.meta.dirname, "install-gitleaks.sh");
const ARTIFACT = "gitleaks_0.0.0_linux_x64.tar.gz";

let server: Server;
let base: string;
const served = new Map<string, Buffer>();
let work: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = served.get(req.url ?? "");
    res.writeHead(body ? 200 : 404).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  served.clear();
});

/** Un artefacto con un binario `gitleaks` falso que deja una marca al ejecutarse. */
function fakeArtifact(reportedVersion: string): { bytes: Buffer; marker: string } {
  work = mkdtempSync(join(tmpdir(), "install-gitleaks-"));
  const marker = join(work, "ejecutado");
  const build = join(work, "build");
  mkdirSync(build);
  writeFileSync(
    join(build, "gitleaks"),
    `#!/bin/sh\ntouch "${marker}"\n[ "$1" = "version" ] && echo "${reportedVersion}"\n`,
  );
  chmodSync(join(build, "gitleaks"), 0o755);
  spawnSync("tar", ["-czf", join(work, ARTIFACT), "-C", build, "gitleaks"]);
  return { bytes: readFileSync(join(work, ARTIFACT)), marker };
}

function pin(sha256: string, path = `/${ARTIFACT}`): string {
  const file = join(work, "gitleaks.json");
  writeFileSync(
    file,
    JSON.stringify({ version: "0.0.0", artifact: ARTIFACT, sha256, url: `${base}${path}` }),
  );
  return file;
}

function install(pinFile: string): Promise<{ code: number | null; output: string; dest: string }> {
  const dest = join(work, "bin");
  return new Promise((resolve) => {
    const child = spawn("bash", [INSTALLER, pinFile, dest]);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (code) => resolve({ code, output, dest }));
  });
}

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("instalador de Gitleaks", () => {
  it("con una suma incorrecta no extrae ni ejecuta el binario y termina en ERROR", async () => {
    const { bytes, marker } = fakeArtifact("0.0.0");
    served.set(`/${ARTIFACT}`, bytes);
    const result = await install(pin("0".repeat(64)));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("SECRET SECURITY: ERROR");
    expect(result.output).toContain("no coincide");
    expect(existsSync(join(result.dest, "gitleaks"))).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("con la suma correcta extrae el binario y comprueba su versión", async () => {
    const { bytes, marker } = fakeArtifact("0.0.0");
    served.set(`/${ARTIFACT}`, bytes);
    const result = await install(pin(sha(bytes)));
    expect(result.code).toBe(0);
    expect(existsSync(join(result.dest, "gitleaks"))).toBe(true);
    expect(existsSync(marker)).toBe(true);
    expect(result.output).not.toContain("ERROR");
  });

  it("si el binario informa otra versión, lo retira y termina en ERROR", async () => {
    const { bytes } = fakeArtifact("9.9.9");
    served.set(`/${ARTIFACT}`, bytes);
    const result = await install(pin(sha(bytes)));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("SECRET SECURITY: ERROR");
    expect(existsSync(join(result.dest, "gitleaks"))).toBe(false);
  });

  it("si la descarga falla, termina en ERROR", async () => {
    fakeArtifact("0.0.0");
    const result = await install(pin("0".repeat(64), "/no-existe.tar.gz"));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("SECRET SECURITY: ERROR");
  });

  it("una fijación sin suma válida termina en ERROR sin descargar", async () => {
    fakeArtifact("0.0.0");
    const result = await install(pin("no-es-una-suma"));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("SECRET SECURITY: ERROR");
  });
});
