# Tasks

Plan por fases (decisión del propietario, 2026-10-23): las fases 1 a 7 dejan el backend completo y
verificado; las fases 8 a 11 son la interfaz. Cada grupo es un commit propio, publicado en la rama
al terminarlo.

## 1. Fase 1 · Base: dependencias, secretos y configuración

- [x] 1.1 Escribir el ADR 0029 (cliente SMTP nodemailer; `smtp-server` solo para pruebas; Mailpit solo en el despliegue de revisión) y agregar las dependencias al backend en versión exacta, con sus filas en `docs/architecture/stack.md` y la excepción en `docs/architecture/integrations.md`; verificar con `corepack pnpm security:dependencies`.
- [x] 1.2 Mover el cifrado de sobres AES-256-GCM de `certificate-vault.ts` a `backend/src/platform/secrets/` como función genérica y hacer que la bóveda de la firma la use sin cambiar su formato ni sus AAD; verificar con las pruebas existentes de la bóveda y pruebas unitarias nuevas del sobre (ida y vuelta, AAD distinto, versión de clave desconocida, datos alterados).
- [x] 1.3 Agregar a `backend/src/config/env.ts` `EMAIL_DELIVERY_ENABLED` (por defecto `0`), `EMAIL_ALLOW_PLAINTEXT_SMTP` (por defecto `0`), `EMAIL_SMTP_CONNECTION_TIMEOUT_MS`, `EMAIL_SMTP_SOCKET_TIMEOUT_MS` y `EMAIL_JOB_*`, con `backend/.env.example`; verificar con las pruebas de configuración (valores por defecto, rangos y rechazos sin secretos).

## 2. Fase 2 · Datos

- [x] 2.1 Agregar al esquema de Prisma `email_settings`, `email_settings_secret`, `email_delivery` y `email_delivery_attempt` (CHECK de puerto, seguridad, origen con actor y estados; `UNIQUE (document_id) WHERE origin = 'AUTOMATIC'`; `UNIQUE (company_id, idempotency_key)`; índice `(company_id, status)`; intentos de solo agregado con trigger; FK compuestas con la empresa y el comprobante, `Restrict` como el resto del archivo, y el secreto en cascada con su configuración) y su migración; verificar con `db:generate`, aplicando la migración en la base de pruebas y con pruebas de integración de las restricciones (un solo envío automático por comprobante, clave de idempotencia única, MANUAL sin actor rechazado, intentos inmutables).
- [x] 2.2 Convertir el correo del tercero en una lista de hasta tres (tabla `party_email` con posición del 1 al 3 y dirección única sin distinguir mayúsculas, migración que copia el correo existente) con el contrato `emails` (máximo 3, válidos, sin repetir sin distinguir mayúsculas), su repositorio, su búsqueda y su auditoría (solo el nombre del campo), y el ajuste mínimo del formulario del tercero para seguir compilando (la interfaz de tres correos va en la fase 9); verificar con pruebas de contrato e integración (alta con dos, más de tres o repetido rechazado, tercero anterior con su correo como primero, evento sin valores) y `openapi:check`.

## 3. Fase 3 · Configuración del correo y prueba

- [x] 3.1 Agregar los permisos `email.configure` (Administrador) y `email.resend` (Administrador y Operador) a `access-policy.ts`, al espejo del frontend y a la tabla de `docs/security/access-control.md`; verificar con las pruebas de la política, del espejo y del documento.
- [x] 3.2 Agregar a `packages/contracts` los esquemas de la configuración del correo (sin contraseña en la respuesta, `passwordSet`, `deliveryEnabled`, `expectedVersion`), del correo de prueba y de los envíos (estado, direcciones con su resultado, origen, intentos); cada ruta entra en el OpenAPI con su endpoint (la prueba de rutas exige que toda ruta documentada exista); verificar con las pruebas de contratos y `openapi:check`.
- [x] 3.3 Implementar `GET` y `PUT /api/v1/email/settings`: contraseña cifrada con el sobre de `platform/secrets` (ausente conserva la guardada), versión optimista, sin cifrado solo con `EMAIL_ALLOW_PLAINTEXT_SMTP=1`, y auditoría `email_settings.changed` sin secretos ni evento cuando no cambia nada; verificar con pruebas de integración: alta, cambio sin contraseña, datos inválidos, sin cifrado rechazado, operador `403`, sin sesión `401`, otra empresa aislada, dos guardados a la vez (`409`), el mismo guardado dos veces, y el contenido del evento.
- [x] 3.4 Implementar el transporte SMTP con nodemailer (TLS directo y STARTTLS con certificado verificado y TLS 1.2 o superior, tiempos agotados configurables, resultado por dirección) y la clasificación de fallos temporales y definitivos con sus motivos en español; verificar con pruebas unitarias de la clasificación y de integración contra `smtp-server`: aceptado, credenciales rechazadas, certificado inválido, tiempo agotado y una dirección rechazada.
- [x] 3.5 Implementar `POST /api/v1/email/test` (interruptor apagado `409`, sin configuración, límite por minuto y empresa, auditoría `email.test_sent` con la dirección y el resultado); verificar con pruebas de integración contra el servidor falso, incluidas las de permiso y aislamiento.

