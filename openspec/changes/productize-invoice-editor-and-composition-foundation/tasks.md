# Tasks

**Reglas para todos los grupos:**
- **Commits.** Un commit por grupo en `redesign-frontend`, sin push, sin archivar y sin publicar en
  `main`. Un grupo en verde se commitea antes de empezar otro paso o un traspaso.
- **SRI.** Ningún grupo contacta al SRI de Pruebas ni de Producción. Antes de cualquier revisión en
  el despliegue local, se prueba `SRI_TRANSMISSION_ENABLED=0` con `docker inspect`; nunca se deduce
  del valor por defecto.
- **Backend.** Sin cambios en el backend, la API, la base de datos ni la lógica fiscal. Ningún
  cálculo fiscal en el navegador. Sin dependencias de ejecución nuevas.
- **Decisiones del propietario.** PO-1, PO-2 y PO-3 (proposal) se resuelven antes del apply. Las
  tareas siguen la recomendación; si el propietario elige otra opción, se revisan con
  `/opsx:update` antes de aplicar.
- **Pantallas fuera del alcance.** Solo reciben los cambios transversales de D2 (enlaces «volver»),
  D9 (botón deshabilitado), D10 (selección neutra) y D11 (estado vacío).
- **Pruebas existentes.** Ninguna prueba de comportamiento se borra. Cada aserción que cambia queda
  explicada en el commit que la cambia.
- **Revisión visual.** Cada grupo con impacto visual se mira en la app renderizada (D19). Pasar
  `test:visual` no basta.

## 1. Revisión visual como herramienta y capturas «antes»

- [ ] 1.1 Ampliar los datos del harness (`frontend/visual/fixtures.ts`) para el editor:
  - borrador nuevo, borrador listo, con problemas, con totales no calculables y a consumidor final;
  - establecimientos y puntos, punto predeterminado, catálogo de formas de pago, clientes y
    productos;
  - empresa en Pruebas, en Producción y con el ambiente desconocido.

  Las rutas de escritura (`POST` y `PUT`) no se simulan: la revisión no guarda nada.

  Verificar que `corepack pnpm test:visual` sigue en verde sin cambiar ninguna captura.
- [ ] 1.2 Crear el proyecto `review` de Playwright y el comando `test:visual:review` (D17):
  - la matriz (D18) en `visual/review/matrix.ts`;
  - la salida en `frontend/.review/visual/<etiqueta>/`: capturas, geometría JSON, hojas de contacto
    HTML con su PNG y `manifest.json`;
  - la comparación con `REVIEW_COMPARE_WITH`;
  - los fallos con código distinto de cero (navegación, captura, condición de listo, `pageerror`,
    otro origen, ruta de la API sin datos), nunca por estética;
  - `frontend/.review/` en `.gitignore`.

  Verificar que el comando termina en 0, que escribe todos los archivos del manifiesto, que falla
  con una ruta sin datos provocada a propósito, y que `git status` no muestra nada bajo `.review/`.
- [ ] 1.3 Documentar el flujo:
  - `testing.md`: el comando, la salida y los fallos;
  - `definition-of-done.md` y `change-lifecycle.md`: antes y después, abrir e inspeccionar, y
    valorar por escrito (D19);
  - el procedimiento manual del despliegue de revisión, con la prueba de
    `SRI_TRANSMISSION_ENABLED=0`.

  Verificar que los tres documentos describen el mismo comando y la misma carpeta.
- [ ] 1.4 Capturar el «antes» con `REVIEW_LABEL=antes`, abrir las hojas y escribir
  `openspec/changes/productize-invoice-editor-and-composition-foundation/review-antes.md`:
  - orden de atención, jerarquía, densidad, alineación, equilibrio y jerarquía de acciones;
  - por anchura y por tema;
  - con las medidas de la geometría.

  Medir también la carga con `test:visual:bundle`, añadiendo la ruta de nueva factura.

  Verificar que el documento cita los archivos de las capturas y que las capturas no se versionan.

## 2. Jerarquía de acciones y anchos del sistema

