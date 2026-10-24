// Conexión con el SRI del tablero (redesign-dashboard-indicators, design D2): sale del último intento
// guardado de la empresa en su ambiente; la lectura nunca abre una conexión al SRI.
import { describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import { sriLastContact } from "../../src/modules/fiscal/infrastructure/index.ts";

type Row = { startedAt: Date; transportOutcome: string; httpStatus: number | null };

function dbWith(row: Row | null) {
  const calls: unknown[] = [];
  const db = {
    sriAttempt: {
      findFirst: (args: unknown) => {
        calls.push(args);
        return Promise.resolve(row);
      },
    },
  } as unknown as DbClient;
  return { db, calls };
}

const AT = new Date("2026-10-14T15:30:00.000Z");

describe("última comunicación con el SRI", () => {
  it("lee el último intento de la empresa en su ambiente", async () => {
    const { db, calls } = dbWith({ startedAt: AT, transportOutcome: "RESPONSE", httpStatus: 200 });
    expect(await sriLastContact(db, "c-1", "TEST")).toEqual({ at: AT, reached: true });
    expect(calls[0]).toMatchObject({
      where: { companyId: "c-1", environment: "TEST" },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
  });

  it("una respuesta 5xx o un fallo de transporte no es una comunicación correcta", async () => {
    for (const row of [
      { startedAt: AT, transportOutcome: "RESPONSE", httpStatus: 503 },
      { startedAt: AT, transportOutcome: "REQUEST_TIMEOUT", httpStatus: null },
      { startedAt: AT, transportOutcome: "CONNECTION_LOST", httpStatus: null },
    ]) {
      expect((await sriLastContact(dbWith(row).db, "c-1", "TEST"))?.reached).toBe(false);
    }
  });

  it("sin intentos no hay comunicación", async () => {
    expect(await sriLastContact(dbWith(null).db, "c-1", "PRODUCTION")).toBeNull();
  });
});