## 4. Fase 4 · Envío automático

- [x] 4.1 Implementar la resolución de destinatarios por tipo (factura; nota de crédito y de débito por su factura; retención; liquidación; guía con sus destinatarios terceros y su transportista tercero), sin duplicados, con el consumidor final y el tercero sin correo como «sin destinatario», y el correo de prueba en el ambiente de Pruebas del comprobante; verificar con pruebas unitarias por tipo y por ambiente.
- [x] 4.2 Implementar el mensaje (asunto con el prefijo de Pruebas, texto y HTML escapados con el resumen, adjuntos `<claveAcceso>.xml` y `<claveAcceso>.pdf` con el XML autorizado o el firmado transmitido, verificados por SHA-256, y `Message-ID` determinista); verificar con pruebas unitarias del asunto, del escape, de los nombres y de un artefacto faltante o alterado que impide el envío.
- [x] 4.3 Crear el envío automático desde la transacción de éxito del RIDE (`emailFollower`), con el trabajo `email.send_document` en un runner `email.` propio (concurrencia 2), la política de reintentos (12 intentos, 26 h), los estados, los intentos, el interruptor al encolar y al ejecutar, y las métricas; verificar con pruebas de integración contra `smtp-server`: un correo con los dos adjuntos al autorizar una factura, un solo correo al procesar dos veces, sin correo hasta que el reintento manual del RIDE tiene éxito, envío automático apagado y despliegue apagado como desactivados sin conexión (también al encender después), reintento y luego enviado, credenciales rechazadas sin reintentar, reintentos agotados, una dirección rechazada, estado fiscal intacto, Pruebas solo al correo de prueba, y los seis tipos de punta a punta.
- [x] 4.4 Retirar `DocumentNotificationPort` de `fiscal/application/ports.ts` y actualizar los comentarios que remiten a él; verificar con `typecheck` y las pruebas del archivo.

## 5. Fase 5 · Historial, reenvío, filtro y aviso

- [x] 5.1 Implementar `GET /api/v1/documents/:id/email-deliveries` y `GET …/email-recipients`; verificar con pruebas de integración: orden, intentos, sin contenido ni configuración, otra empresa `404`, sin sesión `401` y permisos.
- [x] 5.2 Implementar `POST /api/v1/documents/:id/email-deliveries` con `Idempotency-Key` (de 1 a 10 direcciones válidas sin repetir; no autorizado, interruptor apagado o sin configuración `409`; Pruebas al correo de prueba; auditoría `email.resent`); verificar con pruebas de integración: la misma solicitud dos veces con un solo correo, la misma clave con otro cuerpo `409`, dos solicitudes a la vez, operador permitido, otra empresa `404` y direcciones inválidas.
- [x] 5.3 Agregar a la bandeja el filtro `emailStatus=FAILED` y el estado del último envío por fila, y al tablero `attention.emailFailed`, con sus contratos y el OpenAPI; verificar con pruebas de integración del filtro, de un valor inválido, del conteo que baja tras un reenvío aceptado y del aislamiento por empresa.

## 6. Fase 6 · Despliegue

- [x] 6.1 Agregar `deploy/compose.smtp-egress.yaml` (red de salida propia, separada de la del SRI) y `deploy/compose.mailpit.yaml` (imagen fija, SMTP solo interno, página solo en `127.0.0.1`, `EMAIL_DELIVERY_ENABLED=1` y `EMAIL_ALLOW_PLAINTEXT_SMTP=1`), y documentarlos en `docs/architecture/deployment.md` con la recomendación de firewall y de SPF, DKIM y DMARC; verificar con `docker compose config` de la topología por defecto (sin cambios ni salida) y de cada override.
- [x] 6.2 Comprobar en el despliegue local de revisión con Mailpit, con `SRI_TRANSMISSION_ENABLED=0` verificado y sin ninguna conexión al SRI: la configuración del correo, el correo de prueba y el reenvío de un comprobante ya autorizado de la base local, visibles en Mailpit con sus dos adjuntos; registrar la evidencia sin datos sensibles.

## 7. Fase 7 · Documentación del backend

- [x] 7.1 Documentar el correo en `docs/architecture/integrations.md`, `backend.md`, `fiscal-emission.md` (RIDE y después correo), `docs/product/domain-model.md` (envíos e intentos), `docs/product/open-questions.md` (Q-24 implementada), `docs/product/capabilities.md` (`email-delivery`), la documentación de la API y `docs/security/` (custodia de la contraseña SMTP y las direcciones de los receptores como datos personales); verificar con `corepack pnpm format:check` y `openspec:validate`.

