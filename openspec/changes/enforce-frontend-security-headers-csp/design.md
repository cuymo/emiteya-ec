# Design

## Context

La motivación está en `proposal.md` («Why») y los requisitos en `specs/web-security-policy/spec.md`.

### Estado observado (readiness del 2026-10-11)

Se midió sin cambiar el repositorio: un build de producción, `next start` local y Chrome headless
con las políticas candidatas inyectadas por un proxy de laboratorio. No hubo tráfico al SRI.

- **El frontend:** Next.js 16.3.8 con App Router, sin `proxy.ts` ni `middleware`.
  - `next.config.ts` solo fija `poweredByHeader: false` y reenvía `/api/*` al backend en el mismo
    origen (ADR 0016).
  - No envía ninguna cabecera de seguridad en los documentos.
- **El build:** 29 rutas estáticas (`○`, `s-maxage=31536000`) y 16 dinámicas (`ƒ`,
  `private, no-cache, no-store`).
- **Lo que emite cada documento:**
  - 13 a 18 scripts externos de `/_next/static` y una hoja CSS sin `url()` ni `@font-face`;
  - ningún elemento `<style>` ni atributo `style` en el HTML del servidor;
  - ningún origen externo;
  - tres scripts en línea:

    | Script | Contenido | ¿Admite un hash? |
    | --- | --- | --- |
    | El de next-themes (527 bytes) | Igual en todas las páginas | Sí |
    | El arranque `(self.__next_f=…).push([0])` | Igual en todas las páginas | Sí |
    | El payload RSC (`self.__next_f.push([1,…])`) | Distinto por página y por build | No |

- **En tiempo de ejecución:**
  - sonner 2.0.8 inserta un `<style>` (`__insertCSS`) y no admite nonce;
  - next-themes 0.4.6 sí acepta la prop `nonce`, y con `disableTransitionOnChange` también inserta
    un `<style>`.
- **El navegador de la aplicación:**
  - la API y Better Auth están en el mismo origen: `fetch` relativo a `/api/v1` y `/api/auth`, sin
    proveedores externos ni redirecciones a otros dominios;
  - el logo sale de `/api/v1/taxpayer/logo`;
  - las descargas usan una URL `blob:` con `<a download>`;
  - la impresión del RIDE carga una URL `blob:` en un `iframe` oculto.
- **Resultado de cada política en Chrome:**

  | Política | Ruta estática | Ruta dinámica |
  | --- | --- | --- |
  | Estática sin `'unsafe-inline'` | 3 scripts bloqueados, no hidrata | Igual |
  | Estática con `'unsafe-inline'` | 0 violaciones | 0 violaciones |
  | Nonce con `'strict-dynamic'` | 16 violaciones: el HTML del build no tiene nonce | 1 violación: el script de next-themes, sin nonce |
  | Nonce también en `style-src` | — | 4 violaciones más, por los `<style>` de tiempo de ejecución |

- **Latencia local** (`next start`, 30 peticiones): una ruta estática responde en p50 0,9 ms y una
  dinámica en p50 4,4 ms.

### Restricciones

- **Autoridad, decidida por el dueño:** Next.js es dueño de la CSP y de las cabeceras de semántica
  del navegador, y el proxy TLS es dueño de HSTS. El repositorio no tiene una configuración
  canónica del proxy: no hay Dockerfiles ni ficheros de Traefik, Nginx o Caddy.
- **API:** la API sigue con helmet (`backend.md`, paso 3). Sus respuestas no son documentos de la
  interfaz.
- **CI:** cada ejecución tarda unos 40 minutos de los 45 que permite `verify.yml`
  (`technical-debt.md`, «Duración de la CI»).

## Goals / Non-Goals

**Goals:**
- Una CSP aplicada en producción que impida ejecutar scripts no autorizados, sin `'unsafe-inline'`
  ni `'unsafe-eval'` en `script-src`.
- Una sola autoridad y un solo lugar de código para las cabeceras de los documentos.
- Pruebas automatizadas de las doce condiciones del dueño (tabla en D9), sobre el build de
  producción y en un navegador real.

**Non-Goals:**
- Quitar del todo `'unsafe-inline'` de los estilos cuando la medición lo exige. Se acota a lo medido
  y queda como deuda (D4).
