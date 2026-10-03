# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para la pantalla `Catálogos fiscales`
(`/configuracion/catalogos-fiscales`, design D17). Fecha: 2026-10-03.

## Método

- Recorrido automatizado con Chrome (Playwright con el Chrome del sistema, en un directorio
  temporal fuera del repositorio) contra el backend y el frontend reales en desarrollo, sobre una
  instalación nueva aprovisionada en un esquema aislado de la base de pruebas. El backend carga los
  datasets al arrancar, como en producción.
- El error de carga se provoca con una respuesta `503` simulada del navegador. El estado sin
  permiso se provoca con un `403` simulado, porque ningún rol carece de `fiscalCatalogs.read`.
- Las capturas se inspeccionaron, a página completa y por zonas (encabezado, ICE, secciones de
  solo lectura) en escritorio, a 320 px y a 375 px en tema oscuro.
- Pruebas de componentes en `frontend/test/fiscal-catalogs-screen.test.tsx`,
  `decimal-format.test.ts` y `app-shell.test.tsx` (Vitest con jsdom y Testing Library, por rol y
  nombre accesible), dentro de `corepack pnpm verify`.
- Contraste medido en el navegador sobre los colores calculados, con los fondos translúcidos
  compuestos sobre su fondo real, en ambos temas.

## Catálogos fiscales (tareas 6.1 y 6.2)

39 comprobaciones contra el backend real, todas correctas:

- **Navegación:**
  - destino `Catálogos fiscales` en `Configuración`, antes de `Secuenciales`;
  - título de la pestaña "Catálogos fiscales · Facturador SRI".
- **Carga:** esqueleto mientras llegan los catálogos.
- **IVA:**
  - las nueve tarifas de la ficha;
  - el 15 % con código, tarifa formateada ("15 %") y "Base del proyecto: ficha v2.34 (27/07/2026)";
  - el IVA diferenciado (código 8) sin tarifa inventada.
- **Fechas y fuente:**
  - las formas de pago dicen "Desde 01/06/2016 (declarada por la fuente)";
  - cada catálogo muestra su fuente y la versión de su dataset;
  - ningún texto presenta una fecha como vigencia legal.
- **Habilitación:**
  - cada `Switch` tiene el nombre accesible de su entrada;
  - deshabilitar y habilitar confirman con un toast que nombra la entrada;
  - la decisión persiste al recargar, y la API la devuelve como decisión de la empresa (`COMPANY`).
- **ICE:**
  - 75 entradas, deshabilitadas por defecto;
  - el filtro local reduce "cerveza industrial" a sus cinco entradas;
  - los códigos repetidos muestran su variante (`3041-GRAN-ESCALA`, …);
  - con el teclado, Espacio habilita un ICE.
- **Solo lectura (P2):**
  - consumidor final con su monto ("USD 50,00") e identidad;
  - matriz con el anexo 26 como condición del go-live;
  - registro de esquemas;
  - tipo `07` reservado al consumidor final.
- **Error:** el mensaje genérico aparece con `Reintentar`, y reintentar recupera la pantalla.
- **Operador:**
  - ve el destino y la pantalla;
  - los `Switch` están en solo lectura, con la explicación visible y anunciada en cada uno;
  - la API rechaza su habilitación con `403`.
- **Sin permiso:** el `403` se explica sin mostrar datos.
- **Móvil a 375 y 320 px:**
  - sin desbordamiento;
  - objetivos de 44 px o más (`Switch`, filtro y resúmenes de las secciones de solo lectura);
  - sin errores de consola.
- **Tema oscuro:** sin errores de consola.
- **Barrido a 640, 768, 1024 y 1440 px:**
  - pantallas Inicio, Catálogos fiscales, Empresa, Ambiente, Establecimientos, Firma electrónica, Secuenciales, Usuarios y Mi cuenta;
  - sin desbordamiento y con la cabecera completa;
  - a 320 y 375 px, sin desbordamiento en Inicio y Catálogos fiscales.
