# Revisión visual «antes»

Mirada al producto tal como está, antes de cualquier cambio de código de ejecución (tareas 1.4,
D19 y D22). Es la línea base con la que se compara `review-despues.md`.

## Cómo se obtuvo

- **Comando:** `REVIEW_LABEL=antes corepack pnpm --filter @facturador/frontend test:visual:review`.
  Terminó con código 0: 84 capturas, la preparación y las hojas.
- **Carpeta:** `frontend/.review/visual/antes/`, ignorada por git. Las rutas de abajo son relativas
  a ella.
- **Código de la app:** el de `58f7dc9`, sin cambios de ejecución. El manifiesto dice
  `58f7dc9+cambios` porque el árbol tenía sin commitear solo lo del grupo 1: el harness, la
  herramienta y la documentación.
- **Datos:** el harness determinista (`visual/fixtures.ts` y `visual/editor-fixtures.ts`). Sin
  backend, sin guardar ni emitir y sin ningún contacto con el SRI.
- **Qué se miró:**
  - las seis hojas de `contact-sheets/` (shell, editor, listas, configuración, móvil y oscuro);
  - a tamaño real, cada captura citada en este documento;
  - la geometría de `geometry/`, de donde salen todas las medidas.
- **Escala**, la de la auditoría del 2026-10-15 (`docs/quality/technical-debt.md`):
  - **V5:** riesgo fiscal o pérdida de datos;
  - **V4:** roto: solapes, texto que se monta o valores cortados en el flujo principal;
  - **V3:** confunde, compite o fatiga en el uso diario;
  - **V2:** inconsistencia visible;
  - **V1:** pulido.
- **Artefactos de la captura, no del producto:**
  - en las capturas de página entera, la barra lateral mide lo que la ventana (900 px a 1440, por
    ejemplo) y debajo queda el fondo de la página;
  - las capturas con un diálogo o un panel abierto son de la ventana, no de la página.

## Resumen

| Id | Sev. | Hallazgo | Evidencia principal | Tareas |
| --- | --- | --- | --- | --- |
| A1 | V4 | Las migas de la barra superior se parten y, a 768 px, se montan sobre la empresa | `borrador-listo-768-claro.png`, `empresa-configurada-768-claro.png` | 3.1, 3.5 |
| A2 | V3 | Barra plana: ocho piezas con el mismo hueco de 8 px, y un control de tema que no encaja | `nueva-factura-vacia-1440-claro.png` | 3.1, 3.2 |
| A3 | V3 | Migas y enlace «volver» repetidos en los editores | `nueva-factura-vacia-390-claro.png` | 3.5, 3.6 |
| A4 | V3 | El título cambia de altura entre pantallas y entre ambientes | geometría de las 84 capturas | 3.3, 3.6, 4.1 |
| A5 | V2 | El editor marca «Borradores de facturas» en la barra lateral, no Facturas | `nueva-factura-vacia-1440-claro.png` | 3.7 |
| A6 | V3 | Sin anchos de contenido comunes: cada pantalla usa el suyo | `empresa-configurada-1440-claro.png`, `borrador-listo-1440-claro.png` | 2.4, 4.1 |
| B1 | V3 | Pruebas se avisa dos veces en cada pantalla: indicador y franja | `facturas-poblada-1440-claro.png` | 3.3 |
| B2 | V3 | Junto a «Emitir» y en su confirmación no se dice que el comprobante no tendrá validez tributaria | `borrador-confirmacion-1440-claro.png`, `nota-credito-confirmacion-1440-claro.png` | 3.4, 6.4 |
| B3 | V3 | Con el ambiente sin confirmar, la barra no tiene indicador de ambiente | `facturas-ambiente-desconocido-1440-claro.png` | 3.3 |
| B4 | V2 | Producción, en negro, es la pieza con más peso de la barra | `facturas-produccion-1440-claro.png` | 3.3 |
| C1 | V3 | Acciones del editor invertidas: «Emitir» deshabilitado parece activo y «Guardar» es secundario | `nueva-factura-vacia-1440-claro.png` | 2.1, 6.2 |
| C2 | V4 | A 1024 px con la barra expandida, el resumen estrecha el formulario y corta la forma de pago | `borrador-listo-1024-claro.png` | 5.1, 5.4, 6.1 |
| C3 | V3 | Fila de pago desalineada, ayuda críptica y papelera suelta | `borrador-listo-1440-claro.png`, `nueva-factura-vacia-390-claro.png` | 5.3, 6.5 |
| C4 | V3 | Con cambios sin guardar no hay indicador y el resumen pierde los totales | `borrador-cambios-sin-guardar-1440-claro.png` | 6.3, 6.6 |
| C5 | V3 | El problema del comprador solo se lee en el resumen | `borrador-problemas-1440-claro.png` | 6.1, 6.2 |
| C6 | V3 | Líneas como tarjetas apiladas, sin encabezados; en un teléfono cada línea mide unos 300 px | `borrador-ambiente-desconocido-390-claro.png` | 6.1 |
| C7 | V3 | En un teléfono, «Emitir» y «Guardar» solo están al final | `borrador-listo-390-claro.png` | 5.4, 6.1 |
| C8 | V2 | Mensajes del resumen que no corresponden al estado | `borrador-incompleto-1440-claro.png` | 6.3 |
| C9 | V2 | Decimales con punto en los campos y con coma en los importes | `borrador-listo-1440-claro.png` | sin tarea |
| D1 | V3 | Selecciones por defecto en azul primario: cuatro azules en Productos | `productos-poblada-1440-claro.png` | 2.2 |
| D2 | V2 | Controles segmentados con relleno primario | `productos-dialogo-nuevo-1440-claro.png` | 2.2 |
| D3 | V2 | En oscuro, los botones `outline` tienen relleno gris | `borrador-listo-390-oscuro.png` | 2.1 |
| E1 | V3 | Productos a 1024 px: la tabla parte los códigos y lleva el nombre a cuatro líneas | `productos-poblada-1024-claro.png` | sin tarea |

