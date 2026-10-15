# Proposal

## Why

La auditoría de composición visual del 2026-10-15, hecha sobre el producto real, dejó dos fallos
V4 registrados en `technical-debt.md`:
- **La barra superior se rompe en anchuras comunes.** Las migas se parten en dos líneas a 1024 y
  1280 px y, a 768 px, se montan sobre el contexto de la empresa hasta volverse ilegibles. La barra
  es además una fila plana de siete controles iguales.
- **No hay composición de formularios a nivel de página.** Cada pantalla de formulario inventa
  anchos, columnas y el lugar de «Guardar».

Nueva factura es el formulario que más usa el operador diario, y concentra los síntomas:
- la acción principal visible es «Emitir factura» deshabilitada, mientras la única acción válida
  («Guardar borrador») parece secundaria;
- el resumen fijo de 320 px deja el formulario en 376 px a 1024 px;
- la fila de pago está desalineada 20 px;
- la orientación se repite (migas, enlace de vuelta y título);
- el resumen ocupa un panel entero para decir «Guarda el borrador para calcular».

Además, al pasar de Facturas (ya productizada) a Nueva factura el usuario cambia de producto: la
navegación marca otro destino, la acción principal se mueve y la densidad cambia de golpe.

Por último, una prueba de capturas solo demuestra que algo se ve como la imagen aceptada, no que
esté bien compuesto. Los agentes necesitan un flujo repetible para ver el producto renderizado
antes y después de un cambio visual.

## What Changes

- **Barra superior estable** (corrige el V4 de la cabecera):
  - una sola línea a todas las anchuras, en tres zonas:
    - izquierda: navegación y contexto de la empresa;
    - centro flexible: la paleta «Buscar pantalla o acción»;
    - derecha: el ambiente y la cuenta;
  - sin migas en la barra: la barra no lleva la jerarquía de la página;
  - el tema se elige solo en el menú de cuenta, a todas las anchuras (**BREAKING** visual: el grupo
    «Tema» sale de la barra superior de escritorio);
  - el contexto de la empresa con ancho acotado, recorte seguro y el nombre completo accesible.
- **Una sola orientación por pantalla:**
  - las migas pasan a la cabecera del contenido, justo encima del título, a todas las anchuras
    (hoy ya ocurre así en móvil);
  - se retiran los enlaces «volver» que repetían la primera miga en editores y detalles;
  - Nueva factura y los borradores de factura pertenecen al flujo de Facturas (decisión del
    propietario pendiente, ver abajo).
- **Gramática de encabezado de página.** El `PageHeader` existente se amplía con variantes de lista,
  editor y configuración, con un ritmo vertical fijo y las acciones alineadas al título. Pantallas
  que lo adoptan en este cambio: Facturas (ya lo usa) y el editor de facturas.
- **Anchos de contenido por función:** lectura, formulario y espacio de trabajo, en lugar de cinco
  valores sueltos por ruta. En este cambio los usan el editor y Facturas; las pantallas heredadas
  quedan mapeadas para su migración.
- **Jerarquía de acciones en todo el producto:**
  - una acción principal deshabilitada se ve no disponible y neutra, ya no azul translúcido;
  - las selecciones de filtros, vistas y controles segmentados usan una superficie neutra, no el
    azul principal (alcance y consumidores listados en el diseño);
  - el estado vacío no repite en azul la acción principal del encabezado: en las listas de notas
    de crédito y de débito, retenciones, guías y liquidaciones, su llamada pasa a ser secundaria.
- **Composición de formularios** probada contra el editor de facturas, sin primitivos sin
  consumidor:
  - distribución del formulario con un panel de resumen y acciones que se apila según el ancho del
    contenedor;
  - secciones;
  - rejilla de campos con anchos semánticos;
  - filas de campos alineadas, con ayuda, error y acciones en línea;
  - acciones fijas al pie cuando el panel se apila.
