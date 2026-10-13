# Requisitos no funcionales

Trazabilidad de los requisitos no funcionales, de seguridad y de API del ERS, y de las
exigencias técnicas de CTX, hacia el mecanismo que los cumple, el documento que lo detalla y
la forma de verificarlo. Aplican a todos los cambios OpenSpec.

## Calidad y operación (ERS §14)

| ID      | Requisito                                                                     | Cómo se cumple                                                                                         | Dónde                                     | Verificación                                   |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| RNF-001 | Web moderna; backend en contenedores Linux.                                   | Next.js y Express empaquetados con Docker.                                                             | `stack.md`, `deployment.md`               | Build de imágenes en CI.                       |
| RNF-002 | Base relacional transaccional; PostgreSQL recomendado.                        | PostgreSQL con migraciones Prisma.                                                                     | `database.md`                             | Migraciones en CI contra PostgreSQL.           |
| RNF-003 | Reserva de secuenciales segura entre procesos e instancias.                   | Actualización con bloqueo de fila en transacción más restricción única.                                | `fiscal-emission.md`, ADR 0003            | 100+ reservas paralelas sin duplicados (AC-04). |
| RNF-004 | La caída del SRI no impide la consulta local ni causa duplicados.             | Pasos de red en jobs persistidos, circuit breaker, reconciliación por clave.                           | `fiscal-emission.md`, ADR 0005, ADR 0012  | Pruebas de caída de red y casos A–E.           |
| RNF-005 | P95 < 2 s en catálogos y comprobantes, sin la latencia del SRI.               | Paginación en servidor, índices por consulta crítica, emisión que no espera al SRI. Volumen de referencia en Q-26: 10 000 terceros y 10 000 productos medidos; 100 000 facturas por empresa y 10 usuarios concurrentes adoptados provisionalmente para la emisión, medidos localmente hasta `SIGNED` por etapa. | `database.md`, `../quality/performance.md` | Medición con el volumen de referencia.       |
| RNF-006 | 100 % de emisiones y cambios críticos auditables.                             | Auditoría y transiciones de estado en la misma transacción que la acción.                              | `../quality/observability.md`             | Pruebas que verifican el evento por acción.    |
| RNF-007 | Respaldos documentados y restauración probada.                                | Respaldo de base de datos, artefactos y clave maestra por separado; procedimiento de restauración.     | `deployment.md`, ADR 0010, ADR 0011       | Restauración completa (AC-10).                 |
| RNF-008 | Configuración por entorno y secretos; sin dependencia de un proveedor cloud.  | Variables validadas al arrancar; puertos para almacenamiento y secretos con adaptadores locales.       | `deployment.md`                           | Arranque falla ante variables faltantes.       |
| RNF-009 | Navegación por teclado, etiquetas y contraste.                                | Patrones de interfaz y checklist de CognitiveStack.                                                    | `frontend.md`, `../quality/frontend-checklist.md` | Checklist por pantalla.                |
| RNF-010 | Español, USD y fechas de Ecuador.                                             | Interfaz en español; USD fijo; zona horaria `America/Guayaquil` para fechas fiscales.                  | `../product/glossary.md`, `deployment.md` | Pruebas de fecha cerca de medianoche.          |
| RNF-011 | Módulos fiscales desacoplados de la UI y de la persistencia.                  | Dominio fiscal puro y puertos de CTX §43.                                                              | `ARCHITECTURE.md`, ADR 0007               | Regla de dependencias verificada por lint.     |
| RNF-012 | Logs estructurados, métricas y health checks.                                 | Logs JSON con correlación; métricas de CTX §48; salud de base de datos, SRI y jobs (el reloj, en la infraestructura). | `../quality/observability.md`, `fiscal-emission.md` | Endpoint de salud en CI.             |

## Seguridad (ERS §15)

