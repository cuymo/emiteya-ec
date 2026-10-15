# Proposal

## Why

La auditoría de composición visual del 2026-10-15, hecha sobre el producto real, dejó dos fallos
V4 registrados en `technical-debt.md`:
- **La barra superior se rompe en anchuras comunes.** Las migas se parten en dos líneas a 1024 y
  1280 px y, a 768 px, se montan sobre el contexto de la empresa hasta volverse ilegibles. La barra
  es además una fila plana de siete controles iguales.
- **No hay composición de formularios a nivel de página.** Cada pantalla de formulario inventa
  anchos, columnas y el lugar de «Guardar».

El ambiente se repite: el distintivo de la barra y una franja de ancho completo en todas las
pantallas. La franja ámbar domina antes que el contenido y, aun así, no está junto a la acción donde
importa, que es emitir.

Nueva factura es el formulario que más usa el operador diario, y concentra los síntomas:
- la acción principal visible es «Emitir factura» deshabilitada, mientras la única acción válida
  («Guardar borrador») parece secundaria;
- el resumen fijo de 320 px deja el formulario en 376 px a 1024 px;
- la fila de pago está desalineada 20 px;
- la orientación se repite (migas, enlace de vuelta y título);
- el resumen ocupa un panel entero para decir «Guarda el borrador para calcular»;
- salir con cambios sin guardar los pierde sin aviso.

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
- **Ambiente: identidad global compacta y aviso fiscal contextual** (**BREAKING** de comportamiento
  del shell):
  - **Global:** el indicador compacto de la barra es el aviso persistente del ambiente.
    - En Pruebas dice «Pruebas» con icono de advertencia, su nombre accesible completo dice que los
      comprobantes no tienen validez tributaria, y al enfocarlo, señalarlo o tocarlo lo explica.
    - Producción es contexto, nunca éxito.
    - Un ambiente sin confirmar se dice como tal, nunca como Producción.
  - **Se retira la franja de ancho completo de Pruebas.** El aviso de vencimiento de la firma
    conserva su franja.
  - **Contextual:** junto a la acción de emitir y en la confirmación de la emisión, un aviso con
    icono y texto dice que el comprobante de Pruebas no tendrá validez tributaria.
    - Es el aviso del editor de facturas.
    - Para no quitar claridad al retirar la franja, también se añade a los cinco editores de
      comprobantes que emiten (nota de crédito, nota de débito, retención, guía y liquidación),
      sin recomponerlos.
- **Una sola orientación por pantalla:**
  - en las rutas migradas (el editor de facturas), el `PageHeader` es dueño de las migas, encima del
    título;
  - las rutas heredadas usan la fila compartida de migas del contenido hasta su migración;
  - una ruta nunca muestra las dos a la vez;
  - se retiran los enlaces «volver» que repetían la primera miga en editores y detalles;
  - Nueva factura y los borradores de factura pertenecen a Facturas (PO-1).
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
  - **Guardar y emitir se separan según el servidor real:**
    - un borrador incompleto se puede guardar, así que «Guardar borrador» sigue disponible aunque
      falten requisitos de la emisión;
    - guardar solo espera mientras hay un guardado en curso;
    - «Emitir factura» solo está disponible con la versión vigente guardada, sin cambios sin
      guardar y sin problemas del servidor; el servidor los vuelve a comprobar al emitir;
    - la acción siguiente válida lleva el peso principal;
  - **totales veraces sin vista previa del servidor antes de guardar** (PO-2): sin importes
    inventados, los del servidor solo para la versión guardada, y los anteriores rotulados como
    «del último guardado» mientras hay cambios;
  - **«Cambios sin guardar»** visible y el aviso nativo del navegador al cerrar o recargar (PO-3);
    los cambios solo se dan por guardados tras un guardado correcto, y un guardado fallido los
    conserva;
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
  - **antes de tocar el código** en el apply, el agente captura el producto actual, abre y mira las
    capturas y escribe `review-antes.md`; al terminar, captura de nuevo, compara y escribe
    `review-despues.md`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `web-application-shell`:
  - la barra superior estable;
  - el ambiente compacto sin la franja de Pruebas;
  - el shell autenticado y la carga de una pantalla sin la franja;
  - las migas fuera de la barra, con una sola orientación por pantalla;
  - el destino actual y la creación rápida para Nueva factura;
  - el tema solo en el menú de cuenta;
  - el nombre largo de la empresa;
  - la jerarquía de acciones de la pantalla.