- [ ] 2.1 Botón deshabilitado neutro en `components/ui/button.tsx` (D9):
  - por variante, sin opacidad sobre el color de la variante;
  - el estado pendiente (`aria-busy`) excluido;
  - `outline` transparente en oscuro.

  Verificar con pruebas:
  - unitarias del aspecto por variante y de `AsyncButton` pendiente;
  - de tokens: al menos 3:1 entre el texto deshabilitado y `muted` en claro y en oscuro.
- [ ] 2.2 Selección neutra en `ChipGroup` y `SegmentedControl` (D10), con la elección reconocible por
  forma y peso.

  Verificar con pruebas unitarias del estado elegido (`aria-checked` o `data-state` y la clase
  neutra) y con las pruebas existentes de las 10 listas y los 11 consumidores en verde.
- [ ] 2.3 Estado vacío sin segunda principal en notas de crédito, notas de débito, retenciones, guías
  y liquidaciones (D11).

  Verificar con una prueba por pantalla que el encabezado tiene la única principal y el vacío la
  misma acción en `outline`.
- [ ] 2.4 Tokens de ancho por función (`--container-reading`, `--container-form`) y del punto de
  apilado del formulario (`--container-form-rail`) en `globals.css` (D4, D5).

  Verificar con `design-css.test.ts` que existen y generan sus utilidades.
- [ ] 2.5 Actualizar `component-system.md`, `component-selection.md` y `design-foundations.md` con
  las reglas de D9, D10, D11 y D4, incluido el mapeo de los anchos heredados.

  Verificar que los documentos nombran los mismos tokens que el código.

## 3. Barra superior estable y una sola orientación

- [ ] 3.1 Recomponer `components/shell/topbar.tsx` en tres zonas (D1):
  - contexto de la empresa acotado, con `title` y nombre accesible completo;
  - sin migas;
  - sin el grupo «Tema».

  Verificar con pruebas de `app-shell.test.tsx`: una sola línea de elementos, sin migas en la
  barra, el nombre largo recortado con el nombre completo accesible, y sin control de tema en la
  barra.
- [ ] 3.2 Tema solo en el menú de cuenta a todas las anchuras (spec «Tema accesible»).

  Verificar con `app-shell.test.tsx` y `keyboard.spec.ts`: el grupo «Tema» en el menú de cuenta en
  escritorio y en móvil, recorrido con las flechas y recordado al recargar.
- [ ] 3.3 Migas encima del título a todas las anchuras (D2): la fila del contenido sin
  `md:hidden`, en una línea con recorte, y ausente en los destinos de primer nivel.

  Verificar con `app-shell.test.tsx` y `navigation-routes.test.ts` los escenarios de «Migas de
  navegación».
- [ ] 3.4 Retirar los 14 enlaces «volver» (D2) de los editores y detalles listados en el design.

  Verificar que sus pruebas buscan la miga en lugar del enlace y siguen en verde.
- [ ] 3.5 Rutas de factura bajo Facturas en `INTERNAL_ROUTES` (D12, PO-1).

  Verificar con `navigation-routes.test.ts`, `quick-create-and-palette.test.tsx`,
  `drafts-screen.test.tsx` y `ux.spec.ts`:
  - «Facturas › Nueva factura» y «Facturas › Borrador de factura»;
  - Facturas como destino actual antes y después del primer guardado;
  - la creación rápida marcando Facturas.
- [ ] 3.6 Ajustar `scripts/check-web-security-policy.ts` si cambia algún nombre que use, sin
  debilitar la política.

  Verificar con `corepack pnpm check:web-security-policy` en verde.
- [ ] 3.7 Revisión visual del shell:
  - `test:visual:review` sobre la barra y las migas a todas las anchuras de D18, con la geometría
    de la barra (una línea y huecos por zona);
  - revisar a mano las diferencias de las 26 capturas de `test:visual` y actualizar solo las
    esperadas;
  - actualizar `navigation-responsive.md` e `interface-design.md`.

  Verificar que a 768, 1024 y 1280 px ningún elemento de la barra mide más de una línea, y que
  Facturas no empeora.

## 4. Gramática de `PageHeader`