- Trusted Types y los informes de violaciones a un endpoint (`report-to`). Son posibles mejoras
  posteriores.
- La corrección de la redacción de la verificación de los WSDL de Producción en
  `definition-of-done.md`. Va en un commit documental aparte, fuera de este cambio.
- Cabeceras de las respuestas de la API, de los recursos estáticos o de las rutas `/api` del propio
  Next.
- HSTS y cualquier configuración del proxy (D7).

## Decisions

### D1. CSP con nonce por petición desde `proxy.ts`

`frontend/src/proxy.ts` (la convención de Next 16; `middleware` está obsoleta) atiende cada
petición de documento:
1. genera el nonce según el contrato de abajo;
2. construye la política con el módulo puro de D3;
3. escribe la política en la petición, porque Next extrae de ahí el nonce y lo aplica a sus scripts;
4. escribe la política en la respuesta, que es lo que aplica el navegador.

`script-src` usa `'self' 'nonce-…' 'strict-dynamic'`. Así los scripts de Next, autorizados por el
nonce, pueden cargar sus chunks, y cualquier script sin nonce queda bloqueado.

**Contrato del nonce (revisión):**
- **Fuente y entropía:** `crypto.getRandomValues` sobre 16 bytes, es decir, 128 bits de una fuente
  criptográficamente segura. Nunca sale de `Math.random`, de un contador, de la hora ni de datos de
  la petición, el usuario o la sesión.
- **Codificación:** base64 estándar, válida en la sintaxis `nonce-<base64-value>` de la CSP.
- **Un solo uso:** se genera de forma independiente en cada petición de documento y nunca se
  reutiliza a propósito. No se guarda ni se escribe en los registros: `proxy.ts` no registra nada y
  Next no registra las cabeceras.
- **Aplicación coherente:** la misma respuesta lo lleva en su política, en los scripts que Next
  marca automáticamente y en el script de next-themes (D5). No hay otro script en línea autorizado.
- **Pruebas:** se verifica la estructura (longitud decodificada de al menos 16 bytes y alfabeto
  base64) y que dos documentos pedidos por separado reciben nonces distintos. No se hace ninguna
  prueba estadística de aleatoriedad.

**Alternativas evaluadas:**

| Opción | Protección de scripts | Rutas estáticas | Por qué no |
| --- | --- | --- | --- |
| Estática con `'unsafe-inline'` | Ninguna contra scripts en línea inyectados, el vector principal del XSS | Se conservan | Una CSP que no bloquea scripts inyectados no cumple el objetivo de H-02 |
| Hashes | Fuerte | Se conservan | El payload RSC cambia por página y por build: no hay hash estable que listar |
| SRI experimental (`experimental.sri`) | Solo los scripts externos | Se conservan | Los scripts en línea siguen necesitando `'unsafe-inline'` o un nonce, y es experimental |
| **Nonce por petición** | **Fuerte, con un valor nuevo por respuesta** | **Pasan a dinámicas** | **Elegida** |

### D2. Todas las páginas por petición

Un nonce no puede ir en un HTML generado en el build: la medición dio 16 violaciones y una página
rota. Por eso todas las páginas pasan a renderizarse por petición.

El layout raíz, un Server Component, lee el nonce con `headers()` para entregarlo al proveedor de
tema (D5). Esa lectura vuelve dinámico todo el árbol sin tocar cada página.

**Coste:** es aceptable para este producto.
- Es un back office autenticado, autoalojado, con una instancia y sin CDN.
- Las páginas son esqueletos que cargan sus datos en el cliente.
- La diferencia medida es de unos 3,5 ms por documento, y los recursos de `/_next/static` siguen
  inmutables y cacheables.

**Caché:** un nonce por petición y una caché compartida de HTML no se pueden combinar.
- Las respuestas dinámicas ya salen con `private, no-cache, no-store, max-age=0, must-revalidate`,
  como se observó en la readiness. Así una caché compartida no puede servir un documento con el nonce
  de otra respuesta.
