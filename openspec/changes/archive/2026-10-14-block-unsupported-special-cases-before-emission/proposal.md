# Proposal

## Why

La revisión de la matriz normativa del go-live (`docs/quality/go-live-normative-review-2026-10-13.md`)
encontró dos casos especiales que el producto no cumple y no bloquea. Los dos dejan emitir un
comprobante ordinario donde la norma exige otra cosa, contra el ADR 0014 y la spec
`document-emission` («Casos especiales no soportados»). H-01 bloquea el go-live. Es una corrección
de seguridad fiscal acotada: falla de forma explícita en lugar de emitir un XML incompleto.

- **H-01, Anexo 24 (grandes contribuyentes).**
  - La ficha v2.34 (página 132; PDF con SHA-256 `7333aebf…`) exige en «los comprobantes de venta,
    notas de crédito y notas de débito electrónicos» la leyenda «Gran Contribuyente» y el número de
    la resolución, en `<infoAdicional>`.
  - El producto declara el anexo 24 soportado (`SUPPORTED_SPECIAL_CASES` de la factura), pero ningún
    builder escribe esa leyenda, el RIDE no la muestra y la configuración tributaria no guarda el
    número de resolución.
  - Una empresa declarada gran contribuyente emite hoy facturas sin ese requisito. Las notas de
    crédito, las notas de débito y las liquidaciones de compra ni siquiera miran la declaración.
- **H-02, Anexo 26 (RUC del proveedor).**
  - La spec vigente exige rechazar antes de reservar la emisión de cualquier comprobante cuando la
    empresa declara un RUC proveedor distinto del suyo.
  - Solo la factura lo hace. Los otros cinco tipos se emitirían sin el campo «RUC Proveedor».
  - Ocurre solo en el suministro comercial de EmiteYa, que v1 no soporta (Q-37), pero el bloqueo
    debe ser coherente.

**Decisión del propietario (2026-10-13):** fallar de forma cerrada en v1. El Anexo 24 queda conocido,
no soportado y bloqueado; su implementación se difiere. H-02 entra en este mismo cambio. Ni el Anexo
24 ni el Anexo 26 se implementan.

## What Changes

- **Anexo 24 bloqueado antes de reservar.** Con la empresa declarada gran contribuyente, la emisión
  de los tipos que cubre el anexo se rechaza antes de reservar el número, sin consumir secuencial,
  clave de acceso, snapshot, movimiento de inventario, trabajo de transmisión ni ningún otro efecto
  fiscal irreversible. Tipos cubiertos, derivados de la ficha y del Reglamento de Comprobantes, art.
  1 (comprobantes de venta: facturas y liquidaciones de compra):
  - factura (`01`);
  - liquidación de compra (`03`);
  - nota de crédito (`04`);
  - nota de débito (`05`).

  El comprobante de retención (`07`) y la guía de remisión (`06`) no están en el anexo y no cambian.
- **Anexo 26 bloqueado en los seis tipos.** Con un RUC proveedor distinto del propio, la emisión de la
  factura, la liquidación de compra, la nota de crédito, la nota de débito, la guía de remisión y el
  comprobante de retención se rechaza antes de reservar, igual que la factura hoy.
- **Un solo error:** el `SPECIAL_CASE_UNSUPPORTED` que ya usa la factura, ahora también en los otros
  cinco tipos. Su mensaje identifica el anexo. Sin códigos por tipo ni por anexo. Los rechazos no se
  auditan, como los demás rechazos previos a la reserva.
- **El Anexo 24 deja de figurar como soportado:**
  - sale de los casos especiales soportados del motor;
  - la matriz publicada lo clasifica fuera del MVP, en una versión nueva del dataset
    `special-case-matrix`, con su tema y su número;
  - el conocimiento del anexo se conserva.
- **La declaración de gran contribuyente se conserva** en la configuración tributaria: basta para
  activar el bloqueo. No se añade el número de resolución, ni pantalla, ni campo del XML, ni del RIDE.
- **Documentación:**
  - el ADR 0014 enmendado;
  - el manifiesto de catálogos;
  - `fiscal-emission.md`;
  - la revisión normativa del go-live, que cierra H-01 y H-02;
  - la `definition-of-done.md`;
  - una fila de deuda con lo que exigirá soportar a los grandes contribuyentes en el futuro: número
    de resolución, validación, snapshot, `infoAdicional`, RIDE, cobertura por tipo y pruebas contra
    la fuente fijada.

**Fuera de alcance:**
- Implementar el Anexo 24 o el Anexo 26, y habilitar el suministro comercial: la política de Q-37 no
  cambia.
- H-03, la leyenda del negocio popular RIMPE: queda como observación por el conflicto entre la ficha y
  el XSD, sin cambio de ejecución.
- Pantallas nuevas, avisos en la configuración tributaria o en la preparación para emitir.
- Cualquier otro anexo, el XML, el XSD, la firma, el SOAP, los endpoints del SRI, la reconciliación, la
  numeración y la evidencia de certificación. Ningún tráfico al SRI.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `document-emission`: «Casos especiales no soportados» cubre el Anexo 24 en los cuatro tipos que
  alcanza y el Anexo 26 en los seis, siempre antes de reservar y sin consumir recursos fiscales.
- `fiscal-catalogs`: la matriz de casos especiales publica el Anexo 24 fuera del MVP.

## Impact

- **Backend:**
  - una regla compartida de casos especiales del emisor en `fiscal`;
  - la evaluación de la factura y el contexto de emisión de los otros cinco tipos, que ya leen la
    configuración vigente y solo amplían el tipo de su perfil (`largeTaxpayer` y `providerRuc` ya
    viajan en la configuración);
  - un dataset `special-case-matrix` versión 2.

  Sin migración de base de datos.
- **API:** `SPECIAL_CASE_UNSUPPORTED` se añade a los códigos de error de la nota de crédito, la nota de
  débito, el comprobante de retención, la guía de remisión y la liquidación de compra (cambio aditivo
  del contrato y del OpenAPI generado). Sin campos nuevos.
- **Frontend:** muestra el mensaje del servidor en el rechazo de la emisión, sin pantallas nuevas.
- **Pruebas:** la regla compartida, cada tipo emitido y la matriz publicada, sin tráfico al SRI.
- **Go-live:** con el cambio aplicado y verificado, H-01 y H-02 quedan cerrados y la matriz normativa
  sin casos obligatorios omitidos en silencio.
