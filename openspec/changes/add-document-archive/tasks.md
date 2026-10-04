# Tasks

## 1. Esquema del archivo documental

- [x] 1.1 Crear la migración aditiva de design D4, D9 y del Migration Plan:
  - CHECK de `document_artifact`: `SIGNED_XML` y `AUTHORIZED_XML` con `application/xml`, y `RIDE_PDF` con `application/pdf`;
  - tabla `document_delivery_event` con FK compuesta `(company_id, document_id)`, `event` (`DOWNLOAD`, `PRINT_REQUESTED`), `artifact_kind`, `artifact_sha256`, `actor_user_id` con `RESTRICT`, `request_id` y `occurred_at`, triggers contra `UPDATE`, `DELETE` y `TRUNCATE`, e índice `(company_id, document_id, occurred_at)`;
  - índices de la bandeja `(company_id, issue_date, id)` y `(company_id, buyer_identification)`.

  Verificar con pruebas de integración del esquema:
  - un `RIDE_PDF` con `application/pdf` se guarda, uno con otro tipo de medio se rechaza, y un segundo `RIDE_PDF` del mismo comprobante choca con la unicidad;
  - un `RIDE_PDF` guardado no se puede cambiar ni borrar;
  - una entrega no se puede cambiar, borrar ni truncar; una entrega con un comprobante de otra empresa o un evento fuera de la lista se rechaza;
  - un usuario con entregas no se puede borrar;
  - los artefactos `SIGNED_XML` y `AUTHORIZED_XML` existentes siguen válidos tras la migración
- [x] 1.2 Añadir la tabla a `migrations.test.ts` y documentar el CHECK, la tabla, sus triggers y los índices en `database.md`, reemplazando la tabla planificada de entregas. Verificar que `migrations.test.ts` pasa sin deriva entre migraciones y esquema

## 2. Pool de workers genérico y configuración del RIDE

- [ ] 2.1 Extraer de forma conservadora la primitiva `platform/workers/worker-pool.ts` (design D6):
  1. antes de mover código, añadir pruebas de caracterización del pool criptográfico (cola, ocupado, plazo, reemplazo del worker caído y cierre ordenado) y comprobar que pasan sobre el código actual;
  2. extraer la primitiva (workers fijos, cola acotada, plazo que termina y reemplaza el worker, resultados tipados y cierre ordenado);
  3. dejar `CryptoWorkerPool` como instancia independiente con sus errores HTTP de hoy.

  Verificar que las pruebas de caracterización, las del pool criptográfico y las de la firma pasan sin cambiar sus aserciones, y que las pruebas de la primitiva cubren la cola llena, el plazo vencido, el worker que muere, el cierre que espera la tarea en curso y rechaza las nuevas, y un error que llega al hilo principal solo como código
- [ ] 2.2 Añadir a `env.ts` `RIDE_WORKERS`, `RIDE_QUEUE`, `RIDE_TASK_TIMEOUT_MS`, `RIDE_JOB_MAX_ATTEMPTS` y `RIDE_SWEEP_INTERVAL_SECONDS` con los defectos y rangos de design D6, y documentarlas en `deployment.md` como configuración operativa. Verificar con pruebas de entorno: valores por defecto, bordes de cada rango aceptados y valores fuera de rango rechazados

## 3. Dependencias, fuentes y fuente canónica del RIDE