- Los recursos de `/_next/static` conservan `public, max-age=31536000, immutable`.
- La comprobación del build verifica las dos cabeceras de caché en respuestas reales.
- `deployment.md` deja escrita la condición operativa: un proxy o CDN futuro no puede sustituir esa
  política ni guardar en una caché compartida los documentos con nonce.

**Verificación:** una prueba del build comprueba que no queda ninguna ruta de página prerenderada.

### D3. La política, en un módulo puro y probado

`frontend/src/lib/web-security-policy.ts` exporta la construcción de la política y de las demás
cabeceras a partir del nonce y del modo (producción o desarrollo), sin efectos. `proxy.ts` solo
la aplica. La política está escrita solo en ese módulo: la documentación lo referencia y no copia la
política completa.

| Directiva | Producción | Motivo |
| --- | --- | --- |
| `default-src` | `'self'` | Base restrictiva |
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | D1 |
| `script-src-attr` | `'none'` | No se conoce ningún manejador de eventos en atributos: React los asigna por propiedad y el código no usa `on…=` ni `innerHTML`. Se confirma en Chrome (D4). Si un flujo lo necesitara, se documenta la razón medida antes de relajarlo |
| `style-src` | `'self'`, como respaldo | D4 |
| `style-src-elem` | `'self' 'unsafe-inline'` si la medición lo exige | D4 |
| `style-src-attr` | `'none'` o `'unsafe-inline'`, según la medición | D4 |
| `img-src` | `'self'` | El logo es del mismo origen. No hay imágenes `data:` ni `blob:`; se añaden solo si la prueba de navegador demuestra que hacen falta |
| `font-src` | `'self'` | La CSS no carga fuentes; se mantiene restrictivo |
| `connect-src` | `'self'` | API y Better Auth en el mismo origen. En desarrollo, la recarga en caliente solo si lo exige (D10) |
| `frame-src` | `blob:` | La impresión del RIDE en un `iframe` con `blob:`; ningún marco del propio origen. `blob:` no se repite en ninguna otra directiva |
| `object-src` | `'none'` | Sin plugins |
| `base-uri` | `'self'` | Sin cambio de base |
| `form-action` | `'none'` | Los 13 formularios se envían con JavaScript (`onSubmit` con `preventDefault` o `handleSubmit`), sin acciones de servidor ni `action` nativa. `'none'` es el mínimo, y además impide que un envío nativo antes de la hidratación lleve credenciales en la dirección |
| `frame-ancestors` | `'none'` | Sin enmarcado; reemplaza a `X-Frame-Options` |

- **Sin `upgrade-insecure-requests`:** el transporte es del borde TLS (D7). Una instalación que
  todavía sirva HTTP en su red se rompería si el navegador reescribiera las peticiones.
- **Sin comodines** ni esquemas completos como origen.

### D4. Estilos en línea acotados a lo medido (excepción declarada)

**Restricción medida en la readiness:**
- sonner 2.0.8 inserta su hoja de estilos en tiempo de ejecución con un `<style>` sin nonce y no
  permite pasarle uno;
- next-themes, con `disableTransitionOnChange`, también inserta un `<style>`;
- con nonce en `style-src` aparecieron cuatro violaciones.

El HTML del servidor no emite estilos en línea. React asigna los `style` por la CSSOM, que la CSP no
bloquea, pero falta comprobar en Chrome si alguna pieza escribe el atributo `style`.

**Separación de CSP nivel 3 (decisión de la revisión).** No se colapsa todo en un `style-src
'unsafe-inline'` permanente. La tarea 1.1 mide en Chrome real, sobre el build de producción, estas
variantes, con un aviso visible, un diálogo, un menú y el cambio de tema:

| Variante | `style-src-elem` | `style-src-attr` |
| --- | --- | --- |
| A | `'self' 'nonce-…'` | `'none'` |
| B | `'self' 'unsafe-inline'` | `'none'` |
| C | `'self' 'unsafe-inline'` | `'unsafe-inline'` |

**Regla de decisión:**
- Se elige la primera variante sin violaciones.
- Si solo los elementos `<style>` exigen la excepción (B), los atributos quedan en `'none'`.
- Si se necesitan las dos (C), la excepción amplia se acepta en este cambio y queda registrada:
  `STYLE_INLINE_DEBT: OPEN`.
