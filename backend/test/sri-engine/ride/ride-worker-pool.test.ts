// Pool del RIDE (add-document-archive, design D6 y D15): el render ocurre en un worker, con cola,
// plazo y reemplazo propios, y el hilo principal sigue atendiendo HTTP mientras se dibujan varios
// RIDE a la vez. En el hilo, un render bloquea el event loop entre 100 y 220 ms (spike S-4).
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import {
  RideRenderUnavailableError,
  type RideRenderOutcome,
} from "../../../src/modules/sri-engine/application/ride.ts";
import {
  createPooledRideRenderer,
  rideTasksEntry,
} from "../../../src/modules/sri-engine/infrastructure/ride/pooled-ride-renderer.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createInProcessRideRenderer } from "../../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import {
  createRideWorkerPool,
  type RideWorkerPool,
} from "../../../src/platform/workers/ride-worker-pool.ts";
import {
  INVOICE_CASES,
  authorizedInvoice,
  type AuthorizedInvoice,
} from "../../support/ride-invoices.ts";

const p12Dir = inject("p12FixturesDir");
const pools: RideWorkerPool[] = [];
const scratch = mkdtempSync(join(tmpdir(), "facturador-ride-pool-"));
let multiPage: AuthorizedInvoice;
let oneLine: AuthorizedInvoice;
let glyphless: AuthorizedInvoice;

const pool = (options: Partial<Parameters<typeof createRideWorkerPool>[0]> = {}) => {
  const created = createRideWorkerPool({
    entry: rideTasksEntry(),
    size: 2,
    maxQueue: 4,
    timeoutMs: 30_000,
    fontsDirectory: defaultRideFontsDirectory(),
    ...options,
  });
  pools.push(created);
  return created;
};
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** El hueco más largo entre dos turnos de un temporizador mientras corre `work`, en ms. */
async function longestStall(work: () => Promise<unknown>) {
  let longest = 0;
  let last = performance.now();
  const sampler = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 1);
  try {
    await work();
    await new Promise((resolve) => setTimeout(resolve, 5)); // el último hueco se registra
  } finally {
    clearInterval(sampler);
  }
  return longest;
}
const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) =>
      error instanceof RideRenderUnavailableError ? error.reason : String(error),
  );

beforeAll(async () => {
  multiPage = await authorizedInvoice(INVOICE_CASES.multiPage, p12Dir);
  oneLine = await authorizedInvoice(INVOICE_CASES.oneLine, p12Dir);
  glyphless = await authorizedInvoice(
    {
      ...INVOICE_CASES.oneLine,
      name: "sin-glifo",
      sequential: "000000902",
      buyer: { ...INVOICE_CASES.complete.buyer, legalName: "EMPRESA 漢字" },
    },
    p12Dir,
  );
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((p) => p.close()));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("pool del RIDE", () => {
  it("dibuja en un worker los mismos bytes que en el hilo, con sus versiones", async () => {
    const renderer = createPooledRideRenderer(pool());
    const pooled = await renderer.render(oneLine.input);
    const assets = loadRideAssets(defaultRideFontsDirectory());
    if (!assets.ok) throw new Error("fuentes");
    const inProcess = await createInProcessRideRenderer(assets.fonts).render(oneLine.input);
    expect(pooled.status).toBe("RENDERED");
    if (pooled.status !== "RENDERED" || inProcess.status !== "RENDERED") return;
    expect(sha256(pooled.pdf)).toBe(sha256(inProcess.pdf));
    expect(pooled.versions).toEqual(inProcess.versions);
  });

  it("un rechazo determinista llega como código con su detalle", async () => {
    expect(await createPooledRideRenderer(pool()).render(glyphless.input)).toEqual({
      status: "REJECTED",
      code: "RIDE_GLYPH_MISSING",
      detail: ["U+6F22", "U+5B57"],
    } satisfies RideRenderOutcome);
  });

  it("sin las fuentes íntegras, cada render responde RIDE_FONTS_UNAVAILABLE", async () => {
    const broken = join(scratch, "fonts");
    cpSync(defaultRideFontsDirectory(), broken, { recursive: true });
    rmSync(join(broken, "NotoSans-Bold.ttf"));
    const renderer = createPooledRideRenderer(pool({ fontsDirectory: broken, size: 1 }));
    expect(await renderer.render(oneLine.input)).toEqual({
      status: "REJECTED",
      code: "RIDE_FONTS_UNAVAILABLE",
      detail: ["NotoSans-Bold.ttf"],
    });
  });

  it("con la cola llena responde ocupado sin dibujar", async () => {
    const renderer = createPooledRideRenderer(pool({ size: 1, maxQueue: 1 }));
    const running = [renderer.render(multiPage.input), renderer.render(multiPage.input)];
    expect(await reasonOf(renderer.render(oneLine.input))).toBe("BUSY");
    for (const outcome of await Promise.all(running)) expect(outcome.status).toBe("RENDERED");
  });

  it("un plazo vencido falla el render, reemplaza el worker y el pool sigue", async () => {
    const renderer = createPooledRideRenderer(pool({ size: 1, timeoutMs: 1 }));
    expect(await reasonOf(renderer.render(multiPage.input))).toBe("TIMEOUT");
    const healthy = pool({ size: 1 });
    expect((await createPooledRideRenderer(healthy).render(oneLine.input)).status).toBe("RENDERED");
  });

  it("cerrado, responde que no está disponible", async () => {
    const closed = pool();
    await closed.close();
    expect(await reasonOf(createPooledRideRenderer(closed).render(oneLine.input))).toBe("CLOSED");
  });

  it("el hilo principal atiende HTTP mientras se dibujan varios RIDE a la vez", async () => {
    // Referencia en esta misma máquina: un solo render en el hilo no cede el event loop.
    const assets = loadRideAssets(defaultRideFontsDirectory());
    if (!assets.ok) throw new Error("fuentes");
    const inThread = createInProcessRideRenderer(assets.fonts);
    await inThread.render(multiPage.input); // calentamiento
    const blockedMs = await longestStall(() => inThread.render(multiPage.input));

    const renderer = createPooledRideRenderer(pool({ size: 2, maxQueue: 8 }));
    await renderer.render(oneLine.input); // calentamiento de los workers
    const server: Server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      let served = 0;
      let outcomes: RideRenderOutcome[] = [];
      const pooledMs = await longestStall(async () => {
        const renders = Promise.all(
          Array.from({ length: 6 }, () => renderer.render(multiPage.input)),
        );
        let rendering = true;
        void renders.finally(() => (rendering = false));
        while (rendering) {
          const response = await fetch(`http://127.0.0.1:${port}/`);
          expect(await response.text()).toBe("ok");
          served++;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        outcomes = await renders;
      });
      expect(outcomes.every((outcome) => outcome.status === "RENDERED")).toBe(true);
      expect(served).toBeGreaterThan(5);
      // Con seis renders en el pool, el hilo queda libre: su bloqueo más largo es muy inferior al de
      // un solo render en el hilo. El umbral es relativo a la máquina (un runner de CI con dos
      // núcleos es más lento que un equipo de desarrollo), nunca una cifra fija.
      expect(pooledMs).toBeLessThan(blockedMs / 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
