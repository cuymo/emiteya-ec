# Prueba manual integral del MVP (2026-10-09)

Pasada autónoma de extremo a extremo de las capacidades 0 a 16, con un navegador real (Chromium
headless con Playwright) sobre el backend y el frontend reales, en la rama local
`mvp-finalization` (base `main` = `422ce29`). La autorizó el dueño del producto el 2026-10-09. Solo
se corrigieron defectos funcionales claros, cada uno con su prueba de regresión, su reprueba y su
propio commit. Lo demás queda como `NEEDS_USER_DECISION`.

## Reglas de seguridad aplicadas

- Solo datos sintéticos: RUC `1790012345001`, terceros, productos y montos inventados, y correos
  `@sandbox-mvp.ec` o `@ejemplo.invalid`.
- Solo el P12 sintético del generador del repositorio (`generateP12Fixtures`, `sd-utf8.modern.p12`).
  Nunca el P12 real, `archivosensible.env` ni otros archivos de secretos, que no se leyeron.
- Ninguna llamada al SRI real, ni de Pruebas ni de Producción:
  - la transmisión solo se habilitó en el sandbox, hacia el SRI simulado `sri-simulado.test`;
  - los endpoints de Pruebas y de Producción apuntan ambos al simulado;
  - un proxy de salida rechaza cualquier otro host.
- Sin push, PR, CI remota, release ni despliegue. La rama `feat/add-data-portability` no se tocó.

## Entorno

| Componente | Detalle |
| --- | --- |
| Sistema | Linux 7.1.6 (CachyOS), disco giratorio |
| Node / pnpm | 24.15.0 / 12.4.2 (Corepack) |
| Base de datos | PostgreSQL 17.11 (`compose.yaml`), esquema aislado `t_manual_mvp_*` en `facturador_test` |
| Backend | `main.ts` real con `corepack pnpm --filter @facturador/backend sandbox:mvp` (`backend/test/manual/mvp-sandbox.ts`), en `127.0.0.1:4000` |
| SRI | Simulado local (`backend/test/support/simulated-sri.ts`), con un control en `127.0.0.1:4699` para el comportamiento por secuencial |
| Frontend | Next.js 16.3.8, build de producción (`next build` y `next start`) en `localhost:3000`, que reenvía `/api` al backend |
| Navegador | Chromium 1243 headless con playwright-core 1.64.0; XLSX leído con openpyxl 3.1.5 |
| Política de tamaño | Sintética de las pruebas, 1 000 000 bytes (no es la cifra oficial, Q-47) |

Notas del entorno:

- **`next dev` se detuvo** al llegar al límite de tiempo de las tareas en segundo plano. Se cambió por
  el build de producción, levantado solo durante cada fase. Las pantallas probadas son las que se
  despliegan.
- **El sandbox se hizo reanudable** (`--resume`, con la misma clave maestra sintética de la custodia)
  para sobrevivir a ese mismo límite. Los datos de la prueba siguen en su esquema:
  `sandbox:mvp <estado.json> --resume` los vuelve a servir y `--clean` los borra.
- **Los scripts de la pasada viven fuera del repositorio**, en un directorio temporal: fases, capturas,
  descargas y resultados. Validan cada XML con el validador XSD real del proyecto (xmllint y el
  registro de esquemas). Las comprobaciones de estado se hicieron por la API con la sesión del mismo
  navegador.

## Resumen

- 75 casos (MVT-001 a MVT-076; MVT-055 no se usó). Los 75 terminan en PASS.
- Un defecto corregido: severidad MINOR, en el commit `089835f`, con prueba de regresión y reprueba
  en el navegador (MVT-076).
- Dos pendientes `NEEDS_USER_DECISION` de seguridad en profundidad, sin vía de explotación encontrada,
  y una diferencia COSMETIC.
- 0 BLOCKER y 0 MAJOR.
- Regresión obligatoria de `7e1613e` (MVT-031): la devolución por nota de crédito aparece en el kárdex
  como «Nota de crédito 001-001-000000001», enlaza a `/notas-credito/<id>` y nunca a `/facturas/<id>`,
  y el clic abre la nota.
- Cobertura:
  - acceso y roles;
  - empresa, establecimientos, firma, catálogos y ambiente;
  - terceros y productos;
  - factura completa hasta `AUTHORIZED`, con XSD, RIDE, descargas e inmutabilidad histórica;
  - consumidor final;
  - inventario;
  - nota de crédito (devolución y anulación total) y nota de débito;
  - retención 2.0.0;
  - guía de remisión en sus cinco variantes;
  - liquidación de compra;
  - estados negativos del SRI y reconciliación;
  - archivo con los seis tipos;
  - reportes con su XLSX y textos peligrosos;
  - portabilidad;
  - humo de seguridad;
  - responsive a 1280, 375 y 320 px;
  - permisos cruzados.

## Hallazgos

