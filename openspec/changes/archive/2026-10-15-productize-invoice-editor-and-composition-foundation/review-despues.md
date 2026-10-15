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

## Revisión final: el «después» completo (tarea 8.1)

Misma estructura que `review-antes.md`, sobre la matriz completa.

### Cómo se obtuvo

- **Comando:** `REVIEW_LABEL=despues REVIEW_COMPARE_WITH=antes corepack pnpm --filter
  @facturador/frontend test:visual:review`. Terminó con código 0: 96 capturas, la preparación y las
  hojas.
  - Las cuatro capturas de 320 px se repitieron con `REVIEW_FILTER=320` tras corregir el nombre de
    la empresa (N1, abajo). Las hojas y el manifiesto se rehicieron con toda la carpeta.
- **Carpeta:** `frontend/.review/visual/despues/`, ignorada por git. Las rutas de abajo son
  relativas a ella.
- **Código:** `6636acd` con los cambios del grupo 8. El manifiesto dice `6636acd+cambios`.
- **Datos:** el harness determinista. Sin backend, sin guardar ni emitir y sin ningún contacto con
  el SRI.
- **Matriz:** las 84 capturas del «antes» y 12 más:
  - la explicación del indicador abierta (3, grupo 3);
  - Facturas sin acceso (2, grupo 4);
  - la barra de acciones fija a media página (3, grupo 6);
  - 320 px en Facturas, la factura nueva, el borrador listo y Empresa (4, tarea 8.3).
- **Qué se miró:**
  - las seis hojas comparativas, las largas por tramos: `contact-sheets/compare-antes-shell.png`,
    `compare-antes-editor.png`, `compare-antes-listas.png`, `compare-antes-configuracion.png`,
    `compare-antes-movil.png` y `compare-antes-oscuro.png`;
  - a tamaño real, cada captura citada en esta sección;
  - la geometría de las 96 capturas, de donde salen todas las medidas. Ninguna tiene problemas
    registrados ni desborde horizontal de la página.

### Resumen

| Id | Sev. antes | Estado | Evidencia y medida |
| --- | --- | --- | --- |
| A1 | V4 | Cerrado | Migas fuera de la barra en las 96 capturas; cada pieza de la barra, de una línea (`empresa-configurada-768-claro.png`) |
| A2 | V3 | Cerrado | Tres zonas con huecos de 16 px; antes, ocho piezas con huecos de 8 y el tema de 106 × 38 px |
| A3 | V3 | Cerrado | Una fila de migas encima del título y ningún enlace «volver» (`borrador-listo-390-claro.png`) |
| A4 | V3 | Cerrado | La y del título ya no depende del ambiente; ver la tabla del encabezado |
| A5 | V2 | Cerrado | El editor marca Facturas en la barra lateral (`compare-antes-editor.png`) |
| A6 | V3 | Cerrado en el editor | Tokens `max-w-reading` y `max-w-form`, y el editor a ancho de espacio de trabajo. Empresa sigue con su ancho heredado: deuda de las pantallas no migradas |
| B1 | V3 | Cerrado | Sin franja; «Pruebas» en la barra a todas las anchuras (`compare-antes-shell.png`) |
| B2 | V3 | Cerrado | Aviso junto a «Emitir» y en la confirmación, en la factura y en la nota de crédito (`borrador-confirmacion-1440-claro.png`, `nota-credito-confirmacion-1440-claro.png`) |
| B3 | V3 | Cerrado | «Sin confirmar» en la barra (`facturas-ambiente-desconocido-1440-claro.png`) |
| B4 | V2 | Se mantiene por D21 | Producción en `emphasis`, en su zona junto a la cuenta (`facturas-produccion-1440-claro.png`) |
| C1 | V3 | Cerrado | Una principal por estado y deshabilitados neutros |
| C2 | V4 | Cerrado | A 1024 px con la barra expandida, forma de pago de 500 px (antes 160) |
| C3 | V3 | Cerrado | «Forma de pago» e «Importe» en la misma y a 1440, 1280, 1024 y 200 % |
| C4 | V3 | Cerrado | «Cambios sin guardar» y «Totales del último guardado» (`borrador-cambios-sin-guardar-1440-claro.png`) |
| C5 | V3 | Cerrado | El problema del comprador junto a él (`borrador-problemas-1440-claro.png`) |
| C6 | V3 | Cerrado | Líneas en tabla con encabezados, unos 65 px por línea a 1440 (antes 128) |
| C7 | V3 | Cerrado | Acciones en la barra fija al pie (`borrador-barra-acciones-390-claro.png`) |
| C8 | V2 | Cerrado | «Los totales aparecen cuando el borrador tiene productos» (`borrador-incompleto-1440-claro.png`) |
| C9 | V2 | Deuda técnica | Decimales con punto en los campos; el contrato de la API no cambia en este cambio |
| D1 | V3 | Cerrado | Selección neutra (`productos-poblada-1440-claro.png`) |
| D2 | V2 | Cerrado | Segmentados con la pieza elevada (`productos-dialogo-nuevo-1440-claro.png`) |
| D3 | V2 | Cerrado | `outline` transparentes en oscuro (`borrador-listo-390-oscuro.png`, `compare-antes-oscuro.png`) |
| E1 | V3 | Deuda técnica | Productos a 1024 px, fuera del alcance (`productos-poblada-1024-claro.png`) |
| N1 | V2 | Corregido en el grupo 8 | A 320 px el nombre de la empresa quedaba en un trazo («F»); ahora se lee «Ferr…» |
| N2 | V2 | Corregido en el grupo 8 | A 320 px el editor desbordaba 18 px por el nombre del comprador; ahora 0 |

