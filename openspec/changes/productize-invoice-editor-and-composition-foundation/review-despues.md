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
