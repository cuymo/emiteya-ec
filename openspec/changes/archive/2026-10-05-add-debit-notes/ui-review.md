# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Notas de débito` (`/notas-debito`), la nueva nota (`/notas-debito/borradores/nueva`, con `?factura={id}`), el borrador (`/notas-debito/borradores/{id}`) con la confirmación de la declaración, el detalle de la nota (`/notas-debito/{id}`), "Emitir nota de débito" en el detalle de la factura y la bandeja `Comprobantes` con el tipo `05` (design D19 y D23). Fecha: 2026-10-05.

## Método

- **Recorrido automatizado** con el Chrome del sistema (`playwright-core` en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts` como proceso, con la custodia de firmas habilitada) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas.
  - La transmisión apunta al **SRI simulado** local de las pruebas de extremo a extremo, con respuestas SOAP **sintéticas**, que puede no autorizar un comprobante por tipo y secuencial. Ninguna llamada sale al SRI real: el único destino del proxy de salida fue el SRI simulado.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa solo la API real: configuración tributaria, establecimiento y punto, firma sintética con custodia, una operadora, un cliente, el consumidor final del sistema, un bien con IVA 15 % (cemento) y un servicio con IVA 0 % de nombre largo (transporte). La base solo se lee para esperar estados; no se escribe nada por SQL.
  - El recorrido completo se repitió desde una instalación nueva después de corregir cada grupo de hallazgos.
- **Datos preparados:**
  - factura 001-001-1 con cemento 10 (IVA 15 %) y transporte 1 (IVA 0 %): dos tratamientos;
  - factura 001-001-2 con cemento 2: un solo tratamiento;
  - factura 001-001-3 a consumidor final, que no admite notas de débito;
  - nota 001-001-1 sobre la factura 1: intereses de mora USD 20,00 con IVA 15 % y flete posterior USD 5,50 con IVA 0 %, forma de pago 20, autorizada, con su RIDE;
  - nota 001-001-2 sobre la factura 1: intereses USD 4,10 con IVA 15 %, **no autorizada** por el SRI simulado;
  - borradores: uno listo para emitir sobre la factura 1 y otro sobre la factura 2 sin importe, sin tratamiento, sin forma de pago y sin punto.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px, de la lista, el borrador con problemas, la nueva nota desde la factura, la confirmación, el detalle autorizado, el no autorizado, la acción en la factura y la bandeja (24 capturas).
- **Pruebas de componentes:**
  - `frontend/test/debit-notes-screen.test.tsx` (6: lista, filtros y borradores en curso), `debit-note-draft-editor.test.tsx` (12), `debit-note-detail.test.tsx` (10: detalle y acción en la factura), `debit-note-sections.test.tsx` (7: Documentos y Transmisión con la nota) y las nuevas de `documents-screen.test.tsx` y `app-shell.test.tsx`;
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main` y del diálogo de confirmación (que se monta fuera de `main`), con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.
- **Consola:** se registran los errores de todas las páginas recorridas. Se separan como ruido previo a este cambio los `401` de `/api/v1/me` en la página de inicio de sesión (la comprobación de sesión) y el `404` del favicon (el frontend no publica favicon).

## Bandeja, lista, borrador, detalle y factura (tareas 10.1 y 11.1 a 11.3)

118 comprobaciones contra el backend real, todas correctas:

- **Notas de débito (operadora):**
  - título "Notas de débito · Facturador SRI" y "Notas de débito" activo en el grupo Operación;
  - las notas con número, factura, causas, comprador, valor total y estado: la nota 1 con "Intereses de mora · Costos o gastos posteriores a la factura" y USD 28,50; la nota 2 "No autorizado" y USD 4,72 (4,10 + 0,615 redondeado a 0,62);
  - "Borradores en curso" con los dos borradores, su número de conceptos y su enlace; "Nueva nota de débito" como acción secundaria;
  - la causa (`causa=costos`) y el estado (`estado=no-autorizadas`) quedan en la URL y filtran; la búsqueda de la URL llega al campo.
- **Factura:** la 001-001-1 ofrece "Emitir nota de débito" hacia `/notas-debito/borradores/nueva?factura={id}`; la de consumidor final no la ofrece.
- **Borrador con problemas:**
  - el concepto marcado (`aria-invalid`) con "Indica el importe del concepto." y "Elige el tratamiento de IVA del concepto." junto a él; "Elige la forma de pago de la nota de débito." en "Antes de emitir"; "Emitir nota de débito" deshabilitado con "Resuelve los problemas antes de emitir.";
  - la factura de una sola tarifa ofrece solo "IVA 15 %": ninguna tarifa vigente que la factura no tenía.
- **Edición y foco:** el tratamiento se elige con el teclado (espacio); tras guardar, el foco va a "Resumen" y la vista previa del servidor muestra la base, el IVA (USD 0,51) y el valor total USD 3,91, y "Forma de pago: SIN UTILIZACION DEL SISTEMA FINANCIERO · USD 3,91" con el mismo valor exacto; "Agregar concepto" lleva el foco a la descripción nueva y "Quitar el concepto 2" lo devuelve a "Agregar concepto".
- **Emisión desde la factura (operadora):**
  - la factura 001-001-2 llega elegida y "Preparar nota de débito" crea el borrador y abre su ruta;
  - con intereses USD 7,35 en IVA 15 %, la vista previa redondea el impuesto una vez por tratamiento (USD 1,10) y el total es USD 8,45;
  - Enter abre la confirmación con la factura, el valor total, la forma de pago, el aviso "Es una declaración tuya: el sistema no puede comprobarla." y el texto, el contexto y la fuente de la declaración; la confirmación está deshabilitada sin la declaración;
  - Escape cierra y el foco vuelve a "Emitir nota de débito"; al reabrir, la declaración se vuelve a marcar;
  - el doble clic emite una sola nota (la 001-001-3, la bandeja tiene después exactamente tres notas), que el SRI simulado autoriza; sin recargar, la sección de documentos llega a "El RIDE está listo para entregarse.".
- **Detalle autorizado (administradora):** "El SRI autorizó la nota de débito: está lista para entregarse."; enlace a la factura modificada; los conceptos con su causa y su tratamiento ("Intereses de mora · IVA 15 %", "Costos o gastos posteriores a la factura · IVA 0 %"); las bases e impuestos por tratamiento; la forma de pago del snapshot con su total USD 28,50; "Declarada por Olga Operadora" y "el sistema no puede comprobarla"; "La nota de débito no cambia la factura ni su crédito."; "Descargar RIDE", "Imprimir", "XML autorizado" y "XML firmado", y la descarga entrega `nota-de-debito-001-001-000000001.pdf`.
- **Detalle no autorizado:** "El SRI no autorizó la nota de débito", solo el XML firmado, sin reconciliación en un estado final y con el historial de la transmisión de la nota.
- **Comprobantes:** con `tipo=05`, solo las tres notas, cada una con "Nota de débito" bajo el número y el enlace a `/notas-debito/{id}`.
- **Móvil a 375 y 320 px:** lista en tarjetas, borrador y detalle sin desbordamiento; "Nueva nota de débito" y "Emitir nota de débito" miden 44 px; cada opción de los controles segmentados contiene su texto; en la confirmación, "Cancelar" y "Emitir nota de débito" quedan a la vista, el número de la factura en una línea y la declaración se alcanza desplazando el diálogo.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, el borrador, la lista y el detalle sin desbordamiento.
- **Tema oscuro:** lista, borrador, confirmación y detalle en escritorio y a 375 px, sin desbordamiento y con el contraste medido.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.95:1 en claro y 6.46:1 en oscuro; borrador 5.15:1 en claro y 6.71:1 en oscuro; confirmación 6.84:1 en claro y 7.12:1 en oscuro; detalle 5.00:1 en claro y 6.71:1 en oscuro.
- **Consola:** sin errores nuevos.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D23 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `debit-notes-screen.tsx`, `debit-note-draft-editor.tsx`, `debit-note-detail.tsx` e `invoice-debit-note-action.tsx`, con P0 a P3. Los identificadores, las claves de idempotencia, las versiones y las huellas (P3) no se muestran. |
| Tarea y jerarquía | En la lista, la acción principal es abrir la nota y la secundaria "Nueva nota de débito". En el borrador, una sola acción primaria ("Emitir nota de débito") y "Guardar borrador" secundaria; la factura y sus tratamientos van antes que los conceptos, y la forma de pago y el punto después; el resumen con los importes queda al lado. En el detalle, "Reintentar firma" solo en `RESERVED`. |
| Datos y lenguaje | Causas, estados y textos en lenguaje de negocio ("Intereses de mora", "Costos o gastos posteriores a la factura", "No autorizado"). Un tratamiento cuya denominación oficial es solo un porcentaje se nombra "IVA 15 %", como en la nota de crédito; los demás conservan su denominación ("Exento de IVA", "No Objeto de Impuesto"). La forma de pago usa la denominación oficial del catálogo, como en la factura. La declaración dice siempre que es del usuario y que el sistema no puede comprobarla. Importes con los separadores de es-EC y cifras tabulares. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; los problemas en rojo van con su texto y el concepto marcado con borde y `aria-invalid`, nunca solo color. |
| Selección de componentes | `AppDataTable`, `ChipGroup`, `SearchInput`, `Select` (forma de pago, punto y tratamiento desde 6 opciones), `SegmentedControl` (la causa y el tratamiento hasta 5 opciones, sin selección inicial porque se declaran), `EntityPickerDialog` (facturas elegibles) y `ConfirmDialog` con la declaración como contenido propio. |
| Tablas | Paginación en el servidor con tamaño de página en la URL; búsqueda con espera de 300 ms; estado y causa en la URL; estados de carga, vacío (con "Nueva nota de débito"), sin coincidencias, error con reintento y sin permiso. La bandeja ofrece el tipo `05` en el filtro y bajo el número. Por debajo de 768 px, tarjetas con la misma información. |
| Formularios y diálogos | React Hook Form con los dominios de descripción e importe del contrato; el borrador se guarda incompleto y la vista previa del servidor informa lo que falta junto a su concepto. Los importes, los impuestos por tratamiento, el valor total y el total de la forma de pago son la vista previa del servidor: el frontend no calcula dinero. Un solo envío ante el doble clic y la misma `Idempotency-Key` en el reintento de la misma versión. Los `409` se explican con lo que conviene hacer ("Recargar borrador", "Ver notas de débito" o la vista previa actualizada). La emisión es irreversible: confirmación con la declaración. |
| Feedback y estado | Las operaciones pasan por `useMutationFeedback`. Tras guardar, el foco va a "Resumen"; tras un error de emisión o de preparación, al aviso; al cancelar, vuelve a "Emitir nota de débito"; al agregar un concepto, a su descripción; al quitarlo, a "Agregar concepto". El detalle se refresca mientras hay una interacción con el SRI en curso, y la sección de documentos se vuelve a pedir con cada cambio de estado. |
| Navegación y responsive | Cuatro rutas nuevas bajo `/notas-debito`, con "Notas de débito" en el grupo Operación; "Emitir nota de débito" desde la factura llega con la factura elegida. Por debajo de 768 px, tarjetas y controles de 44 px. |
| Rendimiento | La lista y los borradores piden una página acotada; el selector de facturas elegibles pagina en el servidor; los tratamientos ofrecidos llegan con la vista previa del borrador, sin otra consulta. `bench:debit-notes` (tarea 12.1) mide la API. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. La casilla de la declaración tiene su texto como nombre y su contexto como descripción; el botón deshabilitado explica por qué con `aria-describedby`; los encabezados que reciben el foco son enfocables (`tabIndex={-1}`). |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra Pruebas sigue siendo una compuerta previa a la puesta en producción. |
| Estado sin permiso alcanzable | Ambos roles tienen `debitNotes.read`, `debitNotes.draft`, `debitNotes.emit` y `debitNotes.retrySigning`; la reconciliación es solo del administrador. El `403` de las consultas se comprueba con las pruebas de componentes (respuesta `403`, y la acción de la factura sin `debitNotes.draft`) y con las pruebas de permisos del servicio (`backend/test/debit-notes/permissions.test.ts`). |
| Revisión manual en el recorrido | El SRI simulado no produce dos autorizaciones para una clave. La nota en revisión manual, su reconciliación solo del administrador y el `409` de un estado no reconciliable se comprueban con las pruebas de componentes y con `backend/test/integration/debit-note-reconciliation-api.test.ts`. |
| Un solo tratamiento en la factura | Con una sola tarifa en la factura, el control segmentado muestra una opción y el usuario la elige: cada concepto elige uno de los tratamientos de la factura (design D6 y D23), sin que el sistema lo infiera. |
| Ruido de consola previo | Los `401` de la comprobación de sesión antes de entrar y el `404` del favicon existían antes de este cambio y no dependen de él. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |

## Hallazgos corregidos durante la revisión

- **El tratamiento se mostraba como "15%".** Con el catálogo instalado, la denominación oficial congelada en la factura es solo el porcentaje, así que el control decía "15%" y el resumen "Base 15%" y "15%", sin decir que es IVA. El editor y el detalle nombran ahora un porcentaje como "IVA 15 %", como la nota de crédito, y conservan las denominaciones que dicen qué son ("Exento de IVA"); las pruebas de componentes usan ahora las denominaciones del catálogo.
- **La causa larga se salía del control segmentado.** A 320 px, "Costos o gastos posteriores a la factura" ocupaba tres líneas y el texto quedaba fuera del borde, porque la altura de cada opción era fija. `SegmentedControl` usa ahora una altura mínima igual a la anterior: las opciones de una línea no cambian en ninguna pantalla y una etiqueta larga crece dentro del borde. El recorrido comprueba que cada opción contiene su texto.
- **El número de la factura se partía en la confirmación.** A 320 px, "001-001-000000001" se cortaba en dos líneas en el resumen del diálogo; por debajo de 640 px cada dato va ahora bajo su nombre y el número no se parte.

No quedan hallazgos abiertos.