Ningún V4 ni V5 abierto, y ningún V3 nuevo. Los dos hallazgos nuevos (N1 y N2) son V2 de la anchura de
320 px, que el «antes» no capturaba, y se corrigieron.

### Barra superior, medida

| Anchura | Antes: migas en la barra (ancho × alto) | Antes: piezas | Después: piezas (alto) y huecos | Después: migas |
| --- | --- | --- | --- | --- |
| 1440 | 297 × 20 | 8, huecos de 8 | 3 zonas de 32 px, huecos de 16 | Encima del título, y = 72, 20 px de alto |
| 1280 | 252 × 40, dos líneas | 8, huecos de 8 | 3 zonas de 32 px, huecos de 16 | Igual |
| 1024 expandida | 252 × 40, dos líneas | 8, huecos de 8 | 3 zonas de 32 px, huecos de 16 | Igual |
| 1024 colapsada | 297 × 20 | 8, huecos de 8 | 3 zonas de 32 px, huecos de 16 | Igual |
| 768 | 0 × 60, sobre la empresa | 8, huecos de 8 | 3 zonas de 32 px, huecos de 16 | Igual |
| 390 | En la página, y = 129 | 5, huecos de 8 | 3 zonas de 44 px, huecos de 16 | En la página, y = 80 |
| 320 | Sin captura | — | 3 zonas de 44 px, huecos de 16; empresa «Ferr…» | En la página, y = 80 |
| 200 % | En la página, y = 109 | 6, con el tema de 50 px de alto | 3 zonas de 44 px, huecos de 16 | En la página, y = 80 |

- `compare-antes-shell.png`: la barra se lee igual en Pruebas, en Producción y sin confirmar; solo
  cambia el indicador de la zona derecha.
- `empresa-configurada-768-claro.png`, el peor caso del «antes»: la barra queda limpia y la ruta
  «Configuración › Empresa» va encima del título.

### Encabezado: la y del título

| Pantalla | Antes: Pruebas, escritorio | Antes: Producción, escritorio | Antes: teléfono | Después: escritorio, cualquier ambiente | Después: teléfono |
| --- | --- | --- | --- | --- | --- |
| Facturas | 101 | 72 | 129 | 74 | 82 |
| Productos | 103 | — | 133 | 74 | 84 |
| Empresa | 101 | — | 165 | 100 | 108 |
| Editor de facturas | 129 | 100 | 193 | 102 | 108 (borrador) y 110 (nueva) |
| Nota de crédito | 129 | — | 193 | 100 | 108 |