- `style-src 'self'` queda como respaldo para navegadores sin la separación.
- El resultado de la medición se registra en el ADR 0025 y en la deuda técnica.

**Alcance:** solo estilos. Los scripts siguen exigiendo nonce, y la excepción nunca alcanza
`script-src`, `script-src-elem` ni `script-src-attr`.

**Riesgo:** una inyección podría aplicar CSS. Pero no ejecuta código, y con `connect-src`,
`img-src` y `font-src` limitados al propio origen, la exfiltración por CSS queda muy acotada.

**Salida, como deuda en `technical-debt.md` mientras quede `'unsafe-inline'`:**
1. cargar la hoja de sonner como CSS estática del build y desactivar su inserción;
2. dar el nonce al `<style>` de next-themes o quitar `disableTransitionOnChange`;
3. pasar a `style-src-elem 'self' 'nonce-…'` y `style-src-attr 'none'`.

La deuda no bloquea completar H-02 en la capa de aplicación.

### D5. Nonce para el script de tema

`ThemeProvider` recibe `nonce` desde el layout raíz y lo pasa a `NextThemesProvider`. Es la única
violación que quedaba en una ruta dinámica (D2). El nonce viaja en el payload de esa misma respuesta
y cambia con cada una.

### D6. Cabeceras adicionales

Las escribe el mismo módulo, en cada documento:
- `Referrer-Policy: same-origin`. La interfaz no enlaza a otros sitios, así que ningún origen ajeno
  necesita la dirección.
- `X-Content-Type-Options: nosniff`.
- `Permissions-Policy`, que niega las capacidades que la interfaz no usa: cámara, micrófono,
  geolocalización, pago, USB, serie, HID, Bluetooth, sensores y captura de pantalla.
- `Cross-Origin-Opener-Policy: same-origin`, aprobada en la revisión. Aísla la ventana de otras
  pestañas y ventanas emergentes (pestañas engañosas, filtraciones entre sitios).
  - La interfaz no abre ventanas emergentes ni depende de `window.opener`, no hay un proveedor de
    identidad externo, Better Auth está en el mismo origen y la navegación es del mismo origen.
  - La comprobación de navegador recorre el inicio de sesión y la sesión, la navegación normal y la
    impresión del RIDE con la cabecera activa.
  - Si la implementación descubre una dependencia legítima de ventanas emergentes o de `opener`, se
    detiene y se informa. COOP no se relaja en silencio.

La `Permissions-Policy` se basa en lo que la interfaz usa de verdad. El código no usa cámara,
micrófono, geolocalización, pago, USB, serie, HID, Bluetooth, sensores ni captura de pantalla. No se
niegan capacidades que sí usa, como la impresión o las descargas, que además no son características
de esa cabecera.

**No se añaden:**
- `X-Frame-Options`, sustituida por `frame-ancestors`;
- `X-XSS-Protection`, obsoleta;
- `Cross-Origin-Embedder-Policy`, que no aporta sin aislamiento entre orígenes y podría bloquear
  recursos legítimos.

### D7. HSTS en el borde, diferido

La interfaz no envía `Strict-Transport-Security`: solo el proxy que termina TLS sabe si la conexión
fue HTTPS, y no hay una configuración canónica del proxy en el repositorio.

- **HSTS OWNER:** el proxy que termina TLS.
- **HSTS IMPLEMENTATION:** se difiere al hardening del despliegue y del proxy.

`deployment.md` indica al operador que configure HSTS en su proxy y que no añada otra CSP. H-02
queda completo en la capa de aplicación; la compuerta completa del go-live, con el borde TLS,
espera al cambio de despliegue.

### D8. `proxy.ts` solo en documentos

El `matcher` excluye:
- `/api/*`: la API con helmet y la ruta propia de descarga de la portabilidad;
- `/_next/static/*` y `/_next/image/*`;
- `favicon.ico`;
- las peticiones de prefetch (cabecera `next-router-prefetch` o `purpose: prefetch`).

Las respuestas de la API conservan sus cabeceras. `next.config.ts` no añade cabeceras: así no hay
una segunda autoridad.

### D9. Pruebas

