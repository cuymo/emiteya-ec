# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para las pantallas `Terceros` (`/terceros`) y
`Productos` (`/productos`), y para el uso de las entradas fiscales en `Catálogos fiscales` (design
D17). Fecha: 2026-10-03.

## Método

- **Recorrido automatizado** con Chrome (Playwright con el Chrome del sistema, en un directorio temporal fuera del repositorio).
  - Corre contra el backend y el frontend reales en desarrollo, sobre una instalación nueva aprovisionada en un esquema aislado de la base de pruebas.
  - El aprovisionamiento crea la empresa con su consumidor final, como en producción.
- **Estados provocados:**
  - error de carga: respuesta `503` simulada del navegador;
  - sin permiso: `403` simulado, porque ningún rol carece de `parties.read` ni de `products.read`.
- **Capturas inspeccionadas:** a página completa y por zonas, en escritorio, a 320 px y en tema oscuro.
- **Pruebas de componentes:**
  - `frontend/test/parties-screen.test.tsx`, `products-screen.test.tsx`, `fiscal-catalogs-screen.test.tsx` y `app-shell.test.tsx`;
  - Vitest con jsdom y Testing Library, por rol y nombre accesible;
  - dentro de `corepack pnpm verify`.
- **Contraste:** medido en el navegador sobre los colores calculados del nodo que contiene el texto, con los fondos translúcidos compuestos sobre su fondo real, en ambos temas.

## Terceros, Productos y Catálogos fiscales (tareas 7.1 a 7.4)

60 comprobaciones contra el backend real, todas correctas:

- **Navegación:**
  - grupo "Operación" con `Terceros` y `Productos`, para administrador y operador;
  - títulos de pestaña "Terceros · Facturador SRI" y "Productos · Facturador SRI".
- **Terceros:**
  - **carga:** tabla ocupada mientras llega la lista;
  - **consumidor final:** aparece marcado "Del sistema" y sin acciones;
  - **alta:**
    - la regla del tipo de identificación se muestra como ayuda;
    - el tipo reservado no se ofrece;
    - los roles se eligen en chips múltiples;
    - hay un aviso de éxito y el tercero aparece con "Cliente, Proveedor";
  - **identificación repetida:**
    - el error vuelve al campo con `aria-invalid` y nombra al tercero existente;
    - "Ver el tercero existente" lleva la lista a él;
  - **regla del catálogo:** una cédula corta devuelve "no cumple la regla de CÉDULA: 10 dígitos" al campo;
  - **corrección y estado:** la corrección muestra su aviso; desactivar ofrece Deshacer, que reactiva;
  - **búsqueda:** sin coincidencias, con "Limpiar filtros"; la búsqueda del consumidor final lo encuentra;
  - **teclado:** Enter abre el diálogo, y Escape lo cierra y devuelve el foco a "Nuevo tercero";
  - **error:** aparece con "Intentar de nuevo" y se recupera.
- **Productos:**
  - **vacío** inicial;
  - **alta:**
    - el IVA se elige entre las tarifas utilizables, con la tarifa visible ("15% · código 4 · 15 %");
    - el precio se muestra en formato es-EC ("8,75") y el estado "Listo";
  - **precio inválido:** con más de 6 decimales, el error queda en el campo y el valor escrito se conserva sin redondear;
  - **servicio:** no ofrece IRBPNR ni control de stock.
- **Catálogos fiscales:**
  - **uso:** "Usada por 1 producto activo";
  - **deshabilitar una entrada en uso:**
    - pide confirmación indicando el producto afectado;
    - al confirmar, se deshabilita;
  - **revisión:**
    - aparece "1 producto necesita revisión" con su enlace;
    - el enlace lleva a `Productos` filtrado, donde el producto figura en "Revisar impuestos";
    - al corregirlo, el diálogo explica "La tarifa de IVA 4 no está habilitada para tu empresa." y conserva la tarifa actual.
- **Operador:**
  - registra y corrige terceros, sin acciones de desactivar;
  - la API rechaza su desactivación con `403`;
  - Productos, sin desactivar.
- **Sin permiso:** el `403` se explica sin mostrar datos.
- **Móvil a 375 y 320 px, en Terceros, Productos y sus diálogos:**
  - sin desbordamiento;
  - objetivos de 44 px o más;
  - el diálogo cabe en la pantalla;
  - sin errores de consola.
- **Tema oscuro:** sin errores de consola.
- **Consola y red:**
  - sin errores de consola;
  - las únicas respuestas fallidas son las provocadas: la comprobación de sesión antes de iniciarla, el `409` y el `400` buscados y el `503` simulado.
- **Barrido:**
  - a 640, 768, 1024 y 1440 px: Inicio, Terceros, Productos, Catálogos fiscales, Empresa, Ambiente, Establecimientos, Firma electrónica, Secuenciales, Usuarios y Mi cuenta;
  - a 320 y 375 px: Inicio, Terceros, Productos, Establecimientos y Secuenciales;
  - sin desbordamiento y con la cabecera completa.

