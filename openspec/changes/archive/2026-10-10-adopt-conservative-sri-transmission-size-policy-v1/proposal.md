# Proposal

## Why

Hoy un contribuyente no puede transmitir ningún comprobante al SRI fuera de una sesión de
certificación en Pruebas.

- La aplicación exige una «política oficial» de tamaño que nunca se publicó, porque la ficha técnica
  v2.34 dice «320 Kb» sin definir la unidad ni qué se mide (Q-47).
- El 2026-10-09 el dueño del producto resolvió Q-47 **por política de producto**
  (`RESOLVED_BY_PRODUCT_POLICY_V1`). Todo envío individual al SRI, en Pruebas y en Producción, debe
  medir menos de 40 000 bytes en el XML firmado, en su base64 y en el cuerpo SOAP completo.
  - Es la política conservadora propia de EmiteYa: no afirma ser el límite oficial del SRI.
  - Solo se revisa con evidencia oficial nueva del SRI, mediante una decisión y un change nuevos.
- Hoy existen dos mecanismos para lo mismo: el tope de 40 000 bytes, que solo vale en la sesión de
  certificación de Pruebas, y un catálogo de «política oficial» que nunca tuvo datos. Esa duplicación
  ya no tiene propósito.

## What Changes

- **Una sola política de tamaño, `PRODUCT_CONSERVATIVE_POLICY_V1`, para Pruebas y Producción.**
  - Mide el XML firmado (UTF-8), su base64 exacto y el cuerpo SOAP final, construidos una sola vez.
    El cuerpo medido es el que recibe el transporte.
  - Las tres medidas deben ser menores que 40 000 bytes, con comparación estricta: 39 999 pasa,
    40 000 y 40 001 no.
  - El valor es una constante del código: ninguna variable de entorno lo cambia.
- **Bloqueo antes de la red.** Si una medida llega a 40 000 bytes:
  - no hay ninguna llamada ni ningún intento con el SRI, y el estado fiscal no cambia;
  - el motivo interno es `TRANSMISSION_SIZE_POLICY_EXCEEDED`, nunca el error 26 del SRI, `RETURNED`
    ni `NOT_AUTHORIZED`;
  - el comprobante no se trunca, comprime, modifica ni divide, y no se inventa una respuesta del SRI;
  - el mensaje de negocio es «El comprobante excede el límite de seguridad de transmisión de EmiteYa.
    Reduzca el contenido antes de enviarlo.», sin afirmar que el SRI permite como máximo 40 KB.
- **BREAKING para la configuración: se retira la sesión de certificación.**
  - Se quitan la bandera `SRI_CERTIFICATION_SAFETY_CAP_ENABLED` y el bloqueo de Producción ligado a
    ella.
  - Se quitan los motivos `CERTIFICATION_SIZE_CAP_EXCEEDED`, `CERTIFICATION_ENVIRONMENT_NOT_TEST`,
    `SIZE_POLICY_MISSING` y `TOO_LARGE`, con sus métricas.
  - `SRI_TRANSMISSION_ENABLED` se mantiene como interruptor general: apagada, no hay ninguna llamada.
  - La falta de una política de tamaño deja de ser una precondición: la política v1 siempre existe.
- **BREAKING para la API: se retira el catálogo `sri-transmission-policy`.** El catálogo de política
  oficial nunca se publicó. Se quitan:
  - su tabla, mediante una migración, su cargador y su consulta;
  - el endpoint `GET /fiscal-catalogs/sri-transmission-policy` y su vista en la pantalla de
    catálogos;
  - la política sintética que cargaban las pruebas.
- **Readiness.** Informa la política con la fuente `PRODUCT_CONSERVATIVE_POLICY_V1`, el límite y las
  medidas de la última comprobación, sin identificar el comprobante. Nunca informa
  `SRI_OFFICIAL_POLICY`.
- **Documentación.**
  - Q-47 queda resuelta por política de producto y deja de ser una compuerta de la certificación y del
    go-live.
  - El texto «320 Kb» de la ficha queda como fuente de contexto, no como definición.
  - Los límites de recursos (líneas, destinatarios, detalles) no garantizan que un comprobante sea
    transmisible. No se reducen en este change.

**Fuera de alcance:**
- El envío por lotes.
- Dividir o comprimir comprobantes.
- Reducir los límites de recursos.
- Cualquier interpretación «oficial» de 320 Kb.
- Endpoints, reintentos o clasificación de respuestas del SRI.
- Contactar al SRI: este change no transmite nada.
- La validación offline del P12 nuevo, que se hace aparte.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `sri-transmission`. Un requisito MODIFIED no puede quitar escenarios, así que los requisitos que
  pierden escenarios de la sesión de certificación se retiran y se reemplazan con otro nombre.
  - **Se reemplaza** «Transmisión habilitada por configuración» por «Interruptor general de la
    transmisión»: el mismo interruptor, sin precondición de tamaño ni sesión de certificación.
  - **Se reemplaza** «Límite de tamaño del envío» por «Política conservadora de tamaño del envío»: la
    política v1, su medición y su bloqueo antes de la red, en los dos ambientes.
  - **Requisito nuevo:** «Diagnóstico de la política de tamaño».
  - **Se retiran** los cuatro requisitos de la sesión de certificación: tope, medición, solo Pruebas
    y diagnóstico.
- `fiscal-catalogs`: se retira el requisito «Límite de tamaño del envío al SRI» (política oficial
  versionada).

## Impact

- **Backend:**
  - `fiscal`: dominio de la política, `transmit-handler`, `transmission-step`, `transmission-gate`,
    motivos y mensajes de parada;
  - `catalogs`: tipo, dataset, cargador, consultas, repositorio y ruta;
  - `config/env.ts` y `main.ts`.
  - Migración que elimina la tabla `sri_transmission_policy` y el tipo de catálogo.
- **Contratos y frontend:** la ruta del catálogo en `packages/contracts`, el OpenAPI generado y la
  vista de la pantalla de catálogos.
- **Pruebas:**
  - las de la política nueva;
  - el retiro de `synthetic-size-policy.ts` en las pruebas de integración que lo usaban;
  - las del catálogo y la readiness.
- **Documentación:**
  - `open-questions.md` (Q-47), `capabilities.md`, `sri-certification.md`, `fiscal-emission.md`,
    `database.md`, `sri-catalogs/README.md`;
  - la medición de los payloads de la certificación.
- **Sin dependencias nuevas.**
