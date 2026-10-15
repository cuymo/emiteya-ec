# Revisión visual «después»

Se escribe por grupos, a medida que cada grupo con impacto visual se mira en la app renderizada
(D19). Compara con `review-antes.md`, cuyos identificadores (A1, C2…) se citan aquí. La valoración
final, sobre la matriz completa, va al final (tarea 8.1).

Las rutas de las capturas son relativas a `frontend/.review/visual/<etiqueta>/`, ignorada por git.
Todas las capturas salen del harness determinista: sin backend, sin guardar ni emitir y sin ningún
contacto con el SRI.

## Grupo 2: jerarquía de acciones y anchos del sistema

- **Captura:** `REVIEW_LABEL=grupo-2 REVIEW_COMPARE_WITH=antes`, 86/86 con código 0, sobre
  `c149e43` con los cambios del grupo.
- **Qué se miró:**
  - `contact-sheets/compare-antes-listas.png` y `compare-antes-editor.png`;
  - a tamaño real, las capturas citadas abajo;
  - los colores de los botones en la geometría.
- **`test:visual`:** 78 de 80 en verde. Las dos que cambian son Configuración › Ambiente
  (`shell-config-route.png` y `shell-short-height.png`), y se miraron frente a la versión
  anterior: solo cambia «Cambiar a Producción», que deja de ser un primario lavado y se lee
  deshabilitado, con el motivo debajo. Es el escenario «Acción no disponible». Se actualizaron solo
  esas dos.

### Resuelto

- **D1, selección neutra en las listas.**
  - En `productos-poblada-1440-claro.png`, «Todo estado tributario», «Activos» y «Bienes y
    servicios» se ven elegidos por el borde oscuro, la superficie gris y el peso medio.
  - «Nuevo producto» es el único azul de la pantalla.
  - En oscuro (`productos-poblada-390-oscuro.png`) igual.
- **D2, controles segmentados.** «Bien» en el diálogo de producto
  (`productos-dialogo-nuevo-1440-claro.png`), «Sí» en Empresa y «Devolución» en la nota de crédito
  son una pieza blanca elevada con borde, dentro de una pista gris. Se distinguen sin el azul.
- **D3, `outline` en oscuro.** «Guardar borrador», «Cambiar comprador» y «Agregar producto» vuelven
  a leerse como secundarios (`borrador-listo-390-oscuro.png`). El fondo medido pasa de
  `oklab(0.55 … / 0.3)` a transparente.
- **Deshabilitado neutro** (parte de C1).
  - En `nueva-factura-vacia-1440-claro.png`, «Emitir factura» deshabilitado pasa de azul con
    opacidad 0,5 a la superficie `muted` (lab 96,5) con texto gris (lab 42) y opacidad 1. Ya no
    parece una acción disponible.
  - El «Emitir nota de crédito» deshabilitado de la confirmación igual
    (`nota-credito-confirmacion-1440-claro.png`), con «Marca las dos declaraciones para emitir»
    debajo.

### Sin cambios, como se esperaba

Facturas queda igual a todas las anchuras en la hoja comparativa: ya usaba la selección neutra.

### Lo que sigue y por qué

- **C1, la mitad que falta.** En la factura nueva ya no hay un primario falso, pero tampoco una
  acción principal: «Guardar borrador» sigue siendo `outline`. La jerarquía de guardar y emitir
  según el estado es la tarea 6.2.
- **Pendientes de los grupos 3 a 6:** A1 a A6, B1 a B4, C2 a C8.
- **Fuera de este cambio:** C9 y E1, que se registran en la deuda técnica (8.4).
- **Estados vacíos (D11):** las cinco listas no están en la matriz. Lo comprueban las pruebas de
  cada pantalla: una sola principal en el encabezado y el vacío en `outline`.

### Observado y aceptado

El chip elegido pasa a peso medio y crece unos 2 px, así que los chips siguientes se mueven al
cambiar de filtro. Es el coste de que la elección se reconozca por el peso (D10), y no tapa ni
corta nada.

## Grupo 3: barra superior, ambiente compacto y una sola orientación