- [ ] 3.1 Añadir pdfmake 0.3.11, bwip-js 4.11.4 y fontkit 2.0.4 en runtime, y pdfjs-dist 6.3.289, @napi-rs/canvas 1.0.10 y zxing-wasm 3.1.4 en pruebas, con versión exacta y sin excepciones de antigüedad de publicación (ADR 0022). Declarar tipos locales mínimos en lugar de `@types/pdfmake`, y añadir la regla de ESLint que limita pdfmake, bwip-js y fontkit a `sri-engine/infrastructure` (design D1). Actualizar `stack.md`. Verificar que `check:versions`, `lint` y `typecheck` pasan, y que la regla rechaza un import de pdfmake fuera de esa carpeta
- [ ] 3.2 Guardar Noto Sans 2.015 Regular y Bold con `OFL.txt` y `manifest.json` (nombre, versión, licencia, archivo y SHA-256) en `backend/assets/fonts/noto-sans/` (design D7):
  - el build copia fuentes, licencia y manifiesto a `dist/assets/fonts/noto-sans/`;
  - `check:ride-assets`, separado de `check:xsd-artifact`, comprueba en el artefacto construido el manifiesto, las fuentes, la licencia y cada hash; `verify` ejecuta los dos;
  - al arrancar, el RIDE verifica sus fuentes y, si faltan o no coinciden, `/health/ready` no se declara listo, con un detalle propio distinto del de los XSD, el motivo en el log y sin rutas absolutas.

  Verificar con pruebas de la verificación (fuentes correctas, ausentes, alteradas y manifiesto ausente), una prueba de readiness con fuentes alteradas que responde no lista con su detalle, y `corepack pnpm build && corepack pnpm check:xsd-artifact && corepack pnpm check:ride-assets`
- [ ] 3.3 Implementar el puerto `RideSourceReader` en `sri-engine/application` y su lectura en `sri-engine/infrastructure` (design D3):
  - rechaza un XML con `<!DOCTYPE` o entidades, de más de 2 MiB o con más de 24 niveles de anidamiento, y un documento que no sea una factura 1.1.0 (`RIDE_SOURCE_INVALID`);
  - rechaza cualquier elemento que el builder del sistema no escribe, y todo impuesto que no sea IVA (`RIDE_SOURCE_UNSUPPORTED`, con los nombres de los elementos);
  - devuelve el modelo de la factura con los textos y los importes como texto exacto del XML, nunca convertidos a `number`;
  - comprueba que la clave del XML coincide con la del comprobante y con el número de autorización, y su ambiente con el de la autorización (`RIDE_AUTHORIZATION_MISMATCH`).

  Verificar con pruebas unitarias sobre facturas del builder real validadas contra el XSD y firmadas con la firma sintética: cada rechazo de seguridad; una versión 1.0.0, otro tipo de comprobante, un ICE, una propina y un `infoAdicional` rechazados; una clave y un ambiente distintos; y la cantidad `999999.999999` con el precio `1.000001` leídos sin cambios

## 4. Renderer del RIDE

- [ ] 4.1 Implementar el puerto `RideRenderer` y su adaptador sobre pdfmake con el contenido, el formato y la paginación de design D7:
  - cabecera, emisor con sus leyendas (RIMPE del anexo 22), comprador, detalle con las columnas condicionales, formas de pago con su denominación del snapshot y subtotales de IVA llenados en el orden del anexo 2, en secciones independientes;
  - importes y cantidades con el texto exacto del XML;
  - A4, encabezado repetido desde la segunda página, encabezado del detalle repetido, "Página X de Y", filas sin partir y totales indivisibles; la autorización y el código de barras completos en la primera página;
  - acceso a URL y a archivos locales deshabilitado en pdfmake, fuentes desde memoria y logo solo desde sus bytes verificados;
  - fecha de creación igual a la de autorización.

  Verificar con pruebas que extraen el texto del PDF con pdf.js:
  - factura completa con varias líneas, descuentos, varias tarifas de IVA y varias formas de pago;
  - consumidor final, las cuatro leyendas del emisor y el ambiente de pruebas;
  - importes exactos sin redondear;
  - una página con pocas líneas, y varias páginas con el encabezado, la numeración, ninguna fila partida y los totales completos en la siguiente página;
  - el mismo comprobante dibujado dos veces, también en procesos distintos, da los mismos bytes