Ningún V5. Dos V4 (A1 y C2), que son los de la auditoría: la barra superior y el formulario del
editor.

## A. Barra superior, migas y encabezado

**A1 (V4). Las migas de la barra se parten y se montan sobre la empresa.**

- **Medidas:** la caja de las migas dentro de la barra de 48 px de alto:

  | Anchura | Migas (ancho × alto) | Lectura |
  | --- | --- | --- |
  | 1440 | 297 × 20 | Una línea |
  | 1280 | 252 × 40 | Dos líneas |
  | 1024 expandida | 252 × 40 | Dos líneas («Borradores de / facturas») y «Nueva factu…» cortado |
  | 1024 colapsada | 297 × 20 | Una línea |
  | 768 | 0 × 60 | Tres líneas encima de «FA Ferretería Andi…» |

- **Capturas:**
  - `nueva-factura-vacia-1024-claro.png`: la miga «Nueva factu…» toca la ficha «FA».
  - `borrador-listo-768-claro.png`: «Borradores / d FA / facturas» se lee como un solo texto
    roto.
  - `empresa-configurada-768-claro.png`: «Configuración» y «Ferretería Andina» superpuestos, el
    peor caso.
- **Causa:** el contexto de la empresa (144 px), la búsqueda, el indicador, el tema (106 px) y la
  cuenta no encogen. Las migas toman lo que sobra, que a 768 px es cero.

**A2 (V3). La barra es una fila plana.**

- **Medidas:** ocho piezas con el mismo hueco de 8 px (`gaps` 8 × 7 en todas las capturas de
  escritorio). Nada separa la navegación del contexto ni de las acciones de la cuenta.
- **Tema:** el control de tema mide 106 × 38 px, frente a 32 × 32 px de los demás botones. Es la
  pieza más grande de la barra para una preferencia que se toca una vez.
- **Captura a 200 %:** en `borrador-listo-1440z200-claro.png`, sus tres botones miden 142 de los
  720 px de la barra, un quinto.

**A3 (V3). Migas y enlace «volver» repetidos.**

- **Escritorio:** las migas están en la barra, y la página repite el destino con
  «← Borradores de facturas» encima del título (`nueva-factura-vacia-1440-claro.png`).
