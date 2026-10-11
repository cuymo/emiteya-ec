# ADR 0025: CSP con nonce por petición y documentos renderizados por petición en el frontend

## Status

Accepted el 2026-10-11, en la revisión de `enforce-frontend-security-headers-csp`. Cierra H-02 en
la capa de aplicación (`../../quality/manual-mvp-test-2026-10-09.md`).

## Context

- Las páginas del frontend no enviaban Content Security Policy ni las cabeceras de seguridad
  estándar. La API ya las envía con helmet (`../backend.md`).
- Es una compuerta de seguridad del go-live (`../../quality/definition-of-done.md`).
- **Readiness del 2026-10-11:** build de producción, `next start` local y Chrome headless con las
  políticas candidatas, sin cambios en el repositorio y sin tráfico al SRI.
  - Next.js 16.3.8 con App Router; 29 rutas estáticas y 16 dinámicas.
  - Cada documento emite tres scripts en línea:
    - el de next-themes y el arranque `self.__next_f`, iguales en todas las páginas;
    - el payload RSC, distinto por página y por build.
  - Ningún estilo en línea en el HTML del servidor y ningún origen externo.
  - En tiempo de ejecución, sonner inserta un `<style>` sin nonce. next-themes acepta un nonce.

| Opción | Resultado medido en Chrome | Decisión |
| --- | --- | --- |
| CSP estática sin `'unsafe-inline'` | Los 3 scripts en línea se bloquean y la aplicación no hidrata | Descartada |
| CSP estática con `'unsafe-inline'` | 0 violaciones, pero ninguna protección contra un script en línea inyectado | Descartada: no cumple el objetivo de H-02 |
| Hashes | El payload RSC cambia por página y por build: no hay hash estable | Descartada |
| SRI experimental | Solo cubre scripts externos; los en línea siguen necesitando `'unsafe-inline'` o un nonce | Descartada |
| **Nonce por petición con `'strict-dynamic'`** | En una ruta dinámica, una sola violación: el script de tema sin nonce, que se resuelve con su prop | **Elegida** |

## Decision

- **Autoridad única:**
  - Next.js escribe la CSP y las cabeceras de semántica del navegador en cada documento, desde
    `frontend/src/proxy.ts`.
  - La política está escrita solo en `frontend/src/lib/web-security-policy.ts`.
  - `next.config.ts` no añade cabeceras, y el proxy inverso no añade otra CSP.
  - HSTS pertenece al proxy que termina TLS y queda diferido al hardening del despliegue: el
    repositorio no tiene una configuración canónica del proxy.
- **Nonce:**
  - 16 bytes de `crypto.getRandomValues` (128 bits) en base64, generado de forma independiente para
    cada documento;
  - no se deriva de la petición, del usuario ni de la sesión, ni se guarda ni se registra;
  - va en la política de la petición (de donde Next lo extrae para sus scripts) y de la respuesta,
    y en el script de next-themes.
- **Documentos por petición:**
  - el layout raíz lee el nonce con `headers()`, lo que vuelve dinámico todo el árbol;
  - ninguna página queda prerenderada;
  - los documentos salen con caché privada y sin almacenamiento compartido, de modo que ninguna caché
    reutiliza un nonce;
  - los recursos de `/_next/static` conservan su caché pública e inmutable.
- **Scripts:** `script-src` con el nonce y `'strict-dynamic'`, sin `'unsafe-inline'` ni
  `'unsafe-eval'` en producción, y `script-src-attr 'none'`.
- **Estilos en línea:** se acotan a la directiva que la medición en Chrome exige (design D4 del
  cambio), como excepción declarada en `../../quality/technical-debt.md`.

- **Comprobación en un navegador real:** `playwright-core` 1.64.0 como dependencia de desarrollo de
  la raíz, con versión exacta.
  - Es de Microsoft (`microsoft/playwright`), con licencia Apache-2.0 y sin dependencias
    transitivas, publicado el 2026-10-07. No aporta avisos a `pnpm audit`.
  - Lanza el Chrome del sistema (`channel: "chrome"`) y no descarga navegadores: el runner de la CI
    trae Chrome.
  - La alternativa sin dependencias, el protocolo DevTools a mano por WebSocket, exigía más código
    propio y frágil.

## Consequences

- **Rendimiento.** Las 29 rutas estáticas pasan a renderizarse por petición. En la readiness, una
  ruta estática respondía en p50 0,9 ms y una dinámica en p50 4,4 ms, en local. Es aceptable para un
  back office autenticado, autoalojado, con una instancia y sin CDN.
- **CDN.** Un CDN o proxy futuro no puede guardar los documentos en una caché compartida
  (`../deployment.md`).
- **Dependencias.** Una actualización de Next.js, sonner o next-themes que cambie lo que se inserta
  en línea aparece como violación en la comprobación de navegador antes de publicar.
- **Ventanas emergentes.** Un flujo futuro con ventanas emergentes o `window.opener` tendría que
  revisar `Cross-Origin-Opener-Policy: same-origin` en su propio cambio.