- [ ] 4.2 Dibujar la clave de acceso como Code128 con bwip-js en rectángulos vectoriales (módulo de 0.329 mm, zona de silencio de 10 módulos y alto de al menos el 15 % del ancho y 6.35 mm) y como texto completo debajo (design D7). Verificar con una prueba que dibuja el RIDE de varios comprobantes con claves distintas, lo rasteriza con pdf.js y @napi-rs/canvas a 300 ppp y comprueba con zxing que cada lectura devuelve exactamente su clave, y que el texto extraído contiene la clave completa
- [ ] 4.3 Comprobar con fontkit que cada carácter dibujado tiene glifo en Regular y en Bold, y detener con `RIDE_GLYPH_MISSING` y los códigos de los caracteres si no (design D7). Verificar con pruebas: tildes, eñes, diéresis y comillas tipográficas presentes en el texto extraído; un carácter sin glifo que da `RIDE_GLYPH_MISSING` con su código; y un render en un proceso sin fuentes del sistema
- [ ] 4.4 Verificar la seguridad del PDF con pruebas (design D3 y D7): campos con marcado, `javascript:`, URL y rutas de archivo dibujados como texto; el PDF sin `/URI`, `/Launch`, `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/EmbeddedFile` ni `/RichMedia`; y ningún acceso a la red ni a archivos fuera de los propios durante el render
- [ ] 4.5 Crear la entrada `serve-ride-tasks.ts` y `RideWorkerPool`, instancia independiente de la primitiva con `RIDE_WORKERS`, `RIDE_QUEUE` y `RIDE_TASK_TIMEOUT_MS`; los workers cargan pdfmake y las fuentes una vez (design D6). Añadir la prueba de arquitectura que limita pdfmake, bwip-js y fontkit a la infraestructura del RIDE que solo carga la entrada del worker. Verificar con pruebas del pool del RIDE: render correcto en un worker, cola llena que responde ocupado, plazo vencido que reemplaza el worker y falla la tarea, `RIDE_GLYPH_MISSING` que llega como código determinista, y varios renders concurrentes mientras el hilo principal atiende peticiones HTTP con un retraso máximo del event loop muy por debajo de un render
- [ ] 4.6 Documentar el renderer, las fuentes, el formato numérico y el determinismo por versión en `fiscal-emission.md`. Verificar que el documento cita los códigos de error, las versiones y la ruta de las fuentes implementados

## 5. Generación del RIDE como job

- [ ] 5.1 Programar el RIDE al autorizar sin invertir la dependencia (design D1 y D5):
  - el puerto genérico `DocumentTransitionFollower` en `fiscal/application/document-transitions.ts`;
  - `applyDecision` recibe los seguidores como dependencia obligatoria y llama a cada uno, con el cliente de la TX B, después de guardar cada transición y su artefacto;
  - el seguidor `fiscal/application/archive/ride-follower.ts` encola `document.render_ride` con la clave `document.render_ride:{documentId}` cuando la transición llega a `AUTHORIZED`;
  - `main.ts` los compone al arrancar;
  - la prueba de arquitectura: ningún archivo de `src/` fuera de `archive/` y de `main.ts` importa de `archive/`, y ningún archivo de la transmisión contiene `document.render_ride`.

  Verificar con pruebas de integración y de arquitectura:
  - la autorización, la reconciliación automática y la manual que llegan a `AUTHORIZED` dejan su job en la misma transacción;
  - una caída simulada antes del commit, o un seguidor que falla, no deja ni la autorización ni el job;
  - ningún otro estado lo encola;
  - la prueba de arquitectura pasa sobre el código y detecta cada violación en archivos de ejemplo
