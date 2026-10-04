// Primitiva de pool de workers (add-document-archive, design D6): cada instancia aporta sus errores,
// y la primitiva decide la cola, el plazo, el reemplazo del worker y el cierre.
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerPool, type WorkerPool } from "../../src/platform/workers/worker-pool.ts";

class Busy extends Error {}
class Timeout extends Error {}
class WorkerDied extends Error {}
class Closed extends Error {}

const entry = new URL("../support/test-worker-tasks.ts", import.meta.url);
const pools: WorkerPool[] = [];
const pool = (options: { size?: number; timeoutMs?: number; maxQueue?: number } = {}) => {
  const created = createWorkerPool({
    entry,
    size: 1,
    timeoutMs: 10_000,
    ...options,
    interruptedMessage: "tarea de prueba interrumpida",
    errors: {
      busy: () => new Busy(),
      timeout: () => new Timeout(),
      worker: () => new WorkerDied(),
      closed: () => new Closed(),
    },
  });
  pools.push(created);
  return created;
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()));
});

describe("primitiva de pool de workers", () => {
  it("rechaza con el error de ocupado de la instancia cuando la cola está llena", async () => {
    const p = pool({ maxQueue: 1 });
    const running = [p.run("busy", { ms: 200 }), p.run("echo", { value: "en cola" })];
    await expect(p.run("echo", { value: "x" })).rejects.toBeInstanceOf(Busy);
    expect(await Promise.all(running)).toEqual([
      { ok: true, value: { spent: true } },
      { ok: true, value: { echoed: "en cola" } },
    ]);
  });

  it("un plazo vencido termina el worker con el error de la instancia y lo reemplaza", async () => {
    const p = pool({ timeoutMs: 200 });
    await expect(p.run("hang", {})).rejects.toBeInstanceOf(Timeout);
    expect(await p.run("echo", { value: "después" })).toEqual({
      ok: true,
      value: { echoed: "después" },
    });
  });

  it("un worker que muere falla su tarea y se reemplaza", async () => {
    const p = pool();
    await expect(p.run("crash", {})).rejects.toBeInstanceOf(WorkerDied);
    expect(await p.run("echo", { value: "sigue" })).toEqual({
      ok: true,
      value: { echoed: "sigue" },
    });
  });

  it("solo el código de un error llega al hilo principal", async () => {
    const p = pool();
    expect(await p.run("typed", {})).toEqual({ ok: false, code: "TYPED_FAILURE" });
    const outcome = await p.run("unexpected", { secret: "no-debe-salir" });
    expect(outcome).toEqual({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(outcome)).not.toContain("no-debe-salir");
    expect(await p.run("desconocida", {})).toEqual({ ok: false, code: "UNKNOWN_TASK" });
  });

  it("al cerrarse espera la tarea en curso, rechaza la cola y las tareas nuevas", async () => {
    const p = pool();
    const inFlight = p.run("busy", { ms: 200 });
    const queued = p.run("echo", { value: "en cola" }).catch((error: unknown) => error);
    const closing = p.close();
    expect(await queued).toBeInstanceOf(Closed);
    expect(await inFlight).toEqual({ ok: true, value: { spent: true } });
    await closing;
    expect(p.isRunning()).toBe(false);
    await expect(p.run("echo", { value: "x" })).rejects.toBeInstanceOf(Closed);
  });

  it("dos instancias no comparten workers ni cola", async () => {
    const a = pool({ maxQueue: 1 });
    const b = pool({ maxQueue: 1 });
    const running = [a.run("busy", { ms: 300 }), a.run("echo", { value: "en cola de a" })];
    await expect(a.run("echo", { value: "x" })).rejects.toBeInstanceOf(Busy);
    expect(await b.run("echo", { value: "b libre" })).toEqual({
      ok: true,
      value: { echoed: "b libre" },
    });
    await Promise.all(running);
  });
});
