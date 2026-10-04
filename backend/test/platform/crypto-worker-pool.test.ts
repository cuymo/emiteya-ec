// Pool criptográfico fuera del event loop (add-signing-certificate, design D18).
import { afterEach, describe, expect, it } from "vitest";
import {
  CryptoBusyError,
  CryptoPoolClosedError,
  CryptoTimeoutError,
  CryptoWorkerError,
  createCryptoWorkerPool,
  type CryptoWorkerPool,
} from "../../src/platform/workers/crypto-worker-pool.ts";

const entry = new URL("../support/test-crypto-tasks.ts", import.meta.url);
const pools: CryptoWorkerPool[] = [];
const pool = (options: { size?: number; timeoutMs?: number; maxQueue?: number } = {}) => {
  const created = createCryptoWorkerPool({ entry, size: 2, timeoutMs: 10_000, ...options });
  pools.push(created);
  return created;
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()));
});

describe("pool criptográfico (design D18)", () => {
  it("ejecuta tareas en workers y devuelve su valor", async () => {
    expect(await pool().run("echo", { value: "hola" })).toEqual({
      ok: true,
      value: { echoed: "hola" },
    });
  });

  it("acota la concurrencia al número de workers", async () => {
    const p = pool({ size: 2 });
    await p.run("echo", { value: "calentamiento" });
    const started = performance.now();
    await Promise.all(Array.from({ length: 4 }, () => p.run("busy", { ms: 300 })));
    const elapsed = performance.now() - started;
    // Cuatro tareas de 300 ms con dos workers: dos tandas, nunca las cuatro a la vez.
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(elapsed).toBeLessThan(1_500);
  });

  it("rechaza con CRYPTO_BUSY cuando la cola está llena", async () => {
    const p = pool({ size: 1, maxQueue: 2 });
    const running = [
      p.run("busy", { ms: 300 }),
      p.run("echo", { value: "a" }),
      p.run("echo", { value: "b" }),
    ];
    await expect(p.run("echo", { value: "c" })).rejects.toBeInstanceOf(CryptoBusyError);
    await Promise.all(running);
  });

  it("un timeout termina el worker, lo reemplaza y el pool sigue funcionando", async () => {
    const p = pool({ size: 1, timeoutMs: 300 });
    await expect(p.run("hang", {})).rejects.toBeInstanceOf(CryptoTimeoutError);
    expect(await p.run("echo", { value: "después" })).toEqual({
      ok: true,
      value: { echoed: "después" },
    });
  });

  it("propaga el código de un error tipado y oculta el mensaje de uno inesperado", async () => {
    const p = pool();
    expect(await p.run("typed", {})).toEqual({ ok: false, code: "CERTIFICATE_PASSWORD_INVALID" });
    const outcome = await p.run("unexpected", { secret: "contraseña-que-no-debe-salir" });
    expect(outcome).toEqual({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(outcome)).not.toContain("contraseña-que-no-debe-salir");
  });

  it("si el worker muere, la tarea falla sin detalles y el pool lo reemplaza", async () => {
    const p = pool({ size: 1 });
    await expect(p.run("crash", {})).rejects.toBeInstanceOf(CryptoWorkerError);
    expect(await p.run("echo", { value: "sigue" })).toEqual({
      ok: true,
      value: { echoed: "sigue" },
    });
  });

  it("el event loop principal sigue respondiendo durante una tarea pesada", async () => {
    const p = pool({ size: 1 });
    await p.run("echo", { value: "calentamiento" });
    let last = performance.now();
    let maxGap = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    await p.run("busy", { ms: 600 });
    clearInterval(timer);
    expect(maxGap).toBeLessThan(150);
  });

  it("transfiere el buffer: el hilo principal lo pierde y el worker lo pone a cero", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const outcome = await pool().run<{ sum: number; zeroed: boolean }>("wipe", { bytes }, [bytes]);
    expect(outcome).toEqual({ ok: true, value: { sum: 10, zeroed: true } });
    expect(bytes.byteLength).toBe(0);
  });

  // Caracterización previa a la extracción de la primitiva genérica (add-document-archive, design
  // D6): fija la semántica que el pool criptográfico conserva sobre ella.
  it("una cola de tamaño 0 rechaza toda tarea, aunque haya un worker libre", async () => {
    const p = pool({ size: 1, maxQueue: 0 });
    await expect(p.run("echo", { value: "x" })).rejects.toBeInstanceOf(CryptoBusyError);
  });

  it("sus errores conservan el código y el estado HTTP", async () => {
    const busy = pool({ size: 1, maxQueue: 1 });
    const running = [busy.run("busy", { ms: 200 }), busy.run("echo", { value: "en cola" })];
    const rejected = await busy.run("echo", { value: "x" }).catch((error: unknown) => error);
    expect(rejected).toMatchObject({ code: "CRYPTO_BUSY", status: 503 });
    await Promise.all(running);
    const slow = pool({ size: 1, timeoutMs: 200 });
    expect(await slow.run("hang", {}).catch((error: unknown) => error)).toMatchObject({
      code: "CRYPTO_TIMEOUT",
      status: 503,
    });
    const closed = pool();
    await closed.close();
    expect(await closed.run("echo", { value: "x" }).catch((error: unknown) => error)).toMatchObject(
      { code: "CRYPTO_UNAVAILABLE", status: 503 },
    );
  });

  it("registra la interrupción con la tarea y el motivo, nunca la carga útil", async () => {
    const warnings: { details: object; message: string }[] = [];
    const logger = {
      warn: (details: object, message: string) => warnings.push({ details, message }),
    };
    const p = createCryptoWorkerPool({ entry, size: 1, timeoutMs: 200, logger });
    pools.push(p);
    await expect(p.run("hang", { secret: "no-se-registra" })).rejects.toBeInstanceOf(
      CryptoTimeoutError,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toBe("tarea criptográfica interrumpida");
    expect(warnings[0]!.details).toMatchObject({ task: "hang", reason: "timeout" });
    expect(JSON.stringify(warnings)).not.toContain("no-se-registra");
  });

  it("un worker colgado no detiene a los demás", async () => {
    const p = pool({ size: 2, timeoutMs: 1_000 });
    await p.run("echo", { value: "calentamiento" });
    const hung = p.run("hang", {}).catch((error: unknown) => error);
    expect(await p.run("echo", { value: "en paralelo" })).toEqual({
      ok: true,
      value: { echoed: "en paralelo" },
    });
    expect(await hung).toBeInstanceOf(CryptoTimeoutError);
  });

  it("al cerrarse rechaza las tareas en cola y termina la que está en curso", async () => {
    const p = createCryptoWorkerPool({ entry, size: 1, timeoutMs: 10_000 });
    const inFlight = p.run("busy", { ms: 200 });
    const queued = p.run("echo", { value: "en cola" }).catch((error: unknown) => error);
    const closing = p.close();
    expect(await queued).toBeInstanceOf(CryptoPoolClosedError);
    expect(await inFlight).toEqual({ ok: true, value: { spent: true } });
    await closing;
  });

  it("al cerrarse espera la tarea en curso, termina los workers y rechaza nuevas tareas", async () => {
    const p = createCryptoWorkerPool({ entry, size: 1, timeoutMs: 10_000 });
    const inFlight = p.run("busy", { ms: 200 });
    const closing = p.close();
    expect(await inFlight).toEqual({ ok: true, value: { spent: true } });
    await closing;
    expect(p.isRunning()).toBe(false);
    await expect(p.run("echo", { value: "x" })).rejects.toBeInstanceOf(CryptoPoolClosedError);
  });
});