- **Listas:** 74 en Pruebas, en Producción y sin acceso. El área de contenido empieza en 72, y el
  `PageHeader` centra el título en su bloque de 40 px.
- **Pantallas internas:** las migas (y = 72, 20 px) y 8 px de separación ponen el título en 100. El
  editor, en su `PageHeader`, suma los mismos 2 px de centrado que las listas: 102.
- **Diferencias de 2 a 4 px, V1:** entre el editor y las pantallas heredadas, y en el teléfono
  entre Facturas y Productos (acción debajo o al lado del título) o entre un título de una línea y
  uno de dos. Desaparecen cuando cada pantalla migra al `PageHeader`.

### Fila de pago

| Anchura | Antes: y de «Forma de pago 1» / «Importe» | Antes: forma de pago | Después: y de «Forma de pago» / «Importe» | Después: forma de pago |
| --- | --- | --- | --- | --- |
| 1440 | 839 / 819 | 576 px | 665 / 665 | 604 px |
| 1280 | 839 / 819 | 416 px | 713 / 713 | 444 px |
| 1024 expandida | 887 / 867 | 160 px, «SIN UTILIZACION I…» | 689 / 689 | 500 px |
| 1024 colapsada | 839 / 819 | 368 px | 896 / 896 | 396 px |
| 768 | 839 / 819 | 248 px, cortado | 896 / 972, apiladas por su contenedor | 464 px, la fila entera |
| 390 | 1263 / 1339, papelera suelta debajo | 358 px | 980 / 1060, «Quitar» en la fila del importe | 358 px, recorta el nombre |
| 320 | Sin captura | — | 1116 / 1196 | 288 px, recorta el nombre |
| 200 % | 907 / 887 | 468 px | 741 / 741 | 468 px |

- Con la fila en columnas, las etiquetas comparten la y aunque solo el importe lleve ayuda: la
  `subgrid` reserva la fila del mensaje (`borrador-listo-1440-claro.png`).
- Por debajo de 32rem de contenedor, la fila se apila y el importe conserva su «Quitar» al lado.
- A 390 px y menos, el `select` nativo recorta «SIN UTILIZACION DEL SISTEMA FINANCIER…». La lista de
  opciones y el nombre accesible lo dicen entero; queda en la deuda técnica.

### Hallazgos nuevos del «después»

**N1 (V2, corregido). El nombre de la empresa a 320 px.**

- **Qué se vio:** en `facturas-poblada-320-claro.png`, la zona izquierda medía 88 px. El botón de
  navegación, la ficha «FA» y los huecos dejaban al nombre 3,5 px, que se leían como una «F» cortada
  sin elipsis.
- **Corrección:** la zona izquierda es un contenedor en el teléfono, y por debajo de 8rem
  (`--container-topbar-company`) la ficha cede su sitio al nombre. El nombre completo sigue en
  `title` y en el nombre accesible, y a 390 px la ficha sigue ahí.
- **Después:** «Ferr…» en las cuatro capturas de 320 px. `editor.spec.ts` comprueba que el nombre
  mide al menos 28 px a 320, 390, 768, 1024 y 1280.

**N2 (V2, corregido). El editor desbordaba 18 px a 320 px.** La rejilla del comprador y el punto
tomaba el ancho mínimo del nombre del comprador. Las filas de campos tienen ahora una columna
`minmax(0, 1fr)` por defecto, y el nombre se recorta (`borrador-listo-320-claro.png`).

### Observado y aceptado

- **Facturas a 320 px:** la tabla se desplaza 59 px dentro de su contenedor, no la página, y el total
  se lee al desplazarla (`facturas-poblada-320-claro.png`). Es lo que admite el diseño de Facturas
  (`productize-invoice-list-and-shared-table-foundation`, D15, registrado como S2).