- **Captura:** `REVIEW_LABEL=grupo-3 REVIEW_COMPARE_WITH=antes`, 89/89 con código 0 (87 capturas),
  sobre `db3ba9a` con los cambios del grupo. La matriz suma el estado de D18 que faltaba: la
  explicación del indicador abierta (`facturas-indicador-pruebas-*`).
- **Qué se miró:**
  - `contact-sheets/compare-antes-shell.png`, `compare-antes-editor.png` y
    `compare-antes-configuracion.png`;
  - a tamaño real, las capturas citadas abajo;
  - la barra, las migas y la y del título de las 87 capturas, en la geometría.
- **`test:visual`:** cambian 23 de las 26 capturas, todas por la barra nueva y la franja retirada.
  Se miraron frente a las anteriores (`shell-tablet`, `shell-desktop-light`, `shell-mobile`,
  `shell-production-operator`, `shell-config-route`, `shell-desktop-dark` y Facturas), y las tres
  que antes no llegaban a capturarse (paleta, panel móvil y creación rápida) se miraron después de
  generarlas. Quedan 80 de 80 en verde.

### Resuelto

- **A1 (V4), la barra superior.**
  - A todas las anchuras de la matriz, cada pieza de la barra mide una sola línea: 32 px de alto en
    escritorio y 44 en móvil.
  - Las migas ya no están en la barra: ninguna captura las mide dentro de la cabecera.
  - En `empresa-configurada-768-claro.png`, donde antes «Configuración» se montaba sobre
    «Ferretería Andina», la barra se lee limpia y la ruta «Configuración › Empresa» va encima del
    título.
- **A2 (V3), barra plana.**
  - Tres zonas con 16 px entre ellas: navegación y empresa, la paleta centrada, y ambiente y
    cuenta.
  - El control de tema de 106 × 38 px desaparece de la barra: vive en el menú de cuenta a todas las
    anchuras.
  - A 200 % (`nueva-factura-vacia-1440z200-claro.png`), la barra queda en tres piezas de 44 px.
- **A3 (V3), orientación repetida.** Una sola fila de migas encima del título, a todas las
  anchuras, y ningún enlace «volver»: se retiraron de los editores y los detalles. En móvil ya no
  hay dos filas con el mismo destino (`borrador-listo-390-claro.png`).
- **A4 (V3), el título que salta.**
  - La y del título ya no cambia con el ambiente: 72 en Facturas en Pruebas y en Producción, antes
    101 y 72.
  - En las pantallas internas es 100 a todas las anchuras de escritorio (antes 129 en los editores
    y 101 en Empresa), y 108 en móvil (antes 193 y 165).
  - Queda una deriva de 2 px entre Facturas (72) y Productos (74), que corrige el ritmo del
    `PageHeader` (tarea 4.1).
- **A5 (V2).** El editor de facturas marca Facturas en la barra lateral, con las migas
  «Facturas › Nueva factura» y «Facturas › Borrador de factura»
  (`borrador-ambiente-desconocido-1440-claro.png`).
- **B1 (V3), doble aviso.** Ya no hay franja de ancho completo. «Pruebas» sigue en la barra, a
  todas las anchuras, y su explicación se abre con el tacto, el ratón y el teclado
  (`facturas-indicador-pruebas-1440-claro.png` y `-390-claro.png`): sin validez tributaria, y que
  un administrador cambia el ambiente en Configuración › Ambiente.
- **B2 (V3), en el editor heredado.**
  - La nota de crédito dice «Pruebas · esta nota de crédito no tendrá validez tributaria» junto a
    «Emitir» y otra vez en la confirmación (`nota-credito-confirmacion-1440-claro.png`).
  - Los otros cuatro editores heredados lo hacen igual; lo comprueban sus pruebas, porque no están
    en la matriz.
  - El editor de facturas lo recibe en el grupo 6.
- **B3 (V3), ambiente sin confirmar.**
  - La barra muestra «Sin confirmar» con advertencia, junto a la cuenta, y nunca
    «Producción» (`borrador-ambiente-desconocido-1440-claro.png`).
  - El aviso ya no desaparece mientras se reintenta la consulta. Lo descubrió la prueba del editor:
    React Query la devolvía a «pendiente» al reintentar.

### Lo que sigue y por qué

