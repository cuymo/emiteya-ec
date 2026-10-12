# Proposal

## Why

`/api/v1` no valida por sí misma el origen de una petición. La prueba manual del MVP lo registró
(H-03 de `docs/quality/manual-mvp-test-2026-10-09.md`) como defensa en profundidad pendiente del
go-live (`docs/quality/definition-of-done.md`). La revisión de readiness del 2026-10-12 precisó el
riesgo, sin exagerarlo. Este cambio endurece la defensa; no corrige una vulnerabilidad explotable
desde otro sitio.

**Modelo de amenazas, con la evidencia del código:**
- **Sesión por cookie.** `/api/v1` se autentica solo con la cookie de sesión de Better Auth, con
  `SameSite=Lax`. No hay tokens ni claves de API.
- **`SameSite=Lax` ayuda, pero no basta ante un origen del mismo sitio.** Un subdominio hermano u
  otro puerto del mismo host recibe la cookie.
- **Ocho `POST` se pueden enviar sin preflight.** No llevan cuerpo ni una cabecera propia:
  - `signing-attempts` de los seis comprobantes;
  - `print-requests`;
  - `ride-attempts`.

  Un navegador puede enviarlos desde otro origen como petición simple. El resto de mutaciones exige
  JSON, `PUT`/`DELETE` o `Idempotency-Key`, y eso dispara un preflight que falla porque no hay CORS.
- **No hay clientes legítimos fuera del navegador.** Las pruebas end-to-end, los benchmarks y la
  comprobación de navegador ya envían `Origin`.
- **Frontend y API comparten origen.** El navegador llama a `/api` en el origen del frontend, y
  Next.js lo reenvía al backend.
- **Las cabeceras reenviadas no son fuente de confianza.** `Host`, `X-Forwarded-Host`, `Forwarded`
  y `X-Forwarded-Proto` llegan del cliente o del reenvío.
- **Algunos `GET` tienen efectos costosos o auditados.** La exportación de reportes genera un XLSX
  y registra la exportación. Una navegación de nivel superior desde otro sitio lleva la cookie
  `Lax`.
- **Better Auth ya defiende `/api/auth`.** En producción valida `Origin` (o `Referer`) contra
  `BETTER_AUTH_URL` cuando hay cookie, y usa Fetch Metadata en el primer inicio de sesión.
- **Pero Better Auth no limita el cuerpo.** Su adaptador de Node lee el cuerpo completo, y el límite
  de Express no lo alcanza porque Better Auth se monta antes del parser.

## What Changes

- **Origen obligatorio en las mutaciones de `/api/v1`.** `POST`, `PUT`, `PATCH` y `DELETE` exigen
  un `Origin` exactamente igual al origen canónico de la aplicación. Un origen ausente, `null`,
  malformado o distinto en esquema, host o puerto recibe un 403 con el sobre de error genérico,
  sin revelar el origen esperado. El rechazo ocurre antes de leer el cuerpo y de autenticar.
- **Un solo origen canónico.** Sale de `BETTER_AUTH_URL`, normalizado como `scheme://host[:port]`.
  Nunca se toma de las cabeceras reenviadas, no hay comodines ni lista adicional, y no se puede
  desactivar. Un origen canónico inutilizable impide arrancar.
- **Fetch Metadata como defensa adicional en `/api/v1`.** Cuando la petición trae
  `Sec-Fetch-Site`:
  - `same-origin` y `none` siguen;
  - `same-site` y `cross-site` reciben un 403, en todos los métodos salvo `OPTIONS`, incluidos
    `GET` y `HEAD`.

  Sin la cabecera, no se rechaza solo por eso. No reemplaza la regla del origen.
- **Sin cambios de CORS ni de `OPTIONS`.** No se añaden cabeceras `Access-Control-Allow-*`, y
  `OPTIONS` responde como hoy.
- **Cuerpo de Better Auth acotado.** Las peticiones a `/api/auth/*` admiten como máximo 8192 bytes
  de cuerpo recibido. El límite se cuenta sobre el flujo real, sin depender de `Content-Length` ni
  del modo `chunked`. Al superarlo, la respuesta es un 413 genérico.