| ID      | Requisito                                                                     | Cómo se cumple                                                                                         | Dónde                                     | Verificación                                   |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| SEC-001 | Contraseñas con hash robusto y salt.                                          | Better Auth.                                                                                           | `authentication.md`                       | Sin hash propio en el código.                  |
| SEC-002 | Certificado y contraseña cifrados en reposo; KMS cuando exista.               | Cifrado envolvente con clave maestra externa a la base de datos; puerto para KMS.                      | ADR 0011                                  | Prueba de que la base de datos no contiene el secreto en claro. |
| SEC-003 | Sin XML completo con datos personales en logs de producción.                  | Redacción por defecto; solo identificadores y códigos.                                                 | `fiscal-emission.md`, CTX §47             | Revisión de logs en pruebas de integración.    |
| SEC-004 | Sin contraseñas, secretos, tokens ni contenido del P12 en logs.               | Tipos de secreto que no se serializan; redacción en el logger.                                         | ADR 0011, `../security/hardening.md`      | Prueba de logs y respuestas (ERS §20).         |
| SEC-005 | Control de acceso server-side a configuración, firma y secuenciales.          | Política de roles centralizada, denegada por defecto.                                                  | `../security/access-control.md`           | Pruebas de acceso por rol.                     |
| SEC-006 | Protección contra CSRF, XSS e inyección SQL.                                  | Cookies HTTP-only y same-site de Better Auth, consultas parametrizadas de Prisma, encoding en React, CSP. | `../security/hardening.md`             | Escaneo y pruebas de seguridad básicas.        |
| SEC-007 | Auditoría de firma, secuencial, ambiente y datos tributarios.                 | Eventos de auditoría con valores anteriores y nuevos redactados.                                       | `../product/domain-model.md` BR-53        | Pruebas por operación.                         |
| SEC-008 | Respaldo cifrado o cómo implementarlo.                                        | Procedimiento de respaldo cifrado documentado.                                                         | `deployment.md`                           | Restauración desde respaldo cifrado.           |
| SEC-009 | Ubicación de datos y responsabilidades en self-hosted.                        | Sección de responsabilidades del operador en la documentación de instalación.                          | `deployment.md`                           | Revisión de la documentación de release.       |
| SEC-010 | Exportar datos y artefactos del contribuyente. | Capacidad `data-portability`, cerrada por `add-data-portability` (archivado el 2026-10-08): paquete `PORTABILITY_FORMAT_V1` (Q-28 resuelta). | `../product/capabilities.md` | Verificación independiente del paquete: `SHA256SUMS`, lectores ZIP, XLSX y JSON independientes, y los XSD para los XML; sin reimportación (AC-10 se verifica con la restauración del respaldo operativo). |

## API (ERS §17)

| ID      | Requisito                                                       | Cómo se cumple                                                        | Dónde                                     | Verificación                       |
| ------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------- |
| API-001 | Contratos versionados.                                          | Prefijo de versión y esquemas Zod de entrada y salida (Q-29).          | `backend.md`                              | Pruebas de contrato.               |
| API-002 | Validación server-side independiente de la UI.                  | Zod en la frontera HTTP y reglas de dominio en el servidor.           | `backend.md`                              | Pruebas de rechazo por endpoint.   |
| API-003 | `Idempotency-Key` en la emisión.                                | Reclamo atómico antes de ejecutar (Q-30).                             | `idempotency.md`, `fiscal-emission.md`    | Pruebas de idempotencia (AC-05).   |
| API-004 | Sin secretos de firma por API.                                  | Respuestas con listas permitidas; el certificado no tiene endpoint de lectura. | ADR 0011                         | Prueba de respuestas.              |
| API-005 | OpenAPI.                                                        | Especificación generada desde los esquemas en `docs/generated/`.      | `../generated/README.md`                  | Generación en CI.                  |
| API-006 | Licencia y `CONTRIBUTING.md` con reglas de contribución y seguridad. | Archivos en la raíz del repositorio antes de v1.0 (Q-33).        | `../quality/definition-of-done.md`        | Checklist de go-live.              |

## Exigencias técnicas de CTX

| Exigencia                                              | Cómo se cumple                                                               | CTX       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | --------- |
| Reloj sincronizado con NTP.                            | Requisito de la infraestructura, con evidencia operativa fuera de la aplicación. | §20.5     |
| Sin certificados TLS del SRI fijados en el código.     | TLS estándar del runtime; endpoints configurables.                           | §7.5      |
| Límite de 320 KB por comprobante.                      | Parámetro versionado verificado tras la firma.                               | §29       |
| Timeouts, backoff con jitter y circuit breaker.        | Política del cliente SRI.                                                    | §33       |
| Respuestas originales del SRI conservadas.             | Artefactos de respuesta antes de clasificar.                                 | §44       |
| Ambiente de Pruebas del SRI fuera de pruebas de carga. | Clientes simulados en CI.                                                    | §49       |
