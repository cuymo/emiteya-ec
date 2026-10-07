# Tasks

## 1. Cabecera común sin total ni comprador único (P10)

- [x] 1.1 Crear la migración aditiva `document_recipients_optional_totals` (design D10 y D26):
  - `total`, `buyer_identification` y `buyer_name` de `electronic_document` admiten `NULL`;
  - `electronic_document_values_check` con `("document_type" = '06') = ("total" IS NULL)` y las mismas igualdades para el comprador, conservando el dominio `importe` cuando el total existe;
  - `electronic_document_recipient` (empresa, comprobante, posición, identificación y nombre), con FK compuesta, índice `(company_id, identification)` y la guarda que impide `UPDATE` y `DELETE`.

  Verificar con pruebas de integración del esquema:
  - una factura, nota o retención sin total o sin comprador, rechazada;
  - un `06` con total o con comprador, rechazado;
  - el trigger de inmutabilidad con nulos;
  - destinatarios que no cambian ni se borran;
  - las filas existentes que cumplen el `CHECK` nuevo.

  Añadir la migración a `migrations.test.ts` sin deriva y documentar la invariante en `database.md`
- [x] 1.2 Cambiar `DocumentColumns` a la unión `BUYER` / `RECIPIENTS`, `StoredDocument` con comprador y total nulos posibles y la guarda `documentBuyer` de `fiscal`, y usarla en la factura, las notas y la retención donde hoy leen el comprador o el total (design D10). La reserva escribe los destinatarios en la misma transacción. Verificar con pruebas unitarias de la guarda y de la reserva con `RECIPIENTS`, y que los contratos y los golden del XML y del RIDE de la factura, las notas y la retención pasan sin cambios
- [x] 1.3 Cambiar la bandeja (design D10 y D21): `documentListItemSchema` con `buyer` y `total` nulos posibles y `recipients: { count, name | null }`, con la refinación por tipo; la lectura que arma el resumen; el filtro por identificación y la búsqueda por nombre con la rama de destinatarios; y en el frontend el receptor derivado (comprador, nombre del único destinatario o "N destinatarios") y el total "—" con el texto accesible "Sin total monetario". Verificar con pruebas de contrato (cada combinación prohibida), pruebas HTTP de la bandeja con un `06` sintético de uno y de varios destinatarios, filtro por la identificación del segundo destinatario y los demás tipos sin cambios, y pruebas de componente del receptor y del total. Regenerar `docs/generated/openapi.json` y documentar el cambio de la bandeja en `fiscal-emission.md`

## 2. Esquema de la guía

- [x] 2.1 Crear la migración aditiva `add_shipping_guides` (design D26):
  - `shipping_guide_draft`, con `recipients` en `JSONB`, sus `CHECK` de forma y tamaño y la guarda que impide cambiar o borrar un borrador emitido;
  - `shipping_guide`, inmutable, con el establecimiento de origen opcional (FK compuesta por empresa), los `CHECK` del transportista (origen y tercero coherentes, identificación de hasta 13, placa de 1 a 20 sin saltos de línea), fin no anterior al inicio y conteos positivos, y el trigger que exige un `06` de la empresa con el inicio no anterior a su fecha de emisión;
  - `shipping_guide_recipient`, inmutable, con FK a `electronic_document_recipient`, los `CHECK` de coherencia entre clase, sustento, factura, caso y declaración, y el trigger que exige una factura `01` autorizada de la empresa y del ambiente de la guía, y para `OWN_COMPANY` una guía con origen distinto de su destino;
  - el trigger de restricción diferido que impide confirmar un `06` sin su registro, sin destinatarios en las dos tablas, con conteos distintos o con posiciones que no son contiguas desde 1;
  - `shipping_guide.emit` en el `CHECK` de `idempotency_record`.

  Verificar con pruebas de integración del esquema:
  - un `06` sin registro o sin destinatarios, rechazado al confirmar;
  - las facturas, notas y retenciones no afectadas por el trigger;
  - una factura sustento de otra empresa, de otro ambiente, sin autorizar o de otro tipo, rechazada;
  - `OWN_COMPANY` sin la excepción de establecimientos propios, sin origen o con el destino igual al origen, rechazado;
  - un inicio anterior a la fecha de emisión, rechazado;
  - registro y destinatarios inmutables y borrador emitido inmutable;
  - la operación nueva en el registro de idempotencia