- [ ] 5.2 Implementar el barrido idempotente `archive/ride-sweeper.ts`, defensa secundaria al arrancar y cada `RIDE_SWEEP_INTERVAL_SECONDS` (design D5). Verificar con pruebas de integración: los autorizados sin `RIDE_PDF` ni job reciben exactamente uno; el barrido repetido y dos barridos a la vez no crean duplicados; un autorizado con RIDE no recibe job; un job `STOPPED` no se reactiva
- [ ] 5.3 Implementar el handler `fiscal/application/archive/ride-handler.ts` con los pasos y la clasificación de fallos de design D5:
  - comprobante inexistente o no autorizado: detención determinista;
  - con `RIDE_PDF`: completa sin generar;
  - fuente `AUTHORIZED_XML` o, sin él, `SIGNED_XML_FALLBACK`, con la asociación, el SHA-256 y el tamaño verificados (`RIDE_SOURCE_INTEGRITY`) y el logo de la versión de configuración del snapshot con su hash (`RIDE_LOGO_INTEGRITY`);
  - render en el pool y, en una transacción guardada por el arriendo, el `RIDE_PDF` con los metadatos de design D4 y el job `DONE`; un choque de unicidad completa sin error;
  - pool ocupado o apagado: reprograma sin consumir el intento; plazo, worker caído o error inesperado: `FAIL` con backoff; códigos deterministas: `STOP`.

  Verificar con pruebas de integración:
  - primera generación con todos los metadatos y la procedencia `AUTHORIZED_XML`;
  - autorizado sin `AUTHORIZED_XML` con procedencia `SIGNED_XML_FALLBACK` y la autorización del comprobante;
  - un tercero, un producto, la configuración tributaria y una denominación de pago cambiados después de autorizar no cambian el RIDE;
  - origen alterado, autorización que no corresponde y logo alterado se detienen con su motivo;
  - generación repetida y dos generaciones simultáneas dejan un solo RIDE;
  - el comprobante sigue `AUTHORIZED` en cada fallo, y un fallo transitorio que agota `RIDE_JOB_MAX_ATTEMPTS` queda `STOPPED`;
  - ninguna lectura de `parties`, `products`, `taxpayer` ni `catalogs`
- [ ] 5.4 Arrancar una segunda instancia del runner para los jobs `document.*` con `RIDE_WORKERS` lazos, fuera del interruptor de la transmisión y pausada mientras las fuentes del RIDE no estén verificadas, con el barrido y el apagado ordenado compartido: deja de tomar trabajo, espera el render en curso hasta el plazo de gracia, vence los arriendos y cierra el pool (design D6 y D7). Verificar con pruebas: con la transmisión deshabilitada el RIDE se genera; el runner de la transmisión no toma jobs `document.*` ni el del RIDE toma `sri.*`; con las fuentes alteradas no se toma ningún job del RIDE; un apagado con un render en curso que termina, o que se libera y se retoma
- [ ] 5.5 Añadir las métricas `ride_render_duration_seconds`, `ride_job_wait_seconds`, `ride_render_failures_total{code}` y `documents_authorized_without_ride` (design D14), y documentarlas en `observability.md` con las alertas de autorizados sin RIDE y de fallos deterministas. Verificar con una prueba de que aparecen en `/metrics` con códigos acotados, sin bytes, XML, claves completas, datos del comprador ni identificadores de empresa
- [ ] 5.6 Documentar el job, el seguidor de las transiciones y la dirección de las dependencias, el barrido, el runner del RIDE y la primitiva del pool en `backend.md` y `ARCHITECTURE.md`. Verificar que los documentos citan el tipo de job, la clave de deduplicación, las variables y los módulos implementados

## 6. Contratos y permisos

- [ ] 6.1 Crear `packages/contracts/src/archive.ts` (design D10): filtros de la bandeja validados con Zod (fechas ISO con `from <= to`, tipo, estado, identificación, búsqueda, establecimiento, punto y paginación), elemento y resumen, estados `AVAILABLE`, `PENDING`, `STOPPED` y `NOT_APPLICABLE`, eventos de entrega, códigos `DOCUMENT_NOT_AVAILABLE`, `ARTIFACT_INTEGRITY_FAILED`, `RIDE_ALREADY_AVAILABLE`, `RIDE_GENERATION_IN_PROGRESS` y `DOCUMENT_NOT_AUTHORIZED`, y rutas en `apiRoutes`. Verificar con pruebas de contratos: fecha mal formada, rango invertido y estado desconocido rechazados
- [ ] 6.2 Añadir `archive.read`, `archive.download` y `archive.retryRide` a `access-policy.ts` para `ADMIN` y `OPERATOR`, a su espejo del frontend y a la tabla de `access-control.md`, registrando que este cambio confirma la fila "Consultar la bandeja y descargar XML y RIDE" y el reintento bajo ella (design D11). Verificar con `access-policy.test.ts`, la prueba de espejo y la prueba de documentación de la matriz