- **B4 (V2), Producción en negro.** Se mantiene la variante `emphasis`, como fija D21: Producción
  es el ambiente de más consecuencia, y el indicador es neutro y de alta atención, nunca de éxito.
  En la barra de tres zonas queda en su zona, junto a la cuenta, y ya no compite con las migas.
- **C2 (V4), el formulario a 1024 px.** El formulario sigue en 376 px con la barra expandida: lo
  resuelven `FormLayout` y el editor (grupos 5 y 6).
- **Pendientes de los grupos 4 a 6:** A6, C1 (la mitad que falta), C3 a C8.

### Observado y aceptado

- En el ambiente sin confirmar, la barra lleva dos advertencias: «No pudimos confirmar la empresa»,
  recortado a su ancho máximo, y «Sin confirmar». Son dos hechos distintos, la empresa y el ambiente, y cada uno lleva su
  texto.
- En la confirmación de la nota de crédito, el aviso de Pruebas y el de las declaraciones son dos
  recuadros de advertencia seguidos. Se distinguen por su texto y su orden: primero el ambiente,
  después las declaraciones.

## Grupo 4: gramática de `PageHeader`

- **Captura:** `REVIEW_LABEL=grupo-4 REVIEW_COMPARE_WITH=grupo-3`, 91/91 con código 0, sobre
  `105dcf5` con los cambios del grupo. La matriz suma Facturas sin acceso
  (`facturas-sin-acceso-*`), el estado en que el encabezado no lleva acción.
- **Qué se miró:** la y del título en la geometría y, en `test:visual`, la imagen de diferencias de
  `facturas-desktop-light`.
- **`test:visual`:** cambian las 13 capturas que muestran Facturas, y en todas solo baja el contenido
  unos píxeles por debajo del encabezado. La barra superior y la navegación no cambian. Se
  actualizaron esas 13.

### Resuelto

- **A4, la deriva del título.**
  - El bloque del título mide al menos 40 px, la altura del botón, así que el título cae en la misma
    y haya acción o no: 74 px en `facturas-poblada-1440-claro` y en `facturas-sin-acceso-1440-claro`,
    y 82 px a 390 px en los dos.
  - Facturas y Productos quedan en la misma y (74 px). Antes, a 72 y 74.

### Lo que sigue

- **Variante de editor:** la adopta el editor de facturas en la tarea 6.1. Hasta entonces el editor
  pinta sus migas con el mismo componente (`AppBreadcrumbs`), así que su aspecto no cambia en este
  grupo.
- **Variante de configuración:** queda escrita en `interface-design.md` para la migración de esas
  pantallas, sin consumidor en este cambio.

## Grupos 5 y 6: primitivos de formulario y editor de facturas

Los primitivos del grupo 5 no tienen consumidor hasta el editor, así que se miran juntos.

- **Captura:** `REVIEW_LABEL=grupo-6 REVIEW_COMPARE_WITH=antes`, 94/94 con código 0, sobre `64be384`
  con los cambios del grupo 6. Se capturó dos veces: la primera destapó un defecto (abajo), se
  corrigió y la etiqueta se repitió entera.
- **Matriz:** suma `borrador-barra-acciones-*`, la ventana real a media página con la barra de
  acciones fija. La captura de página entera dibuja esa barra donde estaba la ventana, en mitad del
  documento.
- **Qué se miró:** el editor en sus estados y anchuras (listo, con problemas, con cambios, sin
  totales, incompleto, nuevo y con datos, confirmación, Producción, ambiente sin confirmar, oscuro y
  200 %), la geometría de los formularios y `compare-antes-editor.png`.
- **`test:visual`:** 80 de 80 en verde, sin cambiar capturas. Una prueba de comportamiento buscaba
  la barra superior con `locator("header")`, que ahora también encuentra el encabezado del editor.
  Se cambió por el `banner`, que solo es la barra superior.

### Defecto encontrado y corregido

En la primera captura, con el resumen apilado, la barra fija sumaba el aviso de Pruebas en dos
líneas, los botones y el motivo: unos 125 px a 1024 px, más en el teléfono, y una cuarta parte de la
ventana a 200 %. Se compactó:

