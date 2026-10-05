# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para `Inventario` (`/inventario`), el detalle de un producto en el inventario (`/inventario/{productId}`) con sus diálogos de inicialización, entrada, ajuste y desactivación, la marca de control en el diálogo del producto y los avisos de existencias del editor del borrador (design D13). Fecha: 2026-10-04.

## Método

- **Recorrido automatizado** con Chrome (Playwright con el Chrome del sistema, en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts`, con el seguidor de inventario en la transacción de la autorización) y el frontend real en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas.
  - La transmisión apunta a un **SRI simulado** local con respuestas SOAP **sintéticas** (el mismo de las pruebas de extremo a extremo). Ninguna llamada sale al SRI real.
  - La política de tamaño es **sintética** (1 000 000 bytes, de `test/support/synthetic-size-policy.ts`): no es la cifra oficial de Q-47.
  - La preparación usa solo la API real: configuración tributaria, establecimiento y punto, firma sintética con custodia, una operadora, un cliente, cinco bienes marcados, un bien sin marca y un servicio; las inicializaciones, la desactivación y la entrada del cemento; dos facturas autorizadas y un borrador. La base solo se lee para esperar estados; no se escribe nada por SQL.
  - El recorrido completo se repitió desde una instalación nueva después de corregir cada grupo de hallazgos.
- **Datos preparados:**
  - cemento: inicializado con 20, entrada de 10 de la operadora y factura 001-001-1 autorizada con dos líneas (3 + 4), que deja una sola salida de 7 y el saldo en 23;
  - clavos: inicializados con 1 y factura 001-001-2 autorizada de 5: saldo -4;
  - pintura: inicializada con 0 y con el control desactivado;
  - arena y tubería (nombre largo): marcadas sin inicializar;
  - lija (sin marca) y transporte (servicio): fuera de la lista;
  - un borrador con 30 de cemento y 2 de tubería.
- **Capturas inspeccionadas:** a página completa, en escritorio, a 375 y 320 px, y en tema oscuro en escritorio y a 375 px, de la lista, el detalle, los diálogos, la confirmación, el diálogo del producto y el borrador (15 capturas).
- **Pruebas de componentes:**
  - `frontend/test/inventory-screen.test.tsx` (5 pruebas) y `stock-item-detail.test.tsx` (9);
  - las nuevas de `products-screen.test.tsx`, `drafts-screen.test.tsx`, `app-shell.test.tsx` y `decimal-format.test.ts` (una en cada una);
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main`, con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.
- **Consola:** se registran los errores de todas las páginas recorridas. Se separan como ruido previo a este cambio el `401` de `/api/v1/me` antes de iniciar sesión (la comprobación de sesión) y el `404` de `/favicon.ico` (el frontend no publica favicon).

## Inventario, detalle, producto y borrador (tareas 10.1 a 10.3)

73 comprobaciones contra el backend real, todas correctas:

- **Inventario:**
  - título "Inventario · Facturador SRI" e "Inventario" activo en el grupo Operación;
  - los cinco productos con marca o inventario; ni el bien sin marca ni el servicio;
  - la arena dice "Sin inicializar" y "Sin saldo", nunca cero; los clavos, "Saldo negativo" con su icono y -4, en una línea; la pintura, "Control desactivado"; el cemento, 23 tras la salida de 3 + 4;
  - el chip "Saldo negativo" queda en la URL y deja solo los clavos; la búsqueda de la URL llega al campo y filtra por código;
  - el último movimiento cabe en una línea.
- **Detalle activo (administrador):**
  - "Registrar entrada" es la acción primaria y mide 40 px en escritorio; "Ajustar" y "Desactivar control" son secundarias;
  - con saldo distinto de cero, "Desactivar control" está deshabilitado y su `aria-describedby` apunta a la explicación ("el saldo debe ser cero");
  - el kárdex, del más reciente al más antiguo: la salida con "Factura 001-001-000000001" (enlace a la factura, en una línea), "Sistema", -7 y saldo 23; la entrada con su nota y "Usuario · Olga Operadora"; las columnas terminan en las cifras (Fecha, Movimiento, Detalle, Variación, Saldo);
  - Enter abre "Registrar entrada" con el foco dentro; Escape lo cierra y el foco vuelve al botón;
  - la entrada de 5 con Enter muestra "Registraste la entrada de 5. Saldo: 28.", el saldo cambia y el foco va al saldo;
  - el ajuste parte de "Disminuir"; sin motivo, "El motivo del ajuste es obligatorio." queda en el campo con el foco; con motivo, "Registraste el ajuste de -3. Saldo: 25." y el ajuste aparece primero en el kárdex con su motivo;
  - un rango invertido se explica en "Hasta" (`aria-invalid`) y en la tabla ("Revisa el rango de fechas").
- **Inicializar y fijar el control (administrador):**
  - sin inicializar: "Sin inicializar: todavía no hay saldo." y "Inicializar inventario"; con 12.5, el aviso "Inicializaste el inventario de Arena fina, saco de 25 kg con 12,5.", el foco al saldo y el kárdex con el saldo inicial;
  - "Activar control" reactiva la pintura; un saldo inicial de cero se muestra como "0", sin signo;
  - "Desactivar control" pide confirmación y explica que las facturas ya emitidas con el control activo aún pueden descontar su salida al autorizarse; al confirmar, el foco va al saldo.
- **Operador:** registra entradas; no ve "Ajustar", "Desactivar control", "Inicializar inventario" ni "Activar control", y cada estado explica que lo hace un administrador.
- **Borrador:** junto a la línea del cemento, "Aviso de existencias: pides 30 y el saldo contabilizado es 25. Es orientativo y no impide emitir."; junto a la tubería, el aviso sin inventario inicializado; "Emitir factura" sigue habilitado.
- **Producto:** al corregir el cemento, la marca queda deshabilitada y marcada, con "El control se gestiona en Inventario." y el enlace a su inventario; la tubería, sin inventario, conserva la marca editable.
- **Móvil a 375 y 320 px:** lista en tarjetas con el negativo indicado y "Sin saldo" en una línea; detalle sin desbordamiento; "Registrar entrada" mide 44 px.
- **Barrido:** a 640 (equivale a 200 % de zoom en 1280), 768, 1024 y 1440 px, la lista y el detalle del producto de nombre largo sin desbordamiento.
- **Tema oscuro:** lista y detalle en escritorio y a 375 px, sin desbordamiento y con el contraste medido.
- **Contraste:** ningún texto por debajo de 4.5:1. Mínimos: lista 5.15:1 en claro y 5.62:1 en oscuro; detalle 5.95:1 en claro y 6.46:1 en oscuro; borrador con avisos 5.95:1 en claro.
- **Consola:** sin errores nuevos.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D13 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `inventory-screen.tsx` y `stock-item-detail.tsx`, con P0 a P3. Los identificadores, las claves de idempotencia y las huellas (P3) no se muestran. |
| Tarea y jerarquía | En la lista, la acción principal es abrir el producto. En el detalle, una sola acción primaria según el estado y el rol: "Inicializar inventario", "Registrar entrada" o "Activar control"; "Ajustar" y "Desactivar control" son secundarias. El saldo va antes que el kárdex. |
| Datos y lenguaje | Estados del glosario ("Sin inicializar", "Activo", "Control desactivado", "Saldo negativo") y tipos de movimiento en lenguaje de negocio ("Saldo inicial", "Entrada", "Salida por factura", "Ajuste"). Variaciones con signo, saldos con los separadores de es-EC y fechas en la hora de Ecuador. La lista y el detalle aclaran que el stock es contabilizado y no reserva existencias; los avisos del borrador dicen que son orientativos. |
| Fundamentos | Escalas de espaciado y radios del proyecto. `StatusBadge` con icono y texto; el saldo negativo lleva `TriangleAlert` y el texto "Saldo negativo", nunca solo color. Cifras tabulares. |
| Selección de componentes | `AppDataTable`, `ChipGroup`, `SearchInput`, `DatePickerField`, `FormDialog`, `ConfirmDialog` y `SegmentedControl` existentes. La dirección del ajuste es un `SegmentedControl` de dos opciones visibles, y la cantidad se escribe sin signo. `FormDialog` y `ConfirmDialog` aceptan ahora `onCloseAutoFocus` para llevar el foco al resultado tras la acción. |
| Tablas | Paginación en el servidor con tamaño de página en la URL; búsqueda con espera de 300 ms; filtro de estado en la URL; estados de carga, vacío (con el camino a Productos), sin coincidencias, error con reintento y rango inválido. La última columna de cada tabla son cifras, que es lo que la tabla alinea a la derecha. Por debajo de 768 px, tarjetas con la misma información. |
| Formularios y diálogos | React Hook Form con los esquemas Zod del contrato. Cantidad con su dominio, nota opcional y motivo obligatorio en el ajuste, con los errores asociados a su campo. Un solo envío ante el doble clic y la misma clave de idempotencia en el reintento. Los `409` se explican en el diálogo y conservan lo escrito. Desactivar es reversible: una confirmación de un paso que explica sus consecuencias. |
| Feedback y estado | Las operaciones pasan por `useMutationFeedback`, con aviso de éxito que repite la cantidad y el saldo resultante. Tras cada acción, el foco va al saldo; al cancelar, vuelve a quien abrió el diálogo. |
| Navegación y responsive | Dos rutas nuevas, `Inventario` y su detalle, en el grupo Operación. Por debajo de 768 px, tarjetas y controles de 44 px. |
| Rendimiento | La lista pide una página acotada (máximo 100) y completa los saldos de la página en una consulta; el kárdex pagina por posición. `bench:inventory` mide la lista, el detalle, el kárdex y los movimientos con 10 000 productos inicializados. |
| Tema y accesibilidad | Ambos temas revisados con los mínimos de arriba. El saldo es un encabezado enfocable que recibe el foco tras cada acción; los avisos del borrador son `note`; el estado nunca depende solo del color; el botón deshabilitado explica por qué con `aria-describedby`. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Respuestas del SRI sintéticas | Las respuestas siguen los WSDL oficiales guardados en `docs/product/sri-wsdl/`, pero son sintéticas. La certificación contra Pruebas sigue siendo una compuerta previa a la puesta en producción. |
| Estado sin permiso alcanzable | Ambos roles tienen `inventory.read`. El `403` de las consultas se comprueba con las pruebas de componentes (respuesta `403`) y con la guardia de permisos del servicio (`backend/test/inventory/permissions.test.ts`). |
| Ruido de consola previo | El `401` de la comprobación de sesión antes de entrar y el `404` del favicon existían antes de este cambio y no dependen de él. |
| Indicador de desarrollo de Next.js | El círculo "N" de las capturas es el indicador de `next dev`; no existe en el build. |

## Hallazgos corregidos durante la revisión

- **El detalle del kárdex quedaba estrecho y alineado a la derecha.** Era la última columna, que la tabla reserva para cifras o acciones: la factura se partía en tres líneas. Ahora el detalle va antes de las cifras y la tabla termina en el saldo; el recorrido comprueba el orden de las columnas y que el número de la factura cabe en una línea.
- **Textos cortos partidos.** El último movimiento de la lista, "Sin saldo" en las tarjetas a 320 px y "Saldo negativo -4" en la tabla se partían en dos líneas. Ahora no se parten; el recorrido lo comprueba.
- **Un saldo inicial de cero se mostraba como "+0".** Ahora se muestra como "0". Lo cubren una prueba de `formatDelta` y el recorrido.

No quedan hallazgos abiertos.