- `taxpayer-setup`: el aviso persistente del ambiente pasa a ser el indicador compacto de la barra.
- `document-emission`: el aviso de Pruebas junto a la acción de emitir y en la confirmación, para
  todos los comprobantes.
- `invoices`: el editor de borradores de factura, es decir:
  - la acción siguiente;
  - los totales veraces;
  - el ambiente junto a la emisión;
  - la confirmación;
  - las formas de pago;
  - los cambios sin guardar;
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
  - la fila compartida de migas;
  - la selección neutra;
  - el botón deshabilitado neutro;
  - la llamada secundaria en el estado vacío;
  - el aviso de Pruebas junto a la emisión.
- Cambiar el backend, la API, la base de datos, la lógica fiscal o la máquina de estados de la
  emisión. Ningún cálculo fiscal pasa al navegador.
- Una vista previa de totales sin guardar (`SERVER_TOTAL_PREVIEW_GAP`), aceptada como limitación de
  este cambio.
- Proteger la navegación interna con cambios sin guardar: queda como brecha conocida.
- Dependencias nuevas de ejecución.
- Corregir toda la deuda visual de la auditoría.

## Decisiones del propietario (2026-10-15)

| Id | Decisión |
| --- | --- |
| PO-1 | **Aprobada.** Nueva factura: «Facturas › Nueva factura». Borrador existente: «Facturas › Borrador de factura». Facturas es el destino activo en los dos, por la semántica de la ruta y no por el historial. La lista de borradores sigue en Borradores de facturas. Una sola orientación visible por ruta: sin migas en la barra ni enlaces de vuelta duplicados. En las rutas migradas, el `PageHeader` es dueño de las migas. Las heredadas usan la fila compartida hasta migrarse, nunca las dos a la vez. |
| PO-2 | **Aprobada.** Sin endpoint nuevo ni cambios de API, base de datos o cálculo fiscal, y sin totales fiscales en el cliente. A) Borrador nuevo sin guardar: ni ceros ni estimaciones; se explica que guardar da los totales del servidor. B) Guardado sin cambios: los últimos totales del servidor. C) Guardado con cambios: los anteriores no se presentan como vigentes, se rotulan como del último guardado y se explica que hay que guardar para recalcular. D) Tras un guardado correcto, la respuesta nueva del servidor es la autoridad, y el estado sin guardar solo se limpia tras persistir. `SERVER_TOTAL_PREVIEW_GAP` queda aceptada como limitación de este cambio. |
| PO-3 | **Aprobada.** Indicador visible «Cambios sin guardar» mientras el editor tiene cambios. Aviso nativo `beforeunload` solo mientras existen. El estado sin guardar se limpia solo tras un guardado confirmado u otra operación confirmada que persista la versión actual, y se conserva tras un guardado fallido. Sin interceptor de la navegación interna de Next.js; esa protección queda documentada como brecha. |
| Ambiente | **Aprobada.** Identidad global compacta y persistente en la barra («Pruebas» inconfundible, Producción nunca como éxito) y aviso contextual de que los comprobantes de Pruebas no tienen validez tributaria junto a la acción de emitir y en la confirmación. Se retira la franja global de ancho completo. |

**Consecuencias derivadas, para que el propietario las confirme al revisar:**
- **RF-005 del ERS** («advertencia persistente en Pruebas»): se cumple con el indicador compacto,
  que es persistente, no se puede cerrar, lleva icono de advertencia y dice, en su nombre accesible
  y en su explicación, que los comprobantes no tienen validez tributaria.
- **Editores heredados que emiten:** reciben el aviso contextual junto a «Emitir» y en su
  confirmación. Sin él, retirar la franja les quitaría la advertencia de validez tributaria.
- **Guardado en curso:** mientras se guarda, el formulario no se edita, para que lo persistido sea
  exactamente lo que se ve. Hoy, una edición hecha durante el guardado se pierde al volver a montar
  el editor con la versión nueva.