- **Cuerpo de Better Auth solo en JSON.** Un cuerpo no vacío en `/api/auth/*` tiene que ser
  `application/json` (se admite un parámetro como `charset`); cualquier otro tipo recibe un 415.
  Un cuerpo vacío no exige `Content-Type`. Better Auth conserva sus controles de origen y CSRF, y
  este cambio no los duplica.
- **Límites de `/api/v1` sin cambios.** Sigue el límite general de 100 KiB para JSON, y cada
  capacidad conserva los límites propios que ya especifica.
- **Observabilidad segura.** El rechazo por origen o por Fetch Metadata emite un evento de
  seguridad y un contador de baja cardinalidad. Ningún rechazo registra cuerpos, cookies,
  contraseñas ni cabeceras completas, y tampoco crea auditoría de dominio.
- **Pruebas como los clientes reales.** Un cliente de pruebas compartido envía el origen canónico
  por defecto en las mutaciones, y las pruebas negativas lo omiten o lo sustituyen al construir la
  petición. La aplicación recibe cada petición como en producción, sin envoltorios ni cabeceras de
  prueba.

**Fuera de alcance:**
- CORS, tokens de API y cualquier cliente fuera del navegador.
- Orígenes adicionales y comodines.
- Cambiar la semántica de los `GET` con efectos: se protegen, pero el modelo HTTP queda como deuda.
- La configuración del proxy: el techo de cuerpo de 8 MiB y HSTS quedan para el hardening del
  despliegue.
- Los límites de frecuencia, salvo los que ya existen.
- Los controles de CSRF de Better Auth, que no se tocan.
- Cualquier cambio fiscal: XML, firma, XSD, transmisión, reconciliación, numeración, certificados,
  catálogos y evidencia de la certificación.

## Capabilities

### New Capabilities
- `api-request-protection`: la protección de las peticiones HTTP antes de la lógica de dominio.
  Cubre el origen canónico de las mutaciones de `/api/v1` y su rechazo, Fetch Metadata como defensa
  adicional, la ausencia de exposición entre orígenes (CORS y `OPTIONS`), el límite general de
  cuerpo de la API y su rechazo previo al dominio, el límite y el tipo de contenido del cuerpo de
  `/api/auth`, la semántica de los rechazos, su observabilidad y la desconfianza hacia las cabeceras
  reenviadas.

### Modified Capabilities
<!-- Ninguna: user-access, purchase-settlements y shipping-guides no cambian sus requisitos; sus
límites de cuerpo propios y sus flujos de autenticación siguen igual. -->

## Impact

- **Backend:**
  - una guarda de origen y de Fetch Metadata en `/api/v1`, montada antes del parser JSON y de
    `requireContext`;
  - un adaptador acotado para Better Auth en `/api/auth/*`, en lugar de `toNodeHandler`;
  - el origen canónico derivado al arrancar;
  - un tipo nuevo de evento de seguridad con su contador.
- **Contratos y OpenAPI:** la descripción compartida del 403 incluye el rechazo por origen; la
  documentación generada se regenera.
- **Pruebas:**
  - un cliente HTTP de pruebas compartido envía el origen canónico por defecto en las mutaciones;
  - pruebas unitarias, de integración y end-to-end de la matriz;
  - `check:web-security-policy` añade un `POST` sin cuerpo desde un origen ajeno y desde un sitio
    hermano.
- **Documentación:**
  - `docs/security/hardening.md` y `docs/architecture/backend.md`: la frontera de confianza y el
    orden de los middleware;
  - `docs/architecture/authentication.md`: el límite y el tipo de contenido de `/api/auth`;
  - `docs/architecture/deployment.md`: que `BETTER_AUTH_URL` sea el origen público y el requisito
    del techo del proxy;
  - `docs/quality/observability.md`, `docs/quality/testing.md` y `docs/quality/technical-debt.md`
    (los `GET` con efectos y el ejemplo de 1 MiB del proxy, que no alcanza);
  - H-03 en `manual-mvp-test-2026-10-09.md` y en `definition-of-done.md`.
- **Sin cambios** de base de datos, migraciones ni flujos fiscales. Ninguna prueba contacta el SRI.