- **Teléfono y 200 %:** las migas bajan a la página y, debajo, sigue el enlace «volver». Son dos
  filas seguidas con el mismo destino (`nueva-factura-vacia-390-claro.png`,
  `borrador-listo-1440z200-claro.png`).
- **Editor heredado:** la nota de crédito repite el mismo patrón (`nota-credito-lista-390-claro.png`).

**A4 (V3). El título salta.** La y del `h1`, medida en la geometría:

| Pantalla | Pruebas, escritorio | Producción, escritorio | Teléfono |
| --- | --- | --- | --- |
| Facturas | 101 | 72 | 129 |
| Productos | 103 | — | 133 |
| Empresa | 101 | — | 165 |
| Editores | 129 | 100 | 193 |

- **Enlace «volver»:** baja el título de los editores 28 px respecto a las listas.
- **Franja de Pruebas:** mide 29 px y mueve toda la página entre Pruebas y Producción.
- **Teléfono:** las migas de la página añaden otros 36 px en Empresa y en los editores.

**A5 (V2).** En los editores, la barra lateral marca «Borradores de facturas»
(`nueva-factura-vacia-1440-claro.png`). La especificación pide Facturas.

**A6 (V3). Sin anchos de contenido comunes.** A 1440 px:

- Empresa ocupa 768 px a la izquierda y deja vacío el resto (`empresa-configurada-1440-claro.png`);
- el editor ocupa 1136 px: 792 de formulario y 320 de resumen (`borrador-listo-1440-claro.png`);
- Facturas y Productos llenan todo el ancho.

Nada en la composición dice qué clase de pantalla es cada una.

## B. Ambiente

**B1 (V3). Doble aviso en Pruebas.**

- **Qué se ve:** el indicador «Pruebas» de la barra (80 × 20 px) y, debajo, la franja de ancho
  completo «Ambiente de Pruebas: los comprobantes no tienen validez tributaria» (29 px).
- **Dónde:** en todas las pantallas, también en las de solo lectura (`facturas-poblada-1440-claro.png`,
  `productos-poblada-1440-claro.png`, `empresa-configurada-1440-claro.png`).
- **Efecto:** la franja es la primera línea de cada pantalla. En el uso diario se deja de leer
  justo donde no hace falta, y no está donde se decide emitir.

**B2 (V3). No hay aviso de Pruebas en la emisión.**

- **Editor:** junto a «Emitir factura» no hay nada (`borrador-listo-1440-claro.png`).
- **Confirmación de la factura:** dice «Ambiente Pruebas» como un dato más, sin la consecuencia
  de que no tendrá validez tributaria (`borrador-confirmacion-1440-claro.png`,
  `borrador-confirmacion-390-claro.png`).
- **Nota de crédito:** igual, junto a su «Emitir» y en su confirmación
  (`nota-credito-lista-1440-claro.png`, `nota-credito-confirmacion-1440-claro.png`).
- **Consumidor final:** su advertencia sí aparece en la confirmación
  (`borrador-consumidor-final-confirmacion-1440-claro.png`).

**B3 (V3). Ambiente sin confirmar.**

- **Barra:** no hay indicador de ambiente; solo «No pudimos confirmar la empresa», con un icono de
  advertencia.
- **Franja:** dice «Ambiente desconocido…» (`facturas-ambiente-desconocido-1440-claro.png`).
- **Teléfono:** el texto de la empresa se corta en «No pudimos confirmar la em…»
  (`facturas-ambiente-desconocido-390-claro.png`).

**B4 (V2). Producción, en negro.** El indicador «Producción» es una pastilla negra, la pieza de
más peso de la barra (`facturas-produccion-1440-claro.png`, `borrador-produccion-1440-claro.png`).
La especificación lo quiere como contexto.

## C. Editor de facturas

**C1 (V3). Jerarquía de acciones invertida.**

