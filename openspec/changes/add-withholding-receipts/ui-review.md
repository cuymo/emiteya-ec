# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Retenciones` (`/retenciones`), la nueva retención (`/retenciones/borradores/nueva`), el borrador (`/retenciones/borradores/{id}`) con su confirmación, el detalle (`/retenciones/{id}`), la bandeja `Comprobantes` con el tipo `07` y los catálogos de retención en `Catálogos fiscales` (design D20 y D24). Fecha: 2026-10-06.

## Método

- **Recorrido automatizado** con el Chrome del sistema (`playwright-core` en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts` como proceso, con la custodia de firmas habilitada) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas, que se borra al terminar.
  - La firma es la **sintética** de los fixtures de las pruebas (`sd-utf8.modern.p12`, generada en un directorio temporal y borrada al terminar). No se usó ninguna firma real, ningún archivo de credenciales ni ninguna contraseña real.
  - La transmisión apunta al **SRI simulado** local de las pruebas de extremo a extremo, con respuestas SOAP **sintéticas**, detrás de un proxy de salida que solo admite su host (`sri-simulado.test`, que no resuelve por DNS). Ninguna llamada salió a un endpoint real del SRI: el SRI simulado registró 6 llamadas (3 recepciones y 3 autorizaciones) y no hubo ningún otro destino. La transmisión solo se habilitó en ese proceso aislado; la configuración del proyecto sigue con `SRI_TRANSMISSION_ENABLED` apagado.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa solo la API real: configuración tributaria, establecimiento y punto, firma sintética con custodia, una operadora y dos proveedores (una sociedad con RUC y una persona natural con cédula y una razón social de 75 caracteres). La base solo se lee para esperar estados; no se escribe nada por SQL.
  - El recorrido completo se repitió desde una instalación nueva después de corregir cada grupo de hallazgos.
- **Datos preparados:**
  - retención 001-001-1 a la sociedad: una factura con renta 312 (2 %) e IVA código 1 (30 %) y una liquidación de compra con renta 303 (10 %), total retenido USD 106,50, autorizada, con su RIDE;
  - retención 001-001-2 a la persona natural, parte relacionada SÍ, **no autorizada** por el SRI simulado;
  - borradores: uno listo para emitir con una retención en cero (código 7), uno con problemas (sin parte relacionada, el código 8 guardado y una retención de renta sin concepto ni base) y uno con el período 09/2026, anterior al mes de emisión.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px, de la lista, el borrador con problemas, el borrador listo, el combobox de conceptos, la confirmación (con y sin el período distinto), el detalle autorizado, el no autorizado, la bandeja y los catálogos (23 capturas).
- **Pruebas de componentes:**
  - `frontend/test/withholding-receipts-screen.test.tsx` (6: lista, carga, vacío, error, sin permiso, filtros y borradores en curso), `withholding-draft-editor.test.tsx` (14), `withholding-receipt-detail.test.tsx` (3), `withholding-sections.test.tsx` (7: Documentos y Transmisión con la retención) y las nuevas de `documents-screen.test.tsx`, `fiscal-catalogs-screen.test.tsx` (3) y `app-shell.test.tsx`;
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main` y del diálogo de confirmación (que se monta fuera de `main`), con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.
- **Consola:** se registran los errores de todas las páginas recorridas. Se separan como ruido previo a este cambio los `401` de `/api/v1/me` en la página de inicio de sesión (la comprobación de sesión) y el `404` del favicon (el frontend no publica favicon).

## Bandeja, lista, borrador, detalle y catálogos (tareas 11.1 y 12.1 a 12.3)

110 comprobaciones contra el backend real, todas correctas (recorrido repetido desde una instalación nueva después de los ajustes de la verificación del cambio):

- **Retenciones (operadora):**
  - título "Retenciones · Facturador SRI" y "Retenciones" activo en el grupo Operación;
  - las retenciones con número, proveedor con su identificación, período ("Octubre de 2026") con el número de documentos, total retenido (USD 106,50 y USD 10,00) y estado ("Autorizado", "No autorizado"); el número no se parte;
  - "Borradores en curso" con los tres borradores, su período, sus documentos y retenciones, su total o "Sin calcular", y su enlace; "Nueva retención" como acción secundaria;
  - el estado (`estado=no-autorizadas`) y el período (`periodo=2026-10`) quedan en la URL y filtran.
- **Borrador con problemas:**
  - el documento y la retención marcados (`aria-invalid`), con "El código de retención del IVA 8 no se emite como retención en el alcance actual…" junto a la retención, y "Elige el concepto de retención." e "Indica la base de la retención." junto a la otra; la parte relacionada pendiente en "Antes de emitir"; "Emitir retención" deshabilitado con "Resuelve los problemas antes de emitir.";
  - el código 8 guardado se muestra como "Código 8 (no disponible)" y nunca se convierte en otro;
  - la parte relacionada empieza sin selección y se elige con el teclado (espacio); tras guardar, el foco va a "Resumen".
- **Edición y foco:** "Agregar documento sustento" lleva el foco al documento nuevo y "Quitar el documento sustento 2" lo devuelve a "Agregar documento sustento"; el número se escribe con su máscara (`002-005-1234` mientras se escribe).
- **Borrador listo:** la retención en cero muestra la nota oficial del código 7 y "0 % · valor retenido USD 0,00"; la renta 312 "2 % · valor retenido USD 2,00", del servidor, sin campos para el porcentaje ni el valor (la única caja de texto de la retención es la base). El concepto de renta se elige en el combobox con búsqueda y la búsqueda "honorarios" deja solo los conceptos que la contienen.
- **Confirmación:** el resumen con el ambiente, el proveedor, el período, la parte relacionada, los documentos y el total retenido; Escape cierra y el foco vuelve a "Emitir retención".
- **Período distinto del mes de emisión:** el aviso en el borrador; en la confirmación, el período resaltado y la emisión deshabilitada hasta marcar "Confirmo el período Septiembre de 2026, distinto del mes de emisión (Octubre de 2026)."; Enter abre la confirmación; el doble clic emite una sola retención (la lista pasa de 2 a 3), que el SRI simulado autoriza, y sin recargar la sección de documentos llega a "El RIDE está listo para entregarse.".
- **Detalle autorizado:** "El SRI autorizó la retención: está lista para entregarse."; cada documento con su tipo y número ("Factura 001-001-000000123", "Liquidación de compra de Bienes o Prestación de servicios 002-005-000004567"), su sustento y sus retenciones ("RENTA 312", "IVA 1"); "Declarada por Olga Operadora" y "el sistema no puede comprobarla"; cada documento con "Declarado por el usuario: el sistema no verifica su existencia en el SRI."; el total retenido USD 106,50; "Descargar RIDE", "Imprimir", "XML autorizado" y "XML firmado", y la descarga entrega `comprobante-de-retencion-001-001-000000001.pdf`.
- **Detalle no autorizado:** "El SRI no autorizó la retención", con el mensaje sintético del SRI y solo el XML firmado.
- **Comprobantes:** el filtro ofrece "Comprobante de retención"; con `tipo=07`, la retención con su tipo bajo el número y el enlace a `/retenciones/{id}`.
- **Nueva retención:** "Nuevo proveedor", desde el selector de proveedores, abre el alta del tercero con el rol de proveedor ya marcado.
- **Catálogos fiscales (administradora):** 59 conceptos de renta "Soportada" con su habilitación y 68 "Fuera de alcance" sin control, con su razón; los cuatro 323 M, N, O y P "pendiente de evidencia y de soporte futuro" y sin control; el código 8 del IVA se conserva sin control, con "La fuente no define su representación en el comprobante." y sin prometer soporte futuro; la fuente "Catálogo del Anexo Transaccional Simplificado (ATS) del 06/08/2026" con el SHA-256 del archivo; la nota de venta con sus sustentos admitidos, sin el 01.
- **Móvil a 375 y 320 px:** lista en tarjetas, borrador y detalle sin desbordamiento; "Nueva retención", "Emitir retención", "Guardar borrador" y "Agregar documento sustento" miden 44 px; cada opción de los controles segmentados contiene su texto; en la confirmación, "Cancelar" y "Emitir retención" quedan a la vista y el número del documento en una línea; en el detalle, el número del título y los importes de cada retención no se parten.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, el borrador, la lista y el detalle sin desbordamiento.
- **Tema oscuro:** lista, borrador, confirmación y detalle en escritorio y a 375 px, sin desbordamiento y con el contraste medido.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.95:1 en claro y 6.46:1 en oscuro; borrador 5.15:1 en claro y 6.71:1 en oscuro; confirmación 5.95:1 en claro y 6.71:1 en oscuro; detalle 4.98:1 en claro y 6.71:1 en oscuro; catálogos 6.54:1.
- **Consola:** sin errores nuevos.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D24 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `withholding-receipts-screen.tsx`, `withholding-draft-editor.tsx` y `withholding-receipt-detail.tsx`, con P0 a P3. Los identificadores, las claves de idempotencia, las versiones y los `entryKey` (P3) no se muestran. |
| Tarea y jerarquía | En la lista, la acción principal es abrir la retención y la secundaria "Nueva retención". En el borrador, una sola acción primaria ("Emitir retención") y "Guardar borrador" secundaria; el proveedor, la parte relacionada y el período van antes que los documentos, y el punto después; el resumen con el total retenido queda al lado. En el detalle, "Reintentar firma" solo en `RESERVED`. |
| Datos y lenguaje | Estados, impuestos y textos en lenguaje de negocio ("Renta", "Retención en cero", "Fuera de alcance" con su razón). El período se nombra "Octubre de 2026"; el número del documento, con su máscara. La parte relacionada dice siempre que es una declaración del usuario. Los límites de recursos se presentan como límites del sistema, no del SRI. Importes con los separadores de es-EC y cifras tabulares. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; los problemas en rojo van con su texto y el documento o la retención marcados con borde y `aria-invalid`, nunca solo color. |
| Selección de componentes | `AppDataTable`, `ChipGroup`, `SearchInput`, `Select` (período, sustento, códigos de IVA y de IRBPNR, formas de pago y punto), `SegmentedControl` (parte relacionada sin selección inicial, tipo de documento, impuesto del documento e impuesto a retener), `EntityPickerDialog` (proveedores, y como combobox con búsqueda para los 59 conceptos de renta y los 75 códigos de ICE), `DatePickerField`, `PartyDialog` con el rol de proveedor y `ConfirmDialog` con la confirmación del período como contenido propio. |
| Tablas | Paginación en el servidor con tamaño de página en la URL; búsqueda con espera de 300 ms; estado y período en la URL; estados de carga, vacío (con "Nueva retención"), sin coincidencias, error con reintento y sin permiso. La bandeja ofrece el tipo `07` en el filtro y bajo el número. Por debajo de 768 px, tarjetas con la misma información; en el detalle, por debajo de 640 px, cada retención apilada. |
| Formularios y diálogos | React Hook Form con los dominios de importe y base del contrato; el borrador se guarda incompleto y la vista previa del servidor informa lo que falta junto a su documento, su impuesto, su pago o su retención. Los porcentajes, los valores retenidos y el total son la vista previa del servidor: el frontend no calcula dinero. Un solo envío ante el doble clic y la misma `Idempotency-Key` en el reintento de la misma versión. Los `409` se explican con lo que conviene hacer ("Recargar borrador", "Ver retenciones" o la vista previa actualizada). La emisión es irreversible: confirmación con el resumen y, si el período difiere del mes de emisión, su confirmación explícita. |
| Feedback y estado | Las operaciones pasan por `useMutationFeedback`. Tras guardar, el foco va a "Resumen"; tras un error de emisión, al aviso; al cancelar, vuelve a "Emitir retención"; al agregar un documento, a su primer campo de texto; al agregar un impuesto, un pago o una retención, a su importe; al quitarlos, a su botón de agregar. El detalle se refresca mientras hay una interacción con el SRI en curso, y la sección de documentos se vuelve a pedir con cada cambio de estado. |
| Navegación y responsive | Cuatro rutas nuevas bajo `/retenciones`, con "Retenciones" en el grupo Operación. Por debajo de 768 px, tarjetas y controles de 44 px. |
| Rendimiento | La lista y los borradores piden una página acotada; el selector de proveedores pagina en el servidor; las opciones del borrador llegan en una sola consulta y los combobox de conceptos y de ICE buscan sobre ellas sin otra consulta. `bench:withholding-receipts` (tarea 13.1) mide la API. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. La parte relacionada y los demás controles segmentados tienen su nombre accesible; el botón deshabilitado explica por qué con `aria-describedby`; el cálculo de cada retención tiene su nombre ("Cálculo de la retención 1 del documento 1"); los encabezados que reciben el foco son enfocables (`tabIndex={-1}`). |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra el ambiente de Pruebas del SRI se hará después de cerrar los changes 12 a 16, como compuerta previa a la puesta en producción. |
| Estado sin permiso alcanzable | Ambos roles tienen `withholdings.read`, `withholdings.draft`, `withholdings.emit` y `withholdings.retrySigning`; la reconciliación es solo del administrador. El `403` de las consultas se comprueba con las pruebas de componentes (respuesta `403`) y con las pruebas de permisos y HTTP del servicio. |
| Revisión manual en el recorrido | El SRI simulado no produce dos autorizaciones para una clave. La retención en revisión manual, su reconciliación solo del administrador y el `409` de un estado no reconciliable se comprueban con las pruebas de componentes (`withholding-sections.test.tsx`) y con `backend/test/integration/withholding-reconciliation-api.test.ts`. |
| Código de ICE en un combobox | La design D24 pide un `Select` para la tarifa de los impuestos del documento. Con 75 códigos de ICE, la regla de componentes del proyecto (`docs/architecture/frontend.md`: el `Select` es para cinco a quince opciones) pide un combobox con búsqueda: el ICE usa el mismo `EntityPickerDialog` que los conceptos de renta; IVA e IRBPNR siguen en un `Select`. |
| Nombre del tipo en las secciones compartidas | `DocumentsSection` y `TransmissionSection` no cambian (design D20) y concuerdan sus frases en femenino ("la …", "firmada", "autorizada"): nombran la retención como "retención"; el filtro y la etiqueta del tipo dicen "Comprobante de retención". |
| Ruido de consola previo | Los `401` de la comprobación de sesión antes de entrar y el `404` del favicon existían antes de este cambio y no dependen de él. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |

## Hallazgos corregidos durante la revisión

- **El número se partía en la lista.** A 1280 px, con un proveedor de razón social larga, "001-001-000000002" ocupaba dos líneas en la columna Número; el número de la lista y de sus tarjetas ya no se parte.
- **El código guardado que dejó de ser utilizable no se veía.** El borrador con el código 8 guardado mostraba "Elige el código", como si no hubiera nada elegido; el `Select` muestra ahora "Código 8 (no disponible)" y la vista previa explica por qué no se puede emitir. Lo cubre una prueba de componente nueva.
- **La tabla de retenciones del detalle se apretaba en móvil.** A 375 px, "Base" y "Porcentaje" quedaban pegados y los importes se partían ("USD / 100,00"); al impedir que se partan, a 320 px la tabla desbordaba. Por debajo de 640 px, cada retención va ahora apilada (impuesto y código, denominación, base, porcentaje y valor retenido) y los importes no se parten; desde 640 px sigue la tabla, con separación entre columnas.
- **El número se partía en el título y en los totales del detalle.** "Retención 001-001-/000000001" y "RENTA 312 · 001-001-/000000123" se cortaban en dos líneas a 375 px; el número va ahora en una sola línea.

## Ajustes de la verificación del cambio

La verificación de los requisitos y escenarios (`/opsx:verify`) pidió cambios de texto que se revisaron otra vez en el navegador:

- **Clasificación de los catálogos de retención.** Toda entrada que no se elige figura "Fuera de alcance" con la razón de la spec: por no residente, por porcentaje variable, por estructura especial excluida o por representación ambigua (los 323 M, N, O y P, pendientes de evidencia y de soporte futuro). El código 8 del IVA dice que la fuente no define su representación en el comprobante, sin prometer soporte futuro.
- **Fuente y sustentos.** La fuente del Catálogo ATS muestra el SHA-256 del archivo, y cada tipo de documento sustento los sustentos que el Catálogo ATS le asigna.
- **Documento declarado.** En el detalle, cada documento sustento dice que es una declaración del usuario que el sistema no verifica en el SRI.
- **Mensajes.** El rechazo del código 8 dice que no se emite como retención en el alcance actual; los de dividendos, pagos al exterior e ISD lo dicen también, y el de un sustento incompatible lista los sustentos admitidos.

No quedan hallazgos abiertos.