| Sección | Resultado |
| --- | --- |
| Antes de construir | Los briefs de D17 (usuario, objetivo, decisión, información mínima y acción principal) están en el encabezado de `parties-screen.tsx` y `products-screen.tsx`, con P0 a P2. El historial (P3) queda fuera. |
| Tarea y jerarquía | Una acción principal por pantalla: "Nuevo tercero" y "Nuevo producto". En Productos, el estado tributario es el primer filtro y una columna con insignia; los motivos (P2) están en el diálogo. En Catálogos fiscales, el uso de cada entrada solo aparece si es mayor que cero. |
| Datos y lenguaje | Identificación con su tipo oficial, razón social, roles en palabras y precio formateado desde el texto, sin `number`. Los estados tributarios usan las palabras del glosario: "Listo", "Revisar impuestos" e "Incompleto". Los motivos se dicen como frases ("no está habilitada para tu empresa", "todavía no tiene datos oficiales para calcular el impuesto"). No se muestra ningún identificador interno. |
| Fundamentos | Escalas de espaciado y radios. Los estados usan `StatusBadge` con icono y texto; "Del sistema" lleva un candado. Las cifras van tabuladas y el precio, alineado a la derecha, como su encabezado. |
| Selección de componentes | `AppDataTable` con paginación de servidor y estado en la URL; `ChipGroup` para filtros; `FormDialog` para formularios cortos; `SegmentedControl` para bien o servicio; `Select` para los impuestos utilizables, con "Sin ICE" y "Sin IRBPNR"; casilla para el control de stock, que se envía con el formulario; `ChipMultiSelect` (nuevo) para los roles combinables; `ConfirmDialog` de un paso antes de deshabilitar una entrada en uso. |
| Formularios y diálogos | El precio se valida con la especificación del contrato y conserva lo escrito. Los errores van a su campo: identificación (reglas del catálogo, reservado y repetido) y código principal en uso. El impuesto no disponible y el conflicto de versión van al cuerpo del diálogo. Pasar a servicio quita el IRBPNR y el control de stock en la misma solicitud, y lo dice. |
| Feedback y estado | Las mutaciones pasan por `useMutationFeedback`, con avisos que nombran el registro. Desactivar ofrece Deshacer. Habilitar o deshabilitar en Catálogos fiscales vuelve a pedir los datos de productos, porque su estado tributario cambia. |
| Navegación y responsive | Grupo principal "Operación". Por debajo de 768 px: tarjetas en lugar de la tabla, objetivos de 44 px, y los filtros secundarios de Productos (estado y tipo) tras "Más filtros", con el número de filtros activos. |
| Rendimiento | Una consulta paginada por pantalla, más los recuentos (`tax-summary`) en Productos y Catálogos fiscales. La búsqueda libre espera una pausa antes de consultar. Las opciones de impuestos solo se piden con el diálogo abierto. El volumen de referencia lo mide el benchmark (`docs/quality/benchmarks/search-2026-10-03.md`). |
| Tema y accesibilidad | Ambos temas revisados. Texto de las insignias: 15.5:1 en claro y 12.7:1 o más en oscuro. Tipo de identificación atenuado: 6.8:1 y 7.1:1. Texto de los chips inactivos: 16.9:1 y 16.5:1; activos: 6.0:1 y 6.7:1. Borde de un chip inactivo: 3.3:1 o más en claro y en oscuro. Un `h1` por pantalla; tablas con nombre accesible; los chips de roles anuncian `aria-pressed`; "Más filtros" anuncia `aria-expanded`. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Contraste de 3:1 para iconos significativos | El icono de advertencia de "Revisar impuestos" es decorativo (`aria-hidden="true"`); el texto lleva la información. Es la excepción ya declarada en `add-taxpayer-setup`. |
| Estado sin permiso alcanzable | Ningún rol carece de lectura de terceros o productos. Se comprueba con pruebas de componentes y con el `403` simulado. |
| Combobox con búsqueda para ICE | El formulario ofrece en un `Select` solo los códigos que la empresa habilitó (design D17, Riesgos). Un combobox llegará con el selector de productos de la factura. |
| Eliminar | No hay borrado: terceros y productos se desactivan (design D14). El consumidor final no tiene acciones. |

## Hallazgos corregidos durante la revisión

- **`Select` en móvil.** Medía 40 px de alto. Ahora mide 44 px por debajo de 768 px, como `Input` y `Button`. El arreglo es compartido: también lo usa el punto predeterminado de `Mi cuenta`.
- **Filtros de Productos en móvil.** A 320 px, sus tres grupos de chips ocupaban seis filas y empujaban la lista fuera de la vista. Estado y tipo pasan, por debajo de 768 px, tras "Más filtros", que indica cuántos están activos (`data-tables.md`).
- **Encabezado del precio.** Estaba alineado a la izquierda, sobre cifras alineadas a la derecha; ahora va a la derecha.
- **Búsqueda de Terceros.** El texto de ejemplo se cortaba; ahora es "Identificación o nombre", y la etiqueta accesible conserva "Buscar por identificación o razón social".
- **Avisos de éxito.** Duplicaban el punto final cuando la razón social terminaba en punto ("Andina S.A.."); ahora cierran la frase sin duplicarlo.
- **Borde de los chips inactivos.**
  - Un chip inactivo es un control sin seleccionar, de fondo transparente: su única frontera visible es el borde.
  - Con `border-border` medía 1.3:1 en claro y 1.5:1 en oscuro.
  - Ahora usa `border-input`, el token de frontera de los controles (`Input`, `Select`, `SegmentedControl` y `Switch`).
  - Mide 3.5:1 sobre el fondo de la página, 3.6:1 sobre una superficie y 3.3:1 sobre una superficie atenuada en claro; 3.9:1, 3.7:1 y 3.3:1 en oscuro. Valores calculados con los colores de los tokens de cada tema.
  - El arreglo es compartido: `ChipGroup` (también los filtros de Usuarios) y `ChipMultiSelect`. No cambia ningún token.
- **Contraste de las insignias.** La primera medición tomó el color del contenedor de la insignia, que solo colorea el icono, y daba 2.5:1. La medición correcta, sobre el texto, da 15.5:1 o más; `StatusBadge` no cambia.