- **Editor de facturas productizado** (Nueva factura y borrador existente):
  - la acción siguiente válida lleva el peso principal;
  - «Emitir factura» solo domina cuando de verdad puede emitirse, y si no, dice por qué;
  - un resumen veraz:
    - solo totales y problemas calculados por el servidor;
    - tras editar, nunca muestra totales viejos como vigentes;
    - el ambiente, con el aviso de Pruebas junto a la emisión;
  - comprador y punto de emisión como un solo contexto;
  - líneas compactas para la carga frecuente;
  - formas de pago alineadas, con el texto «Déjalo vacío para usar el total de la factura»;
  - la confirmación de la emisión conserva su intención explícita y su seguridad.
- **Revisión visual como ojos del agente:**
  - un comando de desarrollo `test:visual:review` captura una matriz canónica de pantallas,
    estados, anchuras y temas sobre los datos deterministas del harness;
  - escribe capturas, geometría medida, hojas de contacto HTML y un manifiesto en una carpeta
    local ignorada por git;
  - no aprueba nada ni sustituye a `test:visual`;
  - la Definición de Hecho del frontend exige capturas antes y después, abrirlas e inspeccionarlas,
    y una valoración escrita de composición.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `web-application-shell`:
  - la barra superior estable;
  - las migas fuera de la barra y una sola orientación por pantalla;
  - el destino actual y la creación rápida para Nueva factura;
  - el tema solo en el menú de cuenta;
  - el nombre largo de la empresa;
  - la jerarquía de acciones de la pantalla.
- `invoices`: el editor de borradores de factura, es decir:
  - la acción siguiente;
  - los totales veraces;
  - el aviso de ambiente junto a la emisión;
  - la confirmación;
  - las formas de pago;
  - el borrador de otra empresa;
  - la lectura a cualquier anchura.

## Fuera de alcance

- Migrar otras pantallas:
  - Archivo de comprobantes, Productos, Terceros, Reportes;
  - Empresa, Ambiente, Establecimientos, Secuenciales, Firma, Catálogos fiscales, Usuarios,
    Portabilidad;
  - los editores de nota de crédito, nota de débito, retención, guía y liquidación;
  - las demás tablas heredadas.

  Solo reciben los cambios transversales:
  - retirar el enlace «volver» duplicado;
  - la selección neutra;
  - el botón deshabilitado neutro;
  - la llamada secundaria en el estado vacío.
- Cambiar el backend, la API, la base de datos, la lógica fiscal o la máquina de estados de la
  emisión. Ningún cálculo fiscal pasa al navegador.
- Una vista previa de totales sin guardar (`SERVER_TOTAL_PREVIEW_GAP`): se registra como brecha.
- Cambiar la persistencia del aviso de Pruebas: la franja sigue siendo obligatoria
  (`web-application-shell`, «Ambiente fiscal visible en el shell»).
- Dependencias nuevas de ejecución.
- Corregir toda la deuda visual de la auditoría.

## Decisiones del propietario

| Id | Pregunta | Recomendación |
| --- | --- | --- |
| PO-1 | ¿A qué destino pertenecen Nueva factura y un borrador de factura existente? Hoy, Borradores de facturas. | **Ambos a Facturas**: «Facturas › Nueva factura» y «Facturas › Borrador de factura». Así no cambian el destino ni las migas al guardar por primera vez, que hoy reemplaza `/borradores/nuevo` por `/borradores/{id}`. Borradores de facturas sigue como lista para retomar. La alternativa (nuevo en Facturas y existente en Borradores) cambia de destino en mitad del flujo. |
| PO-2 | `SERVER_TOTAL_PREVIEW_GAP`: el servidor solo calcula totales al guardar (no hay vista previa sin persistir). | **No cambiar el backend en este cambio.** El resumen muestra los totales del último guardado solo cuando no hay cambios, y si los hay, dice que hay que guardar para recalcular. Una vista previa sin guardar, o el guardado automático, quedan como cambio aparte. |
| PO-3 | `UNSAVED_CHANGES_GAP`: salir del editor con cambios sin guardar los pierde sin aviso. | **Aviso nativo del navegador al cerrar o recargar la pestaña con cambios, más un indicador visible de «Cambios sin guardar».** No interceptar la navegación interna en este cambio: el router de Next.js no ofrece un bloqueo fiable. |
