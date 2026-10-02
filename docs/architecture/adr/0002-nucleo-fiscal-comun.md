# ADR 0002: Seis flujos documentales sobre un núcleo fiscal común

## Status

Accepted. Origen: ERS §22.2, ADR-002; CTX §68.

## Context

Los seis comprobantes comparten secuencial, clave de acceso, XML, XSD, firma, transmisión,
estados y archivo. Difieren en XSD, builder, reglas de negocio, catálogos, relaciones con
documentos sustento y campos específicos.

## Decision

Un núcleo fiscal común contiene numeración, clave de acceso, snapshot, máquina de estados,
firma, orquestación SRI y artefactos. Cada tipo de comprobante es un flujo con su builder,
sus validaciones y sus reglas. Los flujos dependen del núcleo y nunca entre sí; la
liquidación de compra se mantiene separada de la factura (ERS RF-253).

## Consequences

- La factura construye el núcleo y los otros cinco tipos lo reutilizan.
- El núcleo debe diseñarse para los seis tipos aunque se implemente con la factura.
- El diseño de `add-invoice-emission` valida el núcleo contra los XSD de los otros cinco tipos.