La comprobación del build en Chrome real falla ante cualquier violación de CSP inesperada. No se
limita a comparar cadenas de cabeceras. Lo que el navegador no puede probar de forma exhaustiva se
complementa con pruebas unitarias de la política y de `proxy.ts`.

| # | Condición de la revisión | Prueba |
| --- | --- | --- |
| 1 | La cabecera CSP existe | Build: documentos públicos y autenticados |
| 2 | La CSP se aplica, no solo informa | Build: `Content-Security-Policy` sin `-Report-Only`, y el punto 6 se bloquea |
| 3 | Exactamente una CSP | Build: una sola cabecera y ninguna `meta http-equiv` en el HTML |
| 4 | Nonces distintos | Build: dos documentos pedidos por separado. Unitaria: estructura y no reutilización |
| 5 | Arranque e hidratación correctos | Chrome: la página se hidrata y responde, sin violaciones |
| 6 | Un script no autorizado no se ejecuta | Chrome: se inyecta un `<script>` en línea sin nonce, no cambia el estado de la página y aparece su violación |
| 7 | Sin `unsafe-inline` en `script-src` | Build y unitaria |
| 8 | Sin `unsafe-eval` en `script-src` en producción | Build y unitaria |
| 9 | `script-src-attr 'none'` | Build y unitaria. Chrome: un `onclick` inyectado en un atributo no se ejecuta |
| 10 | `frame-ancestors` impide el enmarcado | Chrome: una página de otro origen intenta un `iframe` y el navegador lo rechaza |
| 11 | `object-src 'none'` | Build y unitaria |
| 12 | `nosniff` | Build |
| 13 | `Referrer-Policy: same-origin` | Build |
| 14 | `Permissions-Policy` correcta | Build y unitaria |
| 15 | COOP no rompe la aplicación | Chrome: inicio de sesión, navegación e impresión del RIDE con la cabecera |
| 16 | `/api/v1` en el mismo origen funciona | Chrome: listas y detalle con datos reales del backend de prueba |
| 17 | El flujo de `/api/auth` funciona | Chrome: inicio de sesión, sesión y cierre de sesión |
| 18 | La impresión del RIDE con `blob:` funciona | Chrome: el `iframe` con `blob:` carga, sin violación de `frame-src` |
| 19 | Los recursos necesarios cargan | Chrome: JavaScript, CSS y el logo responden sin bloqueos |
| 20 | Ninguna violación inesperada | Chrome: cero eventos `securitypolicyviolation` y cero mensajes de CSP fuera de los provocados en los puntos 6 y 9 |
| 21 | Nada de desarrollo en producción | Build: la cabecera no tiene concesiones de desarrollo. Unitaria: el modo desarrollo sí las añade |
| 22 | HTML con nonce no cacheable en una caché compartida | Build: el documento declara caché privada sin `public` ni `s-maxage` |
| 23 | `/_next/static` sigue cacheable | Build: el recurso declara su caché pública, larga e inmutable |

También se prueban:
- que no queda ninguna página prerenderada;
- la ausencia de `Strict-Transport-Security`;
- que ningún nonce de las respuestas aparece en la salida de `next start`;
- que el envío nativo de un formulario se bloquea (`form-action 'none'`).

**Herramientas:**
- **Unitarias:** Vitest en entorno Node, para el módulo de D3 y para `proxy.ts` con un
  `NextRequest`.
- **Comprobación del build:** un script `check:web-security-policy` que corre después de
  `corepack pnpm build` en `verify`, como `check:xsd-artifact` y `check:ride-assets`.
  - Arranca el backend con el arnés `startE2eBackend` (base de pruebas, origen `localhost:3000`)
    y `next start` del build en ese origen.
  - Recorre los flujos en un Chrome real.
  - Recoge los eventos `securitypolicyviolation` y los mensajes de CSP de la consola.
  - Los documentos que necesitan un comprobante autorizado usan el SRI simulado de las pruebas
    end-to-end (`backend/test/support/simulated-sri.ts`, como `e2e-document-archive`), nunca el SRI
    real. `startE2eBackend` ya admite un puerto fijo para un frontend que reenvía `/api`.