- [x] 2.2 Añadir las tablas a `migrations.test.ts` y documentarlas en `database.md`, con el acoplamiento intencional del trigger diferido. Verificar que `migrations.test.ts` pasa sin deriva

## 3. Contratos, permisos y límites

- [x] 3.1 Crear `packages/contracts/src/shipping-guides.ts` (design D22): el borrador estricto con el transportista, los destinatarios, el sustento tipado y los detalles; la emisión con `exceptionDeclaration`; los casos de excepción con su texto oficial y `SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION = 1`; las opciones, la vista previa, las vistas de lista y detalle, la transmisión, los códigos de error y los máximos absolutos. Registrar las rutas en `apiRoutes` junto con su router, en los grupos 6 a 8, como en el cambio 12: la prueba que compara el registro con los routers exige que lleguen juntos. Verificar con pruebas de contratos que se rechazan:
  - un precio, un impuesto, `detallesAdicionales`, un documento aduanero, varias placas o un `companyId`;
  - un número, una autorización o una fecha de sustento escritos a mano, la venta itinerante o un caso desconocido;
  - la dirección de partida enviada con un origen elegido, la dirección o el código de destino enviados para la propia empresa, y los códigos enviados con un producto;
  - una cantidad como número, en cero, negativa, con 7 decimales o con 19 dígitos;
  - un código de destino que no tiene 3 dígitos y una placa de 21 caracteres;
  - más elementos que los máximos absolutos
- [x] 3.2 Añadir `shippingGuides.read`, `shippingGuides.draft`, `shippingGuides.emit` y `shippingGuides.retrySigning` para ADMIN y OPERATOR, y `shippingGuides.reconcile` solo para ADMIN, en `access-policy.ts`, su espejo del frontend y `access-control.md` (design D24). Verificar con `access-policy.test.ts`, la prueba de espejo y la prueba de documentación de la matriz
- [x] 3.3 Añadir `SHIPPING_GUIDE_MAX_RECIPIENTS`, `SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT` y `SHIPPING_GUIDE_MAX_DETAILS` al esquema de entorno con sus valores por defecto y sus rangos (design D23), y documentarlas en `deployment.md` como defensa de recursos, no límites del SRI. Verificar con pruebas del esquema de entorno: valor por defecto, valor configurado y valor fuera de rango rechazado

## 4. Dominio de la guía

- [x] 4.1 Implementar la evaluación pura en el orden de design D12, con D3 a D9 y los límites compuestos de D23: transportista `SELF`/`PARTY`, placa, fechas contra la fecha de evaluación, partida con su origen (obligatorio con la excepción d), destinatarios `PARTY`/`OWN_COMPANY` con el destino distinto del origen y sin comparar con el establecimiento del punto, sustento tipado, coherencia entre caso y destinatario, detalle con producto o libre, cantidad mayor que cero y la declaración requerida. Verificar con pruebas unitarias cada rechazo con su código y su posición, el límite global de detalles que rige aunque los individuales permitan más, que el inicio igual a la emisión y un traslado de 60 días se aceptan, que un traslado propio emitido desde el establecimiento de origen, el de destino o un tercero se acepta, y que una factura a consumidor final con un destinatario identificado se acepta
- [x] 4.2 Implementar el snapshot autosuficiente de design D11 y su construcción, con la partida y su establecimiento de origen, el establecimiento de destino de cada traslado propio, la declaración `USER_DECLARED` por destinatario (caso, versión, actor y momento) y los datos de la factura tomados de su documento inmutable. Verificar con pruebas unitarias que guarda el transportista con su origen, los dos establecimientos con su identidad, código y dirección, cada destinatario con su sustento y su detalle, las cantidades canónicas (`2.500` como `2.5`) y que no lee nada después de construido. Añadir a `decimal-policy.md` la cantidad de la guía mayor que cero como política del proyecto
- [x] 4.3 Alinear la documentación durable con el `/opsx:update` del 2026-10-06: Q-51 (P2 con origen y destino registrados, activos y distintos y la partida derivada del origen; la precarga no autoritativa; la factura a consumidor final como política del MVP; conductor frente a transportista), BR-76, BR-77 y BR-81 de `domain-model.md`, la trazabilidad de `shipping-guides` en `capabilities.md`, el glosario y las decisiones de `fiscal-emission.md`. Verificar que ninguno de esos documentos afirma ya que el destino puede ser el establecimiento de partida libre ni que el tipo vigente del producto representa la línea facturada

