// La ruta de la descarga aborta la verificación cuando el cliente se desconecta antes del primer
// byte (add-data-portability, design D16): el servicio recibe la señal abortada y no hay respuesta.
import { get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadAbortedError } from "../../src/modules/data-portability/application/errors.ts";
import type { DataExports } from "../../src/modules/data-portability/application/service.ts";
import { dataPortabilityRouter } from "../../src/modules/data-portability/infrastructure/http/data-portability-router.ts";

describe("ruta de la descarga ante una desconexión", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
  });

  it("aborta la verificación en curso cuando el cliente se va", async () => {
    let received: AbortSignal | undefined;
    let release: () => void = () => {};
    const download = vi.fn(async (_ctx: unknown, _params: unknown, signal?: AbortSignal) => {
      received = signal;
      // La verificación dura hasta que la señal se aborta.
      await new Promise<void>((resolve) => {
        release = resolve;
        signal?.addEventListener("abort", () => resolve());
      });
      throw new DownloadAbortedError();
    });
    const app = express()
      .use((_req, res, next) => {
        res.locals.context = {
          userId: "u1",
          companyId: "c1",
          role: "ADMIN",
          requestId: "req-1",
        };
        next();
      })
      .use(dataPortabilityRouter({ download } as unknown as DataExports));
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const client = get(`http://127.0.0.1:${port}/data-exports/e1/download`);
    client.on("error", () => {});
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    expect(received?.aborted).toBe(false);
    client.destroy();
    await vi.waitFor(() => expect(received?.aborted).toBe(true));
    release();
  });
});
