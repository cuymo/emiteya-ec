# Proposal

## Why

Las páginas del frontend no envían Content Security Policy ni las cabeceras de seguridad
estándar. Lo encontró la prueba manual del MVP (H-02 de `docs/quality/manual-mvp-test-2026-10-09.md`)
y es una compuerta de seguridad del go-live (`docs/quality/definition-of-done.md`, Go-Live v1.0).
`docs/security/hardening.md` pide una CSP y las cabeceras estándar.

Sin ellas, el navegador del operador queda con menos defensas:
- un script inyectado por un fallo de codificación se ejecutaría sin restricción;
- la aplicación podría mostrarse dentro de un marco ajeno (clickjacking);
- el navegador podría reinterpretar el tipo de un contenido.

La API ya envía sus cabeceras con helmet; solo faltan las páginas que sirve Next.js.

## What Changes

- **Política de seguridad del navegador en las páginas del frontend.** Cada documento HTML que
  sirve Next.js lleva:
  - una CSP aplicada, no solo informativa;
  - `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`,
    `Cross-Origin-Opener-Policy: same-origin` y una `Permissions-Policy` basada en lo que la
    interfaz usa;
  - la prohibición de mostrarse en un marco, con `frame-ancestors 'none'`.
- **Una sola autoridad.** Next.js es el único dueño de esas cabeceras. El proxy inverso no configura
  otra CSP. HSTS pertenece al proxy que termina TLS. Este cambio documenta esa división, pero no
  configura HSTS, porque el repositorio no tiene una configuración canónica del proxy.
- **Scripts solo con autorización por petición.** En producción la CSP no admite `'unsafe-inline'`
  ni `'unsafe-eval'` para scripts, ni manejadores de eventos en atributos (`script-src-attr 'none'`).
  - Cada documento lleva un nonce criptográfico nuevo, de al menos 128 bits, que no se guarda ni se
    registra. Solo los scripts del propio frontend lo reciben.
  - Por eso todas las páginas pasan a renderizarse por petición; hoy 29 rutas son estáticas.
  - Es un cambio deliberado: un nonce no puede ir en una página generada en el build.
- **Documentos fuera de las cachés compartidas.** Los documentos con nonce declaran una caché
  privada. Los recursos estáticos del build conservan su caché pública e inmutable.
- **Formularios solo por la aplicación.** `form-action 'none'`: la interfaz envía todos sus
  formularios con JavaScript.
- **Estilos con una excepción acotada.** Una dependencia de la interfaz inserta sus estilos en
  tiempo de ejecución sin admitir nonce.
  - La excepción se limita, con la separación de CSP nivel 3 medida en Chrome, a la directiva de
    estilo que de verdad la necesita.
  - Mientras quede, se registra como deuda, con su riesgo y su salida.
- **El navegador sigue funcionando igual:** inicio y cierre de sesión, la sesión, la API en el mismo
  origen, el logo, las descargas y la impresión del RIDE.
- **Desarrollo y producción separados.** Las concesiones que necesita `next dev` existen solo en
  desarrollo, y las pruebas demuestran que no llegan a producción.

**Fuera de alcance:**
- la validación del `Origin` en `/api/v1` (H-03), los límites de cuerpo y el de Better Auth, y los
  límites de frecuencia;
- el escaneo de dependencias y de secretos;
- Dockerfiles, imágenes y la configuración del proxy, incluido HSTS y el tiempo de espera de la
  portabilidad;
- respaldo y restauración, rotación de la clave maestra, métricas, deriva del reloj y
  `DATA_EXPORT_DIRECTORY`;
- archivos de gobernanza del repositorio;
- las cabeceras de la API, que ya envía helmet y no cambian;
- la corrección de la redacción de la verificación de los WSDL de Producción en
  `definition-of-done.md`, que va en un commit documental aparte;
- cualquier cambio fiscal: transmisión, SOAP, firma, XSD, XML, numeración, certificados, catálogos
  y evidencia de la certificación.

## Capabilities

### New Capabilities
- `web-security-policy`: la política de seguridad que el navegador aplica a la interfaz web. Cubre
  la CSP aplicada y su única autoridad, las cabeceras de seguridad del documento, la prohibición de
  enmarcado y la compatibilidad con los flujos legítimos del navegador. Separa también lo de
  desarrollo de lo de producción, y deja HSTS al borde TLS.

### Modified Capabilities
<!-- Ninguna: `user-access` no cambia sus requisitos; el inicio de sesión debe seguir funcionando igual. -->

## Impact

- **Frontend:**
  - un `proxy.ts` de Next.js 16 que genera el nonce y escribe las cabeceras;
  - el layout raíz lee el nonce para el script de tema y se vuelve dinámico;
  - las 29 rutas estáticas pasan a dinámicas, y su respuesta deja de ser cacheable por un CDN;
  - `next.config.ts` no lleva cabeceras propias.
- **Rendimiento:** medido en local, una ruta estática responde en unos 0,9 ms (p50) y una dinámica en
  unos 4,4 ms. Es aceptable para un back office autenticado con pocos usuarios y sin CDN, y se vuelve
  a medir en la verificación.
- **Pruebas:**
  - unitarias de la política y de su construcción;
  - pruebas sobre el build de producción que comprueban las cabeceras y las violaciones de CSP en
    un navegador real.

  Pueden requerir una dependencia de desarrollo para el navegador, que se decide en el design.
- **Documentación:**
  - `docs/security/hardening.md`, con la autoridad de las cabeceras;
  - `docs/architecture/deployment.md`, con lo que el proxy no debe duplicar y la división de HSTS;
  - `docs/quality/technical-debt.md`, con la excepción de `style-src`;
  - `docs/quality/manual-mvp-test-2026-10-09.md`, para cerrar H-02 en su parte de aplicación.
- **Sin cambios** en el backend, el contrato de la API, la base de datos ni ningún flujo fiscal.
  Ninguna prueba contacta el SRI, ni Pruebas ni Producción.