## 5. XML de la guía

- [x] 5.1 Crear `shipping-guide-xml-builder.ts` para `guiaRemision` 1.1.0 desde el snapshot (design D16), con `infoTributaria` compartida y sin `rise`, `docAduaneroUnico`, `detallesAdicionales`, `maquinaFiscal`, `infoAdicional` ni nodos vacíos. Verificar con golden fixtures de bytes exactos, todos validados contra el XSD oficial: transporte propio y tercero; destinatario con factura; varios destinatarios con factura y excepciones; la propia empresa con origen y destino distintos y la partida del origen; ruta y código de un tercero; producto y línea libre; 6 decimales y forma canónica; caracteres especiales; longitudes máximas
- [x] 5.2 Crear `shippingGuideSigningProfile` y firmar con el firmador vigente y el tipo `06`, con el XSD antes y después de firmar. Verificar que el XML firmado valida, que el artefacto lleva el tipo `06` y que la firma de la factura, las notas y la retención no cambia

## 6. Lecturas, borradores, vista previa y opciones

- [x] 6.1 Implementar los puertos `ShippingPartyReader`, `ShippingProductReader` y `ShippingInvoiceReader` (sobre `invoiceCreditSource`, sin cambiarla) compuestos por `main.ts`, y las rutas `/shipping-guides/carriers`, `/shipping-guides/recipients`, `/shipping-guides/eligible-invoices`, `/shipping-guides/eligible-invoices/{invoiceId}/goods` y `/shipping-guides/options` (design D9 y D22). Verificar con pruebas HTTP: transportistas con `selectable` y su motivo; destinatarios sin el consumidor final ni el `08`; facturas autorizadas del ambiente vigente con búsqueda; todas las líneas de una factura con sus datos históricos y su sugerencia (`PRODUCT` para las que hoy se resuelven como bien activo, `FREE_LINE` para las demás), sin rotular ninguna como servicio ni como no trasladable, y una factura sin líneas resolubles que sigue siendo elegible; las opciones con los casos, los establecimientos activos y los límites efectivos; `403`, `401` y `404` con referencias de otra empresa
- [x] 6.2 Implementar los borradores con su vista previa (`/shipping-guides/drafts`, design D12), incluido `{ fromInvoiceId }` y la dirección de partida propuesta. Verificar con pruebas HTTP: borrador incompleto que se guarda sin reservar; vista previa con los problemas por destinatario y detalle; la propuesta desde la factura con su comprador, su sustento y solo las sugerencias `PRODUCT` como detalle; el origen sin valor por defecto y la partida derivada al elegirlo; versión del borrador; borrador emitido inmutable; aislamiento por empresa. Documentar las rutas en `fiscal-emission.md`
- [x] 6.3 Aplicar a `POST /shipping-guides/drafts` y `PUT /shipping-guides/drafts/{draftId}` un límite propio del cuerpo JSON de 2 MiB (design D23, segunda capa), sin cambiar el límite global de 100 KB, con el contrato y los límites estructurales aplicados después de leer el cuerpo. Verificar con pruebas HTTP sobre `main.ts`: un borrador dentro de los valores por defecto se acepta; uno en los máximos absolutos con textos multibyte de longitud máxima no recibe `413` y llega a la validación del dominio; un cuerpo de más de 2 MiB recibe `413`; uno de menos de 2 MiB con 301 detalles se rechaza por el límite de detalles, no por tamaño; la emisión y otras rutas conservan los 100 KB. Documentarlo en `fiscal-emission.md`, `backend.md` y `deployment.md`

