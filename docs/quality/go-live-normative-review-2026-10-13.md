# Revisión normativa del go-live (2026-10-13)

Registro de las revisiones normativas que exige el go-live (`definition-of-done.md`: consumidor final
y Anexo 26, matriz normativa; `../product/open-questions.md`, «Antes del go-live»: Q-27, Q-37 y
Q-53). Solo fuentes oficiales fijadas con su SHA-256 y leídas sin conexión. Ningún tráfico al SRI:
ni Producción ni Pruebas.

**Resultado:** Q-27, Q-37 (alcance de v1) y Q-53 quedan resueltas, y las reglas de consumidor final
coinciden con la ficha. La matriz normativa queda **revisada con hallazgos abiertos**: H-01 es un
caso obligatorio del alcance declarado que el producto no cumple; H-02 y H-03 quedan para decisión.

**Actualización del 2026-10-13 (`block-unsupported-special-cases-before-emission`):** H-01 y H-02 quedan cerrados. El producto bloquea antes
de reservar los dos anexos que conoce y no soporta, y ningún caso obligatorio del alcance declarado
se omite en silencio. H-03 sigue como observación no bloqueante. La matriz normativa queda
**revisada**.

## Fuentes fijadas

| Fuente | Identificación | SHA-256 del PDF | Extracto |
| --- | --- | --- | --- |
| Ficha técnica de comprobantes electrónicos, esquema offline | Versión 2.34, publicada el 2026-07-27; 142 páginas; descargada de nuevo el 2026-10-13 | `7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9` | `../product/sri-catalogs/fuentes/ficha-v2.34-*.txt` |
| Resolución NAC-DGERCGC26-00000027 (proveedores de facturación electrónica) | Quinto Suplemento del Registro Oficial No. 335, 2026-07-28 | `8e0a219270439c2ebe8ba85b59599ec627fd3aad84cac17fba2eed3b3cc8d84b` | `nac-dgercgc26-00000027-proveedores.txt` |
| Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios | Edición del SRI, última modificación 2023-12-29 | `7828297fd49bda62e3edde8c4c8e56231348f5b1390018c885911a907e0b2334` | `reglamento-comprobantes-liquidacion-de-compra.txt` |
| Resolución NAC-DGERCGC18-00000233 (emisión, entrega y transmisión) | Segundo Suplemento del Registro Oficial 255, 2018-06-05; PDF escaneado | `03813b55c4c38d084975d3216c1b20d266a78b264ef52bcf53ff897c59e3ef2f` | `normativa-liquidacion-retenciones.txt`, sección 8 |

Los extractos viven en `../product/sri-catalogs/fuentes/`; los PDF no se versionan, como el resto de
las fuentes del proyecto.

## Q-27: conservación de los comprobantes

- **Fuente:** Reglamento de Comprobantes, art. 41 (reformado por el D.E. 99): «Los comprobantes de
  venta, documentos complementarios y comprobantes de retención, deberán conservarse durante el
  plazo mínimo de 7 años». Quien emite por medios electrónicos mantiene el archivo «en la forma que
  determine el Servicio de Rentas Internas», disponible ante cualquier requerimiento. El RALRTI, art.
  224, repite «no inferior a siete años» para el RIMPE.
- **Producto:** v1 nunca purga los comprobantes ni sus artefactos, que se archivan con su hash
  (ADR 0010).
- **Clasificación:** conforme y conservador. Sin cambio de código.
- **Operador:** los respaldos y una eventual baja de la instalación conservan el archivo al menos 7
  años desde cada emisión. El SRI no es un respaldo (CTX §31).

## Q-37: RUC del proveedor (Anexo 26)

- **Resolución, art. 2:** son proveedores los desarrolladores y dueños del código fuente (a) y los
  propietarios de licencias y del código fuente de sistemas desarrollados por terceros (b), en ambos
  casos «con la finalidad de ser comercializados».
- **Resolución, art. 5, y Anexo 26 de la ficha (página 135):** quien usa un sistema de facturación de
  un tercero incluye `<campoAdicional nombre="RUC Proveedor">` con el RUC del proveedor en
  `<infoAdicional>`.
- **Plazo del emisor:** 60 días **calendario** desde la publicación (disposición transitoria
  tercera; la nota de la página 135 de la ficha dice lo mismo). El Boletín 042 del SRI dice «60 días
  hábiles»: es informativo, contradice la resolución y no rige. Resuelve el C-09.
