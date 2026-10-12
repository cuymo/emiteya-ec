// Origen y Fetch Metadata de /api/v1 sobre HTTP (enforce-api-origin-and-body-limits, tarea 1.4): las
// peticiones negativas se construyen en el cliente, como las enviaría un navegador de otro sitio, y
// la aplicación las recibe sin ningún cambio de prueba.
import express, { Router } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import request, { TEST_ORIGIN } from "../support/http-client.ts";
import { archiveCompany, buildArchiveApp, type ArchiveCompany } from "./archive-api-harness.ts";
import { buildAuthApp, buildUsersApp } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { binary, buildReportsApp, exportEvents } from "./reports-api-harness.ts";
import { insertDocument, sha256, signedXmlOf } from "./transmission-harness.ts";

const PDF = Buffer.from("%PDF-1.3\n%RIDE de prueba\n%%EOF\n");
const FOREIGN = "https://atacante.ejemplo";
const MESSAGE = "La solicitud no proviene de la aplicación.";
const MARKER = "cuerpo-que-no-debe-registrarse";

type Res = { status: number; body: unknown; headers: Record<string, unknown> };

function expectRejected(res: Res) {
  expect(res.status).toBe(403);
  expect((res.body as { error: { code: string } }).error.code).toBe("REQUEST_ORIGIN_REJECTED");
}