## 7. Emisión de la guía

- [x] 7.1 Implementar la emisión (`POST /shipping-guides`) con las comprobaciones previas, la declaración de design D14 y la transacción de `RESERVED` de design D13, sin I/O externo dentro: idempotencia `shipping_guide.emit` con la huella de design D15, `reserveDocumentIn` con `06` y las columnas `RECIPIENTS`, el snapshot, el registro y sus destinatarios, la auditoría `shipping_guide.reserved`, la firma después del commit y las métricas de design D27. Verificar con pruebas HTTP:
  - guía de uno y de varios destinatarios firmada con su propio contador;
  - la vista previa, el snapshot, el XML y la consulta con los mismos datos;
  - cada rechazo de la evaluación sin reservar número, entre ellos el inicio anterior a la emisión, un borrador emitido otro día, un transportista sin el rol, un traslado propio sin origen o con el mismo establecimiento como origen y destino;
  - la declaración ausente o con otra versión rechazada, y congelada por destinatario con caso, versión, actor y momento cuando se confirma; la misma clave con otra declaración es otra huella;
  - un tercero, un producto o un establecimiento que cambia después de reservar no cambia el XML firmado;
  - doble envío secuencial y simultáneo con una sola guía; repetición que reanuda la firma; clave reutilizada `409` y sin clave `400`;
  - eventos de auditoría sin direcciones, XML ni SOAP, y ninguno en los rechazos;
  - `emitted-document-types.test.ts` con `/shipping-guides` y sin liquidación.

  Documentar la emisión, la declaración, la idempotencia y los códigos en `fiscal-emission.md` y las métricas en `observability.md`
- [x] 7.2 Probar la atomicidad forzando un fallo después de cada paso de la transacción. Verificar que no quedan secuencial, clave, comprobante, destinatarios, registro, snapshot, borrador emitido, idempotencia ni auditoría
- [x] 7.3 Probar con PostgreSQL real la concurrencia: dos guías simultáneas sobre la misma factura, ambas válidas con secuenciales distintos, y dos emisiones simultáneas del mismo borrador con claves distintas, una sola guía y la otra `409`. Extender la prueba de secuenciales independientes con factura, nota de crédito, nota de débito, retención, guía y factura en el mismo punto (01, 04, 05, 07 y 06). Verificar que las pruebas pasan repetidas sin fallos intermitentes
- [x] 7.4 Implementar el reintento de firma (`/shipping-guides/{id}/signing-attempts`). Verificar que una guía reservada se firma con su mismo número, su misma clave y su misma fecha de emisión, con `shipping_guide.signing_retried`, y que otra empresa recibe `404`

## 8. Consulta, transmisión y reconciliación

