// Prueba end-to-end de add-data-portability (tarea 7.2) contra el backend real: main.ts como proceso,
// sin firma ni transmisión, sobre una instalación nueva con la configuración, el logo y sus versiones
// por la API, comprobantes de los seis tipos en los dos ambientes con sus artefactos y respuestas,
// terceros, productos, inventario, auditoría, una firma cargada con sus secretos marcados y un
// borrador. Solicita la exportación por HTTP, espera `READY`, la descarga y verifica `SHA256SUMS`, el
// manifiesto, los libros, los snapshots y los bytes de cada artefacto y cada respuesta; la ausencia
// de los secretos y del borrador; los cuatro eventos de auditoría; que los datos de la empresa no
// cambian; y que un reinicio a mitad de la generación termina con un solo paquete.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DataExportView } from "@facturador/contracts";
import {
  ARTIFACT_FILES,
  documentFolder,
  responseFile,
} from "../../src/modules/data-portability/domain/format.ts";
import { readXlsx } from "../support/xlsx-reader.ts";
import { extractZip } from "../support/zip-inspect.ts";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";
import {
  PORTABILITY_ADMIN,
  portabilityEnv,
  startPortabilityInstallation,
  type PortabilityInstallation,
} from "./portability-e2e-harness.ts";
import { SECRET_MARKERS } from "./portability-harness.ts";

const run = promisify(execFile);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const DRAFT_MARKER = "MARCADOR-BORRADOR-E2E-SIN-EMITIR";
/** Tablas de la empresa que exportar nunca cambia. */
const COMPANY_TABLES = [
  "electronic_document",
  "document_artifact",
  "sri_attempt",
  "sri_response",
  "document_state_transition",
  "party",
  "product",
  "stock_movement",
  "stock_balance",
  "company_config_version",
  "configuration_asset",
  "signing_certificate",
  "signing_certificate_secret",
];

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