- **Factura nueva:** «Emitir factura» es el botón primario aunque no se puede usar. Deshabilitado
  conserva el azul con opacidad 0,5 y se lee como un primario claro, no como no disponible.
  «Guardar borrador», la única acción válida, es un `outline` debajo
  (`nueva-factura-vacia-1440-claro.png`: Emitir en y = 319, `disabled`, opacidad 0,5; Guardar en
  y = 391).
- **Otros estados:** con cambios sin guardar y con problemas pasa lo mismo
  (`borrador-cambios-sin-guardar-1440-claro.png`, `borrador-problemas-1440-claro.png`).
- **Motivo:** la ayuda bajo el botón («Guarda el borrador para emitirlo.») es de 12 px y gris.

**C2 (V4). A 1024 px con la barra expandida, el resumen estrecha el formulario.**

- **Medidas:** el formulario queda en 376 px y el resumen ocupa 320 px.
  - La forma de pago mide 160 px y se lee «SIN UTILIZACION I…».
  - Cantidad y descuento miden 111 px.
  - «Cambiar comprador» baja a otra línea.
- **Capturas:** `borrador-listo-1024-claro.png` y `nueva-factura-vacia-1024-claro.png`.
- **A 768 px:** el resumen pasa debajo y la forma de pago sigue cortada («SIN UTILIZACION DEL
  SISTEMA»), por la columna fija del importe y la papelera (`borrador-listo-768-claro.png`).

**C3 (V3). Fila de pago desalineada.**

- **Alineación:** a 1440 px, «Importe» está 20 px más arriba que «Forma de pago 1» (etiquetas en
  y = 819 y 839), porque la ayuda bajo el importe empuja la fila con `items-end`
  (`borrador-listo-1440-claro.png`).
- **Ayuda:** «Vacío: el total» no dice qué pasa si se deja vacío.
- **Papelera:** flota a la derecha, sin nombre visible. A 390 px queda sola en su propia línea,
  debajo de la ayuda (`nueva-factura-vacia-390-claro.png`).

**C4 (V3). Cambios sin guardar.**

- **Indicador:** al cambiar una cantidad no aparece ninguno.
- **Resumen:** pierde los totales y vuelve al texto de una factura nueva («Guarda el borrador para
  calcular los totales…», `borrador-cambios-sin-guardar-1440-claro.png`). El operador no ve los
  últimos totales del servidor ni que son del último guardado (PO-2).

**C5 (V3). El problema del comprador solo se lee en el resumen.**

- **Comprador:** «El comprador Comercial Andina S.A. no tiene el rol de cliente» aparece bajo
  «Antes de emitir», a 800 px del comprador.
- **Formas de pago:** el problema sí va junto a ellas (`borrador-problemas-1440-claro.png`).
- **Línea:** el error de la línea 2 sí marca su tarjeta (`borrador-sin-totales-1440-claro.png`).

**C6 (V3). Líneas como tarjetas apiladas.**

- **Escritorio:** cada línea es una tarjeta de 128 px con sus propias etiquetas, sin encabezados
  de columna: cada línea repite «Cantidad / Precio unitario / Descuento».
- **Teléfono:** cantidad, precio y descuento van en columna, y cada línea mide unos 300 px
  (`borrador-ambiente-desconocido-390-claro.png`).

**C7 (V3). En un teléfono, las acciones solo están al final.** «Emitir factura» está en y = 1777
de un documento de 1897 px: con una ventana de 844 px, hay que desplazarse unos 980 px desde
arriba para guardar o emitir (`borrador-listo-390-claro.png`).

**C8 (V2). Mensajes del resumen.**

- **Borrador incompleto:** sin líneas, el resumen dice «Los totales aparecen cuando todas las
  líneas se pueden calcular» (`borrador-incompleto-1440-claro.png`).
- **Comprador y punto:** el punto de emisión ocupa 792 px para un valor de 30 caracteres, junto a
  un comprador presentado como una caja con botón. Las dos piezas no comparten estructura.

**C9 (V2). Decimales con dos formatos.** Los campos muestran «4.5», «1.25» y «0.00», y los
importes, «USD 8,75». El diálogo de producto pide «punto decimal… por ejemplo 8.75». No es de este
cambio: se registra para la deuda técnica.