describe("origen y Fetch Metadata en /api/v1", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let api: ReturnType<typeof buildArchiveApp>;
  let a: ArchiveCompany;
  const responses: Res[] = [];

  /** Una solicitud de impresión, un `POST` sin cuerpo; `origin: null` la envía sin `Origin`. */
  const print = (documentId: string, origin?: string | null) => {
    const call = request(api.app, { origin: origin === null ? null : undefined })
      .post(`/api/v1/documents/${documentId}/print-requests`)
      .set("Cookie", a.cookies.operator);
    return typeof origin === "string" ? call.set("Origin", origin) : call;
  };
  const prints = (documentId: string) =>
    prisma.documentDeliveryEvent.count({ where: { documentId, event: "PRINT_REQUESTED" } });
  const kept = <T extends Res>(res: T): T => {
    responses.push(res);
    return res;
  };

  async function authorizedWithRide() {
    const document = await insertDocument(prisma, a, "AUTHORIZED");
    for (const [kind, content] of [
      ["AUTHORIZED_XML", signedXmlOf(document.accessKey)],
      ["RIDE_PDF", PDF],
    ] as const) {
      await prisma.documentArtifact.create({
        data: {
          companyId: document.companyId,
          documentId: document.id,
          kind,
          mediaType: kind === "RIDE_PDF" ? "application/pdf" : "application/xml",
          content: new Uint8Array(content),
          sizeBytes: content.length,
          sha256: sha256(content),
          metadata: {},
        },
      });
    }
    return document;
  }

  beforeAll(async () => {
    db = await createMigratedSchema("request_origin");
    prisma = db.database.prisma;
    api = buildArchiveApp(db);
    a = await archiveCompany(db, api, "Empresa A");
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("mutaciones", () => {
    it("con el origen canónico, la solicitud de impresión se registra como hasta ahora", async () => {
      const document = await authorizedWithRide();
      expect(kept(await print(document.id)).status).toBe(201);
      expect(await prints(document.id)).toBe(1);
    });

    it.each([
      ["otro sitio", FOREIGN],
      ["un subdominio hermano", "http://otro.localhost:3000"],
      ["otro puerto del mismo host", "http://localhost:3001"],
      ["otro esquema", "https://localhost:3000"],
      ["el origen nulo", "null"],
      ["un origen malformado", `${TEST_ORIGIN}/`],
      ["el origen ausente", null],
    ])("con %s, el POST sin cuerpo recibe 403 y no se registra", async (_case, origin) => {
      const document = await authorizedWithRide();
      expectRejected(kept(await print(document.id, origin)));
      expect(await prints(document.id)).toBe(0);
    });

    it("el origen se decide antes que el tamaño del cuerpo y que la sesión", async () => {
      const big = { relleno: "x".repeat(110 * 1024) };
      const path = "/api/v1/documents/00000000-0000-4000-8000-000000000000/print-requests";
      expectRejected(kept(await request(api.app).post(path).set("Origin", FOREIGN).send(big)));
      expect(kept(await request(api.app).post(path).send(big)).status).toBe(413);
      expectRejected(kept(await request(api.app).post(path).set("Origin", FOREIGN)));
      const unauthenticated = kept(await request(api.app).post(path));
      expect(unauthenticated.status).toBe(401);
      expect((unauthenticated.body as { error: { code: string } }).error.code).toBe(
        "UNAUTHENTICATED",
      );
    });

    it("con el origen canónico, un rol sin permiso sigue recibiendo su denegación", async () => {
      const users = buildUsersApp(db);
      const res = kept(
        await request(users.app)
          .post("/api/v1/users")
          .set("Cookie", a.cookies.operator)
          .send({ name: "Nuevo", email: "nuevo@origen.ec", role: "OPERATOR" }),
      );
      expect(res.status).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    });

    it("un Host o un X-Forwarded-Host falsificados no amplían la confianza", async () => {
      const document = await authorizedWithRide();
      for (const header of ["Host", "X-Forwarded-Host"]) {
        expectRejected(
          kept(
            await print(document.id, FOREIGN)
              .set(header, "atacante.ejemplo")
              .set("X-Forwarded-Proto", "https"),
          ),
        );
      }
      expect(await prints(document.id)).toBe(0);
    });
  });

  describe("Fetch Metadata", () => {
    const list = (site?: string) => {
      const call = request(api.app).get("/api/v1/documents").set("Cookie", a.cookies.operator);
      return site ? call.set("Sec-Fetch-Site", site) : call;
    };

    it("same-origin, none y la ausencia de la cabecera funcionan", async () => {
      for (const site of ["same-origin", "none", undefined]) {
        expect(kept(await list(site)).status, String(site)).toBe(200);
      }
      const document = await authorizedWithRide();
      expect(kept(await print(document.id).set("Sec-Fetch-Site", "same-origin")).status).toBe(201);
    });

    it("un GET same-site o cross-site recibe 403", async () => {
      expectRejected(kept(await list("same-site")));
      expectRejected(kept(await list("cross-site")));
      // HEAD no lleva cuerpo: queda el estado y la respuesta sin caché.
      const head = kept(
        await request(api.app)
          .head("/api/v1/documents")
          .set("Cookie", a.cookies.operator)
          .set("Sec-Fetch-Site", "cross-site"),
      );
      expect(head.status).toBe(403);
      expect(head.headers["cache-control"]).toBe("no-store");
    });

    it("las dos reglas se suman: el origen canónico con cross-site recibe 403", async () => {
      const document = await authorizedWithRide();
      expectRejected(kept(await print(document.id).set("Sec-Fetch-Site", "cross-site")));
      expect(await prints(document.id)).toBe(0);
    });

    it("la exportación de un reporte desde otro sitio recibe 403 y no deja auditoría", async () => {
      const reports = buildReportsApp(db);
      const exportFrom = (site: string) =>
        request(reports.app)
          .get("/api/v1/reports/issued-documents/export")
          .set("Cookie", a.cookies.operator)
          .set("Sec-Fetch-Site", site)
          .buffer(true)
          .parse(binary);
      const before = (await exportEvents(db, a.companyId)).length;
      const crossSite = kept(await exportFrom("cross-site"));
      expect(crossSite.status).toBe(403);
      expect(JSON.parse((crossSite.body as Buffer).toString("utf8"))).toMatchObject({
        error: { code: "REQUEST_ORIGIN_REJECTED" },
      });
      expect((await exportEvents(db, a.companyId)).length).toBe(before);
      // Control: desde el mismo origen la exportación sí se genera y se audita.
      expect(kept(await exportFrom("same-origin")).status).toBe(200);
      expect((await exportEvents(db, a.companyId)).length).toBe(before + 1);
    });
  });

  it("OPTIONS responde como antes del cambio, sin cabeceras Access-Control-*", async () => {
    const res = kept(
      await request(api.app)
        .options("/api/v1/documents")
        .set("Origin", FOREIGN)
        .set("Sec-Fetch-Site", "cross-site")
        .set("Access-Control-Request-Method", "POST"),
    );
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  it("el 403 usa el sobre común, no se guarda en caché y no revela el origen esperado", async () => {
    const document = await authorizedWithRide();
    const res = kept(await print(document.id, FOREIGN).set("X-Request-Id", "req-origen-sobre"));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { code: "REQUEST_ORIGIN_REJECTED", message: MESSAGE, requestId: "req-origen-sobre" },
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    const text = JSON.stringify(res.body);
    for (const leak of ["localhost", "origin_mismatch", "atacante"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("el rechazo es un evento con la categoría de la ruta y un contador, sin datos sensibles en los logs", async () => {
    const document = await authorizedWithRide();
    const referer = "https://atacante.ejemplo/pagina-con-referer";
    const res = kept(
      await print(document.id, FOREIGN)
        .set("X-Request-Id", "req-origen-evento")
        .set("Referer", referer)
        .send({ marca: MARKER }),
    );
    expectRejected(res);
    const event = api.events.find(
      (e) => e.type === "request_origin_rejected" && e.correlationId === "req-origen-evento",
    );
    expect(event).toEqual({
      type: "request_origin_rejected",
      method: "POST",
      route: "documents",
      reason: "origin_mismatch",
      correlationId: "req-origen-evento",
    });
    expect(JSON.stringify(event)).not.toContain(document.id);
    expect(await api.metrics.registry.metrics()).toMatch(
      /^http_request_origin_rejections_total\{method="POST",reason="origin_mismatch"\} [1-9]\d*$/m,
    );

    const logs = api.logs();
    const securityLine = logs
      .split("\n")
      .find(
        (line) =>
          line.includes('"requestId":"req-origen-evento"') && line.includes('"channel":"security"'),
      );
    expect(securityLine).toBeDefined();
    expect(securityLine).not.toContain(document.id);
    const token = decodeURIComponent(a.cookies.operator.split("=")[1] ?? "");
    for (const secret of [FOREIGN, referer, MARKER, token.split(".")[0]!]) {
      expect(logs).not.toContain(secret);
    }
  });

  describe("límites de cuerpo de la API", () => {
    it("el JSON general de más de 100 KiB sigue recibiendo 413 con el origen canónico", async () => {
      const res = kept(
        await request(api.app)
          .post("/api/v1/documents/00000000-0000-4000-8000-000000000000/print-requests")
          .set("Cookie", a.cookies.operator)
          .send({ relleno: "x".repeat(110 * 1024) }),
      );
      expect(res.status).toBe(413);
      expect((res.body as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("una ruta con límite propio acepta su cuerpo grande, y el origen se decide antes de leerlo", async () => {
      const own = buildAuthApp(db, {
        jsonBodyExceptions: (req) => req.path === "/api/v1/probe/large",
        apiRouter: ({ context }) =>
          Router()
            .use(context)
            .post("/probe/large", express.json({ limit: "1mb" }), (req, res) => {
              res.json({ size: JSON.stringify(req.body).length });
            }),
      });
      const send = (size: number) =>
        request(own.app)
          .post("/api/v1/probe/large")
          .set("Cookie", a.cookies.operator)
          .send({ relleno: "x".repeat(size) });
      expect(kept(await send(300 * 1024)).status).toBe(200);
      expect(kept(await send(1100 * 1024)).status).toBe(413);
      expectRejected(kept(await send(300 * 1024).set("Origin", FOREIGN)));
    });
  });

  it("ninguna respuesta, aceptada o rechazada, lleva cabeceras Access-Control-*", () => {
    expect(responses.length).toBeGreaterThan(20);
    for (const res of responses) {
      expect(Object.keys(res.headers).filter((name) => name.startsWith("access-control-"))).toEqual(
        [],
      );
    }
  });
});
