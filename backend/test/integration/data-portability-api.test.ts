// Portabilidad por HTTP (add-data-portability, tareas 5.1 y 5.2, design D10, D11, D16 y D17): la
// solicitud con la fila, el job y el evento en una sola transacción, una generación activa por
// empresa también ante solicitudes simultáneas, el progreso y la vista lista, la descarga con el
// SHA-256 de la vista verificada antes de cualquier cabecera, el paquete perdido o alterado a
// FAILED sin ningún byte, `409`, `410`, la auditoría que falla sin entregar, el reemplazo, `HEAD`,
// `401`, `403` y el aislamiento por empresa. El runner no arranca: los estados de la generación
// los fija el registro real.
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "@prometheus-io/client";
import { Router } from "express";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dataExportListViewSchema,
  dataExportViewSchema,
  type DataExportCounts,
  type DataExportView,
} from "@facturador/contracts";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { DownloadAbortedError } from "../../src/modules/data-portability/application/errors.ts";
import { dataPortabilityModule } from "../../src/modules/data-portability/infrastructure/index.ts";
import { createDataExportStore } from "../../src/modules/data-portability/infrastructure/prisma-data-exports.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { archiveCompany, type ArchiveCompany } from "./archive-api-harness.ts";
import { binary } from "./reports-api-harness.ts";
import { buildAuthApp, createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { portabilitySources } from "./portability-harness.ts";
import { sessionCookie } from "./taxpayer-harness.ts";

const HOUR = 3_600_000;
const TTL_MS = 24 * HOUR;
const COUNTS: DataExportCounts = {
  documentsTest: 3,
  documentsProduction: 1,
  files: 9,
  parties: 2,
  products: 1,
  stockMovements: 4,
  auditEvents: 5,
  users: 2,
};
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function buildPortabilityApp(db: MigratedSchema, root: string) {
  /** Las acciones cuya auditoría falla, para comprobar que nada se crea ni se entrega. */
  const failing = new Set<string>();
  let portability: ReturnType<typeof dataPortabilityModule> | undefined;
  const app = buildAuthApp(db, {
    trustProxy: 1,
    apiRouter: ({ context, memberships, securityEvents }) => {
      portability = dataPortabilityModule({
        prisma: db.database.prisma,
        authorizer: createAuthorizer({ memberships, securityEvents }),
        sources: portabilitySources(db.name),
        jobs: createPrismaJobStore(db.database.prisma, db.name),
        limits: {
          directory: root,
          maxConcurrent: 1,
          ttlHours: 24,
          headroomPercent: 10,
          reserveMib: 64,
          sweepIntervalSeconds: 300,
        },
        registry: new Registry(),
        logger: pino({ level: "silent" }),
        applicationVersion: "0.0.0-test",
        audit: (client) => {
          const log = createAuditLog(client);
          return {
            ...log,
            append: (event) =>
              failing.has(event.action)
                ? Promise.reject(new Error("auditoría no disponible"))
                : log.append(event),
          };
        },
      });
      return Router()
        .use(context)
        .use(...portability.routers);
    },
  });
  return { ...app, portability: portability!, failing };
}

type App = ReturnType<typeof buildPortabilityApp>;

describe("portabilidad por HTTP", () => {
  let db: MigratedSchema;
  let base: string;
  let root: string;
  let api: App;
  const store = createDataExportStore();

  const post = (cookie: string | null, body: object = {}) => {
    const call = request(api.app).post("/api/v1/data-exports").send(body);
    return cookie ? call.set("Cookie", cookie) : call;
  };
  const detail = (cookie: string, id: string) =>
    request(api.app).get(`/api/v1/data-exports/${id}`).set("Cookie", cookie);
  /** La vista de la respuesta, validada con el contrato. */
  const viewOf = (res: request.Response) =>
    dataExportViewSchema.parse((res.body as { data: unknown }).data);
  const download = (cookie: string | null, id: string) => {
    const call = request(api.app)
      .get(`/api/v1/data-exports/${id}/download`)
      .buffer(true)
      .parse(binary);
    return cookie ? call.set("Cookie", cookie) : call;
  };
  /** El error JSON de una respuesta binaria: ningún byte del paquete. */
  const errorOf = (res: request.Response) => {
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    return JSON.parse((res.body as Buffer).toString("utf8")) as { error: { code: string } };
  };

  async function requested(company: ArchiveCompany): Promise<DataExportView> {
    const res = await post(company.cookies.admin);
    expect(res.status).toBe(202);
    return dataExportViewSchema.parse((res.body as { data: unknown }).data);
  }

  async function portabilityEvents(companyId: string) {
    const events = await createAuditLog(db.database.prisma).listForCompany(companyId);
    return events.filter((event) => event.action.startsWith("data_export."));
  }
  const actions = async (companyId: string) =>
    (await portabilityEvents(companyId)).map((event) => event.action).sort();
  const rowsOf = (companyId: string) =>
    db.database.prisma.dataExport.findMany({ where: { companyId } });
  const jobsOf = (companyId: string) =>
    db.database.prisma.job.findMany({ where: { companyId, type: "portability.export" } });

  /** Lleva una exportación a lista con un paquete real en el directorio, por el registro real. */
  async function ready(view: DataExportView, companyId: string, bytes: Buffer, now = new Date()) {
    const files = api.portability.files;
    const partial = files.partialPath(view.id, 1);
    await writeFile(partial, bytes, { mode: 0o600 });
    const fileName = files.fileName(view.id, 1);
    await files.publish(partial, fileName);
    await db.database.prisma.$transaction(async (tx) => {
      await store.start(tx, { id: view.id, attempt: 1, now });
      await store.publish(tx, {
        id: view.id,
        companyId,
        attempt: 1,
        now,
        ttlMs: TTL_MS,
        snapshotAt: now,
        fileName,
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
        counts: COUNTS,
      });
    });
    return join(root, fileName);
  }

  let a: ArchiveCompany;
  let b: ArchiveCompany;

  beforeAll(async () => {
    db = await createMigratedSchema("data_portability_api");
    base = await mkdtemp(join(tmpdir(), "portabilidad-api-"));
    // El módulo crea su directorio privado al iniciar, como en main.ts.
    root = join(base, "exports");
    api = buildPortabilityApp(db, root);
    await api.portability.files.init();
    a = await archiveCompany(db, api as never, "Portabilidad A");
    b = await archiveCompany(db, api as never, "Portabilidad B");
  }, 300_000);

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await db?.drop();
  });

  describe("solicitud, consulta y listado", () => {
    it("deja en cola la fila, el job y el evento juntos, con un 409 para la segunda", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Solicitud");
      const view = await requested(company);
      expect(view).toMatchObject({
        status: "QUEUED",
        phase: null,
        progress: null,
        requestedBy: { name: "Admin Portabilidad Solicitud" },
        startedAt: null,
        sizeBytes: null,
        sha256: null,
        formatVersion: "1",
        counts: null,
        errorCode: null,
      });
      const [row] = await rowsOf(company.companyId);
      expect(row).toMatchObject({ id: view.id, status: "QUEUED" });
      const [job] = await jobsOf(company.companyId);
      expect(job).toMatchObject({
        status: "PENDING",
        payload: { exportId: view.id },
        origin: "MANUAL",
        requestedBy: row!.requestedBy,
      });
      const [event] = await portabilityEvents(company.companyId);
      expect(event).toMatchObject({
        action: "data_export.requested",
        actor: { type: "USER", userId: row!.requestedBy },
        changes: { exportId: view.id },
      });

      // La segunda solicitud con una en cola: 409, sin otra fila, otro job ni otro evento.
      const again = await post(company.cookies.admin);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ error: { code: "DATA_EXPORT_IN_PROGRESS" } });
      expect(await rowsOf(company.companyId)).toHaveLength(1);
      expect(await jobsOf(company.companyId)).toHaveLength(1);
      expect(await actions(company.companyId)).toEqual(["data_export.requested"]);

      // La generación de otra empresa entra en su propia cola.
      const other = await archiveCompany(db, api as never, "Portabilidad Otra Cola");
      expect((await requested(other)).status).toBe("QUEUED");
      expect((await rowsOf(company.companyId))[0]!.status).toBe("QUEUED");
    });

    it("no crea la fila, el job ni el evento si la transacción de la solicitud falla", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Atómica");
      api.failing.add("data_export.requested");
      try {
        const res = await post(company.cookies.admin);
        expect(res.status).toBe(500);
      } finally {
        api.failing.delete("data_export.requested");
      }
      expect(await rowsOf(company.companyId)).toEqual([]);
      expect(await jobsOf(company.companyId)).toEqual([]);
      expect(await portabilityEvents(company.companyId)).toEqual([]);
      // Nada quedó activo: la empresa puede solicitar de nuevo.
      expect((await requested(company)).status).toBe("QUEUED");
    });

    it("dos solicitudes simultáneas producen una sola generación", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Simultánea");
      const email = "admin-2@portabilidad.ec";
      await createMember(api.uow, company.companyId, { name: "Admin Dos", email, role: "ADMIN" });
      const second = await sessionCookie(api.app, email);
      const responses = await Promise.all([post(company.cookies.admin), post(second)]);
      expect(responses.map((res) => res.status).sort()).toEqual([202, 409]);
      expect(await rowsOf(company.companyId)).toHaveLength(1);
      expect(await jobsOf(company.companyId)).toHaveLength(1);
      expect(await actions(company.companyId)).toEqual(["data_export.requested"]);
    });

    it("muestra la fase y el progreso, y la vista lista sin datos internos", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Progreso");
      const view = await requested(company);
      await db.database.prisma.$transaction((tx) =>
        store.start(tx, { id: view.id, attempt: 1, now: new Date() }),
      );
      let res = await detail(company.cookies.admin, view.id);
      expect(viewOf(res)).toMatchObject({
        status: "GENERATING",
        phase: "SNAPSHOT",
        progress: null,
      });
      await store.progress(db.database.prisma, {
        id: view.id,
        attempt: 1,
        phase: "ARTIFACTS",
        done: 3,
        total: 10,
      });
      res = await detail(company.cookies.admin, view.id);
      expect(viewOf(res)).toMatchObject({
        status: "GENERATING",
        phase: "ARTIFACTS",
        progress: { done: 3, total: 10 },
      });

      const bytes = randomBytes(4096);
      await ready(view, company.companyId, bytes);
      res = await detail(company.cookies.admin, view.id);
      const done = viewOf(res);
      expect(done).toMatchObject({
        status: "READY",
        phase: null,
        progress: null,
        sizeBytes: "4096",
        sha256: sha256(bytes),
        counts: COUNTS,
      });
      expect(Date.parse(done.expiresAt!) - Date.parse(done.generatedAt!)).toBe(TTL_MS);
      // Ni el nombre interno del archivo ni el directorio salen en la vista.
      expect(JSON.stringify(res.body)).not.toContain(view.id + "-1");
      expect(JSON.stringify(res.body)).not.toContain(root);

      // El listado: solo la empresa de la sesión, de la más reciente a la más antigua.
      const second = await requested(company);
      const list = await request(api.app)
        .get("/api/v1/data-exports")
        .query({ page: "1", pageSize: "10" })
        .set("Cookie", company.cookies.admin);
      expect(list.status).toBe(200);
      const parsed = dataExportListViewSchema.parse(list.body);
      expect(parsed.data.map((row) => row.id)).toEqual([second.id, view.id]);
      expect(parsed.meta).toMatchObject({ page: 1, pageSize: 10, total: 2 });
    });

    it("rechaza al operador con 403 y sin sesión con 401, sin ningún efecto", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Permisos");
      const view = await requested(company);
      const before = await actions(company.companyId);
      const operator = company.cookies.operator;
      const calls = (cookie: string | null) => {
        const withCookie = (call: request.Test) => (cookie ? call.set("Cookie", cookie) : call);
        return [
          post(cookie),
          withCookie(request(api.app).get("/api/v1/data-exports")),
          withCookie(request(api.app).get(`/api/v1/data-exports/${view.id}`)),
          download(cookie, view.id),
        ];
      };
      for (const res of await Promise.all(calls(operator))) expect(res.status).toBe(403);
      for (const res of await Promise.all(calls(null))) expect(res.status).toBe(401);
      expect(await rowsOf(company.companyId)).toHaveLength(1);
      expect(await jobsOf(company.companyId)).toHaveLength(1);
      expect(await actions(company.companyId)).toEqual(before);
    });

    it("responde 404 por la exportación de otra empresa y rechaza un companyId", async () => {
      const view = await requested(a);
      const bytes = randomBytes(1024);
      await ready(view, a.companyId, bytes);
      const before = await actions(b.companyId);
      expect((await detail(b.cookies.admin, view.id)).status).toBe(404);
      const res = await download(b.cookies.admin, view.id);
      expect(res.status).toBe(404);
      expect(errorOf(res).error.code).toBe("DATA_EXPORT_NOT_FOUND");
      const list = await request(api.app)
        .get("/api/v1/data-exports")
        .set("Cookie", b.cookies.admin);
      expect((list.body as { data: { id: string }[] }).data.map((row) => row.id)).not.toContain(
        view.id,
      );

      const injected = await post(b.cookies.admin, { companyId: a.companyId });
      expect(injected.status).toBe(400);
      expect(injected.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      expect(await rowsOf(b.companyId)).toEqual([]);
      expect(await jobsOf(b.companyId)).toEqual([]);
      expect(await actions(b.companyId)).toEqual(before);
      // La exportación de A sigue lista y sin eventos de B.
      expect(viewOf(await detail(a.cookies.admin, view.id)).status).toBe("READY");
    });
  });

  describe("descarga", () => {
    it("entrega el paquete con el SHA-256 de la vista y registra cada inicio", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Descarga");
      const view = await requested(company);
      // Varios bloques del streaming de 1 MiB.
      const bytes = randomBytes(3 * 2 ** 20 + 17);
      await ready(view, company.companyId, bytes);
      const shown = dataExportViewSchema.parse(
        viewOf(await detail(company.cookies.admin, view.id)),
      );

      const res = await download(company.cookies.admin, view.id);
      expect(res.status).toBe(200);
      expect(res.headers).toMatchObject({
        "content-type": "application/zip",
        "content-length": String(bytes.length),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      expect(res.headers["content-disposition"]).toMatch(
        /^attachment; filename="datos-\d{8}-\d{6}\.zip"$/,
      );
      expect(sha256(res.body as Buffer)).toBe(shown.sha256);

      expect((await download(company.cookies.admin, view.id)).status).toBe(200);
      const started = (await portabilityEvents(company.companyId)).filter(
        (event) => event.action === "data_export.download_started",
      );
      expect(started).toHaveLength(2);
      const [requester] = await rowsOf(company.companyId);
      for (const event of started)
        expect(event).toMatchObject({
          actor: { type: "USER", userId: requester!.requestedBy },
          changes: { exportId: view.id },
        });
    });

    it("no atiende HEAD", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Head");
      const view = await requested(company);
      await ready(view, company.companyId, randomBytes(64));
      const res = await request(api.app)
        .head(`/api/v1/data-exports/${view.id}/download`)
        .set("Cookie", company.cookies.admin);
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("GET");
      expect(await actions(company.companyId)).toEqual(["data_export.requested"]);
    });

    it("responde 409 en cola, generándose o fallida, sin ningún evento de descarga", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad No Lista");
      const view = await requested(company);
      let res = await download(company.cookies.admin, view.id);
      expect([res.status, errorOf(res).error.code]).toEqual([409, "DATA_EXPORT_NOT_READY"]);
      await db.database.prisma.$transaction((tx) =>
        store.start(tx, { id: view.id, attempt: 1, now: new Date() }),
      );
      res = await download(company.cookies.admin, view.id);
      expect([res.status, errorOf(res).error.code]).toEqual([409, "DATA_EXPORT_NOT_READY"]);
      await db.database.prisma.$transaction((tx) =>
        store.fail(tx, {
          id: view.id,
          code: "DATA_EXPORT_FAILED",
          now: new Date(),
          from: "GENERATING",
        }),
      );
      res = await download(company.cookies.admin, view.id);
      expect([res.status, errorOf(res).error.code]).toEqual([409, "DATA_EXPORT_NOT_READY"]);
      expect(await actions(company.companyId)).toEqual(["data_export.requested"]);
    });

    it("responde 410 por un paquete vencido o reemplazado, y el anterior sirve hasta el nuevo", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Caducidad");
      // Lista hace 25 horas: vencida aunque el barrido todavía no pasó.
      const old = await requested(company);
      await ready(old, company.companyId, randomBytes(128), new Date(Date.now() - 25 * HOUR));
      let res = await download(company.cookies.admin, old.id);
      expect([res.status, errorOf(res).error.code]).toEqual([410, "DATA_EXPORT_EXPIRED"]);

      // Generar de nuevo con un paquete vigente: el anterior se descarga mientras el nuevo se
      // genera, y caduca por reemplazo cuando el nuevo queda listo.
      const current = await requested(company);
      await ready(current, company.companyId, randomBytes(128));
      const next = await requested(company);
      expect((await download(company.cookies.admin, current.id)).status).toBe(200);
      await ready(next, company.companyId, randomBytes(256));
      res = await download(company.cookies.admin, current.id);
      expect([res.status, errorOf(res).error.code]).toEqual([410, "DATA_EXPORT_EXPIRED"]);
      expect(viewOf(await detail(company.cookies.admin, current.id))).toMatchObject({
        status: "EXPIRED",
        expiredReason: "REPLACED",
      });
      expect((await download(company.cookies.admin, next.id)).status).toBe(200);
      const started = (await actions(company.companyId)).filter(
        (action) => action === "data_export.download_started",
      );
      expect(started).toHaveLength(2);
    });

    it("deja FAILED un paquete alterado o perdido, sin ningún byte ni ruta", async () => {
      const cases = [
        ["mismo tamaño", "DATA_EXPORT_PACKAGE_INTEGRITY"],
        ["otro tamaño", "DATA_EXPORT_PACKAGE_INTEGRITY"],
        ["borrado", "DATA_EXPORT_PACKAGE_MISSING"],
      ] as const;
      for (const [name, code] of cases) {
        const company = await archiveCompany(db, api as never, `Portabilidad Integridad ${name}`);
        const view = await requested(company);
        const bytes = randomBytes(2048);
        const path = await ready(view, company.companyId, bytes);
        if (name === "borrado") await rm(path);
        else {
          await chmod(path, 0o600);
          const altered = Buffer.from(bytes);
          altered[100] = altered[100]! ^ 0xff;
          await writeFile(path, name === "otro tamaño" ? Buffer.concat([bytes, altered]) : altered);
        }
        const res = await download(company.cookies.admin, view.id);
        expect([name, res.status]).toEqual([name, 500]);
        const text = (res.body as Buffer).toString("utf8");
        expect(JSON.parse(text)).toMatchObject({ error: { code } });
        expect(text).not.toContain(root);
        expect(text).not.toContain(`${view.id}-1`);
        expect(viewOf(await detail(company.cookies.admin, view.id))).toMatchObject({
          status: "FAILED",
          errorCode: code,
        });
        const events = await portabilityEvents(company.companyId);
        expect(events.map((event) => event.action).sort()).toEqual([
          "data_export.failed",
          "data_export.requested",
        ]);
        expect(events.find((event) => event.action === "data_export.failed")!.changes).toEqual({
          exportId: view.id,
          code,
        });
        // Ya fallida: la siguiente descarga es un 409, sin otro evento.
        expect((await download(company.cookies.admin, view.id)).status).toBe(409);
        expect(await portabilityEvents(company.companyId)).toHaveLength(2);
      }
    });

    it("abandona la verificación si el cliente se desconecta, sin registrar la descarga", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Desconexión");
      const view = await requested(company);
      await ready(view, company.companyId, randomBytes(4096));
      const [row] = await rowsOf(company.companyId);
      const ctx = {
        userId: row!.requestedBy,
        companyId: company.companyId,
        role: "ADMIN" as const,
        requestId: "req-desconexion",
      };
      await expect(
        api.portability.service.download(ctx, { id: view.id }, AbortSignal.abort()),
      ).rejects.toBeInstanceOf(DownloadAbortedError);
      expect(await actions(company.companyId)).toEqual(["data_export.requested"]);
      expect(viewOf(await detail(company.cookies.admin, view.id)).status).toBe("READY");
      // Sin desconexión, la misma descarga se verifica y se registra.
      const done = await api.portability.service.download(ctx, { id: view.id });
      await done.handle.close();
      expect(await actions(company.companyId)).toEqual([
        "data_export.download_started",
        "data_export.requested",
      ]);
    });

    it("no entrega nada si no puede registrar el inicio de la descarga", async () => {
      const company = await archiveCompany(db, api as never, "Portabilidad Auditoría");
      const view = await requested(company);
      const bytes = randomBytes(8192);
      await ready(view, company.companyId, bytes);
      api.failing.add("data_export.download_started");
      let res;
      try {
        res = await download(company.cookies.admin, view.id);
      } finally {
        api.failing.delete("data_export.download_started");
      }
      expect(res.status).toBe(500);
      expect(errorOf(res).error.code).not.toMatch(/^DATA_EXPORT_PACKAGE/);
      expect((res.body as Buffer).includes(bytes.subarray(0, 64))).toBe(false);
      expect(await actions(company.companyId)).toEqual(["data_export.requested"]);
      // El paquete sigue listo: con la auditoría disponible, se descarga.
      expect(viewOf(await detail(company.cookies.admin, view.id)).status).toBe("READY");
      res = await download(company.cookies.admin, view.id);
      expect([res.status, sha256(res.body as Buffer)]).toEqual([200, sha256(bytes)]);
    });
  });
});
