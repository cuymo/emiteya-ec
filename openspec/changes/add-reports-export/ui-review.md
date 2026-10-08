# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Reportes` (`/reportes`), con los cinco reportes y las dos vistas del inventario, sus filtros, la exportación a XLSX y sus rechazos (design D16; tarea 5.3). Fecha: 2026-10-08.

## Método

- **Recorrido automatizado** con Chromium (`playwright-core` en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts` como proceso) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas, que se borra al terminar.
  - Sin firma ni transmisión: los reportes solo leen. No se usó ninguna firma, ningún archivo de credenciales ni ninguna contraseña real, y no hubo ninguna llamada al SRI.
  - La preparación usa la API real para la configuración tributaria, dos establecimientos con su punto y una operadora. Los datos de los reportes se siembran con los arneses de las pruebas de integración:
    - 30 facturas de agosto a octubre de 2026 en los dos establecimientos y en varios estados, una de ellas en Producción;
    - una factura con el snapshot real de la emisión, una nota de crédito, una nota de débito y una liquidación de compra;
    - una guía con un destinatario y otra con tres;
    - dos retenciones, una con tres líneas en dos documentos sustento;
    - inventario con un saldo de 18 dígitos y uno negativo, una salida por factura y un ajuste;
    - terceros con roles, un correo y un teléfono, una razón social de 77 caracteres y otra que parece una fórmula (`=HYPERLINK("http://ejemplo.invalid","clic")`).
  - El recorrido completo se repitió después de corregir los hallazgos.
- **XLSX exportado:** el recorrido descarga el XLSX de septiembre de Documentos emitidos y lo abre con openpyxl 3.1.5, un lector independiente del escritor, para comprobar sus hojas, sus tipos de celda, la hoja "Filtros" y la ausencia de fórmulas.
- **Capturas inspeccionadas:** a página completa (28):
  - en escritorio, de cada reporte y vista, y de los mensajes del `409` y del `503`;
  - a 375 y 320 px, en los dos temas, y en escritorio en tema oscuro, de Documentos emitidos de septiembre, Retenciones, Existencias y Terceros.
- **Pruebas de componentes:**
  - `frontend/test/reports-screen.test.tsx` (13):
    - la lista con el ambiente y el aviso;
    - la carga, el vacío, sin coincidencias, el error con reintento y sin permiso;
    - los cinco reportes y las dos vistas;
    - los filtros en la URL y el atajo mensual;
    - los estados por defecto;
    - la exportación con los filtros de la URL y el ambiente de la lista;
    - los mensajes del `409` y del `503`;
    - el cambio de reporte sin filas del anterior.
  - La entrada de la navegación, en `app-shell.test.tsx`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main` y de los diálogos, convertido a sRGB a través de un lienzo (los tokens son `oklch`), con los fondos translúcidos compuestos sobre su fondo real, en los dos temas.
- **Consola:** se registran los errores y las respuestas fallidas de todas las páginas recorridas.
  - El `409` y el `503` son los simulados a propósito en el navegador para ver sus mensajes.
  - Se separa como ruido previo a este cambio el `404` del favicon: el frontend no publica favicon.

## Pantalla y exportación (tareas 5.1 y 5.3)

166 comprobaciones contra el backend real, todas correctas en el último recorrido:

- **Documentos emitidos (operadora):**
  - título "Reportes · Facturador SRI" y "Reportes" activo en el grupo Operación;
  - "37 registros · Ambiente: Pruebas" y el aviso "Los reportes no reemplazan obligaciones contables ni anexos tributarios.";
  - "Exportar XLSX" como única acción primaria;
  - ningún identificador interno visible y sin desbordamiento.
- **Atajo mensual:** "septiembre de 2026" fija `desde=2026-09-01` y `hasta=2026-09-30` y nada más. La guía de tres destinatarios muestra "3 destinatarios" y "—" sin importes. La razón social que parece una fórmula se muestra tal cual.
- **Exportación:**
  - descarga `documentos-emitidos-2026-09-01-2026-09-30.xlsx`, con "Descargaste el XLSX.";
  - **leído con openpyxl:**
    - las hojas "Documentos emitidos" y "Filtros", con el encabezado fijo (`A2`);
    - las mismas 14 filas que la lista;
    - Fecha como fecha, Número e Identificación como texto, Subtotal, Impuestos y Total como números;
    - la guía con sus importes vacíos;
    - el texto hostil como cadena y ninguna fórmula;
    - "Filtros" con el reporte, el momento en Ecuador, el rango, el estado, el ambiente, las filas, el aviso y la nota de precisión.
- **Rechazos:** el `409` ("…Acota los filtros…") y el `503` ("Hay otras exportaciones en curso en este momento. Intenta de nuevo en unos segundos.") se explican junto al botón, con contraste suficiente.
- **Teclado:** el selector del reporte muestra el foco (contorno de 2 px), Tab avanza al control siguiente y el selector cambia de reporte.
- **Facturas:**
  - cambiar de reporte limpia el rango;
  - el estado parte de "Autorizado";
  - IVA y Otros impuestos van en columnas separadas.
- **Retenciones:** una fila por línea con el impuesto congelado ("RENTA", "IVA"), el código y el porcentaje ("1,75 %").
- **Existencias:**
  - el saldo de 18 dígitos exacto ("999.999.999.999,999999");
  - el saldo negativo con icono y "Saldo negativo";
  - sin ambiente.
- **Movimientos:** los tipos ("Salida por factura", "Ajuste") y el número de la factura de la salida. "Elegir producto" abre el buscador, y el producto elegido se muestra por su nombre, sin identificadores.
- **Terceros:** los roles con sus etiquetas ("Cliente, Proveedor"), el estado y el filtro que parte de "Activos".
- **Móvil a 375 y 320 px, en los dos temas:**
  - tarjetas en lugar de la tabla, sin desbordamiento;
  - los filtros plegados tras "Filtros", y desplegados sin desbordar;
  - "Exportar XLSX" dentro del ancho.
- **Tema oscuro** en escritorio y móvil, sin desbordamiento.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimo 4.98:1 ("Exportar XLSX" bajo el puntero, tras exportar) y máximo de los mínimos 6.71:1; Existencias en móvil 5.15:1 (el saldo negativo).

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D16 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `reports-screen.tsx`, con P0 a P3. Los identificadores internos (P3) no se muestran: el producto se elige con un buscador y los filtros de establecimiento y punto muestran su código. |
| Tarea y jerarquía | Una sola acción primaria ("Exportar XLSX"). El reporte, el número de registros y el ambiente efectivo encabezan la tabla. Los filtros secundarios y el aviso de RF-505 van debajo. Sin dashboard, gráficos, indicadores ni totales. |
| Datos y lenguaje | Estados, tipos, ambientes, roles y tipos de movimiento con las etiquetas del glosario. Los importes van con `USD`, los decimales con los separadores de es-EC y sin pasar por `number`. La guía nunca muestra un 0,00 inventado. Los textos de los usuarios se muestran literales. |
| Fundamentos | Escalas del proyecto. El estado va con `StatusBadge` y el saldo negativo con icono y texto, nunca solo color. |
| Selección de componentes | `Select` para el reporte, el mes, el período fiscal, los estados y el ambiente (las opciones no caben a la vista en un `ChipGroup` en móvil); `SegmentedControl` para las dos vistas del inventario; `DatePickerField` para el rango; `EntityPickerDialog` para el producto; `AppDataTable` con tarjetas. |
| Tablas | Paginación en el servidor con la página y el tamaño en la URL; los filtros en la URL; las identificaciones con espera de 300 ms; los estados de carga, vacío, sin coincidencias con "Limpiar filtros", error con "Intentar de nuevo" y sin permiso. Por debajo de 768 px, tarjetas con la misma información. |
| Formularios y diálogos | Un rango invertido se explica en el campo y no se consulta; el buscador de productos pagina en el servidor. |
| Feedback y estado | La exportación pasa por `useMutationFeedback`: "Generando XLSX…" mientras se genera, "Descargaste el XLSX." al terminar, y el `409` o el `503` explicados junto al botón hasta que cambian el reporte o los filtros. |
| Navegación y responsive | La ruta `/reportes`, con "Reportes" en el grupo Operación. Los filtros se pliegan tras "Filtros" por debajo de 768 px. |
| Rendimiento | La lista pide una página acotada y conserva las filas anteriores solo dentro del mismo reporte. `bench:reports` (tarea 6.1) mide las listas y las exportaciones. |
| Tema y accesibilidad | Los dos temas, revisados con los mínimos de arriba. Cada control tiene su rótulo. El número de registros se anuncia con `aria-live`, la tabla en carga lleva `aria-busy` y los importes vacíos se leen "Sin importe". |

## Hallazgos corregidos

| Hallazgo | Corrección |
| --- | --- |
| Al cambiar de reporte, la pantalla se rompía: la lista conservaba las filas del reporte anterior mientras llegaba el nuevo, y las columnas nuevas no sabían leerlas (por ejemplo, el saldo de Existencias sobre filas de Retenciones). | Las filas anteriores solo se conservan dentro del mismo reporte (otra página u otros filtros). Una prueba de componentes reproduce el cambio de Retenciones a Existencias con la respuesta en curso. |
| En escritorio, el número del comprobante se partía por el guion ("001-001-" / "000000015") y los importes entre "USD" y la cifra. | El número, los importes y los porcentajes no se parten (`whitespace-nowrap`); la razón social sí, cuando es larga. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Estado sin permiso alcanzable | Ambos roles tienen `reports.read` y `reports.export`. El acceso sin permiso se comprueba con las pruebas de componentes (respuesta `403`) y con las pruebas HTTP con una política que no concede los permisos (`report-list-api.test.ts` y `report-exports-api.test.ts`). |
| `409` y `503` simulados en el recorrido | Superar el máximo de filas o la concurrencia exige otro volumen u otra carga. Sus respuestas reales se prueban por HTTP (`report-exports-api.test.ts`) y con `bench:reports`. El recorrido simula la respuesta en el navegador solo para ver el mensaje y su contraste. |
| Excel y LibreOffice | La máquina de la revisión no tiene ninguno de los dos. El XLSX se abrió con openpyxl, se validó contra los XSD de ECMA-376 en el spike (ADR 0023) y se lee en la CI con un lector independiente. |
| Fechas del ejemplo | Algunas facturas sintéticas tienen fechas posteriores al día de la revisión; no afecta a lo revisado. |