## D. Selección, deshabilitado y tema oscuro

**D1 (V3). Cuatro azules compiten en Productos.**

- **Qué se ve:** «Todo estado tributario», «Activos» y «Bienes y servicios», las opciones por
  defecto, en azul primario relleno, al lado de «Nuevo producto»
  (`productos-poblada-1440-claro.png`).
- **Oscuro:** pasa lo mismo en `productos-poblada-390-oscuro.png`.
- **Referencia:** Facturas ya usa la selección neutra («Todas»), y la diferencia se nota al ir de
  una lista a otra.

**D2 (V2). Controles segmentados con relleno primario:**

- «Bien» en el diálogo de producto (`productos-dialogo-nuevo-1440-claro.png`);
- «Sí» en Empresa (`empresa-configurada-1440-claro.png`);
- «Devolución» en la nota de crédito (`nota-credito-lista-1440-claro.png`).

**D3 (V2). En oscuro, los `outline` tienen relleno gris.** «Guardar borrador», «Cambiar comprador»
y «Agregar producto» se leen como botones rellenos (`borrador-listo-390-oscuro.png`,
`borrador-listo-1440-oscuro.png`).

## E. Listas heredadas

**E1 (V3). Productos a 1024 px.** La tabla lleva el nombre a cuatro líneas y parte los códigos
(«CEM-/50», `productos-poblada-1024-claro.png`). La geometría registra un contenedor con
desplazamiento horizontal a 1024 y 768 px. No es de este cambio, que en Productos solo toca la
selección. Se registra para la deuda técnica.

## Por anchura y tema

| Anchura | Qué domina |
| --- | --- |
| 1440 | Composición correcta en general. Doble aviso de Pruebas (B1), acciones invertidas (C1), fila de pago desalineada (C3) |
| 1280 | Migas en dos líneas (A1). El formulario del editor mide 632 px y la forma de pago, 416 px: legible |
| 1024 expandida | Migas en dos líneas y cortadas (A1), y formulario estrechado por el resumen (C2): la peor anchura del editor |
| 1024 colapsada | Migas en una línea; el formulario sube a 584 px y la forma de pago a 368 px, legible |
| 768 | Migas montadas sobre la empresa (A1); forma de pago cortada (C2) |
| 390 | Migas y «volver» duplicados (A3); papelera suelta (C3); líneas de unos 300 px (C6); acciones al final (C7) |
| 200 % | Igual que 390, con el control de tema enorme en la barra (A2) |
| Oscuro | Mismos hallazgos, con los `outline` rellenos (D3) y los azules de la selección más visibles (D1) |

## Carga del «antes»

`test:visual:bundle` con la nueva factura añadida, sobre el mismo build. Datos en
`docs/quality/benchmarks/frontend-editor-2026-10-15.json`; bytes transferidos y decodificados:

| Pantalla | JS | CSS | Fuente |
| --- | --- | --- | --- |
| Inicio de sesión | 16 archivos, 347941 / 1257134 | 13215 / 72213 | 69652 |
| Inicio | 19 archivos, 371685 / 1336446 | 13215 / 72213 | 69652 |
| Facturas | 20 archivos, 395622 / 1421073 | 13215 / 72213 | 69652 |
| Nueva factura | 20 archivos, 386285 / 1381488 | 13215 / 72213 | 69652 |

La nueva factura pide `/me`, `/company/status`, `/signing-certificate/validity`, `/establishments`,
`/me/default-emission-point` y `/fiscal-catalogs/payment-method/entries`.

## Qué tendrá que mostrar el «después»

- A1 y C2 cerrados a todas las anchuras de la matriz, medidos en la geometría:
  - migas fuera de la barra, en una sola fila y un solo lugar;
  - el formulario sin valores cortados a 1024 px con la barra expandida.
- La y del título igual entre listas, editores y ambientes, sin franja de Pruebas.
- El aviso de Pruebas junto a «Emitir» y en la confirmación, en la factura y en la nota de crédito.
- La acción principal que corresponde a cada estado, y deshabilitados que se lean como tales.
- Selecciones neutras, y `outline` transparentes en oscuro.
