# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Liquidaciones de compra` (`/liquidaciones-compra`), la nueva liquidación (`/liquidaciones-compra/borradores/nueva`), el borrador (`/liquidaciones-compra/borradores/{id}`) con su confirmación, el detalle (`/liquidaciones-compra/{id}`) y la bandeja `Comprobantes` con el tipo `03` (design D20 y D24). Fecha: 2026-10-07.

## Método

- **Recorrido automatizado** con Chromium (`playwright-core` en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts` como proceso, con la custodia de firmas habilitada) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas, que se borra al terminar.
  - La firma es la **sintética** de los fixtures de las pruebas (`sd-utf8.modern.p12`, generada en un directorio temporal y borrada al terminar). No se usó ninguna firma real, ningún archivo de credenciales ni ninguna contraseña real.
  - La transmisión apunta al **SRI simulado** local de las pruebas de extremo a extremo, con respuestas SOAP **sintéticas**, detrás de un proxy de salida que solo admite su host (`sri-simulado.test`, que no resuelve por DNS). Ninguna llamada salió a un endpoint real del SRI: en la instalación nueva, el SRI simulado registró 6 llamadas (3 recepciones y 3 autorizaciones: las dos liquidaciones preparadas y la emitida en el recorrido) y el proxy no vio ningún otro destino. La transmisión solo se habilitó en ese proceso aislado; la configuración del proyecto sigue con `SRI_TRANSMISSION_ENABLED` apagado.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa solo la API real: configuración tributaria, el establecimiento 001 con su punto, firma sintética con custodia, una operadora con su punto predeterminado, cuatro terceros con el rol de proveedor (María Quishpe con cédula y dirección; un proveedor con pasaporte y una razón social y una dirección largas; uno con RUC, no seleccionable; y Rosa Chicaiza con cédula y sin dirección), un bien y un servicio. La base solo se lee para esperar estados; no se escribe nada por SQL.
  - El recorrido completo se repitió desde una instalación nueva después de corregir los hallazgos.
- **Datos preparados:**
  - liquidación 001-001-1 a María Quishpe, con una línea al 15 % con producto, unidad y descuento, otra libre al 0 % y dos pagos (contado y 30 días); autorizada, con su RIDE;
  - liquidación 001-001-2 al proveedor con pasaporte, **no autorizada** por el SRI simulado;
  - borradores: dos listos (uno se emite en el recorrido y otro solo abre la confirmación), uno con los pagos por debajo del importe total, uno con problemas (una línea sin descripción y un pago sin plazo) y uno vacío.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px, de la lista, el borrador con problemas, el borrador con la diferencia de los pagos, el selector de proveedores, el alta de un proveedor, el borrador listo, la confirmación, el detalle autorizado y el no autorizado, y la bandeja (26 capturas).
- **Pruebas de componentes:**
  - `frontend/test/purchase-settlements-screen.test.tsx` (7: lista, carga, vacío, error, sin permiso, filtros, borradores en curso y sin `purchaseSettlements.draft`), `purchase-settlement-draft-editor.test.tsx` (15), `purchase-settlement-detail.test.tsx` (4), `purchase-settlement-sections.test.tsx` (7: Documentos y Transmisión con la liquidación) y las nuevas de `documents-screen.test.tsx` y `app-shell.test.tsx`;
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main` y de los diálogos (que se montan fuera de `main`), convertido a sRGB a través de un lienzo (los tokens son `oklch`) y con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.
- **Consola:** se registran los errores de todas las páginas recorridas. Se separa como ruido previo a este cambio el `404` del favicon (el frontend no publica favicon).

## Lista, borrador, detalle y bandeja (tareas 11.1 y 12.1 a 12.3)

94 comprobaciones contra el backend real, todas correctas en la instalación nueva:

- **Liquidaciones de compra (operadora):**
  - título "Liquidaciones de compra · Facturador SRI" y "Liquidaciones de compra" activo en el grupo Operación, después de Facturas;
  - las liquidaciones con número, proveedor con su identificación, fecha, importe total ("USD 106,00") y estado ("Autorizado", "No autorizado"); el número no se parte;
  - "Borradores en curso" con su proveedor ("Liquidación a María Quishpe" o "Liquidación sin proveedor"), sus líneas, el importe de su vista previa y su enlace; "Nueva liquidación de compra" como acción secundaria;
  - el estado (`estado=no-autorizadas`) y la búsqueda por pasaporte (`q=AB1234567`) quedan en la URL y filtran; el texto de ayuda de la búsqueda cabe en el campo.
- **Borrador con problemas:**
  - la línea 2 y el pago 1 marcados (`aria-invalid`), con "Línea 2: escribe la descripción." y "Pago 1: escribe el plazo del pago." junto a ellos; sin importe total mientras una línea no se calcula; "Emitir liquidación de compra" deshabilitado con "Resuelve los problemas antes de emitir.";
  - un proveedor de 77 caracteres va en su propio renglón del resumen: no parte los rótulos de los importes.
- **Borrador con la diferencia de los pagos:** "Antes de emitir" explica lo que falta y la sección Pagos muestra "Pagos USD 50,00 de un importe total de USD 106,00.".
- **Borrador vacío:**
  - ninguna forma de pago, total, plazo, unidad de tiempo ni tarifa de IVA precargados; el punto predeterminado de la operadora preseleccionado;
  - el proveedor con RUC aparece en el selector deshabilitado (`aria-disabled`, "…, no se puede elegir") con su motivo, y un clic no lo elige; Rosa Chicaiza, sin dirección, deja la dirección vacía; María Quishpe la propone ("Comunidad San Pablo, Cayambe") porque estaba vacía;
  - "Nuevo proveedor" abre el alta del tercero con el rol de proveedor marcado a la vista;
  - el servicio elegido como producto propone su código y su descripción y deja el precio vacío;
  - "Quitar el pago 2" devuelve el foco a "Agregar pago".
- **Borrador listo:**
  - el resumen con los subtotales por tarifa, el subtotal sin impuestos, el descuento, el IVA 15 %, el importe total, el aviso de la retención y las cuatro declaraciones que se confirmarán; cada línea con su base imponible y su IVA de la vista previa;
  - Enter abre la confirmación; tiene el ambiente, el proveedor, el importe total, las líneas y los pagos, el aviso de que las declaraciones son del usuario, la fuente de la política y cuatro casillas, una por declaración, sin casilla genérica; la confirmación está deshabilitada sin las cuatro; Escape cierra y el foco vuelve a "Emitir liquidación de compra";
  - las casillas se marcan con el teclado (espacio) y habilitan la emisión;
  - el doble clic emite una sola liquidación (la lista pasa de 2 a 3), que el SRI simulado autoriza, y sin recargar llega a "El RIDE está listo para entregarse.".
- **Detalle autorizado:** "El SRI autorizó la liquidación: está lista para entregarse."; el aviso de la retención; el proveedor congelado ("Cédula 1710034065" y su dirección); la procedencia con las cuatro declaraciones, cada una "Declarada por Olga Operadora" con su momento, y "el sistema no puede comprobarlas", sin ninguna indicación de verificación; las líneas con su unidad, su código, su descuento y su IVA; los pagos con su plazo; los totales; "Descargar RIDE", "Imprimir", "XML autorizado" y "XML firmado", y la descarga entrega un PDF `liquidacion-de-compra-001-001-000000001.pdf`.
- **Detalle no autorizado:** "El SRI no autorizó la liquidación", con el mensaje sintético del SRI y solo el XML firmado; la razón social larga no desborda.
- **Comprobantes:** el filtro ofrece los seis tipos, con "Liquidación de compra" en segundo lugar; con `tipo=03`, solo liquidaciones, con su tipo bajo el número, "Proveedor · 1710034065" y el enlace a `/liquidaciones-compra/{id}`.
- **Nueva liquidación:** "Preparar borrador" abre el editor.
- **Móvil a 375 y 320 px:** lista en tarjetas, borrador y detalle sin desbordamiento; "Nueva liquidación de compra", "Emitir liquidación de compra", "Guardar borrador", "Agregar línea" y "Agregar pago" miden 44 px; en la confirmación, las casillas, "Cancelar" y "Emitir liquidación de compra" quedan dentro de la pantalla; el número del título del detalle no se parte.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, la lista, el borrador y el detalle sin desbordamiento.
- **Tema oscuro:** lista, borrador, confirmación y detalle en escritorio y a 375 px, sin desbordamiento y con el contraste medido.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.95:1 en claro y 6.46:1 en oscuro; borrador con problemas 5.15:1 en claro y 5.62:1 en oscuro; selector de proveedores 5.15:1; borrador listo 5.95:1; confirmación 5.95:1 en claro y 6.71:1 en oscuro; detalle 5.95:1 en claro y 6.71:1 en oscuro; bandeja 5.95:1.
- **Consola:** sin errores nuevos.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D24 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `purchase-settlements-screen.tsx`, `purchase-settlement-draft-editor.tsx` y `purchase-settlement-detail.tsx`, con P0 a P3. Los identificadores, las claves de idempotencia y las versiones (P3) no se muestran. |
| Tarea y jerarquía | En la lista, la acción principal es abrir la liquidación y la secundaria "Nueva liquidación de compra". En el borrador, una sola acción primaria ("Emitir liquidación de compra") y "Guardar borrador" secundaria; el punto, el proveedor, las líneas y los pagos van en ese orden, con el resumen al lado. En el detalle, "Reintentar firma" solo en `RESERVED`. |
| Datos y lenguaje | Estados y textos en lenguaje de negocio. Las declaraciones se presentan siempre como del usuario, con su autor y su momento, nunca como verificadas. El aviso de la retención es una obligación, nunca la evidencia de una retención emitida. El RUC aparece como restricción del sistema para el caso c). Los límites de recursos se presentan como límites del sistema, no del SRI. El vacío explica cuándo se emite una liquidación (art. 13, letra c). |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; los problemas en rojo van con su texto y la línea o el pago marcados con borde y `aria-invalid`, nunca solo color. |
| Selección de componentes | `AppDataTable`, `ChipGroup`, `SearchInput`, `Select` (punto, IVA y forma de pago sin selección inicial), `EntityPickerDialog` (proveedores con los no seleccionables deshabilitados y su motivo, y productos activos), `PartyDialog` con el rol de proveedor marcado y `ConfirmDialog` con las cuatro declaraciones como contenido propio. |
| Tablas | Paginación en el servidor con tamaño de página en la URL; búsqueda con espera de 300 ms; estado en la URL; estados de carga, vacío (con "Nueva liquidación de compra"), sin coincidencias, error con reintento y sin permiso. La bandeja ofrece el tipo `03` en el filtro y bajo el número, con la contraparte rotulada "Proveedor". Por debajo de 768 px, tarjetas con la misma información. |
| Formularios y diálogos | React Hook Form con los dominios del contrato (cantidad y precio con hasta 6 decimales, importes y plazo con 2, textos sin saltos de línea y con su longitud); el borrador se guarda incompleto y la vista previa del servidor informa lo que falta junto a su línea o su pago. Nunca se envían importes ni datos derivados. El producto solo propone el código y la descripción. Un solo envío ante el doble clic y la misma `Idempotency-Key` en el reintento de la misma versión; un rechazo desmarca las declaraciones. Los `409` se explican con lo que conviene hacer ("Recargar borrador", "Ver liquidaciones de compra" o la vista previa actualizada). La emisión es irreversible: confirmación con el resumen y las cuatro declaraciones explícitas. |
| Feedback y estado | Las operaciones pasan por `useMutationFeedback`. Tras guardar, el foco va a "Resumen"; tras un error de emisión, al aviso; al cancelar, vuelve a "Emitir liquidación de compra"; al quitar una línea o un pago, a su botón de agregar. El detalle se refresca mientras hay una interacción con el SRI en curso. |
| Navegación y responsive | Cuatro rutas nuevas bajo `/liquidaciones-compra`, con "Liquidaciones de compra" en el grupo Operación. Por debajo de 768 px, tarjetas y controles de 44 px. |
| Rendimiento | La lista y los borradores piden una página acotada; los selectores de proveedores y productos paginan en el servidor. `bench:purchase-settlements` (tarea 14.1) mide la API. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. El botón deshabilitado explica por qué con `aria-describedby`; el proveedor no seleccionable se anuncia como tal y lleva `aria-disabled`; cada casilla tiene el texto completo de su declaración como nombre accesible; los encabezados que reciben el foco son enfocables (`tabIndex={-1}`). |