- **Barra de acciones en las capturas de página entera:** se dibuja donde estaba la ventana, en mitad
  del documento (`borrador-problemas-1024-claro.png`, `borrador-listo-320-claro.png`). En la ventana
  real queda al pie (`borrador-barra-acciones-*`).
- **Dos formas de pago** repiten la etiqueta «Forma de pago»: cada fila es un grupo con su número
  para las tecnologías de asistencia.

### Por anchura y tema

| Anchura | Qué domina |
| --- | --- |
| 1440 | Composición en orden: barra en tres zonas, migas encima del título, formulario de 824 px junto al resumen de 288, una principal por estado y el aviso de Pruebas sobre las acciones |
| 1280 | Igual, con el formulario de 664 px y la forma de pago de 444 |
| 1024 expandida | El resumen pasa debajo y el formulario mide 720 px; las acciones van en la barra fija al pie. Antes, la peor anchura del editor |
| 1024 colapsada | Formulario de 616 px junto al resumen |
| 768 | Barra limpia (antes, migas sobre la empresa); formulario de 464 px y fila de pago apilada |
| 390 | Una sola fila de migas; líneas en dos filas; acciones en la barra fija; forma de pago recortada (deuda) |
| 320 | Sin desborde; el nombre de la empresa recortado con elipsis; la tabla de Facturas se desplaza dentro de su contenedor |
| 200 % | Barra en tres piezas de 44 px; la barra de acciones fija mide unos 97 px |
| Oscuro | Los mismos resultados, con los `outline` transparentes, la selección neutra y el aviso de Pruebas legible (`compare-antes-oscuro.png`) |

### Valoración de composición (D19)

- **Orden de atención:** migas, título con su estado, y la sección que toca. En el editor, el ojo
  termina en el resumen y en la acción, que es la decisión de la pantalla.
- **Jerarquía:** una sola principal por pantalla y por estado. «Nueva factura» es el único azul de
  Facturas, y en Productos los filtros elegidos ya no compiten con «Nuevo producto».
- **Densidad:** las líneas pasan de tarjetas de 128 px a filas de unos 65 px con encabezados, y en un
  teléfono de unos 300 a unos 160 px.
- **Alineación:** etiquetas y controles de una fila en la misma y; migas, título y secciones en el
  mismo eje izquierdo.
- **Equilibrio:** el resumen de 288 px solo va al lado cuando caben 36rem de formulario; si no, se
  apila sin estrechar nada.
- **Jerarquía de acciones:** guardar es la principal mientras no se puede emitir, y emitir cuando
  el borrador está listo. Los deshabilitados se leen no disponibles y llevan su motivo debajo.
- **Anchuras:** de 320 a 1440 y a 200 % sin desborde ni texto montado. Queda el `select` recortado a
  390 y menos.
- **Claro y oscuro:** equivalentes. El aviso de Pruebas y el indicador conservan icono y texto en
  los dos.
- **Fatiga diaria:** sin franja en cada pantalla. La advertencia está donde se decide emitir, y el
  indicador de la barra sigue a la vista.
- **Claridad para la primera vez:** las migas dicen dónde se está, el estado del borrador va junto
  al título, y cada acción no disponible dice qué falta.

### Carga del «después»

`test:visual:bundle` sobre el árbol final del grupo 8. Datos en
`docs/quality/benchmarks/frontend-editor-2026-10-15.json`; bytes transferidos y decodificados:

| Pantalla | JS | CSS | Fuente |
| --- | --- | --- | --- |
| Inicio de sesión | 16 archivos, 348491 / 1258933 (+550 / +1799) | 13999 / 77470 (+784 / +5257) | 69652 |
| Inicio | 19 archivos, 374044 / 1344802 (+2359 / +8356) | 13999 / 77470 | 69652 |
| Facturas | 20 archivos, 398134 / 1429842 (+2512 / +8769) | 13999 / 77470 | 69652 |
| Nueva factura | 20 archivos, 391107 / 1397822 (+4822 / +16334) | 13999 / 77470 | 69652 |

Las peticiones a la API son las mismas que antes en las cuatro pantallas, y no entra ninguna
dependencia. Cada diferencia se explica en `frontend-editor-2026-10-15.md`.

