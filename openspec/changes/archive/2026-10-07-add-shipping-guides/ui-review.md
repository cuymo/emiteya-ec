# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Guías de remisión` (`/guias-remision`), la nueva guía (`/guias-remision/borradores/nueva`), el borrador (`/guias-remision/borradores/{id}`) con su confirmación, el detalle (`/guias-remision/{id}`), la acción "Nueva guía de remisión" del detalle de una factura y la bandeja `Comprobantes` con el tipo `06` (design D21 y D25). Fecha: 2026-10-06.

## Método

- **Recorrido automatizado** con el Chrome del sistema (`playwright-core` en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts` como proceso, con la custodia de firmas habilitada) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas, que se borra al terminar.
  - La firma es la **sintética** de los fixtures de las pruebas (`sd-utf8.modern.p12`, generada en un directorio temporal y borrada al terminar). No se usó ninguna firma real, ningún archivo de credenciales ni ninguna contraseña real.
  - La transmisión apunta al **SRI simulado** local de las pruebas de extremo a extremo, con respuestas SOAP **sintéticas**, detrás de un proxy de salida que solo admite su host (`sri-simulado.test`, que no resuelve por DNS). Ninguna llamada salió a un endpoint real del SRI: el SRI simulado registró 8 llamadas (4 recepciones y 4 autorizaciones: la factura sustento y tres guías) y no hubo ningún otro destino. La transmisión solo se habilitó en ese proceso aislado; la configuración del proyecto sigue con `SRI_TRANSMISSION_ENABLED` apagado.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa solo la API real: configuración tributaria, los establecimientos 001 (con su punto) y 002 (bodega, con una dirección larga), firma sintética con custodia, una operadora, un cliente con RUC, una persona natural con cédula y una razón social de 81 caracteres sin roles, un transportista con el rol y otro con pasaporte de 14 caracteres (no seleccionable), un bien y un servicio, y una factura autorizada por el SRI simulado con el bien y el servicio. La base solo se lee para esperar estados; no se escribe nada por SQL.
  - El recorrido completo se repitió desde una instalación nueva después de corregir los hallazgos.
- **Datos preparados:**
  - guía 001-001-1, transporte propio desde el establecimiento 001, con dos destinatarios: el cliente con la factura sustento y un traslado a la bodega 002 (excepción d declarada); autorizada, con su RIDE;
  - guía 001-001-2 con el transportista tercero, en consignación a la persona natural, **no autorizada** por el SRI simulado;
  - borradores: uno listo con la factura, uno listo con una exhibición (excepción e) y uno con problemas (sin placa, sin fechas, sin dirección ni motivo, con un servicio como detalle y sin cantidad).
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px, de la lista, el borrador con problemas, el selector de transportistas, la carga de mercancías, la confirmación (con y sin la declaración), el detalle autorizado y el no autorizado, la bandeja y el borrador propuesto desde la factura (24 capturas).
- **Pruebas de componentes:**
  - `frontend/test/shipping-guides-screen.test.tsx` (6: lista, carga, vacío, error, sin permiso, filtros y borradores en curso), `shipping-guide-draft-editor.test.tsx` (13), `shipping-guide-detail.test.tsx` (7, con la acción de la factura), `shipping-guide-sections.test.tsx` (7: Documentos y Transmisión con la guía) y las nuevas de `documents-screen.test.tsx` y `app-shell.test.tsx`;
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main` y de los diálogos (que se montan fuera de `main`), con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.
- **Consola:** se registran los errores de todas las páginas recorridas. Se separan como ruido previo a este cambio los `401` de `/api/v1/me` en la página de inicio de sesión (la comprobación de sesión) y el `404` del favicon (el frontend no publica favicon).

## Lista, borrador, detalle, bandeja y acción de la factura (tareas 11.1 y 12.1 a 12.3)

112 comprobaciones contra el backend real, todas correctas en la instalación nueva:

- **Guías de remisión (operadora):**
  - título "Guías de remisión · Facturador SRI" y "Guías de remisión" activo en el grupo Operación;
  - las guías con número, destinatarios ("2 destinatarios" o el nombre del único), transportista ("TRANSPORTES ANDINOS S.A." o la empresa en el transporte propio), fechas y estado ("Autorizado", "No autorizado"), sin importes; el número no se parte;
  - "Borradores en curso" con su transportista, sus destinatarios, sus detalles y su fecha de inicio, y su enlace; "Nueva guía de remisión" como acción secundaria;
  - el estado (`estado=no-autorizadas`) y la búsqueda por la cédula de un destinatario (`q=1710034065`) quedan en la URL y filtran.
- **Borrador con problemas:**
  - el destinatario y el detalle marcados (`aria-invalid`), con el mensaje del servicio junto al detalle y los de la dirección y el motivo junto al destinatario; la placa y las fechas en "Antes de emitir"; "Emitir guía de remisión" deshabilitado con "Resuelve los problemas antes de emitir.";
  - el modo del detalle se elige con el teclado (espacio) y la línea libre ofrece sus códigos; la descripción muestra su vista previa tal como irá al XML y al RIDE ("«10 cajas de 12 botellas de 1 litro»") y su contador (34/300);
  - "Quitar el destinatario 2" devuelve el foco a "Agregar destinatario"; tras guardar, el foco va a "Resumen".
- **Borrador listo:**
  - el transportista con pasaporte de 14 caracteres aparece en el selector deshabilitado (`aria-disabled`) con su motivo ("…admite como máximo 13 (Ficha técnica v2.34, anexo 3, página 70)") y un clic no lo elige;
  - el establecimiento de origen empieza sin selección; elegido, la partida es su dirección, de solo lectura y sin campo;
  - "Cargar mercancías de la factura" marca solo el bien y ofrece el servicio sin marcar como "Agregar como línea libre: Instalación en obra" con su cantidad y su código facturados, y el aviso de sugerencia; nunca lo llama servicio ni no trasladable;
  - la confirmación resume el ambiente, el transportista, la placa, las fechas y cada destinatario con su factura, sin casilla; Escape cierra y el foco vuelve a "Emitir guía de remisión"; Enter la abre;
  - el doble clic emite una sola guía (la lista pasa de 2 a 3), que el SRI simulado autoriza, y sin recargar llega a "El RIDE está listo para entregarse.".
- **Borrador con una excepción:** la confirmación lista "Destinatario 1: Exhibición o demostración (literal e)." con su texto oficial y no emite sin la casilla "Declaro que los traslados sin factura corresponden a los casos indicados del art. 30 del Reglamento de Comprobantes."; marcada, la emisión se habilita.
- **Detalle autorizado:** "El SRI autorizó la guía: está lista para entregarse."; el transporte ("Transporte propio", la placa, las fechas y "Desde el establecimiento 001"); el cliente con la factura (enlace a `/facturas/{id}`), su fecha, su autorización y su detalle; el traslado a la bodega como "Establecimiento propio 002" con "Sin factura: Traslado entre establecimientos propios (art. 30, numeral 8, literal d)", "Declarada por Olga Operadora" con su momento y "el sistema no puede comprobarla"; "La guía no tiene total monetario"; "Descargar RIDE", "Imprimir", "XML autorizado" y "XML firmado", y la descarga entrega un PDF.
- **Detalle no autorizado:** "El SRI no autorizó la guía", con el mensaje sintético del SRI y solo el XML firmado.
- **Comprobantes:** el filtro ofrece "Guía de remisión"; con `tipo=06`, la guía con su tipo bajo el número, "2 destinatarios" y el enlace a `/guias-remision/{id}`.
- **Desde la factura:** "Nueva guía de remisión" en el detalle de la factura autorizada crea el borrador propuesto: el comprador, la factura como sustento y solo el bien como detalle (el servicio no se agrega solo).
- **Nueva guía:** "Preparar borrador" abre el editor con el transporte sin selección; elegir el punto propone la partida con la dirección de su establecimiento; "Nuevo transportista" abre el alta del tercero con el rol de transportista marcado.
- **Móvil a 375 y 320 px:** lista en tarjetas, borrador y detalle sin desbordamiento; "Nueva guía de remisión", "Emitir guía de remisión", "Guardar borrador", "Agregar destinatario" y "Agregar detalle" miden 44 px; cada opción de los controles segmentados contiene su texto; en la confirmación, "Cancelar", "Emitir guía de remisión" y la casilla quedan a la vista; el número del título del detalle no se parte.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, la lista, el borrador y el detalle sin desbordamiento.
- **Tema oscuro:** lista, borrador, confirmación y detalle en escritorio y a 375 px, sin desbordamiento y con el contraste medido.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.95:1 en claro y 6.46:1 en oscuro; borrador 5.15:1 en claro y 6.46:1 en oscuro; carga de mercancías 5.95:1; confirmación 5.95:1 en claro y 7.12:1 en oscuro; detalle 4.98:1 en claro y 6.71:1 en oscuro.
- **Consola:** sin errores nuevos.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D25 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `shipping-guides-screen.tsx`, `shipping-guide-draft-editor.tsx` y `shipping-guide-detail.tsx`, con P0 a P3. Los identificadores, las claves de idempotencia y las versiones (P3) no se muestran. |
| Tarea y jerarquía | En la lista, la acción principal es abrir la guía y la secundaria "Nueva guía de remisión". En el borrador, una sola acción primaria ("Emitir guía de remisión") y "Guardar borrador" secundaria; el transporte, las fechas y la partida van antes que los destinatarios, y el punto después; el resumen queda al lado. En el detalle, "Reintentar firma" solo en `RESERVED`. En la factura, "Nueva guía de remisión" es una acción secundaria. |
| Datos y lenguaje | Estados y textos en lenguaje de negocio ("Transporte propio", "Sin factura", "Establecimiento propio"). Las excepciones citan su literal y su texto oficial, y la declaración dice siempre que es del usuario. Los límites de recursos se presentan como límites del sistema, no del SRI. Sin importes: la guía no tiene total monetario. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; los problemas en rojo van con su texto y el destinatario o el detalle marcados con borde y `aria-invalid`, nunca solo color. Los derivados se muestran de solo lectura con fondo atenuado y su rótulo. |
| Selección de componentes | `AppDataTable`, `ChipGroup`, `SearchInput`, `SegmentedControl` (transporte sin selección inicial, partida, clase del destinatario, comprobante de venta y modo del detalle), `Select` (origen sin selección inicial, destino que excluye el origen y punto), `EntityPickerDialog` (transportistas con los no seleccionables deshabilitados y su motivo, destinatarios, facturas elegibles y bienes activos), `SelectionCardGroup` para los casos de excepción con su texto oficial, `DatePickerField`, `PartyDialog` con el rol de transportista o sin roles, y `ConfirmDialog` con la declaración como contenido propio. |
| Tablas | Paginación en el servidor con tamaño de página en la URL; búsqueda con espera de 300 ms; estado en la URL; estados de carga, vacío (con "Nueva guía de remisión"), sin coincidencias, error con reintento y sin permiso. La bandeja ofrece el tipo `06` en el filtro y bajo el número. Por debajo de 768 px, tarjetas con la misma información; en el detalle, por debajo de 640 px, cada línea apilada. |
| Formularios y diálogos | React Hook Form con los dominios del contrato (cantidad mayor que cero con hasta 6 decimales, textos sin saltos de línea, código de destino de 3 dígitos); el borrador se guarda incompleto y la vista previa del servidor informa lo que falta junto a su destinatario y su detalle. Los datos derivados nunca se envían. La carga de mercancías es una sugerencia: nada se agrega sin confirmar. Un solo envío ante el doble clic y la misma `Idempotency-Key` en el reintento de la misma versión. Los `409` se explican con lo que conviene hacer ("Recargar borrador", "Ver guías de remisión" o la vista previa actualizada). La emisión es irreversible: confirmación con el resumen y, con excepciones, la declaración explícita. |
| Feedback y estado | Las operaciones pasan por `useMutationFeedback`. Tras guardar, el foco va a "Resumen"; tras un error de emisión, al aviso; al cancelar, vuelve a "Emitir guía de remisión"; al agregar un detalle, a su descripción; al quitar un destinatario o un detalle, a su botón de agregar. El detalle se refresca mientras hay una interacción con el SRI en curso. |
| Navegación y responsive | Cuatro rutas nuevas bajo `/guias-remision`, con "Guías de remisión" en el grupo Operación. Por debajo de 768 px, tarjetas y controles de 44 px. |
| Rendimiento | La lista y los borradores piden una página acotada; los selectores de transportistas, destinatarios, facturas y bienes paginan en el servidor; las líneas de una factura se piden solo al abrir la carga de mercancías. `bench:shipping-guides` (tarea 13.1) mide la API. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. Los controles segmentados tienen su nombre accesible; el botón deshabilitado explica por qué con `aria-describedby`; el transportista no seleccionable se anuncia como tal ("…, no se puede elegir") y lleva `aria-disabled`; los encabezados que reciben el foco son enfocables (`tabIndex={-1}`). |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra el ambiente de Pruebas del SRI se hará después de cerrar los changes 12 a 16, como compuerta previa a la puesta en producción, e incluye los casos de transporte `SELF` y `PARTY`. |
| Estado sin permiso alcanzable | Ambos roles tienen `shippingGuides.read`, `shippingGuides.draft`, `shippingGuides.emit` y `shippingGuides.retrySigning`; la reconciliación es solo del administrador. El `403` de las consultas se comprueba con las pruebas de componentes (respuesta `403`) y con las pruebas de permisos y HTTP del servicio. |
| Revisión manual en el recorrido | El SRI simulado no produce dos autorizaciones para una clave. La guía en revisión manual, su reconciliación solo del administrador y el `409` de un estado no reconciliable se comprueban con las pruebas de componentes (`shipping-guide-sections.test.tsx`) y con `backend/test/integration/shipping-guide-reconciliation-api.test.ts`. |
| Detalle en filas de rejilla | La design D25 pide el detalle "en tabla desde 640 px y apilado por debajo". En el borrador, cada detalle es una fila de rejilla (producto o códigos, descripción y cantidad en columnas desde 640 px, apilados por debajo) porque cada uno lleva sus controles, su ayuda, su vista previa y sus problemas; en el detalle de la guía, el detalle sí es una tabla desde 640 px. |
| Transportista propio en los borradores | El resumen de un borrador con transporte propio nombra a la empresa ("Guía con COMERCIAL ANDINA S.A."), que es quien transporta; el detalle y la confirmación dicen "Transporte propio". |
| Nombre del tipo en las secciones compartidas | `DocumentsSection` y `TransmissionSection` no cambian (design D21) y concuerdan sus frases en femenino ("la …", "firmada", "autorizada"): nombran la guía como "guía"; el filtro y la etiqueta del tipo dicen "Guía de remisión". |
| Ruido de consola previo | Los `401` de la comprobación de sesión antes de entrar y el `404` del favicon existían antes de este cambio y no dependen de él. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |

## Hallazgos corregidos durante la revisión

| Hallazgo | Corrección |
| --- | --- |
| El texto de ayuda de la búsqueda de la lista se cortaba ("Número, transportista o i…") en escritorio y a 320 px. | El marcador dice "Número o identificación"; el nombre accesible sigue siendo "Buscar por número, transportista o destinatario". |
| Un borrador preparado sin punto predeterminado no proponía la partida, aunque la ayuda dice que se propone desde el establecimiento del punto. | Al elegir el punto (o al tomarse el predeterminado), con otra dirección vacía, el editor propone la dirección de su establecimiento; nunca reemplaza una dirección escrita (`shipping-guide-draft-editor.test.tsx`). |

## Hallazgos abiertos

Ninguno.