## Hallazgos corregidos

| Hallazgo | Corrección |
| --- | --- |
| A 320 px, en la confirmación, "Cancelar" quedaba en parte fuera de la pantalla: el rótulo "Emitir liquidación de compra" no cabía junto a él en el pie. | El pie de `ConfirmDialog` admite pasar los botones a un segundo renglón (`flex-wrap`); solo cambia cuando no caben, de modo que los diálogos de los demás tipos se ven igual. |
| El texto de ayuda de la búsqueda ("Número, identificación o nombre") se cortaba en el campo. | "Número o proveedor"; el nombre accesible sigue siendo "Buscar por número o proveedor". |
| En el resumen del borrador, una razón social larga del proveedor comprimía la columna de los rótulos y partía "Importe total". | El proveedor va en su propio renglón, sobre los importes, con su identificación. |
| El rótulo de las declaraciones repetía el paréntesis final de la fuente ("…letra c))"). | El rótulo es "Declaraciones de procedencia" y la fuente va debajo ("Fuente: …"). |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra el ambiente de Pruebas del SRI se hará después de cerrar los changes 12 a 16, como compuerta previa a la puesta en producción. |
| Estado sin permiso alcanzable | Ambos roles tienen `purchaseSettlements.read`, `purchaseSettlements.draft`, `purchaseSettlements.emit` y `purchaseSettlements.retrySigning`; la reconciliación es solo del administrador. El acceso sin permiso se comprueba con las pruebas de componentes (respuesta `403` y permisos retirados) y con las pruebas de permisos y HTTP del servicio. |
| Revisión manual en el recorrido | El SRI simulado no produce dos autorizaciones para una clave. La liquidación en revisión manual, su reconciliación solo del administrador y el `409` de un estado no reconciliable se comprueban con las pruebas de componentes (`purchase-settlement-sections.test.tsx`) y con `backend/test/integration/purchase-settlement-reconciliation-api.test.ts`. |
| Nombre del tipo en las secciones compartidas | `DocumentsSection` y `TransmissionSection` no cambian (design D20) y concuerdan sus frases en femenino ("la …", "firmada", "autorizada"): nombran la liquidación como "liquidación"; el filtro y la etiqueta del tipo dicen "Liquidación de compra". |
| Contraparte en las columnas del comprador | La bandeja reutiliza provisionalmente las columnas genéricas del comprador para el proveedor (deuda registrada en `docs/quality/technical-debt.md`); la interfaz lo rotula siempre "Proveedor". |
