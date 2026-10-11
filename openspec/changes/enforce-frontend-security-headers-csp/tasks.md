# Tasks

## 1. La política como módulo puro

- [x] 1.1 Crear `frontend/src/lib/web-security-policy.ts`, sin efectos.
  - Genera el nonce con `crypto.getRandomValues` sobre 16 bytes, codificado en base64, y valida su
    estructura (design D1, contrato del nonce).
  - Construye la `Content-Security-Policy` a partir del nonce y del modo, con las directivas de D3:
    `script-src-attr 'none'`, `form-action 'none'` y `blob:` solo en `frame-src`.
  - Los estilos empiezan en la variante C de D4; la tarea 3.3 los acota según la medición.
  - Construye las cabeceras de D6: `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`,
    `Permissions-Policy` y `Cross-Origin-Opener-Policy: same-origin`.
  - En desarrollo, solo añade lo que exija D10.
  - No produce `Strict-Transport-Security` (D7).

  Verificar con `frontend/test/web-security-policy.test.ts`, en entorno Node:
  - el nonce generado decodifica a 16 bytes con alfabeto base64, y dos llamadas no lo repiten. Es una
    prueba de estructura, no estadística;
  - un nonce vacío, corto o con caracteres fuera de base64 se rechaza;
  - producción tiene `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
    `frame-ancestors 'none'`, `script-src-attr 'none'` y `frame-src blob:`;
  - `script-src` lleva el nonce y `'strict-dynamic'`, sin `'unsafe-inline'` ni `'unsafe-eval'`;
  - `'unsafe-inline'` no aparece en ninguna directiva de scripts;
  - ninguna directiva tiene `*`, `https:` ni `http:` como origen, y `blob:` solo está en
    `frame-src`;
  - el modo desarrollo añade solo sus concesiones y conserva `object-src`, `base-uri`,
    `script-src-attr` y `frame-ancestors`;
  - las cuatro cabeceras de D6 con sus valores, y ninguna `Strict-Transport-Security`.

## 2. Aplicación en Next.js y renderizado por petición

- [x] 2.1 Leer `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` y
  `01-app/02-guides/content-security-policy.md` de la versión instalada (`frontend/AGENTS.md`).
  Crear `frontend/src/proxy.ts` (D1, D8):
  1. genera un nonce por petición de documento con el módulo de 1.1;
  2. escribe la política en la petición y en la respuesta, más las cabeceras de D6;
  3. lleva un `matcher` que excluye `/api`, `/_next/static`, `/_next/image`, `favicon.ico` y los
     prefetch;
  4. no registra nada.

  Verificar con `frontend/test/proxy.test.ts`, usando un `NextRequest`:
  - dos peticiones dan nonces distintos con estructura válida;
  - la misma política, con el mismo nonce, va en la petición y en la respuesta;
  - las cabeceras de D6 están presentes y `Strict-Transport-Security` no;
  - el `matcher` no cubre `/api/v1/...` ni `/_next/static/...`.
- [x] 2.2 Leer el nonce en `frontend/src/app/layout.tsx` con `headers()` y pasarlo a
  `frontend/src/components/theme-provider.tsx`, que lo entrega a `NextThemesProvider` (D5).
  `next.config.ts` sigue sin `headers()` propios (D8). Verificar:
  - las pruebas del proveedor de tema y de la sesión siguen en verde;
  - `corepack pnpm --filter @facturador/frontend build` no deja ninguna ruta de página `○`;
  - `typecheck` y `lint` están en verde.
- [x] 2.3 Escribir `docs/architecture/adr/0025-...md`: la autoridad de las cabeceras, el nonce por
  petición con su contrato, todas las páginas dinámicas, las alternativas de D1 con su evidencia y
  la caché de los documentos. Actualizar:
  - `docs/architecture/frontend.md`: el renderizado por petición y el nonce;
  - `docs/security/hardening.md`: la autoridad, con un enlace al módulo de 1.1, sin copiar la
    política;
  - `docs/architecture/deployment.md`: el proxy no añade CSP, conserva las cabeceras de la
    aplicación, no guarda los documentos con nonce en una caché compartida y configura HSTS en el
    borde TLS (D2, D7).

  Verificar que `corepack pnpm format:check` pasa y que la política completa está escrita solo en el
  módulo.

## 3. Comprobación del build en un navegador real

- [x] 3.1 Añadir `playwright-core` como dependencia de desarrollo de la raíz, con versión exacta
  (D9).
  - Confirmar el nombre del paquete, su mantenimiento y su licencia Apache-2.0
    (`hardening.md`, «Dependencies And Supply Chain»).
  - Lanza el Chrome del sistema (`channel: "chrome"`) y no descarga navegadores.
  - Registrarlo en `docs/architecture/stack.md` y en el ADR 0025.

  Verificar que `corepack pnpm install` y `corepack pnpm check:versions` pasan y que el lockfile solo
  cambia por esa dependencia.
- [ ] 3.2 Crear `scripts/check-web-security-policy.ts` y el script `check:web-security-policy`.
  1. Arranca el backend con `startE2eBackend`, con un puerto fijo y el SRI simulado de
     `backend/test/support/simulated-sri.ts`, como `e2e-document-archive`; nunca el SRI real.
  2. Arranca `next start` del build en el origen `localhost:3000`, con `/api` hacia ese backend.
  3. Recorre los flujos en Chrome, recoge los eventos `securitypolicyviolation` y los mensajes de CSP
     de la consola, y falla ante cualquier violación inesperada.

  Comprueba las 23 condiciones de la tabla de D9, y además:
  - que no queda ninguna página prerenderada, leyendo el manifiesto del build;
  - la ausencia de `Strict-Transport-Security`;
  - que ningún nonce de las respuestas aparece en la salida de `next start`;
  - que el envío nativo de un formulario se bloquea.

  Si un flujo revela una dependencia legítima de ventanas emergentes u `opener` que COOP rompe, se
  detiene y se informa (D6). Verificar ejecutándolo en local después del build: termina en 0, y cada
  condición informa su resultado.
- [ ] 3.3 Medir los estilos en Chrome real (D4). Con la política de la aplicación activa, el modo de
  medición del script añade una `Content-Security-Policy-Report-Only` por cada variante, A y B, y
  recorre los mismos flujos, con un aviso visible, un diálogo, un menú y el cambio de tema.
  - Aplicar la regla de decisión de D4 al módulo de 1.1 y ajustar su prueba unitaria.
  - Confirmar también que `script-src-attr 'none'` no produce violaciones. Si las produjera,
    documentar la razón medida antes de cambiar nada.
  - Registrar el resultado en el ADR 0025. En `docs/quality/technical-debt.md`, registrar la
    excepción que quede con su razón, alcance, riesgo y salida, y `STYLE_INLINE_DEBT: OPEN` si
    hacen falta las dos directivas.

  Verificar que la comprobación de 3.2 pasa con la política acotada.
- [ ] 3.4 Encadenar `check:web-security-policy` en `verify` después de `corepack pnpm build`, como
  `check:xsd-artifact`. Medir su duración local y documentar el comando en `docs/quality/testing.md`.
  Verificar que `corepack pnpm verify` lo ejecuta. `timeout-minutes` no se toca hasta medir la CI
  (4.5).

## 4. Verificación y cierre de H-02 en la aplicación

- [ ] 4.1 Volver a medir la latencia de un documento con el método del design: `next start` local,
  30 peticiones, p50 y p95 de una antigua ruta estática y de una dinámica. Registrarla en el ADR 0025.
  Verificar que la diferencia sigue en el orden de milisegundos medido en la readiness.
- [ ] 4.2 Arrancar `next dev` y abrir el inicio de sesión. Verificar que funciona con la política de
  desarrollo y que solo lleva las concesiones de D10. Si la recarga en caliente exige otra, añadirla
  solo en desarrollo y cubrirla en la prueba de 1.1.
- [ ] 4.3 Marcar H-02 como «APPLICATION LAYER COMPLETE», con HSTS diferido al borde TLS
  (`HSTS STATUS: DEFERRED TO DEPLOYMENT/PROXY HARDENING`), en
  `docs/quality/manual-mvp-test-2026-10-09.md` y `docs/quality/definition-of-done.md` (Go-Live
  v1.0). Verificar que `corepack pnpm format:check` pasa.
- [ ] 4.4 Ejecutar `corepack pnpm verify` completo y verificar que termina en 0. Si falla por una
  prueba inestable ya registrada en `technical-debt.md`, informar el código de salida real y aportar
  la evidencia aislada o de control, sin marcar la tarea como completa.
- [ ] 4.5 Cuando el cambio corra en la CI remota, medir la duración del job. Si queda demasiado cerca
  del límite de 45 minutos o lo supera, subir `timeout-minutes` en `.github/workflows/verify.yml` a un
  valor basado en esa medida, con margen razonable, y anotarlo en la deuda «Duración de la CI».
  Verificar con una ejecución verde de la CI.