### Conclusión frente a D20

- V4 de la barra superior: cerrado a todas las anchuras de la matriz.
- V4 de formularios: cerrado para el editor de facturas.
- Ningún V4 ni V5, y ningún V3 nuevo en la base ni en el editor.
- Abiertos y registrados en `technical-debt.md`: C9, E1, la forma de pago recortada a 390 px y menos,
  y los V3 de las pantallas heredadas no migradas.

## Revisión UX enfocada (tarea 8.2)

### Cómo se hizo

- **Harness:** las 96 capturas de arriba y la interacción real de `editor.spec.ts`: teclado,
  confirmación, ambiente, anchuras y foco junto a la barra fija.
- **Despliegue local de revisión** (`https://emiteya.localhost`):
  - **Reconstruido solo en su frontend,** sobre `6636acd` y los primeros ajustes del grupo 8. La
    corrección N1 es posterior, y solo se comprobó en el harness.
  - **Transmisión:** antes de abrir el navegador se leyó solo `SRI_TRANSMISSION_ENABLED` en el
    contenedor del backend en ejecución, y valía `0`. Se volvió a leer antes de esta sección, con el
    mismo resultado.
  - **Recorrido de solo lectura** a 1440 y 390 px: Facturas, la factura nueva, Borradores, Empresa,
    Productos y la explicación del indicador. El script cortaba cualquier escritura a la API salvo
    el inicio de sesión, y cualquier petición a otro origen. No cortó ninguna: 0 escrituras y 0
    otros orígenes.
  - **Qué mostró:**
    - la empresa del despliegue no tiene datos registrados: la barra dice «Empresa sin datos
      registrados» («Empresa si…» a 390 px);
    - no hay facturas ni borradores, y la factura nueva no tiene un punto de emisión por defecto
      («Elige un punto»);
    - «Pruebas» abre su explicación con el tacto: sin validez tributaria, y que un administrador
      cambia el ambiente en Configuración › Ambiente.
  - Las capturas quedaron fuera del repositorio.

### Personas

| Persona | Puntuación | Por qué |
| --- | --- | --- |
| Operador diario | 4/5 | Las acciones están siempre en el mismo sitio, al lado o en la barra fija, y «Emitir» solo es la principal cuando el borrador está listo. Las líneas se leen como una tabla, el aviso de Pruebas aparece solo al emitir y el estado del borrador va junto al título. Le resta: los totales solo llegan al guardar (`SERVER_TOTAL_PREVIEW_GAP`), los decimales van con punto (C9) y salir por la barra lateral descarta los cambios sin preguntar (`UNSAVED_CHANGES_GAP`) |
| Administrador nuevo | 4/5 | La barra dice qué empresa es, o que todavía no tiene datos, y el indicador explica qué significa Pruebas y dónde se cambia. En el despliegue, la factura nueva le pide elegir un punto, y «Emitir factura» se lee no disponible con «Guarda el borrador para emitirlo». Le resta: Empresa y las demás pantallas de configuración siguen con su composición heredada |
| Usuario ocasional | 4/5 | Las migas dicen dónde está, sin «volver» que dude con ellas. La confirmación repite ambiente, comprador, total, líneas y el aviso de Pruebas, y la ayuda del importe dice qué pasa si lo deja vacío. Le resta: la nota de crédito y los demás editores heredados no tienen todavía la composición del editor de facturas |

El umbral de D20 se cumple: las tres personas puntúan 4/5.

### Aparte: lo que depende del backend o del framework

- **`SERVER_TOTAL_PREVIEW_GAP` (S3, backend).** El servidor solo calcula los totales de un borrador
  guardado. El editor no los calcula en el navegador: dice «Guarda el borrador para obtener los
  totales calculados por el servidor» o muestra los del último guardado, rotulados. Se cierra con una
  evaluación sin persistir en la API.
- **`UNSAVED_CHANGES_GAP`, navegación interna (S3, framework).** El App Router no ofrece un bloqueo
  fiable de la navegación interna. Cerrar o recargar la pestaña sí pide confirmación, y «Cambios sin
  guardar» queda visible.

