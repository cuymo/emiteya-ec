# Proposal

## Why

El operador necesita certificar los seis tipos de comprobante en el ambiente de **Pruebas** del SRI
(ERS AC-03, S-3 online), pero la aplicación no transmite nada sin una política oficial de tamaño, y
esa política no existe.

- La ficha técnica v2.34 dice «320 Kb» sin definir la unidad ni qué representación se mide. Q-47
  sigue abierta y bloquea la transmisión general y el go-live.
- El dueño del producto aprobó, el 2026-10-09, una salvaguarda solo para la sesión de certificación:
  un **tope de seguridad de la certificación** (CERTIFICATION SAFETY CAP) de 40 000 bytes. Sale de la
  lectura convencional más restrictiva del texto oficial: 320 000 bits.
- La medición offline de los siete documentos planificados dio un máximo de 13 532 bytes
  (`docs/quality/sri-certification.md`, sección 2).

**Qué no es:**
- no resuelve Q-47;
- no es el límite oficial del SRI, ni el de Producción, ni un límite general de documento, ni una
  defensa de recursos, ni una regla del XSD;
- no es una funcionalidad nueva del MVP.

## What Changes

- **Activación.** Una bandera explícita de configuración, `SRI_CERTIFICATION_SAFETY_CAP_ENABLED`,
  que nace apagada. No cambia el valor por defecto de `SRI_TRANSMISSION_ENABLED`, y transmitir sigue
  exigiendo la transmisión habilitada.
- **El tope** es una constante del código de 40 000 bytes, no configurable: la bandera se puede
  cambiar, el valor no.
- **Con la bandera encendida, solo Pruebas:**
  - el sistema solo habla con el SRI sobre comprobantes del ambiente de Pruebas;
  - un comprobante de Producción se detiene antes de cualquier llamada de red, sin redirigirlo a
    Pruebas ni corregir su ambiente.
- **Medición en el último momento.** Antes del envío a la recepción, el sistema construye una sola
  vez el cuerpo final de la petición y mide:
  - los bytes UTF-8 del XML firmado;
  - los del base64 que lleva;
  - los del cuerpo SOAP completo.

  Ese mismo cuerpo es el que se envía. Solo se envía si los tres miden menos de 40 000 bytes (39 999
  pasa; 40 000 y 40 001 no). Nunca se trunca, comprime ni altera el documento.
- **Composición con una política oficial futura.** El tope solo hace más restrictivo al sistema:
  - con una política oficial vigente y la bandera encendida, deben permitir el envío las dos;
  - sin la bandera, rige solo la política oficial, como hoy;
  - sin política oficial y con la bandera encendida, un comprobante de Pruebas bajo el tope puede
    enviarse. Es la única excepción a «sin política de tamaño no se envía nada».
- **Errores propios.** Dos motivos de parada internos, distintos de cualquier respuesta del SRI: tope
  de la certificación superado y comprobante fuera de Pruebas. No hay intento de red, ni respuesta del
  SRI, ni transición fiscal. No equivalen a `RETURNED` ni al código 26 del SRI.
- **Observabilidad sin secretos.**
  - La readiness indica si el tope está activo, su valor y la fuente efectiva del límite de tamaño
    (`CERTIFICATION_CONSERVATIVE_CAP` o `SRI_OFFICIAL_POLICY`).
  - Cada envío o bloqueo en modo de certificación registra el ambiente y los tres tamaños, sin el
    XML, el base64 ni el SOAP.
- **Documentación.**
  - En el runbook de la certificación, la regla de los modos especiales distingue lo prohibido
    (atajos fiscales, saltar validaciones o la firma, fingir autorizaciones, relajar la seguridad) de
    lo permitido (controles adicionales que solo hacen más restrictiva la sesión de Pruebas).
  - Se registra Security Data como soportado por evidencia oficial, sin afirmar todavía que el P12
    concreto del operador es compatible.
  - Q-47 queda abierta y como compuerta del go-live.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `sri-transmission`:
  - **Requisitos que cambian:**
    - «Transmisión habilitada por configuración»: la precondición de tamaño se cumple también con el
      tope de la certificación;
    - «Límite de tamaño del envío»: la excepción de la sesión de certificación y la composición con
      el tope.
  - **Requisito nuevo:** el tope de seguridad de la certificación, con su activación, su ámbito solo
    de Pruebas, su medición exacta, su borde y sus errores.

## Impact

- **Backend:**
  - la configuración de entorno;
  - el handler del envío a la recepción y el ejecutor común de las llamadas al SRI;
  - el gateway del SRI, que recibe el cuerpo ya construido para enviar exactamente lo medido;
  - el interruptor de la transmisión, con su readiness y su métrica;
  - los motivos de parada y sus mensajes.
- **Sin migraciones** y sin cambios en los contratos de la API: el motivo de parada ya es texto.
- **Fuera de alcance:**
  - publicar la política oficial de Q-47;
  - cambiar los límites generales de documentos, los máximos de líneas, las defensas de recursos o la
    política de Producción;
  - el go-live.