## 8. Fase 8 · Interfaz: capa de datos y Configuración → Correos

- [x] 8.1 Backend: agregar `GET /api/v1/email/availability` (`email.resend`): si hay servidor, si el envío del despliegue y el automático están encendidos y el correo de prueba, sin el servidor, el usuario ni la contraseña; con su contrato, su ruta en el OpenAPI y la prueba de rutas; verificar con pruebas de integración (el operador la lee sin datos del servidor, sin sesión `401`, cada empresa ve la suya).
- [x] 8.2 Agregar `frontend/src/features/email/email-api.ts` (configuración, disponibilidad, prueba, historial, direcciones propuestas y reenvío con una `Idempotency-Key` por diálogo, sus claves e invalidaciones, y los errores que van a cada campo) y `email-format.ts` (la presentación de cada estado); verificar con pruebas unitarias del formato y de los parámetros de cada consulta y mutación.
- [x] 8.3 Agregar el destino «Correos» después de Firma en `routes.ts` (`email.configure`, icono de correo, palabras clave «correo», «SMTP» y «servidor de correo») y su página `app/(app)/configuracion/correos/page.tsx`; verificar con las pruebas de la configuración en pestañas (las ocho secciones en orden), de las rutas y de la paleta de comandos.
- [x] 8.4 Construir la pantalla «Correos» (design D14): estado listo, desactivado por el despliegue o sin configurar; el formulario con servidor y puerto, seguridad (sin cifrado solo si el despliegue lo admite), usuario, contraseña con «Contraseña guardada», remitente, copia oculta, correo de prueba y envío automático; el aviso de conflicto con «Recargar»; los errores del servidor junto a su campo; y el diálogo «Enviar correo de prueba» con el resultado dentro; verificar con pruebas de componentes: carga, error con reintento, sin permiso, sin configurar, desactivado, guardado sin repetir la contraseña, conflicto, errores por campo, prueba aceptada, rechazada, desactivada y limitada, teclado, y teléfono y escritorio en tema claro.

## 9. Fase 9 · Interfaz: terceros con hasta tres correos

- [x] 9.1 Llevar `PartyContactFields` (formulario y `PartyDialog`) a una lista de hasta tres correos con «Agregar correo» y quitar, y el error de cada uno junto a su campo; verificar con pruebas de componentes: alta con varios, límite de tres, repetido, inválido, quitar, edición de un tercero existente que conserva sus correos y teclado.

## 10. Fase 10 · Interfaz: el correo del comprobante

- [ ] 10.1 Agregar `archive/email-section.tsx` en la pestaña de documentos de los seis detalles (design D14): el último envío con su insignia, su motivo y sus direcciones, la nota de Pruebas, el recordatorio de los dos RIDE de la liquidación, el historial plegable con los intentos, la atención de la pestaña cuando el último falló, y «Reenviar correo» (solo con `email.resend`) con las direcciones propuestas y editables; verificar con pruebas de componentes de cada estado, sin envíos, del reenvío con éxito, con error y repetido, sin permiso sin el botón, y teclado.
- [ ] 10.2 Agregar `email/email-destination-notice.tsx` a la confirmación «Emitir» de los seis editores (receptor con correos, sin correo o consumidor final, Pruebas, automático o despliegue apagado, sin servidor), con los correos del tercero o, en las notas, las direcciones de su factura; verificar con pruebas de componentes por tipo y por caso, incluido el operador.

## 11. Fase 11 · Interfaz: bandeja, avisos y revisión

- [ ] 11.1 Agregar a la bandeja el filtro «Correo» con «No enviado» (`correo=no-enviado`, en `filtersActive` y `clearFilters`) y el indicador del correo en la fila y en la tarjeta del teléfono; verificar con pruebas de componentes del filtro, de la dirección y del indicador.
- [ ] 11.2 Agregar a Avisos «N comprobantes sin enviar por correo» con el enlace a la bandeja filtrada, sin cambiar «Requieren atención» del tablero; verificar con las pruebas de los avisos.
- [ ] 11.3 Revisar las pantallas con la lista de comprobación del frontend (`docs/quality/frontend-checklist.md`) en escritorio y teléfono, solo tema claro, con sus entradas y fixtures en `visual/review`; documentarlas en `docs/architecture/` (`frontend.md`, `navigation-responsive.md`, `component-system.md`, `data-tables.md`, `forms-and-workflows.md` y `fiscal-emission.md`); verificar con capturas de la app desplegada.

## 12. Verificación

- [ ] 12.1 Ejecutar `corepack pnpm verify` y confirmar que pasa completo, incluidas las pruebas de integración del backend, `openapi:check` y la política de seguridad del navegador.