- [ ] 4.1 Ritmo vertical fijo en `components/layout/page-header.tsx` (D3):
  - bloque del título de al menos 40 px con `items-center`;
  - 8 px desde la fila de migas y 24 px hasta el contenido;
  - variantes de lista y de editor (contexto con el estado del borrador, sin acciones en el
    encabezado).

  Verificar con `page-header.test.tsx` la variante de editor, y con la geometría de la revisión la
  misma y del título en Facturas con y sin acción.
- [ ] 4.2 Documentar la gramática de las tres variantes en `interface-design.md` y
  `component-system.md`, con la de configuración escrita para su migración.

  Verificar que el documento y el componente coinciden.

## 5. Primitivos de composición de formularios

- [ ] 5.1 `FormLayout` (D5): contenedor con `@container`, formulario y panel opcional de 18rem, al
  lado desde `--container-form-rail` y apilado por debajo.

  Verificar con una prueba unitaria la estructura y el orden de lectura, y con el navegador las
  anchuras de D5.
- [ ] 5.2 `FormSection` (D6): título, descripción opcional, acción local y contenido, con
  `aria-labelledby`.

  Verificar con una prueba unitaria el nombre accesible de la sección y la acción local.
- [ ] 5.3 `FormGrid` y `FormFieldRow` (D7), sobre el `FormField` existente:
  - columnas por contenedor;
  - filas en `grid-rows-subgrid` con etiqueta, control y mensaje;
  - acción en línea en la fila del control;
  - `fieldset` con leyenda.

  Verificar con pruebas unitarias la asociación del `fieldset` y la acción, y con el navegador que
  las etiquetas y los controles de una fila comparten la y, con una ayuda bajo un solo campo.
- [ ] 5.4 `StickySummaryPanel` y `StickyFormActions` (D8): fijo al lado y barra al pie cuando se
  apila, con la reserva de alto para el foco y el motivo asociado con `aria-describedby`.

  Verificar con pruebas unitarias el motivo asociado, y con el navegador que el foco nunca queda
  tapado por la barra.
- [ ] 5.5 Rutas nuevas en la lista estricta de `eslint.config.js` y su prueba de lint escalonado;
  filas en `component-system.md` y `frontend.md`.

  Verificar con `corepack pnpm lint` y `staged-lint.test.ts`.

## 6. Editor de facturas productizado

- [ ] 6.1 Componer `features/invoices/draft-editor.tsx` con `PageHeader` (variante de editor),
  `FormLayout`, `FormSection`, `FormGrid` y `FormFieldRow` (D13):
  - comprador y punto de emisión en dos columnas;
  - líneas con encabezados, la base imponible del servidor solo sin cambios, y el foco en la
    cantidad de la línea nueva;
  - formas de pago alineadas.

  Verificar con pruebas de pantalla:
  - el comprador y el punto en la misma sección;
  - el foco tras agregar un producto;
  - la base imponible solo con el borrador guardado y sin cambios.
- [ ] 6.2 Acción siguiente según la matriz de D14.

  Verificar con una prueba por estado: nuevo, guardando, con cambios, con problemas, listo, sin
  permiso para emitir y los errores de operación. En cada uno, la principal, la secundaria, la no
  disponible con su motivo y la llamada que hace.
- [ ] 6.3 Resumen veraz y ambiente junto a la emisión (D8):
  - estado del borrador;
  - totales del servidor;
  - el aviso de recalcular con el último total guardado rotulado;
  - los totales no calculables;
  - los problemas generales;
  - el ambiente en Pruebas, en Producción y desconocido.

  Verificar con pruebas de pantalla los escenarios de «Totales veraces» y «Ambiente junto a la
  emisión», y que el navegador no calcula importes.
- [ ] 6.4 Confirmación de la emisión con la línea de Pruebas (D15).

  Verificar con pruebas de pantalla los escenarios de «Confirmación de la emisión», incluida la
  confirmación repetida con la misma `Idempotency-Key`.