- **Navegador:** `playwright-core` como dependencia de desarrollo, con versión exacta, que lanza el
  Chrome del sistema (`channel: "chrome"`). No descarga navegadores: el runner `ubuntu-24.04` trae
  Chrome, y en local se usa el instalado.
  - La alternativa sin dependencias, el protocolo DevTools a mano por WebSocket, exige más código
    propio y frágil.
  - La dependencia se registra en `stack.md` y en el ADR 0025, con su licencia (Apache-2.0) y la
    revisión de `hardening.md` («Dependencies And Supply Chain»).

### D10. Desarrollo

En `next dev`, la política añade a `script-src` solo `'unsafe-eval'`, y solo si las herramientas de
desarrollo de Next lo exigen (React lo usa para reconstruir las pilas de error). La conexión de
recarga en caliente va al mismo origen y la cubre `connect-src 'self'`. Si el servidor de desarrollo
demostrara otra necesidad, como un WebSocket, se añade solo en ese modo. La comprobación del build
demuestra que ninguna concesión llega a producción.

### D11. Documentación y ADR

- **ADR 0025:** la autoridad de las cabeceras, el nonce por petición con todas las páginas
  dinámicas y la dependencia de desarrollo del navegador.
- **`docs/security/hardening.md`:** la autoridad y el enlace al módulo, sin copiar la política.
- **`docs/architecture/deployment.md`:** el proxy no añade CSP, conserva las cabeceras de la
  aplicación y configura HSTS.
- **`docs/quality/technical-debt.md`:** la excepción de `style-src` (D4).
- **`docs/quality/manual-mvp-test-2026-10-09.md` y `definition-of-done.md`:** H-02 completo en la
  aplicación, con HSTS pendiente en el borde.
- **`docs/architecture/frontend.md`:** el renderizado por petición y el nonce.

## Risks / Trade-offs

- **[La CI está cerca de su límite, 40 de 45 minutos]** → La comprobación de navegador es
  determinista y acotada: un solo camino por flujo, con esperas por condiciones y no por tiempos
  fijos.
  - No se quita ni se debilita ninguna prueba de seguridad para caber en el límite.
  - No se sube el límite de forma preventiva. Primero se mide la duración real del job.
  - Si la comprobación lo deja demasiado cerca del límite o lo supera, se sube `timeout-minutes` a un
    valor basado en esa medida, con margen razonable, y se anota en la deuda «Duración de la CI».
- **[Una actualización de Next, sonner o next-themes cambia lo que se inserta en línea]** → La
  comprobación de navegador falla con la violación concreta antes de publicar. Es el propósito de
  la prueba.
- **[Rutas estáticas pasan a dinámicas]** → Coste medido y aceptado (D2). La verificación vuelve a
  medir la latencia de un documento con el mismo método (`next start` local, 30 peticiones, p50 y
  p95) y la registra en el ADR 0025.
- **[Una página nueva no hereda el nonce]** → El nonce se aplica en `proxy.ts` y el layout raíz, que
  cubren toda ruta de página. La prueba de que no queda ninguna página prerenderada detecta una
  regresión.
- **[`'unsafe-inline'` en estilos]** → Alcance, riesgo y salida en D4, con su entrada de deuda.
- **[Un proxy mal configurado añade otra CSP]** → `deployment.md` lo prohíbe explícitamente. La
  prueba de una sola CSP corre contra el servidor de la aplicación, y el operador comprueba su proxy
  con la misma cabecera.
- **[`Cross-Origin-Opener-Policy` rompe un flujo futuro con ventanas emergentes]** → Se documenta;
  un flujo así tendría que revisar la cabecera en su propio cambio.

## Migration Plan

1. Desplegar el frontend con `proxy.ts`. No hay migraciones ni cambios del backend.
2. En el despliegue real, el operador quita del proxy cualquier CSP o cabecera de seguridad
   duplicada y configura HSTS en el borde TLS, según `deployment.md`.
3. **Reversión:** volver a la versión anterior del frontend. Las rutas recuperan el renderizado
   estático y se van las cabeceras. No hay datos que migrar.

## Open Questions

- El valor exacto de `max-age` de HSTS y la inclusión de subdominios se deciden en el cambio de
  despliegue que configure el proxy. No afecta a este cambio.