- **Política del producto (decisión del propietario, 2026-10-13):** el go-live de v1 soporta solo el
  uso propio o el suministro no comercial de EmiteYa. Es una política de alcance y de despliegue, no
  una afirmación jurídica general.
- **Conclusión para ese alcance: A, no aplica.** Sin comercialización de EmiteYa al emisor no hay
  proveedor en el sentido del art. 2.
- **Despliegue comercial** (EmiteYa vendido, licenciado o prestado como sistema o servicio de pago):
  no puede apoyarse en la conclusión A y necesita una clasificación nueva frente a la resolución. Con
  la interpretación identificada, si cae en la definición de proveedor, el resultado es **C, aplica y
  no está soportado**: el producto no escribe el campo «RUC Proveedor». No está soportado hasta un
  cambio fiscal explícito.
- Que la arquitectura pueda alojar varias empresas no decide Q-37, ni la falta de cobros
  implementados: decide el modelo real de distribución y uso.

## Q-53: dos ejemplares del RIDE de la liquidación de compra

- **Fuente confirmada:** NAC-DGERCGC18-00000233, art. 6, num. 2, lit. d (página 4 del PDF oficial,
  leída de nuevo el 2026-10-13): cuando se entrega impreso el RIDE de una liquidación de compra «se
  deberá emitir dos ejemplares del RIDE que deberán ser firmados por el receptor, a quien se
  entregará un ejemplar, mientras que el otro será conservado obligatoriamente por el receptor». Las
  reformas registradas de la resolución no tocan el art. 6.
- **Clasificación:** proceso operativo. El producto ya genera el RIDE de la liquidación en el archivo
  documental; no hace falta un subsistema de impresión ni de firmas.
- **Procedimiento del operador:** al entregar impresa una liquidación, imprimir dos ejemplares del
  RIDE desde el archivo, hacer firmar ambos por el receptor (el proveedor de la liquidación),
  entregarle uno y conservar el otro como dice el texto oficial, citado tal cual. El comprobante
  electrónico autorizado queda en el archivo (Q-27). El producto no registra firmas manuscritas ni
  el RIDE firmado.

## Reglas de consumidor final

Numeral 9.10 de la ficha (página 29): por encima de USD 50 se identifica al adquirente. El dataset
`consumer-final-policy` versión 1 fija 50.00 USD y la identificación `07` / `9999999999999`, y la
emisión de la factura lo aplica (`CONSUMER_FINAL_LIMIT_EXCEEDED`). Conforme.

## Matriz normativa (matriz de casos especiales del ADR 0014)

El dataset `special-case-matrix` versión 1 tiene los 26 anexos del índice de la ficha v2.34 (el mismo
PDF). Estado en el alcance declarado de v1:

| Anexo | Categoría | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 y 3 (XML 1.0.0 y 1.1.0), 10 (retención ATS 2.0.0), 14 (XAdES-BES), 17 (liquidación) | `CORE` | Soportados | Registro de esquemas de los seis tipos, firma compartida y certificación en Pruebas 7/7 |
| 2 (RIDE) | `CORE` | Soportado | Archivo documental de los seis tipos |
| 21 (agente de retención) | `CONDITIONAL_ISSUER_RULE` | Soportado | `agenteRetencion` en el `infoTributaria` común de los seis tipos |
| 22 (RIMPE) | `CONDITIONAL_ISSUER_RULE` | Soportado, con la observación H-03 | `contribuyenteRimpe` en el `infoTributaria` común |
| 24 (grandes contribuyentes) | `OUT_OF_MVP` (matriz versión 2) | Conocido, no soportado y bloqueado antes de reservar en `01`, `03`, `04` y `05` (H-01 cerrado) | Regla compartida de casos especiales y pruebas de emisión de los cuatro tipos |
| 26 (RUC del proveedor) | `CONDITIONAL_GO_LIVE` | Uso propio o no comercial: soportado (no aplica, Q-37). Suministro comercial: conocido, no soportado y bloqueado antes de reservar en los seis tipos (H-02 cerrado) | Q-37; pruebas de emisión de los seis tipos |
| 15 (compatibilidad de dispositivos) | `NOT_APPLICABLE` | No aplica | ADR 0014 |
| 4 a 9, 11 a 13, 16, 18 a 20, 23 y 25 | `OUT_OF_MVP` | Fuera del alcance declarado | La API no ofrece sus atributos. Un contribuyente obligado por su actividad (por ejemplo, combustibles o materiales de construcción) no usa el MVP para esas operaciones: el producto no infiere obligaciones (ADR 0014; `overview.md`) |