## 7. API de la bandeja

- [ ] 7.1 Implementar `GET /api/v1/documents` con los filtros, el orden y las disponibilidades de design D2, en una consulta paginada sin N+1, y `GET /api/v1/documents/{documentId}` con los artefactos (tipo, SHA-256, tamaño, fecha y procedencia del RIDE) y la generación con su motivo. Registrar las rutas en OpenAPI. Verificar con pruebas HTTP:
  - comprobantes en todos los estados con su estado visible, sin borradores, y la bandeja vacía;
  - el rango de fechas inclusivo, el establecimiento con el punto y el estado, la identificación y el número;
  - un filtro inválido rechazado antes de consultar;
  - las disponibilidades de autorizado con RIDE, RIDE en preparación, RIDE detenido, sin autorizar y reservado;
  - sin sesión `401`, sin permiso `403`, y ningún comprobante de otra empresa con ningún filtro ni por identificador (`404`);
  - `openapi-routes.test.ts` y `openapi:check` pasan

## 8. Descargas, impresión y entregas

- [ ] 8.1 Implementar el repositorio de entregas, `GET /api/v1/documents/{documentId}/ride`, `/authorized-xml` y `/signed-xml`, y `POST /api/v1/documents/{documentId}/print-requests`, con los pasos, las cabeceras y el nombre de archivo de design D8 y D9:
  - sesión y permiso, empresa y comprobante (`404`), disponibilidad (`404 DOCUMENT_NOT_AVAILABLE`), SHA-256 y tamaño recalculados (`500 ARTIFACT_INTEGRITY_FAILED` sin servir nada, con log de error);
  - los `GET` registran `DOWNLOAD` una vez determinado que responden con el artefacto, y sirven los bytes con `Content-Disposition: attachment`;
  - el `POST` comprueba lo mismo sobre el `RIDE_PDF`, registra `PRINT_REQUESTED` y responde `201` sin bytes;
  - las métricas `document_deliveries_total{event}` y `artifact_integrity_failures_total{kind}`, y la alerta de integridad en `observability.md`.

  Verificar con pruebas HTTP:
  - los bytes servidos son idénticos al artefacto y su hash coincide;
  - `Content-Type`, `Content-Length`, `Content-Disposition`, `nosniff`, `Cache-Control: private, no-store` y `ETag`;
  - el nombre `factura-001-001-000000001.pdf`, y los XML con `-autorizado` y `-firmado`;
  - el XML autorizado de un comprobante sin él y el RIDE de uno sin RIDE responden no disponible, también la solicitud de impresión;
  - un artefacto alterado en la base no sirve ningún byte, no acepta la solicitud de impresión y no registra entrega;
  - una entrega por descarga y una por solicitud de impresión con el comprobante, el tipo, el hash, el actor, el momento y el `request_id`;
  - varios `GET` del RIDE no registran ningún `PRINT_REQUESTED`;
  - ninguna entrega ni evento de auditoría en los rechazos por sesión, permiso, otra empresa, disponibilidad o integridad, y ningún evento de auditoría por una entrega servida
- [ ] 8.2 Implementar `GET /api/v1/documents/{documentId}/deliveries` (las 100 más recientes y el total, sin hashes) y declarar `DocumentNotificationPort` en `fiscal/application/ports.ts` sin implementación ni cableado (design D9). Verificar con pruebas HTTP: orden de la más reciente a la más antigua, sin bytes ni hashes, sin eventos de correo ni de recepción, sin permiso `403` y otra empresa `404`
- [ ] 8.3 Documentar las entregas observables en `domain-model.md` y `glossary.md` (`DOWNLOAD`, `PRINT_REQUESTED`, sin "entregado"). Verificar que los términos coinciden con los eventos implementados

## 9. Reintento de una generación detenida