- [x] 8.1 Implementar la consulta (`/shipping-guides`, `/shipping-guides/{id}`, `/shipping-guides/{id}/transmission`) con sus rutas en OpenAPI. Verificar con pruebas HTTP: detalle con el transportista, la placa, las fechas, la partida y todos los destinatarios con su sustento (la excepción como declarada por el usuario) y su detalle; lista con "N destinatarios" o el nombre, sin importes; búsqueda por número, transportista o identificación de cualquier destinatario, filtro de estado y paginación; `403`, `401` y otra empresa `404`
- [x] 8.2 Implementar la reconciliación manual (`/shipping-guides/{id}/reconciliations`, `shipping_guide.reconciliation_requested`) y agregar `"06"` a `COMPLETED_AUDIT`. Verificar con pruebas HTTP: administrador que reconcilia una guía en revisión manual que pasa a autorizada; operador `403`; estado no reconciliable rechazado; eventos sin SOAP; las reconciliaciones de los demás tipos sin cambios
- [x] 8.3 Repetir con una guía los casos de la transmisión de design D18 con respuestas SINTÉTICAS, incluida una `DEVUELTA` con el error 82, `NOT_SENT` comprobable y `SEND_UNKNOWN`, la respuesta guardada antes de clasificar y su reclasificación sin otra llamada al SRI. Verificar que pasan sin cambios en el transporte, la cola ni los clasificadores, con `SRI_TRANSMISSION_ENABLED` apagado, y documentar en `fiscal-emission.md` que la transmisión atiende el tipo `06`

## 9. Independencia y dirección de las dependencias

- [x] 9.1 Probar con PostgreSQL real que una guía autorizada, devuelta y no autorizada de un producto con control de stock no registra movimientos ni cambia saldos de inventario, no cambia la factura sustento ni su capacidad acreditable, y no asigna roles a sus terceros. Verificar que las reconciliaciones de capacidades y saldos no informan diferencias
- [x] 9.2 Añadir la prueba de arquitectura de design D1 (nadie importa `shipping-guides`, y `shipping-guides` no importa `inventory`, `invoices`, `parties`, `products` ni otro comprobante) y documentar el módulo en `ARCHITECTURE.md` y `backend.md`. Verificar que la prueba pasa y detecta cada violación en archivos de ejemplo

## 10. RIDE de la guía

- [x] 10.1 Implementar la lectura `guiaRemision` 1.1.0 con su lista blanca y el modelo `RideShippingGuide`, y la distribución de la ficha v2.34, anexo 2, página 64, con el renderer `guia-remision-1` (design D20). Verificar con golden del texto de las páginas y la lectura del Code128: varios destinatarios; destinatario sin factura con los rótulos vacíos; sin importes ni fila de fecha de emisión; paginación con el máximo de filas; los mismos bytes en dos procesos; `rise`, `docAduaneroUnico`, `detallesAdicionales`, `maquinaFiscal`, `infoAdicional` o un sustento distinto de `01` que detienen la generación; el RIDE de los demás tipos sin cambios. Comparar el resultado con la página 64 renderizada y registrarlo
- [x] 10.2 Comprobar el RIDE en el job, el pool y la bandeja. Verificar con una prueba de integración que una guía autorizada programa su RIDE en la misma operación, que se descarga verificado y que se imprime el mismo RIDE

## 11. Bandeja con guías de remisión

- [x] 11.1 Agregar el tipo `06` a `EMITTED_DOCUMENT_TYPES` y `DOCUMENT_KINDS` (design D21). Verificar con pruebas de componente: filtro con los cinco tipos, tipo bajo el número, receptor derivado (nombre o "N destinatarios") y total "—" accesible, enlace al detalle de la guía, textos en femenino, documentos disponibles por estado, y los demás tipos sin cambios. Documentarlo en `fiscal-emission.md`
- [x] 11.2 Añadir una prueba de backend de la bandeja con una factura, una nota de crédito, una nota de débito, una guía de remisión y un comprobante de retención. Verificar que devuelve los cinco con su tipo, el total nulo de la guía y los importes de los demás, y que el filtro por guía de remisión deja solo las guías

## 12. Pantallas de guías de remisión