- [ ] 6.5 Formas de pago:
  - «Déjalo vacío para usar el total de la factura» con una forma de pago;
  - la ayuda de sección con varias;
  - quitar asociado a su fila en móvil.

  Verificar con pruebas de pantalla los escenarios de «Formas de pago en el editor», y que las
  reglas no cambian.
- [ ] 6.6 Cambios sin guardar (D16, PO-3): indicador en el encabezado y en el resumen, y
  `beforeunload` solo con cambios.

  Verificar con pruebas de pantalla los escenarios de «Cambios sin guardar», incluido que sin
  cambios no se registra el aviso.
- [ ] 6.7 Mantener el borrador ajeno como inexistente, la carga, el error y la falta de permiso con
  la gramática nueva.

  Verificar con pruebas de pantalla «El borrador no existe», la carga sin saltos y el error con
  reintento.
- [ ] 6.8 Actualizar `fiscal-emission.md` con el editor: estados, resumen, confirmación y cambios
  sin guardar.

  Verificar que el documento coincide con la pantalla.

## 7. Navegador y capturas

- [ ] 7.1 Añadir `visual/shell/editor.spec.ts`:
  - **teclado:** comprador, punto, agregar producto, cantidad, formas de pago y acciones, y
    confirmación con devolución del foco;
  - **axe** en claro, oscuro, móvil y con la confirmación abierta;
  - **anchuras de D18,** con la forma de pago y el importe completos, sin desplazamiento de la
    página, con el panel al lado o apilado según D5.

  Verificar que la spec pasa.
- [ ] 7.2 Capturas canónicas del editor en `test:visual`:
  - nuevo;
  - listo;
  - con problemas;
  - con cambios;
  - 1024 expandida;
  - 390;
  - oscuro.

  Revisar a mano cada captura nueva y las del shell que cambien. Facturas se compara con su
  captura actual y no puede empeorar.

  Verificar que `corepack pnpm test:visual` pasa y que ninguna captura ajena al alcance cambió sin
  revisión.
- [ ] 7.3 Medir la carga «después» con `test:visual:bundle` y explicar cada diferencia.

  Verificar que no entra ninguna dependencia nueva y que el editor no hace peticiones nuevas.

## 8. Revisión «después», UX y documentación final

- [ ] 8.1 Capturar el «después» con `REVIEW_LABEL=despues` y `REVIEW_COMPARE_WITH=antes`, abrir la
  comparación y escribir `review-despues.md` con la misma estructura que el «antes».

  Verificar que el documento cita las hojas de comparación y mide la barra, el encabezado y la fila
  de pago.
- [ ] 8.2 Revisión UX enfocada:
  - con el operador diario, el administrador nuevo y el usuario ocasional;
  - sobre el harness y sobre el despliegue local de revisión, reconstruido solo en su frontend con
    `SRI_TRANSMISSION_ENABLED=0` probado.

  Verificar el umbral de D20 y los S3 del backend informados aparte.
- [ ] 8.3 Recorrer `frontend-checklist.md` en el editor y en la barra superior: 320, 768, 1024 y
  1440 px, zoom al 200 %, teclado, claro y oscuro, administrador y operador, Pruebas y Producción.

  Verificar que la lista queda marcada.
- [ ] 8.4 Actualizar `technical-debt.md`:
  - cerrar los V4 de la barra y de formularios para el editor;
  - registrar `SERVER_TOTAL_PREVIEW_GAP` y la navegación interna de `UNSAVED_CHANGES_GAP`;
  - mantener la deuda visual de las pantallas heredadas.

  Añadir las filas de la plantilla a `THIRD_PARTY_NOTICES.md`.

  Verificar que cada fila nombra su efecto, su paliativo y su criterio de salida.

## 9. Verificación final

- [ ] 9.1 Ejecutar, sin tráfico al SRI:
  - las pruebas enfocadas;
  - `openspec:validate`, `format:check`, `security:dependencies` y `security:secrets`;
  - `test:visual`;
  - `verify`, en sala limpia mientras el CI alojado no pueda ejecutarse.

  Verificar que todo pasa. Si solo falla AC-04 por su inestabilidad registrada, informar la
  evidencia compuesta y no presentarla como verde.
