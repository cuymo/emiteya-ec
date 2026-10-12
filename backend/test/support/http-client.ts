// Cliente HTTP de las pruebas en proceso (enforce-api-origin-and-body-limits, design D9). Envía el
// origen canónico en las mutaciones, como el navegador; la aplicación recibe cada petición como en
// producción, sin envoltorios ni cabeceras de prueba.
import supertest from "supertest";

/** El origen canónico con que las pruebas arman la aplicación. */
export const TEST_ORIGIN = "http://localhost:3000";

type App = Parameters<typeof supertest>[0];
type Client = ReturnType<typeof supertest>;

const MUTATIONS = ["post", "put", "patch", "delete", "del"] as const;

/**
 * `supertest(app)` con `Origin: TEST_ORIGIN` en `post`, `put`, `patch` y `delete`. Las pruebas
 * negativas lo omiten con `{ origin: null }` o lo sustituyen con `.set("Origin", …)`.
 */
function request(app: App, options: { origin?: string | null } = {}): Client {
  const client = supertest(app);
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
  if (origin === null) return client;
  for (const method of MUTATIONS) {
    const send = client[method].bind(client);
    client[method] = (url: string) => send(url).set("Origin", origin);
  }
  return client;
}

// Los tipos de supertest bajo el mismo nombre, para que cambiar la importación baste.
// eslint-disable-next-line @typescript-eslint/no-namespace -- espacio de nombres solo de tipos
declare namespace request {
  type Response = supertest.Response;
  type Test = supertest.Test;
}

export default request;
