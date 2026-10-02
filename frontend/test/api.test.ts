import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api";

function mockFetch(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(body, { status, headers: { "content-type": "application/json" } }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("devuelve data tipada de un sobre de éxito, validada con el esquema", async () => {
    mockFetch(200, JSON.stringify({ data: { id: "1", name: "Ejemplo" } }));
    const data = await apiFetch("/examples/1", {
      schema: z.object({ id: z.string(), name: z.string() }),
    });
    expect(data).toEqual({ id: "1", name: "Ejemplo" });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/v1/examples/1");
  });

  it("lanza ApiError con code y requestId ante un sobre de error", async () => {
    mockFetch(
      404,
      JSON.stringify({
        error: {
          code: "ROUTE_NOT_FOUND",
          message: "La ruta solicitada no existe.",
          requestId: "r-123",
        },
      }),
    );
    const error = await apiFetch("/no-existe").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "ROUTE_NOT_FOUND",
      status: 404,
      requestId: "r-123",
      message: "La ruta solicitada no existe.",
    });
  });

  it("lanza un error genérico si la respuesta no es JSON", async () => {
    mockFetch(502, "<html>Bad gateway</html>");
    await expect(apiFetch("/algo")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    });
  });

  it("rechaza un sobre de éxito que no cumple el esquema", async () => {
    mockFetch(200, JSON.stringify({ data: { id: 1 } }));
    await expect(apiFetch("/x", { schema: z.object({ id: z.string() }) })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