Los dos están en `technical-debt.md` con su efecto, su paliativo y su criterio de salida.

## Lista de comprobación del frontend (tarea 8.3)

`docs/quality/frontend-checklist.md`, recorrida en el editor de facturas y en la barra superior.
Cada punto está marcado, o declarado como excepción o como no aplicable, con su motivo.

### Dimensiones pedidas

- [x] **320 px:** sin desborde en el editor ni en la barra (`editor.spec.ts`, «lectura» a 320 y
  «barra superior en una línea»; `borrador-listo-320-claro.png`, `nueva-factura-vacia-320-claro.png`).
- [x] **768 px:** barra limpia y formulario apilado sin cortes (`borrador-listo-768-claro.png`).
- [x] **1024 px**, con la barra expandida y colapsada: forma de pago entera y el panel donde cabe
  (`borrador-listo-1024-claro.png`, `borrador-listo-1024c-claro.png`).
- [x] **1440 px:** `borrador-listo-1440-claro.png`.
- [x] **Zoom al 200 %:** barra en tres piezas, migas en la página, barra de acciones de unos 97 px y
  el foco nunca debajo de ella (`borrador-barra-acciones-1440z200-claro.png`; `editor.spec.ts`).
- [x] **Teclado:** comprador, punto, agregar producto con el foco en la cantidad nueva, cantidad,
  descuento, quitar, formas de pago y guardar; la confirmación con Escape y el foco de vuelta
  (`editor.spec.ts`). El indicador del ambiente se explica al llegar con el teclado, sin quitar el
  foco, y se cierra con Escape (`environment-notice.test.tsx`).
- [x] **Claro y oscuro:** capturas en los dos, y `axe` en claro, oscuro y móvil.
- [x] **Administrador y operador:**
  - los dos roles ven el editor y emiten;
  - la barra se comprobó con los dos (`ux.spec.ts`);
  - la falta del permiso de emitir se simula (`draft-editor-no-emit.test.tsx`), porque hoy ningún
    rol la tiene.
- [x] **Pruebas y Producción, y sin confirmar:** aviso junto a las acciones y en la confirmación
  según el ambiente (`editor.spec.ts`; `borrador-produccion-1440-claro.png`,
  `borrador-ambiente-desconocido-1440-claro.png`).

### Antes de construir

- [x] El brief del editor está escrito en el design («Screen brief: editor de facturas»), con su
  decisión principal y una sola acción principal por estado.
- [x] Se presenta como un trabajo (preparar y emitir una factura), no como la página de una
  entidad.
- [x] Información por niveles: comprador y punto, productos, pagos, y el resumen con la acción.
  Nada de P3 en la vista inicial.
- [x] Nada se muestra solo porque el backend lo devuelva.
- [x] Presupuesto de acciones: una principal y una secundaria, y el resto dentro de su sección.

### Tarea y jerarquía

- [x] Usuario, tarea y acción claros; orientación en unos dos segundos: migas, título, estado y
  acción.
- [x] Una sola acción con peso de principal, y su texto nombra la acción y el objeto («Emitir
  factura», «Guardar borrador»).
- [x] Superficie adecuada: página completa para un flujo fiscal largo, y diálogo para elegir el
  comprador o el producto.
- [x] Sin submódulos en pestañas.
- [ ] **Excepción declarada:** crear, editar y quitar líneas y pagos funcionan contra el harness y en
  las pruebas, pero no se ejercitaron contra el backend real. Las salvaguardas de este paso prohíben
  escribir en el despliegue.
- [x] Título, módulo y resumen sin duplicar; filtros y acciones junto a lo que afectan.
- [x] Ningún panel ni texto de ayuda sin beneficio. El resumen solo dice lo que el servidor calculó.
- [x] Se entiende sin conocer la implementación.

### Datos y lenguaje

