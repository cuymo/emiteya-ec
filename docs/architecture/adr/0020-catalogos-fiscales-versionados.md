# ADR 0020: Catálogos fiscales como datos normativos versionados del sistema

## Status

Accepted el 2026-10-02 (resuelve Q-25). Origen: ERS RF-234, SRI-REQ-12; CTX §12.5, §16.4, §18,
§53, §55; ADR 0008.

## Context

Los códigos fiscales oficiales (impuestos, tarifas, formas de pago, tipos de identificación,
retenciones) cambian por normativa, y un comprobante emitido debe poder reproducirse con los
valores vigentes cuando se emitió. Un código inventado o editado por un usuario produce un XML
tributariamente incorrecto. El ADR 0008 ya fija que catálogos, políticas y límites son datos con
vigencia y fuente; faltaba decidir quién los mantiene y qué puede hacer cada empresa con ellos.

## Decision

- **Son datos del sistema, no de la empresa.** Los catálogos fiscales oficiales son datos normativos versionados que el proyecto distribuye. Su flujo es: fuente oficial → dataset versionado en el repositorio → release con su migración → catálogo disponible para todas las empresas de la instalación.
- **Lo que guarda cada entrada**, cuando aplique: tipo de catálogo (`catalogType`), código (`code`), descripción oficial (`officialLabel`), vigente desde (`effectiveFrom`), vigente hasta (`effectiveTo`), documento fuente (`source`), versión de la fuente (`sourceVersion`) y estado normativo (`normativeStatus`). Cada catálogo añade los atributos propios de su semántica (una tarifa de IVA no es igual que una de ICE); el modelo concreto lo define el cambio que los implementa.
- **Nada histórico se sobrescribe.** Una actualización oficial crea entradas o versiones nuevas. Una entrada publicada no cambia su código, su descripción oficial, sus valores ni su inicio de vigencia; una versión posterior del dataset solo puede cerrar una vigencia abierta o cambiar su estado normativo, y siempre con la fuente que lo justifica. Además, cada comprobante copia los valores que usa en su snapshot (BR-21).
- **El administrador de una empresa no crea ni modifica** códigos, descripciones oficiales, tarifas ni vigencias. Solo puede habilitar o deshabilitar para su empresa las entradas cuya disponibilidad por empresa tenga sentido; esa habilitación vive en una tabla propia, aislada por empresa (ADR 0009), y nunca altera comprobantes emitidos.
- **Sin sincronización con el SRI en tiempo de ejecución** en el MVP. Los datasets se actualizan con cambios controlados del producto (proceso de CTX §53 y checklist de CTX §54); el registro de cambios normativos vive en el repositorio (Q-40).
- **Auditoría.** Cargar o actualizar un dataset como parte de una release no genera un evento por empresa ni por fila: la trazabilidad es el dataset versionado con su fuente. Habilitar o deshabilitar una entrada para una empresa sí se audita cuando afecta al comportamiento tributario.
- **`facturacion-electronica-ec` no es la fuente** (ADR 0018). Sus catálogos y validadores no son canónicos. Una prueba de contrato puede comparar los valores coincidentes de la librería con los nuestros; una discrepancia se investiga contra la fuente oficial y nunca se resuelve adoptando en silencio el valor de la librería.

## Consequences

- Una actualización normativa es un cambio de datos con su fuente, pruebas y release, no una edición en producción ni una reescritura de código.
- Una instalación no puede corregir por sí misma un catálogo desactualizado: necesita una versión nueva del producto. Es el precio de no permitir códigos inventados.
- Cada dataset necesita una fuente oficial citable; transcribirla y revisarla es trabajo de cada release (CTX §54).
- El cambio `add-business-catalogs` define el formato de los datasets, el mecanismo de carga, el modelo de vigencia y qué entradas admiten habilitación por empresa.
