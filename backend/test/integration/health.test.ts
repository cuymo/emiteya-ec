import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { buildTestApp } from "../helpers.ts";
import { TEST_DATABASE_URL, requireTestDatabase } from "./database.ts";

describe("endpoints de salud contra PostgreSQL", () => {
  let database: Database;
  let silent: Server;
  let silentUrl: string;

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(TEST_DATABASE_URL);
    // Un servidor TCP que acepta conexiones y nunca responde: simula una base que no contesta.
    silent = createServer(() => {}).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => silent.once("listening", () => resolve()));
    silentUrl = `postgresql://u:p@127.0.0.1:${(silent.address() as AddressInfo).port}/x`;
  });

  afterAll(async () => {
    await database.close();
    silent.close();
  });

  it("live responde 200", async () => {
    const { app } = buildTestApp({ readiness: () => database.ping() });
    expect((await request(app).get("/health/live")).status).toBe(200);
  });

  it("ready responde 200 con la base disponible", async () => {
    const { app } = buildTestApp({ readiness: () => database.ping() });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
  });

  it("ready responde 503 dentro del tiempo límite cuando la base no responde", async () => {
    const unreachable = createDatabase(silentUrl);
    const { app } = buildTestApp({ readiness: () => unreachable.ping() });
    const started = Date.now();
    const res = await request(app).get("/health/ready");
    const elapsed = Date.now() - started;
    void unreachable.close().catch(() => {});

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable" });
    expect(elapsed).toBeLessThan(3_000);
  });
});