- [x] Etiquetas en lenguaje de negocio; sin identificadores crudos ni detalles internos.
- [x] Relaciones con selectores con búsqueda (comprador y producto).
- [x] Nada que genere el backend se pide al usuario: totales, secuencial y clave de acceso.
- [ ] **Excepción declarada (C9):** cantidades y descuentos con punto, junto a importes con coma.
  Registrado en la deuda técnica.
- [x] El texto habla al usuario, sin narrar procesos internos.

### Fundamentos y selección de componentes

- [x] Espaciado, radio, tipo, color, capas y duraciones de las escalas; sin valores arbitrarios (lint
  estricto en las rutas nuevas).
- [x] Agrupación por espacio y alineación antes que bordes.
- [x] Acento dentro de presupuesto, y ningún estado solo por color: el aviso y el indicador llevan
  icono y texto.
- [x] Estados de los controles: reposo, hover, foco, activo, deshabilitado y ocupado.
- [x] Controles elegidos por intención: valores exactos tecleados, opciones que caben a la vista.
  El punto de emisión y la forma de pago son `select` nativos porque sus listas no caben a la vista.
- [x] Variantes de botón por nivel de acción; «Quitar» con icono y nombre accesible.

### Tablas

- [x] La lista de líneas usa encabezados de columna y una fila por línea desde 40rem de contenedor.
- n/a Paginación, búsqueda, filtros, orden y acciones de fila: la lista de líneas de una factura no es
  una tabla de datos paginada.

### Formularios y diálogos

- [x] React Hook Form y Zod.
- [x] Etiquetas, obligatorio, ayuda y errores asociados (`fieldAria`), también los del servidor.
- [x] Envío duplicado evitado: el formulario se bloquea mientras guarda, y la confirmación tiene su
  cerrojo.
- [x] Un fallo conserva lo escrito y el estado con cambios, y lleva el foco a la recuperación.
- [x] Foco, Escape, cierre, capa y desplazamiento de los diálogos, también en móvil.
- [x] Página completa para un flujo de alto riesgo; la decisión está en el design.
- n/a Datos sensibles, borrado irreversible y archivos: el editor no los tiene.

### Respuesta y estado

- [x] Guardar y emitir tienen estado pendiente (botón ocupado y formulario bloqueado), éxito (el
  estado «Guardado», o la factura emitida) y error (una alerta con el foco en ella).
- [ ] **Excepción declarada:** el editor no usa `useMutationFeedback`, como tampoco lo usaba antes
  del cambio. Su error pide una recuperación en la página, como recargar un borrador que cambió o ir
  a la factura ya emitida, y un toast no la ofrece. El mensaje sí pasa por el `errorMessage`
  compartido, que lo sanea.
- [x] Avisos persistentes solo para condiciones persistentes: la firma por vencer. El ambiente va en
  el indicador y en el aviso contextual.
- [x] Errores desconocidos saneados.
- [x] Una respuesta vieja no pisa un estado más nuevo: el punto por defecto se aplica con
  `keepDirtyValues`.

### Navegación y responsive

- [x] Destino actual: Facturas, también en el editor.
- [x] Controles de la barra estables, sin borde y de 44 px en móvil.
- [x] Sin solapes a 320, 768, 1024 y 1440 px ni a 200 %.
- [x] Texto largo recortado de forma predecible: el comprador, el nombre de la empresa y el producto.
- [ ] **Excepción declarada:** la forma de pago recortada a 390 px y menos. Registrada en la deuda
  técnica.

### Rendimiento

- [x] Sin peticiones nuevas ni cascadas: las mismas seis peticiones que antes en la factura nueva.
- [x] Sin dependencias nuevas, y +4822 bytes de JavaScript transferidos en la factura nueva.
- n/a Imágenes y listas sin límite: el editor no tiene ninguna.

### Tema y accesibilidad

- [x] Claro y oscuro en la página, los diálogos, el popover, el tooltip, los campos y la barra fija.
- [x] Teclado y foco visible, también junto a la barra fija.
- [x] Orden de encabezados y regiones lógico; la barra superior es el único `banner`.
- [x] Contraste y objetivos táctiles: `axe` (WCAG 2.2 AA) sin violaciones en claro, oscuro y móvil.
- [x] Movimiento reducido respetado.