### H-01: el Anexo 24 se da por soportado y no se escribe (cerrado el 2026-10-13)

**Cierre (`block-unsupported-special-cases-before-emission`, decisión del propietario: fallar de forma cerrada en v1):** el 24 sale del conjunto
soportado del motor y la matriz versión 2 lo publica fuera del MVP. Con la empresa declarada gran
contribuyente, la factura, la liquidación de compra (comprobante de venta por el art. 1 del
Reglamento), la nota de crédito y la nota de débito se rechazan antes de reservar con
`SPECIAL_CASE_UNSUPPORTED`, sin consumir secuencial ni producir efecto fiscal. La guía de remisión
y el comprobante de retención no están en el anexo y se emiten. El anexo no se implementa: queda
como deuda.

Hallazgo original:

- **Fuente:** ficha v2.34, Anexo 24 (página 132): «Los comprobantes de venta, notas de crédito y
  notas de débito electrónicos deberán contener la leyenda "Gran Contribuyente" y el número de la
  resolución mediante la cual fueron calificados como tal, en la estructura del XML», en
  `<infoAdicional>`, como `<campoadicional>`.
- **Producto:** `SUPPORTED_SPECIAL_CASES` (`backend/src/modules/invoices/domain/evaluation.ts`)
  incluye el 24, así que una factura de una empresa declarada gran contribuyente se emite. Ningún
  builder escribe `infoAdicional` para ese caso, ni el RIDE lo muestra. La configuración tributaria
  solo guarda si la empresa es gran contribuyente, sin el número de resolución que exige el anexo.
  El design de `add-invoice-emission` decía que el anexo 24 no tenía elemento en el XSD; la ficha lo
  ubica en `infoAdicional`, que el XSD sí tiene.
- **Por qué bloquea:** es un caso obligatorio del alcance declarado (`CONDITIONAL_ISSUER_RULE`) que
  se degrada en silencio a un comprobante ordinario, contra el ADR 0014 y la spec
  `document-emission` («Casos especiales no soportados»).
- **Cambio de código:** sí, fiscal; necesita una decisión del propietario y su propio cambio
  OpenSpec.
- **Acción mínima:** bloquear de forma explícita, antes de reservar, la emisión de los comprobantes
  que cubre el anexo cuando la empresa se declara gran contribuyente, y sacar el 24 de los casos
  soportados. La alternativa es implementarlo: número de resolución en la configuración, campo
  adicional en el XML, RIDE y pruebas de XSD.

### H-02: el bloqueo del Anexo 26 cubre solo la factura (cerrado el 2026-10-13)

**Cierre (`block-unsupported-special-cases-before-emission`):** el mismo rechazo previo a la reserva, con `SPECIAL_CASE_UNSUPPORTED`, cubre
los seis tipos. El Anexo 26 sigue sin implementarse y el suministro comercial sigue sin soporte
(Q-37).

Hallazgo original:

- **Spec:** `document-emission`, «Casos especiales no soportados», escenario «Anexo 26 aplicable y
  no soportado»: con un RUC proveedor distinto del propio, la emisión de un comprobante se rechaza
  antes de reservar.
- **Producto:** solo la evaluación de la factura lo comprueba. La nota de crédito, la nota de débito,
  el comprobante de retención, la guía de remisión y la liquidación de compra no miran el RUC
  proveedor, y se emitirían sin el campo.
- **Alcance:** solo ocurre si se declara un RUC proveedor de un tercero, es decir, en el suministro
  comercial que v1 no soporta (Q-37). En el uso propio, el RUC proveedor queda vacío.
- **Acción mínima:** extender el mismo rechazo previo a la reserva a los otros cinco tipos, con sus
  pruebas.

### H-03: leyenda del negocio popular RIMPE (observación abierta, no bloqueante)

La ficha (Anexo 22, página 130) define «CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE», pero el tipo
`contribuyenteRimpe` de los XSD oficiales registrados solo admite «CONTRIBUYENTE RÉGIMEN RIMPE». El
producto escribe este último para cualquier categoría RIMPE declarada. Las fuentes oficiales se
contradicen, y resolverlo exige una aclaración oficial o un XSD nuevo, no una inferencia.
