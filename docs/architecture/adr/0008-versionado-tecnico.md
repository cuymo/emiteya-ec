# ADR 0008: XSD, catálogos y reglas técnicas versionados

## Status

Accepted. Origen: ERS §22.2, ADR-008; CTX §3.1, §19, §53, §55.

## Context

El SRI cambia XSD, catálogos, tarifas, límites y endpoints, y los comprobantes históricos
deben seguir siendo reproducibles con la versión con que se emitieron.

## Decision

- Registro de esquemas con tipo, raíz, versión, archivo, hash SHA-256, origen y fecha de descarga. Los XSD se empaquetan en el repositorio y nunca se descargan en tiempo de ejecución.
- Si falta el XSD, su hash no coincide o la versión no está registrada, el comprobante no se envía.
- Catálogos, políticas y límites son datos con vigencia y fuente, no constantes del código.
- Cada comprobante registra en su snapshot las versiones de XSD, builder, catálogos, configuración y renderer.
- Los XSD antiguos se conservan.
- Versiones iniciales, decisión de proyecto de CTX §3.1: factura 1.1.0, liquidación de compra 1.1.0, nota de crédito 1.1.0, nota de débito 1.0.0, guía de remisión 1.1.0 y retención 2.0.0. Las versiones 2.0.0 y 2.1.0 de factura se habilitan solo cuando su caso especial esté implementado y probado.

## Consequences

- Una actualización normativa es un cambio de datos más pruebas, no una reescritura.
- El registro de esquemas y los catálogos requieren mantenimiento en cada release.
- El checklist de CTX §54 se aplica antes de cada release; dónde vive el registro normativo se decide en Q-40.
