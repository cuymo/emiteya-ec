// Protección de las peticiones con main.ts real (enforce-api-origin-and-body-limits, tarea 2.3): fuera
// de NODE_ENV=test, la defensa propia de Better Auth sigue activa, el cuerpo de /api/auth está acotado
// y /api/v1 toma el origen canónico de BETTER_AUTH_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@proteccion.ec", password: "contrasena-e2e-proteccion-1" };

describe("protección de las peticiones con el backend real", () => {
  let backend: E2eBackend;

  const signIn = (headers: Record<string, string>, body: string) =>
    fetch(`${backend.base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  beforeAll(async () => {
    backend = await startE2eBackend({ label: "request_protection", admin: ADMIN });
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
  });

  it("un inicio de sesión desde un origen ajeno sigue recibiendo el 403 de Better Auth", async () => {
    const res = await signIn(
      { origin: "https://atacante.ejemplo", "sec-fetch-site": "cross-site" },
      JSON.stringify(ADMIN),
    );
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
    // Control: desde el origen canónico, las mismas credenciales entran.
    expect((await backend.signIn(ADMIN.email, ADMIN.password)).status).toBe(200);
  });

  it("un inicio de sesión de más de 8192 bytes recibe 413", async () => {
    const res = await signIn({ origin: E2E_ORIGIN }, JSON.stringify(ADMIN) + " ".repeat(9000));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("en desarrollo, una mutación de /api/v1 sin Origin recibe 403 y con el origen canónico sigue", async () => {
    const { cookie } = await backend.signIn(ADMIN.email, ADMIN.password);
    const res = await fetch(`${backend.base}/api/v1/parties`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "REQUEST_ORIGIN_REJECTED" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const accepted = await backend.fetchApi("POST", "/parties", cookie, {});
    expect(accepted.status).toBe(400);
  });
});
