# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para las pantallas `Borradores` (`/borradores`),
el editor de factura (`/borradores/nuevo`, `/borradores/{id}`), `Facturas` (`/facturas`) y el
detalle de una factura (`/facturas/{id}`), y para el componente compartido `EntityPickerDialog`
(design D15). Fecha: 2026-10-03.

## Método

- **Recorrido automatizado** con Chrome (Playwright con el Chrome del sistema, en un directorio temporal fuera del repositorio).
  - Corre contra el backend y el frontend reales en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas.
  - La preparación usa la API real: configuración tributaria, establecimiento y punto, firma sintética (`sd-utf8.modern.p12`) con custodia, un cliente, tres productos y un operador.
  - El backend corre con `XSD_VALIDATION_CONCURRENCY=1` y `XSD_VALIDATION_QUEUE=0`, para provocar una factura `RESERVED` real: cuatro emisiones simultáneas saturan la validación y tres quedan con el diagnóstico `VALIDATOR_BUSY`, sin simular respuestas.
  - El recorrido completo se repitió desde una instalación nueva después de corregir los hallazgos.
- **Estados provocados:**
  - error de carga: respuesta `503` simulada del navegador;
  - sin permiso: `403` simulado, porque ningún rol carece de `invoices.read` ni de `invoices.draft`;
  - conflicto de versión: dos pestañas sobre el mismo borrador;
  - rechazo de la emisión: un producto desactivado entre la vista previa y la emisión.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro (33 capturas).
- **Pruebas de componentes:**
  - `frontend/test/entity-picker-dialog.test.tsx`, `drafts-screen.test.tsx`, `invoices-screen.test.tsx` y `app-shell.test.tsx`;
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento más profundo que contiene el texto, con los fondos translúcidos compuestos sobre su fondo real, en ambos temas. Además, un barrido de todo el texto visible de `main` en cada pantalla revisada.

## Borradores, editor, Facturas y detalle (tareas 10.1 a 10.3)

115 comprobaciones contra el backend real, todas correctas:

- **Navegación:**
  - grupo "Operación" con `Facturas` y `Borradores`, para administrador y operador;
  - títulos de pestaña "Borradores · Facturador SRI", "Nueva factura · Facturador SRI", "Facturas · Facturador SRI" y "Factura · Facturador SRI".
- **Borradores:**
  - **vacío** inicial con "Nueva factura";
  - **eliminar:** confirmación destructiva de un paso, aviso de éxito y el borrador sale de la lista;
  - un borrador emitido sale de la lista; abrirlo explica que ya se emitió y lleva a `Facturas`.
- **Editor:**
  - **punto predeterminado** del usuario preseleccionado;
  - **"Emitir factura"** deshabilitado, con su ayuda, mientras el borrador no está guardado, tiene cambios, tiene problemas o se está guardando;
  - **selector de comprador:**
    - el foco empieza en la búsqueda;
    - "Consumidor final" es la opción rápida y no se repite entre los resultados;
    - escribir oculta la opción rápida;
    - Enter elige el resultado activo, y el foco vuelve a "Cambiar comprador";
  - **selector de productos:** precio visible en cada resultado; la línea muestra el precio del producto como texto, sin campo para editarlo;
  - **cantidad de 7 decimales:** el error queda en el campo con `aria-invalid` y el valor escrito se conserva sin redondear;
  - **guardar** navega al borrador y muestra la vista previa del servidor: subtotal, descuento, IVA 15 % y total, "sin validez fiscal";
  - **conflicto de versión:** el aviso recibe el foco, ofrece "Recargar borrador" y recargar trae la versión vigente;
  - **consumidor final por encima del monto:** el resumen lo explica antes de emitir y la emisión queda deshabilitada;
  - **rechazo de la emisión:** el aviso vuelve al editor y la línea queda señalada con su mensaje; no se reserva número.
- **Confirmación de la emisión:**
  - ambiente "Pruebas", comprador, total y número de líneas;
  - a consumidor final, advierte de las restricciones de anulación y nota de crédito (CTX §35);
  - Escape la cierra y devuelve el foco a "Emitir factura";
  - al confirmar, navega al detalle con el aviso "Emitiste la factura 001-001-000000001.".
- **Detalle:**
  - firmada: "Pendiente de envío", clave de acceso de 49 dígitos, totales, líneas y forma de pago con su denominación, sin "Reintentar firma";
  - reservada: etapa, motivo, si es reintentable, intentos y fecha del último intento, sin secretos ni XML;
  - **reintento:** el operador firma la factura con su mismo número, aparece el aviso y la acción desaparece.
- **Facturas:**
  - número, comprador, total, fecha y estado con icono y texto;
  - la búsqueda sin coincidencias ofrece "Limpiar filtros";
  - los filtros "Procesando" y "Pendientes de envío" van a la URL;
  - el número abre el detalle.
- **Operador:** prepara, emite y reintenta la firma.
- **Sin permiso:** el `403` simulado se explica sin mostrar datos, en `Borradores` y en `Facturas`.
- **Error:** el `503` simulado muestra "Intentar de nuevo", que recupera la lista.
- **Móvil a 375 y 320 px, en Borradores, el editor, Facturas, el detalle, el selector y la confirmación:**
  - sin desbordamiento;
  - controles de 44 px o más;
  - los diálogos caben en la pantalla.
