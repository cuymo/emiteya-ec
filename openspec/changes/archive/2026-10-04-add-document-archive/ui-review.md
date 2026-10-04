# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Comprobantes` (`/comprobantes`), la bandeja
documental, y para la sección "Documentos" del detalle de una factura (`/facturas/{id}`), con la
descarga del RIDE y de los XML, la impresión, el reintento de un RIDE detenido y el historial de
entregas (design D13). Fecha: 2026-10-04.

## Método

- **Recorrido automatizado** con Chrome (Playwright con el Chrome del sistema, en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts`, con el pool de RIDE, el runner, el sweeper y el seguidor de transiciones) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas.
  - La transmisión apunta a un **SRI simulado** local con respuestas SOAP **sintéticas** (el mismo de las pruebas de extremo a extremo). Ninguna llamada sale al SRI real.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa solo la API real: configuración tributaria, dos establecimientos con su punto, firma sintética con custodia, dos clientes, un producto, una operadora y las facturas emitidas por ella. La base solo se lee para esperar estados; no se escribe nada por SQL.
  - El recorrido completo se repitió desde una instalación nueva después de corregir el hallazgo.
- **Facturas preparadas:**
  - 001-001-1: autorizada con el XML del SRI; su RIDE sale del XML autorizado;
  - 001-001-2: autorizada sin el XML en la respuesta; su RIDE sale del XML firmado (respaldo);
  - 001-001-3: autorizada para un cliente con caracteres CJK en la razón social; la generación del RIDE se detiene sola con `RIDE_GLYPH_MISSING`, porque Noto Sans no tiene esos glifos;
  - 002-001-1 y 002-001-2: autorizadas en el segundo establecimiento;
  - 001-001-4: emitida con el SRI caído; queda verificando con el SRI, sin autorizar;
  - 002-001-3: emitida con el backend reiniciado sobre un directorio de fuentes vacío (el runner del RIDE queda en pausa): la factura está autorizada y su RIDE en preparación; al reiniciar con las fuentes verificadas, el RIDE aparece.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px (14 capturas).
- **Pruebas de componentes:**
  - `frontend/test/documents-screen.test.tsx` (7 pruebas), `documents-section.test.tsx` (11) y `date-picker-field.test.tsx` (4);
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main`, con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.
- **Consola:** se registran los errores de todas las páginas recorridas. Se separan como ruido previo a este cambio el `401` de `/api/v1/me` antes de iniciar sesión (la comprobación de sesión) y el `404` de `/favicon.ico` (el frontend no publica favicon).

## Comprobantes y Documentos (tareas 10.1 a 10.3)

62 comprobaciones contra el backend real, todas correctas:

- **Comprobantes:**
  - título "Comprobantes · Facturador SRI" y "Comprobantes" activo en la navegación;
  - los seis comprobantes emitidos, sin borradores, con número, fecha, receptor, total y estado del glosario;
  - el RIDE se descarga desde la fila en los cuatro comprobantes que lo tienen; el detenido dice "Detenido"; el que no está autorizado muestra su estado y no ofrece RIDE;
  - sin filtro de tipo mientras solo existe la factura;
  - el chip "Autorizados" queda en la URL y deja cinco filas; el establecimiento 002 deja sus dos comprobantes y habilita el punto de emisión;
  - un rango de fechas invertido se explica en el campo "Hasta" (`aria-invalid`) y en la tabla ("Revisa el rango de fechas"), sin consultar;
  - la descarga desde la fila guarda `factura-001-001-000000001.pdf` y muestra su aviso.
- **Detalle autorizado:**
  - acciones "Descargar RIDE" (primaria), "Imprimir", "XML autorizado" y "XML firmado", en ese orden;
  - la acción primaria mide 40 px en escritorio;
  - Enter sobre "Descargar RIDE" descarga el PDF; "XML autorizado" guarda `factura-001-001-000000001-autorizado.xml`;
  - "Imprimir" primero registra la solicitud (`POST …/print-requests`) y después pide el mismo RIDE (`GET …/ride`) para el diálogo de impresión;
  - el historial de entregas, plegable, muestra "Solicitud de impresión · RIDE" y "Descarga · XML autorizado" con fecha y persona, sin códigos internos ni hashes.
- **Respaldo:** sin "XML autorizado"; el RIDE y "XML firmado", rotulado como firmado.
- **RIDE detenido:**
  - el aviso explica el motivo en lenguaje de negocio ("El comprobante tiene caracteres que el RIDE no puede representar con sus fuentes.") y recuerda que la factura sigue autorizada;
  - "Reintentar generación" es la acción primaria; al reintentar aparece el aviso y el foco vuelve al título de la sección;
  - el reintento vuelve a detenerse con el mismo motivo, porque el carácter sigue en el comprobante.
- **Sin autorizar:** "El RIDE estará disponible cuando el SRI autorice la factura." y solo "XML firmado".
- **En preparación:** "Estamos preparando el RIDE." sin ofrecerlo; al reanudar el runner, el RIDE aparece solo con el refresco de 5 s.
- **Móvil a 375 y 320 px:** `Comprobantes` en tarjetas y los detalles, sin desbordamiento; los filtros avanzados quedan en un panel que abre "Filtros" (44 px); "Descargar RIDE" mide 44 px.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, `Comprobantes` y el detalle detenido sin desbordamiento.
- **Tema oscuro:** lista y detalle, en escritorio y a 375 px, sin desbordamiento y con el contraste medido.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.95:1 en claro y 6.46:1 en oscuro; detalle 5.95:1 en claro y 6.71:1 en oscuro.
- **Consola:** sin errores nuevos.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D13 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `documents-screen.tsx` y `documents-section.tsx`, con P0 a P3. Los hashes, las versiones del renderer y la procedencia (P3) no se muestran. |
| Tarea y jerarquía | En la bandeja, la acción principal es abrir el comprobante; el RIDE se descarga desde la fila. En el detalle, una sola acción primaria según el estado: "Descargar RIDE" o, con el RIDE detenido, "Reintentar generación". El estado del RIDE va primero; el historial, plegado al final. |
| Datos y lenguaje | Estados del glosario. Los documentos se nombran "RIDE", "XML autorizado" y "XML firmado"; el firmado nunca se presenta como autorizado. El historial dice "Descarga" y "Solicitud de impresión", sin afirmar que el cliente recibió o imprimió el documento. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; el RIDE detenido usa `CirclePause` en el aviso. Montos con cifras tabulares. |
| Selección de componentes | `AppDataTable`, `ChipGroup`, `SearchInput` y `RowActionButton` existentes. `DatePickerField` nuevo sobre el `<input type="date">` nativo, con etiqueta, limpieza y error en el campo. `details` nativo para el historial, que se pide al abrirlo. |
| Tablas | Paginación en el servidor con tamaño de página en la URL; búsqueda con espera de 300 ms; filtros en la URL; estados de carga, vacío, sin coincidencias, error con reintento y rango inválido. Por debajo de 768 px, tarjetas con la misma información. |
| Formularios y diálogos | Sin diálogos nuevos. El rango invertido se explica en el campo y no consulta; "Limpiar filtros" vuelve a la bandeja completa. |
| Feedback y estado | Descargas, impresión y reintento pasan por `useMutationFeedback`, con aviso de éxito o de error. El resumen del detalle se refresca cada 5 s solo mientras el RIDE está en preparación. |
| Navegación y responsive | Una ruta nueva, `Comprobantes`, en el grupo Operación. Por debajo de 768 px, los filtros avanzados pasan a un panel y los controles miden 44 px. |
| Rendimiento | La bandeja pide una página acotada (máximo 100) con índices por empresa y fecha y por receptor. El historial solo se pide al abrirlo. El PDF no se genera en la petición: se lee el artefacto ya guardado. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. La sección es una región con nombre ("Documentos"); el aviso del RIDE detenido es un `status`; el historial es una lista con nombre; el estado nunca depende solo del color; el foco vuelve al título tras el reintento. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra Pruebas sigue siendo una compuerta previa a la puesta en producción. |
| Diálogo de impresión | El diálogo del navegador no se puede inspeccionar en Chrome sin interfaz. Se comprueba el orden de las peticiones, que el iframe carga el mismo RIDE y el aviso. |
| Estado sin permiso alcanzable | Ambos roles tienen `archive.read`. Se comprueba con las pruebas de componentes. |
| Ruido de consola previo | El `401` de la comprobación de sesión antes de entrar y el `404` del favicon existían antes de este cambio y no dependen de él. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |

## Hallazgos corregidos durante la revisión

- **Dos filtros seguidos se pisaban.** Al elegir "Desde" y enseguida "Hasta", el segundo cambio construía la URL con la consulta anterior, que todavía no tenía "Desde", y la fecha inicial se perdía. Ahora la bandeja recuerda la última consulta pedida hasta que llega a la URL, y los cambios se acumulan. Lo cubre una prueba nueva del componente, que falla sin la corrección.

No quedan hallazgos abiertos.