- [ ] 9.1 Implementar `POST /api/v1/documents/{documentId}/ride-attempts` con el permiso `archive.retryRide` (design D5): `202` con un job `MANUAL` y `requested_by`; `409 RIDE_ALREADY_AVAILABLE`, `409 RIDE_GENERATION_IN_PROGRESS` y `409 DOCUMENT_NOT_AUTHORIZED`. Verificar con pruebas HTTP: generación detenida que se programa y genera el RIDE; RIDE existente rechazado sin cambiarlo; job activo rechazado sin programar otro; comprobante no autorizado; dos solicitudes simultáneas de las que solo una se programa; sin sesión, sin permiso y otra empresa sin efecto; ningún evento de auditoría

## 10. Pantallas

- [ ] 10.1 Implementar `DatePickerField` en `frontend/src/components` sobre `<input type="date">`, con etiqueta, limpieza y error en el campo (design D13), y marcarlo como disponible en `component-system.md`. Verificar con pruebas de componente: valor, limpieza, error asociado al campo y teclado
- [ ] 10.2 Implementar la pantalla `Comprobantes` en `/comprobantes` dentro de "Operación" (design D13): `AppDataTable` con paginación del servidor y filtros en la URL, `ChipGroup` del estado, búsqueda, `Select` de establecimiento, punto y tipo (oculto con un solo tipo), rango con dos `DatePickerField`, panel de filtros por debajo de 768 px, enlace al detalle y descarga del RIDE disponible. Verificar con pruebas de componente: carga, vacío, error, sin permiso, filtros en la URL, rango inválido y descarga
- [ ] 10.3 Añadir la sección "Documentos" al detalle de la factura, debajo de "Transmisión al SRI" (design D13): "Descargar RIDE"; "Imprimir", que primero crea la solicitud de impresión y después pide el mismo RIDE y lo abre como blob en un `iframe` oculto; "XML autorizado"; "XML firmado" rotulado como firmado; historial de entregas plegable; refresco cada 5 s con el RIDE en preparación; y "Reintentar generación" con su motivo para quien tiene el permiso. Verificar con pruebas de componente: autorizado con RIDE, en preparación con refresco, detenido con reintento, sin autorizar solo con el XML firmado, reservado sin documentos, la impresión que llama al `POST` antes del `GET` y no abre el diálogo si el `POST` falla, error de integridad explicado, `409` explicado, sin permiso y foco tras las acciones
- [ ] 10.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real con un SRI simulado (escritorio, 375 y 320 px, tema claro y oscuro, contraste y teclado), y registrar la revisión en `openspec/changes/add-document-archive/ui-review.md`. Verificar que la revisión no deja hallazgos abiertos

## 11. Rendimiento y prueba end-to-end

- [ ] 11.1 Añadir `bench:ride` en `backend/scripts/` (design D15): 50 RIDE representativos de una y varias páginas con calentamiento aparte, desde facturas del builder real, por el código real (lector, `RideWorkerPool`, handler y persistencia), informando por separado el render (P50, P95 y máximo), la espera de cola y el retraso máximo del event loop. Registrar el resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que el P95 del render es menor que 1 s en el entorno registrado
- [ ] 11.2 Añadir la prueba end-to-end sobre `main.ts` con un SRI simulado: emisión, transmisión, autorización, job del RIDE presente sin esperar al barrido, RIDE generado, bandeja, descarga y solicitud de impresión con sus entregas, y rearranque con un autorizado sin RIDE que el barrido completa. Actualizar `capabilities.md` con `document-archive`. Verificar que la prueba pasa
- [ ] 11.3 Reproducir S-4 con la implementación real, sin código de la rama del spike: decodificación del Code128 de varias claves con zxing (y zbar con poppler si están instalados), determinismo de bytes entre procesos, render en `node:24.21.0-slim` sin fuentes del sistema y la medición de `bench:ride`. Registrar la comparación con S-4 en el benchmark. Verificar que cada criterio de S-4 se cumple

## 12. Verificación

- [ ] 12.1 Ejecutar `corepack pnpm verify` y verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact` y `check:ride-assets` pasan