- el aviso en texto pequeño cuando la barra está apilada;
- 8 px de relleno vertical;
- la reserva de alto para el foco, a 10rem.

Ahora el aviso cabe en una línea a 390 px, y la barra mide unos 112 px a 1024 y a 390, y unos 97 px
a 200 % (`borrador-barra-acciones-390-claro.png`, `-1024-claro.png`, `-1440z200-claro.png`).

### Resuelto

- **C2 (V4), el formulario a 1024 px.**
  - Formulario y panel por contenedor, medidos: 824 y 288 px al lado a 1440, 664 a 1280 y 616 a 1024
    con la barra colapsada. Apilado: 720 a 1024 con la barra expandida, 464 a 768 y 358 a 390.
  - A 1024 con la barra expandida, la forma de pago mide 500 px y se lee entera
    (`borrador-listo-1024-claro.png`; antes, 160 px y «SIN UTILIZACION I…»).
  - Ninguna captura se desplaza a lo ancho.
- **C3 (V3), la fila de pago.**
  - «Forma de pago» e «Importe» comparten la y a 1440, 1280, 1024 y 200 % (665 y 665 a 1440;
    antes, 839 y 819), aunque solo el importe lleve ayuda.
  - La ayuda dice «Déjalo vacío para usar el total de la factura».
  - «Quitar» está en la fila del importe y dentro del grupo «Forma de pago N», también en el
    teléfono (`borrador-listo-390-claro.png`).
- **C1, la mitad que faltaba.**
  - Factura nueva y con cambios: «Guardar borrador» es la principal y «Emitir factura» se lee no
    disponible, con su motivo debajo (`nueva-factura-vacia-1440-claro.png`,
    `borrador-cambios-sin-guardar-1440-claro.png`).
  - Listo: «Emitir factura» es la principal y «Guardar borrador», la secundaria.
  - Con problemas: ninguna se destaca (`borrador-problemas-1440-claro.png`).
- **C4 (V3), cambios sin guardar.** «Cambios sin guardar» junto al título y en el resumen. Los
  totales se rotulan «Totales del último guardado», atenuados, con «Guarda para recalcularlos», y la
  base imponible de cada línea pasa a «—».
- **C5 (V3).** El problema del comprador va junto a él: borde rojo y el texto bajo su
  identificación. No se repite en «Antes de emitir».
- **C6 (V3), las líneas.**
  - Una tabla con encabezados (producto, cantidad, precio unitario, descuento, base imponible y
    quitar) desde 40rem de contenedor.
  - Por debajo, dos filas por línea: la identidad con su base, y la cantidad, el precio y el
    descuento.
  - A 1440, cada línea mide unos 65 px (antes, una tarjeta de 128 px).
- **C7 (V3), las acciones en un teléfono.** Están en la barra fija al pie, a la vista en cualquier
  punto del desplazamiento (`borrador-barra-acciones-390-claro.png`). Antes había que bajar unos
  980 px.
- **C8 (V2).** El borrador sin líneas dice «Los totales aparecen cuando el borrador tiene
  productos» (`borrador-incompleto-1440-claro.png`).
- **B2, en el editor de facturas.** «Pruebas · esta factura no tendrá validez tributaria» va encima
  de las acciones y en la confirmación (`borrador-confirmacion-1440-claro.png`). Con el ambiente sin
  confirmar lo dice, y en Producción no aparece.
- **A6, en el editor.** El editor usa el ancho de espacio de trabajo, y su panel de 18rem va al lado
  solo cuando caben 36rem de formulario.

### Lo que sigue y por qué

- **C9 (V2), los decimales.** Los campos siguen mostrando el punto («4.5», «1.25») junto a importes
  con coma. Es el formato del contrato de la API y cambiarlo no es de este cambio; queda en la deuda
  técnica (8.4).
- **El comprador como campo.** Su caja gris se lee como un dato de solo lectura, que es lo que es:
  se elige con «Elegir comprador» o «Cambiar comprador», a su lado.
- **Dos formas de pago** muestran la etiqueta «Forma de pago» dos veces. Cada fila es un grupo con
  su número para las tecnologías de asistencia, y la separación entre filas las distingue a la
  vista.