- [x] 12.1 Implementar Guías de remisión en `/guias-remision`, dentro de "Operación" (design D25), con lista, búsqueda, filtro de estado en la URL, borradores en curso y tarjetas por debajo de 768 px. Verificar con pruebas de componente: carga, vacío, error con reintento, sin permiso y filtros en la URL
- [x] 12.2 Implementar el borrador con los pasos de design D25:
  - transporte propio o tercero, con el selector de transportistas, los no seleccionables con su motivo y "Nuevo transportista" con `PartyDialog` y el rol marcado; la placa;
  - fechas; partida desde un establecimiento propio elegido (sin selección inicial, dirección derivada de solo lectura) u otra dirección propuesta desde el punto;
  - destinatarios tercero o establecimiento propio de destino, que excluye el origen y pide elegir el origen si falta, con "Nuevo destinatario" con `PartyDialog` sin roles;
  - sustento factura o sin factura, con "Cargar mercancías de la factura" (sugerencias marcadas, líneas libres sin marcar con sus datos históricos y el aviso de sugerencia no autoritativa) y los casos con su texto oficial; la excepción fija del establecimiento propio;
  - detalle con producto o línea libre, la descripción con su rótulo, ayuda, contador y vista previa, y la cantidad decimal;
  - vista previa del servidor y la confirmación con la casilla de la declaración.

  Verificar con pruebas de componente:
  - solo transportistas con el rol, y ningún rol asignado sin la acción explícita;
  - los campos derivados de solo lectura (partida del origen, dirección y código del establecimiento de destino, códigos del producto);
  - el destino igual al origen imposible de elegir, y el emisor libre de ser origen, destino u otro;
  - la carga de mercancías que nunca agrega sola una línea libre y deja confirmar o editar cada una;
  - problemas junto a su destinatario y su detalle, y emisión bloqueada;
  - la casilla de la declaración exigida solo con excepciones;
  - límites presentados como defensa del sistema;
  - éxito que lleva al detalle;
  - doble clic que envía una sola emisión con la misma clave en el reintento;
  - los `409` explicados y el foco tras cada acción
- [x] 12.3 Implementar el detalle de la guía y la acción "Nueva guía de remisión" en el detalle de una factura autorizada (design D25). Verificar con pruebas de componente: todos los destinatarios con su sustento, la excepción "declarada por" el usuario con su momento, el detalle, el reintento de firma, la transmisión y los documentos; la acción visible solo con `shippingGuides.draft` en una factura autorizada y que abre el borrador propuesto. Documentar las pantallas en `fiscal-emission.md` con sus rutas y permisos
- [x] 12.4 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real (escritorio, 375 y 320 px, tema claro y oscuro, contraste y teclado) y registrar la revisión en `openspec/changes/add-shipping-guides/ui-review.md`. Verificar que no quedan hallazgos abiertos

## 13. Rendimiento y prueba end-to-end

- [x] 13.1 Añadir `bench:shipping-guides` en `backend/scripts/` (design D28), con el barrido del RIDE apagado, y registrar su resultado en `docs/quality/benchmarks/` y en `performance.md`. Verificar que cada P95 cumple ERS RNF-005, que el RIDE tarda menos de 1 s, que la transacción de la reserva no incluye XML, firma ni red, que la bandeja filtrada por un destinatario cumple el objetivo, y que el CPU, la memoria y la latencia del peor caso confirman los valores por defecto de design D23 (o ajustarlos con `/opsx:update` y la evidencia). Registrar el tamaño del XML firmado del peor caso solo como medición, sin relacionarlo con Q-47
- [x] 13.2 Añadir la prueba end-to-end sobre `main.ts` con el SRI simulado aislado: una guía con transporte propio, origen en un establecimiento propio y dos destinatarios (una factura autorizada y un traslado a otro establecimiento propio distinto del origen), autorizada y con su RIDE en la bandeja; otra no autorizada; y el inventario, la factura y los roles sin cambios. Verificar que la prueba pasa

## 14. Verificación

- [ ] 14.1 Ejecutar `corepack pnpm verify` y `openspec validate --all --strict`, y verificar que pasan formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build, `check:xsd-artifact`, `check:ride-assets` y la validación de los specs