| Id | Caso | Severidad | Descripción | Estado |
| --- | --- | --- | --- | --- |
| H-01 | MVT-076 | MINOR | Con la ventana baja (por ejemplo 1280×720 en `/facturas`), el último destino de la barra lateral («Portabilidad de datos») quedaba fuera de la ventana y no se podía pulsar. El contenedor fijo de la navegación no se desplazaba. | Corregido en `089835f` (`overflow-y-auto`, prueba en `frontend/test/app-shell.test.tsx`). Reprobado a 1366×768, 1280×720 y 1280×600: PASS |
| H-02 | MVT-068 | MINOR, `NEEDS_USER_DECISION` | Las páginas del frontend no envían CSP, `X-Frame-Options`, `X-Content-Type-Options` ni `Referrer-Policy`, que pide `docs/security/hardening.md`. La API sí las envía (helmet). Con la cookie `SameSite=Lax`, la sesión no viaja en un iframe entre sitios. | Pendiente: decidir si las pone Next.js (CSP con nonces) o el proxy de producción |
| H-03 | MVT-068 | Observación, `NEEDS_USER_DECISION` | `/api/v1` no valida el `Origin` por sí misma: un POST JSON con un Origin ajeno y la cookie inyectada fuera del navegador llega al handler. Desde un navegador no hay vía de CSRF: cookie `SameSite=Lax`, `text/plain` y formularios rechazados con 400, preflight sin CORS e inicio de sesión con Origin ajeno rechazado con 403. | Pendiente: decidir si se agrega la comprobación de `Origin` como defensa en profundidad |
| H-04 | MVT-011 | COSMETIC | El mismo estado sin permiso tiene dos redacciones: «No tienes acceso a Usuarios» (también en Reportes y Comprobantes) frente a «No tienes permiso para ver esta sección». | Sin corrección (COSMETIC) |

Observaciones que no son defectos:

- **El XML autorizado es idéntico al firmado.** Es el comprobante que devuelve el SRI, como hace el
  SRI real (MVT-022).
- **La vista del archivo no expone las transiciones.** El historial está en
  `/{tipo}/:id/transmission` (MVT-023, MVT-052 y MVT-053).
- **Sin sesión, `/facturas` responde 200.** Es el shell de la aplicación, que lleva al inicio de sesión
  sin exponer datos; la API responde 401.

## Pendientes

- H-02 y H-03: decisión del dueño del producto antes del go-live.
- H-04: queda para una pasada de redacción.
- Fuera del alcance de esta pasada:
  - la certificación con el SRI de Pruebas (`sri-certification.md`);
  - las compuertas del go-live ya registradas (AC-10, RNF-007, SEC-008 y el plazo del proxy de al
    menos 120 s para la descarga de la portabilidad).

## Datos que quedaron en el sandbox

- **Terceros:** siguen los cinco iniciales. «CLIENTE SINTÉTICO UNO S.A.» quedó renombrado por la prueba
  de inmutabilidad (MVT-026).
- **Productos:** el cemento quedó a 9,99 por la misma prueba.
- **Terceros de prueba añadidos:**
  - el proveedor con pasaporte `PS0000123`;
  - cuatro terceros con textos peligrosos para hojas de cálculo (`=HYPERLINK(…)`, `+TEST`, `@TEST` y
    `-2+3`);
  - uno con HTML en su razón social.
- **Comprobantes:**
  - 10 facturas, incluidas una devuelta, una no autorizada y una emitida por la operadora;
  - 2 notas de crédito, 1 nota de débito, 1 retención, 3 guías y 2 liquidaciones;
  - una exportación de portabilidad;
  - algunos borradores de intentos fallidos de los scripts.

## Casos

