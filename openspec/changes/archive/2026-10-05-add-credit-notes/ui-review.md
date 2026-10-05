# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Notas de crédito` (`/notas-credito`), el borrador (`/notas-credito/borradores/nueva` y `/notas-credito/borradores/{id}`) con la confirmación de las declaraciones, el detalle de la nota (`/notas-credito/{id}`), el crédito en el detalle de la factura y la bandeja `Comprobantes` con el filtro de tipo (design D15 y D19). Fecha: 2026-10-05.

## Método

- **Recorrido automatizado** con Chrome (Playwright con el Chrome del sistema, en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts`, con los seguidores del crédito y de la devolución en la transacción que concluye la nota) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas.
  - La transmisión apunta a un **SRI simulado** local con respuestas SOAP **sintéticas** (el de las pruebas de extremo a extremo, que ahora puede no autorizar un comprobante por tipo y secuencial). Ninguna llamada sale al SRI real.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa solo la API real: configuración tributaria, establecimiento y punto, firma sintética con custodia, una operadora, un cliente, el consumidor final, dos bienes con inventario (cemento y una cerámica de nombre largo), un bien sin control (lija) y un servicio (instalación); cuatro facturas autorizadas, tres notas emitidas por la API con las declaraciones y dos borradores. La base solo se lee para esperar estados; no se escribe nada por SQL.
  - El recorrido completo se repitió desde una instalación nueva después de corregir cada grupo de hallazgos.
- **Datos preparados:**
  - factura 001-001-1 con cemento 10, cerámica 6, lija 4 e instalación 1;
  - nota 001-001-1: devolución de 3 sacos de cemento con 2 de retorno físico, autorizada (crédito aplicado y `DEVOLUCION_NC`);
  - nota 001-001-2: devolución de la instalación, **no autorizada** por el SRI simulado (su capacidad se libera);
  - factura 001-001-2 con cemento 4 y nota 001-001-3: anulación total con el retorno de los 4 sacos, autorizada;
  - factura 001-001-3 a consumidor final y factura 001-001-4 con cerámica 3, sin notas, para emitir desde la interfaz;
  - borradores sobre 001-001-1: una devolución lista para emitir (cerámica 2 con retorno 2 y lija 1) y una anulación total que ya no procede.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px, de la lista, los borradores, la confirmación, el detalle autorizado, el no autorizado, el crédito de la factura y la bandeja (26 capturas).
- **Pruebas de componentes:**
  - `frontend/test/credit-notes-screen.test.tsx` (14 pruebas: lista, detalle y crédito de la factura), `credit-note-draft-editor.test.tsx` (10), `credit-note-sections.test.tsx` (11: Documentos y Transmisión por tipo) y las nuevas de `documents-screen.test.tsx` (3);
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main` (y del diálogo de confirmación, que se monta fuera de `main`), con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.
- **Consola:** se registran los errores de todas las páginas recorridas. Se separan como ruido previo a este cambio el `401` de `/api/v1/me` antes de iniciar sesión (la comprobación de sesión) y el `404` de `/favicon.ico` (el frontend no publica favicon).

## Bandeja, lista, borrador, detalle y factura (tareas 12.1 y 13.1 a 13.3)

114 comprobaciones contra el backend real, todas correctas:

- **Notas de crédito (operadora):**
  - título "Notas de crédito · Facturador SRI" y "Notas de crédito" activo en el grupo Operación;
  - las tres notas con número, factura, causa, comprador, valor y estado; la nota 2 "No autorizado" y la 3 "Anulación total"; el estado cabe en una línea;
  - "Borradores en curso" con los dos borradores y su enlace; "Nueva nota de crédito" como acción secundaria;
  - la causa (`causa=anulacion`) y el estado (`estado=autorizadas`) quedan en la URL y filtran; la búsqueda de la URL llega al campo.
- **Detalle autorizado (administradora):**
  - "El SRI autorizó la nota de crédito: está lista para entregarse.", con el número de autorización;
  - enlace a la factura modificada, "Su crédito está aplicado en la factura." y "Retorno físico al inventario: 2" en la línea;
  - "Declaraciones del usuario": "Declaradas por Olga Operadora · fecha y hora", "Son declaraciones del usuario: el sistema no puede comprobarlas." y las dos declaraciones con su fuente;
  - "Descargar RIDE", "XML autorizado" y "XML firmado"; la descarga entrega `nota-de-credito-001-001-000000001.pdf`.
- **Detalle no autorizado:** "El SRI no autorizó la nota de crédito. Revisa sus mensajes.", el mensaje sintético del SRI, "El crédito que reservaba en la factura se liberó"; sin RIDE ni XML autorizado, solo el XML firmado; sin reconciliación en un estado final; el historial de la transmisión de la nota.
- **Factura:** la 001-001-1 muestra aplicado USD 30,19 (solo la nota autorizada, sin la rechazada), reservado USD 0,00 y disponible USD 262,26, con "Emitir nota de crédito" hacia `/notas-credito/borradores/nueva?factura={id}`; la anulada dice "La factura ya no tiene valor acreditable." y la de consumidor final "no admite notas de crédito", ambas sin la acción.
- **Borrador con la anulación total que ya no procede:**
  - sin casillas de líneas: cada línea "Se acredita completa";
  - "La factura ya tiene créditos reservados o aplicados: la anulación total no procede." junto a la causa y en "Antes de emitir"; "Emitir nota de crédito" deshabilitado con "Resuelve los problemas antes de emitir.";
  - retorno físico permitido en el cemento, y deshabilitado en el servicio y en la lija con "No admite retorno físico: en la factura, la línea no afectaba al inventario…" (`aria-describedby`).
- **Edición y foco:** la causa cambia a "Devolución" con el teclado (espacio); una cantidad de 9 sobre 7 acreditables se guarda, el foco va a "Resumen" y "La cantidad supera lo acreditable de la línea: quedan 7." queda junto a la línea marcada (`aria-invalid`), con la emisión bloqueada.
- **Emisión desde la factura (operadora):**
  - la factura 001-001-4 llega elegida; sin punto predeterminado, el punto queda por elegir; sin causa, "Elige la causa de la nota.";
  - tras guardar, la página del borrador con la vista previa del servidor y "En la nota: 1 por una base imponible de USD 21,40. Después de esta nota quedan 2 acreditables.";
  - Enter abre la confirmación: dos casillas separadas, el aviso "Son declaraciones tuyas: el sistema no puede comprobarlas…" y el contexto de cada declaración; la confirmación está deshabilitada sin declaraciones y con una sola, y se habilita con ambas;
  - Escape cierra y el foco vuelve a "Emitir nota de crédito"; al reabrir, las declaraciones se vuelven a marcar;
  - el doble clic emite una sola nota (la bandeja tiene después exactamente cuatro notas), que el SRI simulado autoriza; sin recargar, la sección de documentos se actualiza hasta "El RIDE está listo para entregarse.".
- **Comprobantes:** con `tipo=04`, las cuatro notas con "Nota de crédito" bajo el número y el enlace al detalle de la nota; con "Todos", las cuatro facturas y las cuatro notas.
- **Móvil a 375 y 320 px:** lista en tarjetas sin desbordamiento, con el número de la factura en una línea; borrador y detalle sin desbordamiento; "Nueva nota de crédito" y "Emitir nota de crédito" miden 44 px; en la confirmación, "Cancelar" y "Emitir nota de crédito" quedan a la vista y la segunda declaración se alcanza desplazando el diálogo.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, el borrador con la cerámica de nombre largo y la lista sin desbordamiento.
- **Tema oscuro:** lista, borrador, confirmación y detalle en escritorio y a 375 px, sin desbordamiento y con el contraste medido.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.95:1 en claro, 6.71:1 a 375 px y 6.46:1 en escritorio en oscuro; detalle 4.97:1 en claro y 6.71:1 en oscuro; borrador 5.15:1 en claro y 6.71:1 en oscuro; confirmación 5.95:1 en claro y 6.71:1 en oscuro.
- **Consola:** sin errores nuevos.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D19 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `credit-notes-screen.tsx`, `credit-note-draft-editor.tsx`, `credit-note-detail.tsx` e `invoice-credit-section.tsx`, con P0 a P3; el de la bandeja (D15) en `documents-screen.tsx`. Los identificadores, las claves de idempotencia y las huellas (P3) no se muestran. |
| Tarea y jerarquía | En la lista, la acción principal es abrir la nota y la secundaria "Nueva nota de crédito". En el borrador, una sola acción primaria ("Emitir nota de crédito") y "Guardar borrador" secundaria; la factura, la causa y el motivo van antes que las líneas; el resumen con los importes queda al lado. En el detalle, "Reintentar firma" solo en `RESERVED`. |
| Datos y lenguaje | Causas, estados y textos en lenguaje de negocio ("Devolución", "Anulación total", "No autorizado", "Retorno físico al inventario"). La transmisión y los documentos usan el nombre de la nota ("la nota de crédito"), y la factura conserva sus textos. Las declaraciones dicen siempre que son del usuario y que el sistema no puede comprobarlas. El detalle dice dónde está el crédito de la nota: aplicado, liberado o reservado. Importes con los separadores de es-EC y cifras tabulares. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; los problemas en rojo van con su texto y la línea marcada con borde y `aria-invalid`, nunca solo color. |
| Selección de componentes | `AppDataTable`, `ChipGroup`, `SearchInput`, `Select`, `SegmentedControl` (la causa, sin selección inicial porque se declara), `EntityPickerDialog` (facturas elegibles) y `ConfirmDialog`. `ConfirmDialog` acepta ahora un contenido propio (`children`) y `confirmBlocked` para las dos casillas de las declaraciones, y su cuerpo se desplaza con las acciones fijas. |
| Tablas | Paginación en el servidor con tamaño de página en la URL; búsqueda con espera de 300 ms; estado y causa en la URL; estados de carga, vacío (con "Nueva nota de crédito"), sin coincidencias, error con reintento y sin permiso. La bandeja suma el filtro "Tipo de comprobante" (`tipo`) y el tipo bajo el número. Por debajo de 768 px, tarjetas con la misma información. |
| Formularios y diálogos | React Hook Form con los dominios de cantidad del contrato. Cantidad obligatoria y mayor que cero en cada línea devuelta; retorno físico deshabilitado con su explicación donde no procede (también en la anulación total). Los importes y los problemas son la vista previa del servidor. Un solo envío ante el doble clic y la misma `Idempotency-Key` en el reintento de la misma versión. Los `409` se explican con lo que conviene hacer ("Recargar borrador", "Ver notas de crédito" o la vista previa actualizada). La emisión es irreversible: confirmación con las dos declaraciones por separado. |
| Feedback y estado | Las operaciones pasan por `useMutationFeedback`. Tras guardar, el foco va a "Resumen"; tras un error de emisión, al aviso; al cancelar, vuelve a "Emitir nota de crédito". El detalle se refresca mientras hay una interacción con el SRI en curso, y la sección de documentos se vuelve a pedir con cada cambio de estado. |
| Navegación y responsive | Cuatro rutas nuevas bajo `/notas-credito`, con "Notas de crédito" en el grupo Operación; "Emitir nota de crédito" desde la factura llega con la factura elegida. Por debajo de 768 px, tarjetas y controles de 44 px. |
| Rendimiento | La lista y los borradores piden una página acotada; el selector de facturas elegibles pagina en el servidor; el crédito de la factura se pide solo para una factura autorizada. `bench:credit-notes` (tarea 14.1) mide la API. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. Las casillas de las declaraciones tienen su texto como nombre y su contexto como descripción; el botón deshabilitado explica por qué con `aria-describedby`; los encabezados que reciben el foco son enfocables (`tabIndex={-1}`). |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra Pruebas sigue siendo una compuerta previa a la puesta en producción. |
| Estado sin permiso alcanzable | Ambos roles tienen `creditNotes.read`, `creditNotes.draft` y `creditNotes.emit`; la reconciliación es solo del administrador. El `403` de las consultas se comprueba con las pruebas de componentes (respuesta `403`) y con las pruebas de permisos del servicio (`backend/test/credit-notes/permissions.test.ts`). |
| Revisión manual en el recorrido | El SRI simulado no produce dos autorizaciones para una clave. La nota en revisión manual, su reconciliación solo del administrador y el `409` de un estado no reconciliable se comprueban con las pruebas de componentes y con `backend/test/integration/credit-note-reconciliation-api.test.ts`. |
| Ruido de consola previo | El `401` de la comprobación de sesión antes de entrar y el `404` del favicon existían antes de este cambio y no dependen de él. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |

## Hallazgos corregidos durante la revisión

- **La confirmación no cabía en la pantalla.** A 375 y 320 px, con las dos declaraciones y su contexto, el contenido superaba el alto del diálogo y "Emitir nota de crédito" quedaba fuera de alcance. El cuerpo de `ConfirmDialog` ahora se desplaza y las acciones quedan fijas a la vista; el recorrido comprueba ambas acciones dentro de la pantalla y la segunda declaración alcanzable.
- **La sección de documentos no se actualizaba tras la autorización.** El resumen de documentos solo se volvía a pedir mientras el RIDE se preparaba, así que después de emitir seguía diciendo "Los documentos estarán disponibles cuando la nota de crédito se firme." hasta recargar. También afectaba al detalle de la factura. `DocumentsSection` recibe ahora el estado del comprobante (design D15) y el resumen se vuelve a pedir con cada cambio de estado; lo cubren una prueba de componentes y el recorrido.
- **La vista previa de la línea se leía como precio unitario.** "2 × base USD 42,80" sugería una base por unidad; ahora dice "En la nota: 2 por una base imponible de USD 42,80. Después de esta nota quedan 4 acreditables.".
- **Doble punto tras la hora de las declaraciones.** La hora termina en "a. m." y la frase añadía otro punto; la fecha va ahora en su propia línea ("Declaradas por … · fecha y hora").
- **El número de la factura se partía en las tarjetas.** A 320 px, "001-001-000000002" se cortaba en dos líneas en las tarjetas y en los borradores en curso; ahora no se parte.
- **El crédito de la nota no se veía en su detalle.** El detalle dice ahora si el crédito está aplicado, se liberó o sigue reservado.

No quedan hallazgos abiertos.