### Pasada de pulido y auditoría de la pantalla

- [x] Escalas, alineación y grupos; estados distintos entre sí.
- [x] Carga, vacío, error y éxito igual de cuidados: el borrador ajeno se trata como inexistente.
- [x] Dos segundos, ansiedad visual, eliminación, usuario nuevo, recurrente, coste de la tarea,
  coherencia y contención: respondidas en la valoración de composición y en las personas de arriba.

### Evidencia de verificación

- [x] Pruebas de componente del editor y de los primitivos en verde.
- [x] Flujo crítico cubierto en el navegador (`editor.spec.ts`).
- [x] Capturas de escritorio y móvil inspeccionadas: este documento.
- [x] Sin errores nuevos en la consola. El harness no la revisa por sí solo: la revisión visual y
  `routes.spec.ts` solo fallan con un error no capturado. Se comprobó aparte, con una prueba
  temporal que no queda en el repositorio:
  - 192 visitas: el editor en sus estados, Facturas y Empresa, con la explicación del indicador y una
    cantidad cambiada;
  - administrador y operador, Pruebas y Producción, 1440, 390 y 320 px, claro y oscuro;
  - ningún error ni error no capturado. Cada documento da un aviso, siempre el mismo: Chrome 154 no
    reconoce `bluetooth` en la cabecera `Permissions-Policy`. Viene de la política de seguridad del
    navegador (`web-security-policy.ts`, del 2026-10-11), no de este cambio.
- [x] Lint, tipos, pruebas y build: se ejecutan otra vez enteros en la verificación final (9.1).
- [ ] **Excepción declarada:** crear, editar, ver y quitar contra el backend real no se ejercitó,
  por las salvaguardas (ver «Tarea y jerarquía»).
- [x] Cada criterio queda informado como cumplido o como excepción con su motivo.

## Verificación final (tarea 9.1)

Todo sobre el commit `196b537`, sin tráfico al SRI. `SRI_TRANSMISSION_ENABLED=0` se leyó en el
backend del despliegue de revisión, y la sala limpia lo fija en `0`.

- **`verify`, en sala limpia:** un worktree nuevo del commit exacto, PostgreSQL 17 propio y los
  valores de relleno del CI.
  - **Primera ejecución:** falló en `test` por una sola prueba del backend:
    `job-runner.test.ts`, «pausado, ningún job `sri.*` se toma ni consume intentos». Espera una
    ventana fija de 400 ms, y la máquina estaba cargada (carga media de unos 8). La rama no toca el
    runner: del backend solo cambia una ruta en una prueba de documentación. Aislada, la prueba pasó
    5 de 5.
  - **Segunda ejecución,** con una base nueva: código 0 en todos los pasos.
    - Formato, OpenSpec (26), versiones, lint y tipos.
    - 3745 pruebas en verde y una omitida, y AC-04 3 de 3.
    - OpenAPI, arranque de desarrollo y build.
    - `check:web-security-policy` 40 de 40 (tarea 3.8), con el SRI simulado `sri-simulado.test`,
      que no resuelve y solo se alcanza por un proxy local.
    - XSD y recursos del RIDE.
- **`security:dependencies`:** PASS. Solo hay excepciones revisadas y vigentes, y un aviso moderado
  informado.
- **`security:secrets`:** PASS, con Gitleaks 8.30.1 verificado por su hash, y las 13 pruebas de las
  reglas.
- **`test:visual`:** 115 de 115, sin capturas base cambiadas.
- **Pruebas enfocadas:** las del frontend, 803 de 803. `editor.spec.ts`, dentro de `test:visual`.
- **`test:visual:review`, etiqueta `final` comparada con `despues`:** 96 capturas, ninguna falta.
  No hubo errores de página, peticiones a otro origen ni rutas sin datos de prueba. La y del
  título, las cajas de la barra y el alto del documento son iguales a los del «después» en las 96,
  y `contact-sheets/compare-despues-movil.png` se miró.