- **Tema oscuro:** editor, Facturas y detalle, en escritorio y a 375 px, con el contraste medido.
- **Barrido:** a 640, 768, 1024 y 1440 px, las cinco rutas nuevas sin desbordamiento y con la cabecera completa.
- **Consola y red:** las únicas respuestas fallidas son las esperadas o provocadas:
  - la comprobación de sesión antes de iniciarla (`401`);
  - la visita al borrador ya emitido, el conflicto de versión y el rechazo de la emisión (`409`);
  - los `403` y `503` simulados (el `503` con sus dos reintentos automáticos);
  - el `404` de `/favicon.ico`, anterior a este cambio: la aplicación no tiene icono.

| Sección | Resultado |
| --- | --- |
| Antes de construir | Los briefs de D15 (usuario, objetivo, decisión, información mínima y acción principal) están en el encabezado de `drafts-screen.tsx`, `draft-editor.tsx`, `invoices-screen.tsx` e `invoice-detail.tsx`, con P0 a P3. Las versiones y los metadatos técnicos (P3) no se muestran. |
| Tarea y jerarquía | Una acción principal por superficie: "Nueva factura", "Emitir factura" (con "Guardar borrador" como secundaria) y "Reintentar firma" solo con `RESERVED` y permiso. En el detalle, el estado y el diagnóstico van primero; después, comprador y totales; las líneas y los pagos, al final. |
| Datos y lenguaje | Importes en USD con el formato es-EC desde el texto, sin `number`. Estados del glosario: "Procesando" y "Pendiente de envío". Etapas y clases del diagnóstico en frases ("Validación del XML", "Puedes reintentar ahora."). La forma de pago se muestra con su denominación oficial, no con su código. Ningún identificador interno a la vista; la clave de acceso solo en el detalle. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto. Cifras tabuladas y alineadas a la derecha en los resúmenes; los importes no se parten en móvil. |
| Selección de componentes | `AppDataTable` con paginación de servidor y estado en la URL; `ChipGroup` para el estado; `EntityPickerDialog` (nuevo) para comprador y productos, porque son conjuntos grandes con búsqueda; `Select` para el punto y la forma de pago (pocas opciones conocidas); `ConfirmDialog` de un paso para emitir y para eliminar un borrador. |
| Formularios y diálogos | React Hook Form con los esquemas decimales del contrato. Página completa para el editor, por ser un flujo complejo y de riesgo (design D15). Los errores de campo quedan en su campo; el conflicto y el rechazo, en un aviso que recibe el foco, con la línea señalada. La `Idempotency-Key` se genera al abrir la confirmación y se repite en los reintentos de la misma solicitud. |
| Feedback y estado | Las mutaciones pasan por `useMutationFeedback`. Una factura que queda `RESERVED` se avisa con tono de advertencia y el motivo, no como un éxito. El editor no calcula dinero: los totales y los problemas son la vista previa del servidor del borrador guardado. |
| Navegación y responsive | `Facturas` y `Borradores` en el grupo "Operación". Por debajo de 768 px: tarjetas en las listas, el resumen del editor bajo el formulario y controles de 44 px. |
| Rendimiento | Una consulta paginada por lista. Las búsquedas de los selectores esperan una pausa antes de consultar y piden una página de 10. La lista de borradores evalúa cada vista previa con lecturas de catálogos memorizadas por solicitud. |
| Tema y accesibilidad | Ambos temas revisados. Insignias: 16.0:1 y 15.5:1 en claro, 12.6:1 y 12.9:1 en oscuro. Aviso del diagnóstico: 15.4:1 y 14.0:1; su línea atenuada, 6.0:1 y 6.5:1. Identificación atenuada y ayudas: 6.8:1 y 7.1:1. Clave de acceso: 17.7:1 y 15.3:1. El selector es un combobox sobre un listbox (`aria-activedescendant`, `aria-selected`); las líneas con problemas anuncian `aria-invalid`; un `h1` por pantalla y regiones con nombre ("Resumen", "Totales"). |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Confirmación escrita para un borrado irreversible | Eliminar un borrador no se puede deshacer, pero el borrador no tiene número, clave ni datos fiscales: es trabajo pendiente. Se usa una confirmación destructiva de un paso, como pide design D15 ("eliminación con confirmación"). |
| Estado sin permiso alcanzable | Ningún rol carece de `invoices.read` ni de `invoices.draft`. Se comprueba con pruebas de componentes y con el `403` simulado. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |
| `404` de `/favicon.ico` | Anterior a este cambio y ajeno a sus pantallas: la aplicación no publica un icono. |

## Hallazgos corregidos durante la revisión

- **Consumidor final repetido en el selector.** Aparecía como opción rápida y, además, entre los resultados de clientes (es un tercero con rol de cliente). Ahora el cargador de compradores lo excluye de los resultados y ajusta el total.
- **Enter durante la espera de la búsqueda.** Con una búsqueda escrita y aún sin aplicar, Enter elegía el resultado activo de la búsqueda anterior (la opción rápida). Ahora aplica la búsqueda, la opción rápida desaparece en cuanto se escribe y el siguiente Enter elige. Lo cubre una prueba nueva del componente.
- **Emitir mientras se guarda.** "Emitir factura" seguía habilitado durante un guardado; al terminar, el editor vuelve a montarse con la versión nueva y cerraba la confirmación abierta. Ahora la emisión espera al guardado.
- **Consulta repetida tras emitir.** La emisión invalidaba también el detalle del borrador emitido, que el editor volvía a pedir (`409`) antes de navegar. Ahora solo invalida la lista de borradores y las facturas.
- **Puntuación del diagnóstico.** La fecha del último intento terminaba en "p. m." y se le añadía otro punto; ahora se escribe "Intentos: 1 · último intento: …".
- **Importes partidos en móvil.** A 375 px, el importe de una forma de pago se partía en "USD" y "10,06"; los importes del detalle ya no se parten.
