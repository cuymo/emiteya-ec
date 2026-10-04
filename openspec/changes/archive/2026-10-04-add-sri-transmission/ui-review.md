# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Facturas` (`/facturas`) con los estados de
la transmisión y para la sección "Transmisión al SRI" del detalle de una factura
(`/facturas/{id}`), con la acción "Reconciliar con el SRI" y su diálogo (design D20). Fecha:
2026-10-04.

## Método

- **Recorrido automatizado** con Chrome (Playwright con el Chrome del sistema, en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts`, con sus workers, el sweeper y el gate) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas.
  - La transmisión está habilitada y apunta a un **SRI simulado** local: un servidor HTTP con respuestas SOAP **sintéticas**, un escenario por secuencial. Ninguna llamada sale al SRI real.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa la API real: configuración tributaria, establecimiento y punto, firma sintética con custodia, un cliente, un producto, una operadora y siete facturas emitidas.
  - Las siete facturas recorren el flujo real hasta su estado; ninguna se escribe por SQL salvo el paro de la séptima (abajo).
  - El recorrido completo se repitió desde una instalación nueva después de corregir los hallazgos.
- **Escenarios del SRI simulado:**
  - 1: recibida y autorizada, con la advertencia `60`;
  - 2: devuelta con dos mensajes (`35` con información adicional y una advertencia);
  - 3: recibida y `RECHAZADO` en la autorización con el mensaje `46` (no autorizada, design D10);
  - 4: primera recepción no clasificable (HTML), después recibida y la autorización en proceso: queda pendiente de autorización con una interacción en curso;
  - 5: devuelta con una clave ajena: revisión manual;
  - 6: error `70`, luego autorizada;
  - 7: la autorización solo recibe Faults; su job de autorización se pasa a `STOPPED` por SQL para no esperar la ventana de una hora. Es la transmisión detenida.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px (24 capturas).
- **Pruebas de componentes:**
  - `frontend/test/invoice-transmission.test.tsx` (13 pruebas) e `invoices-screen.test.tsx` (vacío, error con reintento y sin permiso);
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main`, con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.

## Facturas y detalle (tareas 13.1 a 13.3)

69 comprobaciones contra el backend real, todas correctas:

- **Facturas:**
  - título "Facturas · Facturador SRI";
  - los estados "Autorizado", "Devuelto", "No autorizado", "Pendiente de autorización" y "Requiere revisión", con icono y texto del glosario;
  - la transmisión detenida se ve como una segunda insignia, "Transmisión detenida", con icono;
  - "Requiere atención" deja exactamente la revisión manual y la detenida.
- **Detalle autorizado:** número, fecha y ambiente de la autorización; la advertencia `60` del SRI; sin "Reconciliar con el SRI".
- **Historial plegable:** resume transiciones e intentos ("Envío al SRI: Recibida", "Consulta de autorización: Autorizada"); no muestra XML, SOAP ni identificadores técnicos.
- **Devuelto:** los dos mensajes con su código, su texto, su tipo y la información adicional.
- **No autorizado:** explica el estado y muestra el mensaje `46`.
- **Pendiente de autorización:** avisa la interacción en curso y no ofrece reconciliar.
- **Transmisión detenida:**
  - el aviso explica el motivo en lenguaje de negocio, con la fecha, sin repetir la puntuación tras la hora;
  - el administrador tiene "Reconciliar con el SRI" como acción primaria de la sección;
  - la operadora ve el motivo y "Un administrador puede reconciliarla con el SRI.", sin la acción.
- **Reconciliación con el teclado (revisión manual):**
  - título "Factura · Facturador SRI";
  - la acción mide 40 px en escritorio (botón estándar) y 44 px por debajo de 768 px;
  - Enter abre el diálogo y el foco va al motivo;
  - sin motivo, el error queda en el campo con `aria-invalid` y el foco vuelve al motivo;
  - Escape cierra y devuelve el foco a la acción;
  - con motivo, el aviso de éxito aparece y el diálogo se cierra;
  - mientras corre, la sección dice "La reconciliación está en curso" sin contradecirse;
  - al terminar, la factura queda autorizada y la sección se actualiza sola.
- **Móvil a 375 y 320 px:** `Facturas` y los detalles devuelto, detenido y autorizado, sin desbordamiento.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, `Facturas` y los detalles detenido y devuelto sin desbordamiento.
- **Tema oscuro:** lista y los tres detalles, en escritorio y a 375 px, sin desbordamiento y con el contraste medido; diálogo de reconciliación en oscuro.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.95:1 en claro y 6.46:1 en oscuro; aviso de transmisión detenida 5.95:1 en claro y 6.51:1 en oscuro; detalles devuelto y autorizado 6.54:1 en claro y 7.12:1 en oscuro.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D20 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `transmission-section.tsx` e `invoice-detail.tsx`, con P0 a P3. Los identificadores de intentos, las cabeceras y los tiempos técnicos (P3) no se muestran; nunca XML ni SOAP. |
| Tarea y jerarquía | Una sola acción en la sección, "Reconciliar con el SRI", primaria, solo para el administrador y en un estado admitido. El estado y su explicación van primero; después el aviso de transmisión detenida, la autorización y los mensajes; el historial, plegado al final. |
| Datos y lenguaje | Estados del glosario. Cada estado se explica en una frase. Las operaciones, los resultados y las causas del historial se muestran con etiquetas en español. El motivo de una transmisión detenida solo dice qué pasó; la acción depende del rol y la indica la interfaz. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; la transmisión detenida usa una insignia propia con `CirclePause`. El número de autorización en monoespaciada, partido en cualquier carácter. |
| Selección de componentes | `AppDataTable` y `ChipGroup` existentes para la lista; `ConfirmDialog` ampliado con un texto obligatorio validado por el esquema del contrato para el motivo; `details` nativo para el historial, que se pide al abrirlo. |
| Formularios y diálogos | El motivo es obligatorio, con su límite de longitud y el mensaje del contrato en el campo. Un `409` (`SRI_INTERACTION_IN_PROGRESS` o `INVOICE_NOT_RECONCILABLE`) se explica en el aviso de error. |
| Feedback y estado | La mutación pasa por `useMutationFeedback`. El detalle se refresca cada 5 s solo mientras hay una interacción en curso. |
| Navegación y responsive | Sin rutas nuevas. Por debajo de 768 px, la acción pasa bajo el título de la sección y los controles miden 44 px. |
| Rendimiento | El detalle trae el resumen de la transmisión en la misma consulta; el historial (acotado a las entradas más recientes) solo se pide al abrirlo. La lista calcula "requiere atención" y la transmisión detenida en su consulta paginada. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. La sección es una región con nombre ("Transmisión al SRI"), el aviso de transmisión detenida es un `status`, las listas de mensajes y el historial tienen nombre accesible y el estado nunca depende solo del color. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Paro provocado por SQL | La séptima factura se detiene escribiendo `STOPPED` en su job de autorización, para no esperar la ventana de conclusión de una hora. El resto del flujo es real. El paro por agotamiento lo cubren las pruebas del runner y de los handlers. |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra Pruebas es una compuerta previa a la puesta en producción (tarea 14.2). |
| Estado sin permiso alcanzable | Ningún rol carece de `invoices.read`. Se comprueba con las pruebas de componentes. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |

## Hallazgos corregidos durante la revisión

- **Puntuación del aviso de transmisión detenida.** La fecha terminaba en "a. m." y se le añadía otro punto ("a. m.."). Ahora se escribe "04/10/2026, 12:22 a. m. · Reconcilia con el SRI para continuar.". Lo cubre una prueba nueva del componente.
- **Acción con poco peso.** "Reconciliar con el SRI" usaba la variante con borde aunque es la única acción de la sección; ahora es primaria.
- **Revisión manual contradictoria.** Con la reconciliación pedida, la sección decía "un administrador debe reconciliar la factura. Hay una interacción con el SRI en curso.". Ahora dice "La reconciliación está en curso: el estado se actualizará cuando el SRI responda.". Lo cubre una prueba nueva del componente.
- **Instrucción repetida y ajena al rol.** El motivo de la transmisión detenida, que arma el backend, terminaba en "Reconcilia cuando el servicio esté disponible." y la interfaz añadía su propia línea. La operadora, que no puede reconciliar, también leía la instrucción. Ahora el motivo solo dice qué pasó y la interfaz indica la acción según el rol.

No quedan hallazgos abiertos.