- **Consola y red:**
  - sin errores de consola;
  - las únicas respuestas fallidas son las provocadas: la comprobación de sesión antes de iniciarla y el `503` simulado.

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D17 (usuario, objetivo, decisión y acción principal) está en el encabezado de `catalogs-screen.tsx`, con P0 a P2. El historial de datasets (P3) queda fuera. |
| Tarea y jerarquía | No hay un botón focal: la acción es el `Switch` de cada entrada. Primero van IVA y formas de pago (P0), después ICE con su filtro e IRBPNR (P1). Las secciones de solo lectura (P2) se pliegan en `Más datos oficiales`. |
| Datos y lenguaje | Denominación oficial tal como la publica la ficha; código con cifras tabulares; variante solo cuando difiere del código. La tarifa usa el formateador de cadenas, sin `number`. Cada fecha dice su origen, declarada por la fuente o base del proyecto. ICE e IRBPNR dicen que no tienen tarifa transcrita, en vez de inventarla. |
| Fundamentos | Escalas de espaciado y radios. El estado se muestra con texto visible ("Habilitada" o "Deshabilitada") además del color del `Switch`. "No vigente hoy" usa `StatusBadge`. |
| Selección de componentes | `Switch` nuevo (Radix) para la habilitación al instante (`component-selection.md`). La lista con divisores sustituye a una tabla: cada entrada es una fila con texto y un control. `details` para las secciones de solo lectura. |
| Formularios y diálogos | No hay formularios. El filtro de ICE es local y tiene su etiqueta visible. |
| Feedback y estado | `useSetEnablement` pasa por `useMutationFeedback`, con un toast que nombra la entrada y la empresa. Los `Switch` se bloquean mientras guarda. El error de carga y el `403` usan `ErrorState`. |
| Navegación y responsive | `Catálogos fiscales` en `Configuración`, con `fiscalCatalogs.read`. Por debajo de 640 px, el estado y el `Switch` pasan a su propia línea, bajo la denominación. |
| Rendimiento | Nueve consultas en paralelo al cargar: el resumen, las entradas de cada catálogo y las tres lecturas de solo lectura. Son lecturas pequeñas de datos que no cambian con el uso. La habilitación invalida solo las listas de entradas. El filtro de ICE no hace peticiones. |
| Tema y accesibilidad | Ambos temas revisados. Claro y oscuro: denominación a 17.7:1 y 15.3:1; fecha y base atenuadas a 6.8:1 y 7.1:1; pista del `Switch` activo a 6.1:1; borde del `Switch` inactivo a 3.6:1 en ambos. Un `h1`, un `h2` por catálogo, listas con `aria-label`. El texto del estado es `aria-hidden` porque el `Switch` ya anuncia su estado. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Estado sin permiso alcanzable | Ningún rol carece de `fiscalCatalogs.read`. El estado existe por defensa en profundidad y se comprueba con una prueba de componente y con el `403` simulado en el recorrido. |
| Contraste de 3:1 para iconos significativos | El icono de advertencia de `StatusBadge` "No vigente hoy" es decorativo (`aria-hidden="true"`), como en la franja de ambiente (excepción ya declarada en `add-taxpayer-setup`). Ninguna entrada de la versión 1 está fuera de vigencia hoy, así que la insignia solo aparece en las pruebas de componentes. |
| Tablas y paginación | Las 75 entradas de ICE se muestran como lista filtrable, sin paginación. Son datos de la versión instalada, no crecen con el uso. |
| Eliminar o editar | Los datos oficiales no se editan ni se eliminan (design D4). Solo cambia la habilitación por empresa. |

## Hallazgos corregidos durante la revisión

- A 320 px, el estado y el `Switch` ocupaban unos 150 px de cada fila. Así, la columna de la
  denominación se quedaba en unos 110 px y las denominaciones de ICE se partían palabra por
  palabra. Por debajo de 640 px, el estado y el `Switch` pasan ahora a su propia línea, bajo la
  denominación. El recorrido y el barrido se repitieron después del cambio.