describe("flujo completo de la portabilidad", () => {
  let installation: PortabilityInstallation;
  let backend: E2eBackend;
  let directory: string;
  let work: string;
  const env = () => portabilityEnv(directory, { DATA_EXPORT_SWEEP_INTERVAL_SECONDS: "10" });

  const prisma = () => installation.db.database.prisma;
  const api = (method: string, path: string, cookie = installation.cookies.admin, body?: unknown) =>
    backend.fetchApi(method, path, cookie, body);
  const detail = async (id: string) =>
    ((await (await api("GET", `/data-exports/${id}`)).json()) as { data: DataExportView }).data;
  async function untilFinished(id: string, timeoutMs = 240_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const view = await detail(id);
      if (view.status === "READY" || view.status === "FAILED") return view;
      if (Date.now() > deadline) throw new Error(`la exportación sigue ${view.status}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const events = async (id: string) =>
    (
      await prisma().auditEvent.findMany({
        where: {
          companyId: installation.company.companyId,
          action: { startsWith: "data_export." },
        },
        orderBy: { occurredAt: "asc" },
      })
    ).filter((event) => (event.changes as { exportId?: string } | null)?.exportId === id);

  /** Huella de cada tabla de la empresa: su número de filas y el hash de su contenido. */
  async function fingerprints() {
    const result: Record<string, string> = {};
    for (const table of COMPANY_TABLES) {
      const [row] = await prisma().$queryRawUnsafe<{ count: bigint; hash: string | null }[]>(
        `SELECT count(*) AS count, md5(string_agg(t::text, '|' ORDER BY t::text)) AS hash FROM "${installation.db.name}"."${table}" t`,
      );
      result[table] = `${row!.count}:${row!.hash ?? ""}`;
    }
    return result;
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "e2e-portabilidad-"));
    work = await mkdtemp(join(tmpdir(), "e2e-portabilidad-extraido-"));
    installation = await startPortabilityInstallation({
      label: "end_to_end_portability",
      directory,
      env: { DATA_EXPORT_SWEEP_INTERVAL_SECONDS: "10" },
    });
    backend = installation.backend;
    await prisma().purchaseSettlementDraft.create({
      data: {
        companyId: installation.company.companyId,
        lines: [{ description: DRAFT_MARKER, quantity: "1", unitPrice: "1.00" }],
        payments: [],
        createdBy: installation.company.adminId,
        updatedBy: installation.company.adminId,
      },
    });
  }, 300_000);

  afterAll(async () => {
    await backend?.stop();
    await installation?.db.drop();
    await rm(directory, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  it("genera, descarga y verifica el paquete completo sin cambiar la empresa", async () => {
    const before = await fingerprints();
    expect((await api("POST", "/data-exports", installation.cookies.operator, {})).status).toBe(
      403,
    );
    const res = await api("POST", "/data-exports", undefined, {});
    expect(res.status).toBe(202);
    const { id } = ((await res.json()) as { data: DataExportView }).data;
    const view = await untilFinished(id);
    expect(view).toMatchObject({ status: "READY", formatVersion: "1" });

    const download = await api("GET", `/data-exports/${id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(
      /^attachment; filename="datos-\d{8}-\d{6}\.zip"$/,
    );
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.length).toBe(Number(view.sizeBytes));
    expect(sha256(bytes)).toBe(view.sha256);
    const zip = join(work, "paquete.zip");
    await writeFile(zip, bytes);
    const out = join(work, "paquete");
    const entries = await extractZip(zip, out);

    // SHA256SUMS cubre cada archivo, salvo él mismo, y sha256sum lo verifica.
    const { stdout } = await run("sha256sum", ["-c", "--strict", "SHA256SUMS"], {
      cwd: out,
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 64 * 2 ** 20,
    });
    const checked = stdout.trim().split("\n");
    expect(checked.every((line) => line.endsWith(": OK"))).toBe(true);
    expect(checked).toHaveLength(entries.length - 1);

    // El manifiesto: la versión, el momento y los conteos de la vista.
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8")) as {
      formatVersion: string;
      snapshotAt: string;
      counts: { documents: { TEST: number; PRODUCTION: number }; files: number };
      exclusions: { data: string }[];
    };
    expect(manifest.formatVersion).toBe("1");
    expect(new Date(manifest.snapshotAt).toISOString()).toBe(view.snapshotAt);
    expect(manifest.counts.documents).toMatchObject({
      TEST: view.counts!.documentsTest,
      PRODUCTION: view.counts!.documentsProduction,
    });
    expect(manifest.counts.files).toBe(view.counts!.files);
    expect(entries).toHaveLength(view.counts!.files);
    expect(manifest.exclusions.map((x) => x.data).join("\n")).toMatch(/firma electrónica/);

    // Los libros, con una fila de encabezado y una por comprobante de los dos ambientes.
    const books = entries.filter((name) => name.endsWith(".xlsx"));
    expect(books.length).toBe(6);
    const book = books.find((name) => /(^|\/)comprobantes\.xlsx$/.test(name))!;
    const documents = readXlsx(join(out, book)).sheets[0]!;
    expect(documents.rows.size - 1).toBe(
      view.counts!.documentsTest + view.counts!.documentsProduction,
    );
    expect(view.counts!.documentsTest).toBeGreaterThan(0);
    expect(view.counts!.documentsProduction).toBeGreaterThan(0);

    // Cada comprobante: su snapshot, cada artefacto y cada respuesta, con los bytes de la base.
    const rows = await prisma().electronicDocument.findMany({
      where: { companyId: installation.company.companyId },
      include: { artifacts: true },
    });
    const attempts = await prisma().sriAttempt.findMany({
      where: { companyId: installation.company.companyId },
      include: { response: true },
    });
    let artifactsChecked = 0;
    for (const document of rows) {
      const folder = join(
        out,
        documentFolder({
          ...document,
          environment: document.environment as Parameters<typeof documentFolder>[0]["environment"],
        }),
      );
      expect(JSON.parse(await readFile(join(folder, "snapshot.json"), "utf8"))).toEqual(
        document.snapshot,
      );
      for (const artifact of document.artifacts) {
        const file = await readFile(join(folder, ARTIFACT_FILES[artifact.kind as "SIGNED_XML"]));
        expect(file.equals(Buffer.from(artifact.content))).toBe(true);
        artifactsChecked += 1;
      }
      for (const attempt of attempts.filter((a) => a.documentId === document.id && a.response)) {
        const file = await readFile(
          join(folder, responseFile({ ...attempt, contentType: attempt.response!.contentType })),
        );
        expect(file.equals(Buffer.from(attempt.response!.body))).toBe(true);
      }
    }
    expect(artifactsChecked).toBeGreaterThan(rows.length);

    // Ningún secreto ni el borrador, en claro ni en base64, tampoco dentro de los libros.
    const needles = [...Object.values(SECRET_MARKERS), DRAFT_MARKER].flatMap((marker) => [
      Buffer.from(marker),
      Buffer.from(Buffer.from(marker).toString("base64").slice(0, 16)),
    ]);
    for (const file of await walk(out)) {
      const contents = [await readFile(file)];
      if (file.endsWith(".xlsx"))
        contents.push(...[...readXlsx(file).parts.values()].map((xml) => Buffer.from(xml)));
      for (const content of contents)
        for (const needle of needles)
          expect([file, needle.toString(), content.includes(needle)]).toEqual([
            file,
            needle.toString(),
            false,
          ]);
    }

    // Los datos de la empresa no cambiaron.
    expect(await fingerprints()).toEqual(before);

    // Un paquete alterado en el disco no se entrega y deja la exportación fallida.
    const fileName = (await prisma().dataExport.findUniqueOrThrow({ where: { id } })).fileName!;
    const path = join(directory, fileName);
    await chmod(path, 0o600);
    const altered = Buffer.from(bytes);
    altered[100] = altered[100]! ^ 0xff;
    await writeFile(path, altered);
    const rejected = await api("GET", `/data-exports/${id}/download`);
    expect(rejected.status).toBe(500);
    expect(await rejected.json()).toMatchObject({
      error: { code: "DATA_EXPORT_PACKAGE_INTEGRITY" },
    });

    // Los cuatro eventos, en orden, sin rutas ni contenido.
    const recorded = await events(id);
    expect(recorded.map((event) => event.action)).toEqual([
      "data_export.requested",
      "data_export.completed",
      "data_export.download_started",
      "data_export.failed",
    ]);
    expect(JSON.stringify(recorded.map((event) => event.changes))).not.toMatch(
      new RegExp(`${directory}|\\.zip|documents/`),
    );
  }, 300_000);

  it("un reinicio a mitad de la generación termina con un solo paquete", async () => {
    let id = "";
    // La generación de esta instalación dura poco: se detiene el proceso en cuanto se ve en curso
    // y se mata detenido, como una caída a mitad del trabajo.
    for (let tries = 0; tries < 5 && !id; tries += 1) {
      const res = await api("POST", "/data-exports", undefined, {});
      expect(res.status).toBe(202);
      const created = ((await res.json()) as { data: DataExportView }).data.id;
      for (;;) {
        const row = await prisma().dataExport.findUniqueOrThrow({ where: { id: created } });
        if (row.status === "GENERATING") {
          process.kill(backend.pid, "SIGSTOP");
          id = created;
          break;
        }
        if (row.status === "READY" || row.status === "FAILED") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    expect(id).not.toBe("");
    await backend.crash();
    backend = await startE2eBackend({
      label: "end_to_end_portability",
      admin: PORTABILITY_ADMIN,
      db: installation.db,
      env: env(),
    });
    // El lease del proceso caído vence y el nuevo intento la genera desde el principio.
    const view = await untilFinished(id, 240_000);
    expect(view.status).toBe("READY");
    const row = await prisma().dataExport.findUniqueOrThrow({ where: { id } });
    expect(row.attempt).toBeGreaterThanOrEqual(2);
    expect(
      await prisma().dataExport.count({
        where: { companyId: installation.company.companyId, status: "READY" },
      }),
    ).toBe(1);
    expect((await events(id)).map((event) => event.action)).toEqual([
      "data_export.requested",
      "data_export.completed",
    ]);
    // Tras un barrido, solo el paquete vigente: ni parciales ni trabajo del intento caído.
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    expect((await readdir(directory)).sort()).toEqual([row.fileName!, "work"].sort());
    expect(await readdir(join(directory, "work"))).toEqual([]);
    const download = await api("GET", `/data-exports/${id}/download`);
    expect(sha256(Buffer.from(await download.arrayBuffer()))).toBe(view.sha256);
  }, 420_000);
});