| Caso | Módulo / flujo | Pasos | Esperado | Obtenido | Resultado | Severidad | Commit de corrección | Reprueba | Notas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MVT-001 | Acceso | El administrador aprovisionado inicia sesión | Entra a la aplicación con su sesión | rol ADMIN, en / | PASS | — | — | — | — |
| MVT-002 | Acceso | El administrador cierra sesión | Vuelve al inicio de sesión y la sesión deja de servir | en /iniciar-sesion; /me responde 401 | PASS | — | — | — | — |
| MVT-003 | Contribuyente | Registrar la identidad fiscal sintética y los atributos | Se guarda la configuración y queda vigente la versión 1 | versión 1, RUC 1790012345001, contabilidad true | PASS | — | — | — | — |
| MVT-004 | Contribuyente | Cargar el logo sintético | El logo queda en una versión nueva y se muestra | versión 2 | PASS | — | — | — | — |
| MVT-005 | Establecimientos | Crear los establecimientos 001 y 002 con su punto 001 | Dos establecimientos activos, cada uno con su punto | 001:001 002:001 | PASS | — | — | — | — |
| MVT-006 | Usuarios | Crear la operadora sintética | La usuaria queda activa con rol Operador | Olga Operadora Sintética OPERATOR | PASS | — | — | — | — |
| MVT-007 | Firma | Cargar el P12 sintético con su contraseña sintética | La firma queda utilizable y el RUC coincide | Utilizable; RUC coincide | PASS | — | — | — | — |
| MVT-008 | Catálogos | Consultar los catálogos fiscales y cambiar la habilitación de una entrada | Se ven los catálogos y una entrada cambia entre habilitada y deshabilitada, y persiste | 159 entradas habilitables; «RETENCIÓN DEL IVA 50%» se deshabilitó, persistió al recargar y se volvió a habilitar | PASS | — | — | — | — |
| MVT-009 | Secuenciales | Consultar los secuenciales por punto | Cada punto muestra sus secuenciales por tipo | puntos 001-001 y 002-001 | PASS | — | — | — | — |
| MVT-010 | Ambiente | El ambiente vigente es Pruebas | La pantalla de ambiente muestra Pruebas | Pruebas, con la acción Cambiar a Producción | PASS | — | — | — | — |
| MVT-011 | Acceso | La operadora inicia sesión y solo ve lo que su rol permite | Navegación sin la configuración de administrador; rutas de administrador explican que no tiene acceso | navegación: Facturas, Liquidaciones de compra, Notas de crédito, Notas de débito, Retenciones, Guías de remisión, Comprobantes, Borradores, Terceros, Productos, Inventario, Reportes, Catálogos fiscales; usuarios, portabilidad y firma muestran el estado sin permiso (Usuarios con otra redacción: COSMETIC) | PASS | COSMETIC | — | — | Usuarios (y Reportes y Comprobantes) dicen «No tienes acceso a …» y otras pantallas «No tienes permiso para ver esta sección»: redacción distinta del mismo estado. Sin corrección (COSMETIC). |
| MVT-012 | Terceros | Registrar clientes, proveedores, transportista y roles combinados | Cinco terceros con sus roles | CLIENTE SINTÉTICO UNO S.A. [CUSTOMER]; PROVEEDOR SINTÉTICO PERSONA [SUPPLIER]; TRANSPORTES SINTÉTICOS CIA. LTDA. [CARRIER]; COMERCIAL MIXTA SINTÉTICA [CUSTOMER+SUPPLIER]; AGRICULTOR SINTÉTICO RURAL [SUPPLIER] | PASS | — | — | — | — |
| MVT-013 | Terceros | Corregir, buscar, desactivar y reactivar un tercero | Los cambios persisten y la búsqueda lo encuentra | corregido y encontrado por búsqueda | PASS | — | — | — | — |
| MVT-014 | Productos | Registrar un bien con stock, un bien sin stock y un servicio, con IVA 15 % y 0 % | Tres productos activos | Arena sintética m3 (GOOD, 22); Cemento sintético 50 kg (GOOD, 8.5); Servicio sintético de transporte (SERVICE, 35) | PASS | — | — | — | — |
| MVT-015 | Terceros | Desactivar y reactivar un tercero | El estado cambia a desactivado y vuelve a activo | INACTIVE y de nuevo ACTIVE | PASS | — | — | — | — |
| MVT-016 | Productos | Corregir el precio de un producto, y desactivar y reactivar un servicio | El cambio persiste y el estado cambia y vuelve | precio 23.00; servicio INACTIVE y ACTIVE | PASS | — | — | — | — |
| MVT-017 | Acceso (servidor) | El servidor rechaza a la operadora en operaciones de administrador | 403 en usuarios, firma, ambiente, ajuste de secuenciales y portabilidad | POST /users 403; GET /users?page=1&pageSize=10 403; PUT /taxpayer/environment 403; POST /data-exports 403; GET /signing-certificate 403 | PASS | — | — | — | — |
| MVT-018 | Acceso | La operadora cierra sesión | Vuelve al inicio de sesión | en /iniciar-sesion | PASS | — | — | — | — |
| MVT-019 | Acceso (servidor) | Sin sesión, la API responde 401 | 401 sin cookie | 401 | PASS | — | — | — | — |
| MVT-020 | Inventario | Activar el control de stock del cemento y registrar saldo inicial 20, entrada de 3 y ajuste de −1 | Saldo 22 con tres movimientos en el kárdex | saldo 22; AJUSTE -1, ENTRADA_MANUAL 3, INICIAL 20 | PASS | — | — | — | — |
| MVT-021 | Factura | Crear el borrador de factura por la UI con dos líneas y forma de pago, y ver el resumen calculado | Borrador guardado con totales del servidor | borrador e835fcb9…; resumen: Resumen Subtotal sin impuestos USD 77,50 Descuento USD 0,00 IVA 15 % USD 11,63 Total USD 89,13 Vista previa del 09/10/2026, sin validez fiscal. Emitir factura G | PASS | — | — | — | — |
| MVT-022 | Factura | Emitir la factura y seguirla hasta AUTHORIZED con el SRI simulado | SIGNED → RECEIVED → AUTHORIZED, secuencial 000000001 y clave de 49 dígitos | inicial SIGNED; final AUTHORIZED; 001-001-000000001; clave 091020260117900123450011…; total 89.13; firmado 7580 B, autorizado 7580 B | PASS | — | — | — | El XML autorizado es el comprobante que devuelve el SRI simulado, idéntico al firmado, como el SRI real (design D16 de add-document-archive). |
| MVT-023 | Factura | Transiciones registradas del comprobante | RESERVED → SIGNED → RECEIVED → AUTHORIZED | estados visibles en el archivo: AUTHORIZED | PASS | — | — | — | La vista del archivo no expone las transiciones; el historial completo está en /invoices/:id/transmission y se verificó en MVT-052 y MVT-053. |
| MVT-024 | Factura | Descargar RIDE, XML autorizado y XML firmado desde la UI; validar XSD y clave | PDF válido; XML con la clave; XSD válido | ride: factura-001-001-000000001.pdf; autorizado: factura-001-001-000000001-autorizado.xml; firmado: factura-001-001-000000001-firmado.xml; XSD factura 1.1.0 válido (firmado y comprobante del autorizado); firma XAdES presente | PASS | — | — | — | — |
| MVT-025 | Inventario | La factura autorizada descuenta el stock y el kárdex enlaza a la factura | Saldo 17 y movimiento SALIDA_FACTURA con «Factura 001-001-000000001» → /facturas/{id} | saldo 17; el enlace abre la factura | PASS | — | — | — | — |
| MVT-026 | Factura | Corregir el tercero, el precio del producto y un catálogo no cambia la factura emitida | La factura conserva el comprador, el precio y su XML | tercero renombrado, precio 9.99 y forma de pago 01 deshabilitada y rehabilitada; la factura, su detalle y su XML no cambiaron | PASS | — | — | — | El tercero quedó renombrado y el cemento a 9,99 para el resto de la prueba: las facturas posteriores llevan el nombre nuevo en su snapshot y la 001 conserva el original (también en el archivo, MVT-057). |
| MVT-027 | Contribuyente | Con una emisión, la identidad tributaria queda bloqueada | El RUC no se puede cambiar | PUT con otro RUC: 409 TAX_IDENTITY_LOCKED; la UI muestra el RUC como texto con «El RUC ya no puede cambiar en esta empresa.» (taxIdentityLocked=true) | PASS | — | — | — | — |
| MVT-028 | Consumidor final | Factura a consumidor final dentro de la política (≤ US$ 50,00) | Se emite y se autoriza | 001-001-000000002 AUTHORIZED, total 23.00, comprador CONSUMIDOR FINAL | PASS | — | — | — | — |
| MVT-029 | Consumidor final | Consumidor final por encima de US$ 50,00 no se emite | La emisión se rechaza con su motivo, sin consumir número | Emitir deshabilitado; aviso: CONSUMIDOR FINAL 9999999999999 Consumidor final Cambiar comprador Punto de emisión Elige un punto 001-001 · Local sintético 001, Quito 002-001 · Local sintético 002, Quito Productos Cemento sintético 50 kg CEM-50 Cantidad Precio unitario USD 9,99 Descuento Agregar producto Formas de pago Forma de pago 1 Elige la forma de pago SIN UTILIZACION DEL SISTEMA FINANCIERO (01) COMPENSACIÓN DE DEUDAS (15) TARJETA DE DÉBITO (16) DINERO ELECTRÓNICO (17) TARJETA PREPAGO (18) TARJETA DE CRÉDITO (19) OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO (20) ENDOSO DE TÍTULOS (21) Importe Vacío: el total Agregar forma de pago Resumen Subtotal sin impuestos USD 99,90 Descuento USD 0,00 IVA 15 % USD 14,99 Total USD 114,89 Vista previa del 09/10/2026, sin validez fiscal.; POST /invoices directo: 409 CONSUMER_FINAL_LIMIT_EXCEEDED; sin factura nueva | PASS | — | — | — | — |
| MVT-030 | Nota de crédito | Devolución de 2 sacos de cemento con retorno físico desde la factura autorizada | Borrador con valor 19,55; emitida y AUTHORIZED; tipo 04 | 001-001-000000001 AUTHORIZED; causa RETURN; modifica 001-001-000000001; retorno físico 2 | PASS | — | — | — | — |
| MVT-031 | Inventario / Nota de crédito | REGRESIÓN 7e1613e: el kárdex muestra la devolución con «Nota de crédito <número>» y enlaza a /notas-credito/<id> | Saldo 19; movimiento DEVOLUCION_NC; enlace a la nota, nunca a /facturas | saldo 19; enlaces del kárdex: Nota de crédito 001-001-000000001→/notas-credito/279e394f-774e-42cb-bfae-2751af348d6e \| Factura 001-001-000000001→/facturas/a7f6946d-51cb-46b2-aa46-25b7db75305d; el clic abre la nota | PASS | — | — | — | — |
| MVT-032 | Nota de crédito | El crédito de la factura refleja la nota y la anulación total ya no procede | Aplicado 19,55; disponible 69,58; anulación total bloqueada con su motivo | Notas de crédito Aplicado en notas autorizadas USD 19,55 Reservado por notas en curso USD 0,00 Disponible USD 69,58 Emitir nota de crédito | PASS | — | — | — | — |
| MVT-033 | Nota de crédito | Anulación total de una factura de servicio | Nota AUTHORIZED por el total; la factura queda sin valor acreditable; sin movimiento de inventario | factura 001-001-000000003 total 40.25; nota 001-001-000000002 AUTHORIZED causa TOTAL_ANNULMENT | PASS | — | — | — | — |
| MVT-034 | Nota de crédito | Descargas de la nota de crédito y XSD | RIDE PDF; XML firmado y autorizado válidos contra el XSD de notaCredito | nota-de-credito-001-001-000000001.pdf, nota-de-credito-001-001-000000001-autorizado.xml, nota-de-credito-001-001-000000001-firmado.xml; XSD notaCredito 1.1.0 válido; referencia la factura 01 001-001-000000001 | PASS | — | — | — | — |
| MVT-035 | Nota de crédito | Una factura a consumidor final no admite nota de crédito | La sección lo explica y no ofrece la acción | mensaje visible y sin acción | PASS | — | — | — | — |
| MVT-036 | Nota de débito | Nota de débito con intereses de mora y un costo posterior | Valor 17,25 (15,00 + IVA 2,25); AUTHORIZED; tipo 05 | 001-001-000000001 AUTHORIZED; conceptos LATE_PAYMENT_INTEREST 5.00, POST_INVOICE_COST_EXPENSE 10.00; total 17.25; kárdex sin cambios (5 movimientos) | PASS | — | — | — | — |
| MVT-037 | Nota de débito | Descargas de la nota de débito y XSD | RIDE PDF; XML válidos contra el XSD de notaDebito | nota-de-debito-001-001-000000001.pdf; XSD notaDebito 1.0.0 válido | PASS | — | — | — | — |
| MVT-038 | Retención | Borrador de retención por la UI: proveedor, parte relacionada, período, sustento externo con IVA, pago y dos retenciones (renta 312 e IVA 30 %) | Vista previa: renta 2 % = 2,00 e IVA 30 % = 4,50; total retenido 6,50 | aviso de período: «El período (Septiembre de 2026) es distinto del mes de emisión (Octubre de 2026). Puedes emitirlo, pero tendrás que conf»; 2 % · valor retenido USD 2,00; 30 % · valor retenido USD 4,50; Resumen Documento 1 · 312 USD 2,00 Documento 1 · 1 USD 4,50 Total retenido USD 6,50 Vista previa del 09/10/2026, sin validez fiscal. No reserva nada: la emisión | PASS | — | — | — | — |
| MVT-039 | Retención | Emitir la retención y seguirla hasta AUTHORIZED | Tipo 07, AUTHORIZED, período 10/2026, sin movimientos de inventario | 001-001-000000001 AUTHORIZED; período "fiscalPeriod":"10/2026"/; kárdex sin cambios | PASS | — | — | — | — |
| MVT-040 | Retención | XML 2.0.0 de la retención contra su XSD, RIDE y descargas | comprobanteRetencion 2.0.0 válido; periodoFiscal 10/2026; docSustento con dos retenciones; RIDE PDF | comprobante-de-retencion-001-001-000000001.pdf; XSD comprobanteRetencion 2.0.0 válido; periodoFiscal 10/2026; 2 retenciones; sustento 001002000000123; parteRel NO | PASS | — | — | — | — |
| MVT-041 | Guía de remisión | Guía desde la factura autorizada: transportista tercero, partida desde el establecimiento 001, sustento factura | Borrador propuesto con el comprador, la factura y sus mercancías; AUTHORIZED; tipo 06 | 001-001-000000001 AUTHORIZED; detalles sugeridos 1; transportista {"source":"PARTY","partyId":"c68b5ea9-00d0-4aa9-9423-d6b99d43bf8d","identificationType":"0 | PASS | — | — | — | — |
| MVT-042 | Guía de remisión | Transporte propio, partida por dirección libre y excepción declarada (consignación) con línea libre | AUTHORIZED con la declaración de excepción congelada | 001-001-000000002 AUTHORIZED; excepción CONSIGNMENT registrada | PASS | — | — | — | — |
| MVT-043 | Guía de remisión | Traslado entre establecimientos propios 001 → 002 con un producto | AUTHORIZED; partida del 001, destino el 002 con su código; sin inventario | 001-001-000000003 AUTHORIZED | PASS | — | — | — | — |
| MVT-044 | Guía de remisión | XML de las guías contra el XSD, RIDE y cero movimientos de inventario | guiaRemision válido; sustento 01 con su número en la guía de la factura; codEstabDestino 002 en el traslado; kárdex sin cambios | XSD guiaRemision 1.1.0 válido en las tres; sustento 01 001-001-000000001; traslado con codEstabDestino 002 y dirPartida del 001; kárdex sin cambios (5) | PASS | — | — | — | — |
| MVT-045 | Terceros | Registrar un proveedor sintético con pasaporte | Tercero 06 con rol proveedor | 06 PS0000123 PRODUCTOR SINTÉTICO EXTRANJERO SUPPLIER | PASS | — | — | — | — |
| MVT-046 | Liquidación de compra | Proveedor con cédula: bien y servicio desde productos, línea libre con descuento e IVA 0 %, dos pagos con plazo; 4 declaraciones | Total 219,10; AUTHORIZED; tipo 03; sin retención automática ni inventario | 001-001-000000001 AUTHORIZED; total 219.10; 4 declaraciones en el diálogo (art. 13, letra c)) | PASS | — | — | — | — |
| MVT-047 | Liquidación de compra | XML de la liquidación: XSD, DOLAR, pagos con plazo y unidad de tiempo, proveedor 05; RIDE | liquidacionCompra válido; moneda DOLAR; 2 pagos con plazo y unidadTiempo; sin 07 ni movimientos | liquidacion-de-compra-001-001-000000001.pdf; XSD liquidacionCompra 1.1.0 válido; DOLAR; 2 pagos (plazo 30 dias); 3 detalles; sin 07 automática (1) ni movimientos (5) | PASS | — | — | — | — |
| MVT-048 | Liquidación de compra | Proveedor con pasaporte: una línea libre con IVA 15 % y un pago | AUTHORIZED; tipoIdentificacionProveedor 06 | 001-001-000000002 AUTHORIZED; total 57.50; proveedor 06 PS0000123; XSD válido | PASS | — | — | — | — |
| MVT-049 | Liquidación de compra | Un proveedor con RUC no se puede elegir y la UI explica por qué | Opción deshabilitada con el motivo del caso c) del art. 13 | opción deshabilitada: «Tiene RUC: la liquidación de compra del sistema solo documenta compras a personas sin RUC activo (caso c) del art. 13).» | PASS | — | — | — | — |
| MVT-050 | SRI negativo | Recepción DEVUELTA (error 35): la factura queda RETURNED con los mensajes del SRI | RETURNED; mensaje 35 visible; sin reconciliación; sin movimiento de inventario | 001-001-000000004 RETURNED; Transmisión al SRI El SRI devolvió la factura. Revisa sus mensajes. Mensajes del SRI Código 35 · ARCHIVO NO CUMPLE ESTRUCTURA XML (sintético) · ERROR Historial de la transmisión | PASS | — | — | — | — |
| MVT-051 | SRI negativo | Autorización NO AUTORIZADO: la factura queda NOT_AUTHORIZED | NOT_AUTHORIZED con sus mensajes; sin movimiento de inventario | 001-001-000000005 NOT_AUTHORIZED; Transmisión al SRI El SRI no autorizó la factura. Revisa sus mensajes. Mensajes del SRI Código 65 · FECHA EMISION EXTEMPORANEA (sintético) · ERROR Historial de la transmisión | PASS | — | — | — | — |
| MVT-052 | SRI negativo | Recepción sin respuesta (retenida): SEND_UNKNOWN y reconciliación automática por clave | SEND_UNKNOWN visible; luego AUTHORIZED sin otra clave; una sola salida de inventario | visto AUTHORIZED; final AUTHORIZED con la misma clave; stock 19→18; llamadas al SRI: RECEPTION, AUTHORIZATION | PASS | — | — | — | Historial: SIGNED → SEND_UNKNOWN (recepción UNKNOWN por tiempo) → AUTHORIZED por RECONCILIATION automática, con una sola recepción. |
| MVT-053 | SRI negativo | Recepción con clave ajena: MANUAL_REVIEW y reconciliación del administrador desde la UI | Transmisión detenida con su motivo; «Reconciliar con el SRI» con motivo obligatorio; AUTHORIZED; una salida | MANUAL_REVIEW (SIGNED → SEND_UNKNOWN → MANUAL_REVIEW, mensaje 35 clave ajena): «Transmisión al SRI Reconciliar con el SRI El resultado del SRI no se pudo resolver automáticamente: un administrador debe reconciliar la factura. Mensajes del SRI Código 35 · CLAVE AJENA (sintético) ·»; confirmar sin motivo permitido; tras reconciliar AUTHORIZED; stock 16→15 | PASS | — | — | — | MANUAL_REVIEW no muestra «La transmisión está detenida» (eso es para una transmisión detenida por el sistema); explica que un administrador debe reconciliar. Primer intento del script falló por una espera mal escrita; la reconciliación funcionó en ambos intentos. |
| MVT-054 | SRI negativo | SRI caído durante la emisión y recuperación | La factura no se pierde ni se duplica: queda pendiente o incierta y, con el SRI de vuelta, termina AUTHORIZED | con el SRI caído: SIGNED → SEND_UNKNOWN; recuperación automática: AUTHORIZED; recepciones registradas por el simulador 1 | PASS | — | — | — | — |
| MVT-056 | Archivo | Comprobantes: los seis tipos en la bandeja y el filtro por tipo coincide con la API | 01, 03, 04, 05, 06 y 07 presentes; cada filtro muestra solo su tipo | API por tipo 01:10, 03:2, 04:2, 05:1, 06:3, 07:1; opciones de la UI: Todos \| Factura \| Liquidación de compra \| Nota de crédito \| Nota de débito \| Guía de remisión \| Comprobante de retención | PASS | — | — | — | — |
| MVT-057 | Archivo | Filtros por receptor y estado, y descarga del RIDE desde la bandeja | Solo los comprobantes del receptor; el estado RETURNED muestra la devuelta; el RIDE se descarga | receptor 1796666666001: 10 comprobantes (tipos 01,06,05,04, la guía por su destinatario); RETURNED: 1; RIDE desde la bandeja: factura-001-001-000000010.pdf | PASS | — | — | — | — |
| MVT-058 | Terceros | Registrar terceros con textos peligrosos para hojas de cálculo | Se guardan tal cual o la validación los rechaza con su motivo | «=HYPERLINK("http://ejemplo.invalid","clic") SINTÉTICO» guardado; «+TEST SINTÉTICO» guardado; «@TEST SINTÉTICO» guardado; «-2+3 SINTÉTICO» guardado | PASS | — | — | — | — |
| MVT-059 | Reportes | Documentos emitidos: la lista y el XLSX tienen las mismas filas; el XLSX no contiene fórmulas | Total de la lista = filas de datos del XLSX; hoja Filtros; 0 fórmulas; textos peligrosos como texto | documentos-emitidos-2026-10-09.xlsx: lista 18 = XLSX 18; hojas Documentos emitidos, Filtros; fórmulas 0; celdas que empiezan por = + - @: ninguna | PASS | — | — | — | — |
| MVT-060 | Reportes | Facturas: la lista y el XLSX tienen las mismas filas; el XLSX no contiene fórmulas | Total de la lista = filas de datos del XLSX; hoja Filtros; 0 fórmulas; textos peligrosos como texto | facturas-2026-10-09.xlsx: lista 7 = XLSX 7; hojas Facturas, Filtros; fórmulas 0; celdas que empiezan por = + - @: ninguna | PASS | — | — | — | — |
| MVT-061 | Reportes | Retenciones: la lista y el XLSX tienen las mismas filas; el XLSX no contiene fórmulas | Total de la lista = filas de datos del XLSX; hoja Filtros; 0 fórmulas; textos peligrosos como texto | retenciones-2026-10-09.xlsx: lista 2 = XLSX 2; hojas Retenciones, Filtros; fórmulas 0; celdas que empiezan por = + - @: ninguna | PASS | — | — | — | — |
| MVT-062 | Reportes | Inventario: existencias: la lista y el XLSX tienen las mismas filas; el XLSX no contiene fórmulas | Total de la lista = filas de datos del XLSX; hoja Filtros; 0 fórmulas; textos peligrosos como texto | existencias-2026-10-09.xlsx: lista 1 = XLSX 1; hojas Existencias, Filtros; fórmulas 0; celdas que empiezan por = + - @: ninguna | PASS | — | — | — | — |
| MVT-063 | Reportes | Inventario: movimientos: la lista y el XLSX tienen las mismas filas; el XLSX no contiene fórmulas | Total de la lista = filas de datos del XLSX; hoja Filtros; 0 fórmulas; textos peligrosos como texto | movimientos-2026-10-09.xlsx: lista 9 = XLSX 9; hojas Movimientos, Filtros; fórmulas 0; celdas que empiezan por = + - @: ninguna | PASS | — | — | — | — |
| MVT-064 | Reportes | Terceros: la lista y el XLSX tienen las mismas filas; el XLSX no contiene fórmulas | Total de la lista = filas de datos del XLSX; hoja Filtros; 0 fórmulas; textos peligrosos como texto | terceros-2026-10-09.xlsx: lista 11 = XLSX 11; hojas Terceros, Filtros; fórmulas 0; celdas que empiezan por = + - @: B2 s «+TEST SINTÉTICO» \| B3 s «-2+3 SINTÉTICO» \| B4 s «=HYPERLINK("http://ejemplo.invalid","clic") SINTÉTICO» \| B5 s «@TEST SINTÉTICO» | PASS | — | — | — | — |
| MVT-065 | Portabilidad | El administrador genera la exportación, la descarga y el SHA-256 del archivo coincide con el mostrado | Paquete listo; descarga por la ruta propia; SHA-256 igual al de la UI y la API | datos-20261009-013839.zip (675740 B); SHA-256 976d47cf0bdb2901… = UI = API | PASS | — | — | — | — |
| MVT-066 | Portabilidad | Inspección del paquete: manifiesto, comprobantes y ausencia de secretos | Manifiesto con hashes; XML y RIDE de los comprobantes; sin P12, contraseñas ni claves | 114 archivos; raíz: SHA256SUMS, LEEME.txt, data, documents, assets, manifest.json; 70 XML, 16 PDF; manifiesto manifest.json; sin P12, contraseñas, clave maestra ni claves privadas | PASS | — | — | — | — |
| MVT-067 | Portabilidad | El operador no puede generar, listar ni descargar exportaciones | 403 en la API y estado sin permiso en la UI | GET /data-exports 403; POST 403; descarga por el frontend 403; la UI muestra el estado sin permiso | PASS | — | — | — | — |
| MVT-068 | Seguridad | Cookie de sesión, orígenes ajenos, cabeceras y errores sin detalles internos | Cookie HttpOnly y SameSite; 403 con Origin ajeno; cabeceras de seguridad; errores sin stack | cookie better-auth.session_token HttpOnly=true SameSite=Lax Secure=false; JSON con Origin ajeno y cookie inyectada a mano 409 (la API no valida Origin); text/plain 400; preflight 401 sin CORS; sign-in con Origin ajeno 403; id inválido 404 sin stack; RIDE sin sesión 401; /facturas sin sesión 200 ; cabeceras de página {"x-content-type-options":null,"x-frame-options":null,"content-security-policy":null,"referrer-policy":null,"x-powered-by":null}; cabeceras de API {"x-content-type-options":"nosniff","x-powered-by":null,"cache-control":null} | PASS | MINOR / NEEDS_USER_DECISION | — | — | La API /api/v1 no valida Origin: un POST JSON con Origin ajeno y la cookie inyectada a mano llega al handler. Desde un navegador no hay vía de CSRF (cookie SameSite=Lax, text/plain y formularios rechazados con 400, preflight sin CORS, sign-in con Origin ajeno 403). Decidir si se agrega la comprobación de Origin como defensa en profundidad antes de producción. Además, las páginas del frontend (next start) no envían CSP, X-Frame-Options, X-Content-Type-Options ni Referrer-Policy, que pide docs/security/hardening.md; la API sí (helmet). Con la cookie SameSite=Lax la sesión no viaja en un iframe entre sitios. Decidir si las pone Next.js (CSP con nonces) o el proxy de producción: MINOR, NEEDS_USER_DECISION. |
| MVT-069 | Seguridad | Texto con HTML en un tercero se muestra literal, sin ejecutarse | Sin diálogos ni scripts; el texto aparece escapado o la validación lo rechaza | alta: guardado; en la lista se ve el texto literal; sin diálogo ni elemento inyectado | PASS | — | — | — | — |
| MVT-070 | Seguridad | Inicio de sesión fallido: mensaje genérico y sin revelar si el correo existe | Mismo mensaje para correo inexistente y contraseña errónea | correo inexistente 401 y correo existente con clave errónea 401, mismo código y mensaje (INVALID_EMAIL_OR_PASSWORD); mensaje de la UI: «El correo o la contraseña no son correctos.» | PASS | — | — | — | — |
| MVT-071 | Roles cruzados | La operadora emite una factura a consumidor final y la ve autorizada | Puede preparar y emitir (invoices.emit); AUTHORIZED | 001-001-000000010 AUTHORIZED emitida por la operadora | PASS | — | — | — | — |
| MVT-072 | Roles cruzados | La operadora no ajusta ni inicializa inventario, no reconcilia, no cambia estados ni catálogos | Sin esas acciones en la UI; 403 en la API | UI sin Ajustar/Inicializar ni Reconciliar; POST /inventory/items/:id/adjustments 403; POST /invoices/:id/reconciliations 403; PUT /parties/:id/status 403; PUT /fiscal-catalogs/payment-method/entries/20/enablement 403; PUT /establishments/:id/emission-points/9f6110a8-4b1f-4bac-b6d5-edad56621da1/sequences/TEST/01 403; exportar reporte (permitido): 200 | PASS | — | — | — | — |
| MVT-073 | Responsive | Pantallas principales a 1280 px sin desbordamiento horizontal | scrollWidth ≤ ancho de la ventana en cada pantalla; navegación disponible | 14 pantallas sin desbordamiento; barra lateral visible | PASS | — | — | — | — |
| MVT-074 | Responsive | Pantallas principales a 375 px sin desbordamiento horizontal | scrollWidth ≤ ancho de la ventana en cada pantalla; navegación disponible | 14 pantallas sin desbordamiento; «Abrir menú» lleva a Facturas | PASS | — | — | — | — |
| MVT-075 | Responsive | Pantallas principales a 320 px sin desbordamiento horizontal | scrollWidth ≤ ancho de la ventana en cada pantalla; navegación disponible | 14 pantallas sin desbordamiento; «Abrir menú» lleva a Facturas | PASS | — | — | — | — |
| MVT-076 | Navegación | Barra lateral en ventanas bajas (1366×768, 1280×720, 1280×600): el último destino se alcanza y abre su pantalla | La barra se desplaza dentro de sí; «Portabilidad de datos» visible tras desplazarla y el clic abre /configuracion/portabilidad | 1366×768: tras la rueda sobre la barra visible y pulsable; el clic abre la pantalla; 1280×720: tras la rueda sobre la barra visible y pulsable; el clic abre la pantalla; 1280×600: tras la rueda sobre la barra visible y pulsable; el clic abre la pantalla | PASS | MINOR | 089835f | PASS (este caso) | Antes de la corrección, a 1280×720 en /facturas el último destino («Portabilidad de datos») quedaba cortado fuera de la ventana y no se podía pulsar: la barra fija no se desplazaba (overflow visible). Corrección trivial: overflow-y-auto en el contenedor fijo, con prueba de regresión en app-shell.test.tsx. |
