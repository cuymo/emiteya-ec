# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para las pantallas de D14: aviso de ambiente en
el shell, Inicio (preparación para emitir), Empresa (con el logo), Ambiente, Establecimientos y el
punto predeterminado de Mi cuenta. Fecha: 2026-10-02.

## Método

- Recorridos automatizados con Chrome (Playwright con el Chrome del sistema, en un directorio
  temporal fuera del repositorio) contra el backend y el frontend reales en desarrollo, sobre una
  instalación nueva aprovisionada en un esquema aislado de la base de pruebas. Cada recorrido parte
  de cero. Las capturas se inspeccionaron.
- Pruebas de componentes en `frontend/test/` (Vitest con jsdom y Testing Library, por rol y nombre
  accesible), dentro de `corepack pnpm verify`.
- Contraste calculado sobre los tokens OKLCH en ambos temas.

## Aviso de ambiente e Inicio (tareas 7.1 y 7.2)

30 comprobaciones contra el backend real, todas correctas:

- Inicio de una empresa nueva con los tres requisitos pendientes y la acción principal al primero.
- Configuración mínima con la firma pendiente y sin acción para ella.
- Operador sin enlaces y con a quién pedírselo.
- Cambio de ambiente visto por otra sesión al recargar, sin volver a iniciar sesión.
- Esqueleto de carga y error con reintento, con "Ambiente desconocido" y nunca Producción.
- Móvil a 375 y 320 px, tema oscuro y teclado (primer Tab al enlace para saltar).

## Empresa y Ambiente (tarea 8.6)

40 comprobaciones contra el backend real, todas correctas:

- Ambiente sin datos, con la acción deshabilitada y su explicación.
- Primer registro: errores asociados a su campo, foco en el primero inválido, valores conservados.
- Versión 1, corrección a la versión 2 y guardado sin cambios sin versión nueva.
- Doble clic con un solo envío.
- Conflicto entre dos pestañas, con `Recargar` que trae la versión vigente.
- Logo: carga con vista previa, reemplazo, contenido falso rechazado por el servidor, tipo y tamaño avisados antes de enviar, y eliminación con confirmación.
- RUC bloqueado con la operación interna, mostrado como etiqueta, con los demás datos corregibles.
- Ambiente: cancelar sin efecto, confirmación bloqueada hasta escribir el RUC, paso a Producción que retira la franja, y vuelta a Pruebas en un paso.
- Operador sin permiso en ambas pantallas.
- Sin desbordamiento a 320, 375, 640 (equivalente a 200 % de zoom), 768, 1024 y 1440 px.
- Sin respuestas de error inesperadas ni errores de consola o hidratación.

| Sección | Resultado |
| --- | --- |
| Antes de construir | Briefs, niveles P0-P3 y acción principal de D14; el historial de versiones es P3 y queda fuera de la pantalla. |
| Tarea y jerarquía | Una acción principal por pantalla (`Guardar datos`, `Cambiar a Producción` o `Volver a Pruebas`, el primer requisito pendiente en Inicio). Empresa es página completa por secciones, como pide D14 para un registro largo y de alto riesgo. Ambiente es un destino propio, separado de la edición de datos. |
| Datos y lenguaje | Etiquetas de negocio (`Pruebas`, `Producción`, `Obligada a llevar contabilidad`, `Régimen RIMPE`). Sin identificadores de assets ni rutas de almacenamiento: el logo se muestra como "Logo vigente" con su tipo y tamaño. |
| Fundamentos | Espaciado, radios y capas de las escalas. Estados con icono y texto. El foco visible lo da el estilo global `:focus-visible`. |
| Selección de componentes | Contabilidad con `SegmentedControl` sin preselección (se declara, no se infiere). RIMPE con tarjetas de selección (tres opciones con consecuencias distintas). Casillas que revelan el número de contribuyente especial y de resolución, aplicadas al guardar. El logo, que se aplica en el acto, con `FileField` fuera del formulario. |
| Formularios y diálogos | React Hook Form con las reglas del contrato (XSD); los campos condicionados se validan solo con su casilla marcada. Envío duplicado bloqueado también durante la validación. Confirmación escrita para pasar a Producción y de un paso para eliminar el logo o volver a Pruebas. |
| Feedback y estado | Toda mutación pasa por `useMutationFeedback`. El conflicto de versión se muestra junto al formulario con `Recargar`. La franja de Pruebas es el único aviso persistente, porque la condición lo es. |
| Navegación y responsive | Empresa y Ambiente en `Configuración`, solo para administradores. Por debajo de 640 px el distintivo de ambiente no cabe en la cabecera: Producción se indica con una línea bajo ella (hallazgo corregido). |
| Rendimiento | Una consulta por pantalla. El logo se revalida con `ETag`. |
| Tema y accesibilidad | Ambos temas revisados en página y diálogo. Contraste de texto de 5.8:1 o más, incluido el de la franja (15.9:1 en claro, 8.7:1 en oscuro). Landmarks y encabezados en orden. La franja se anuncia con `role="status"`. |

## Establecimientos (tarea 9.2)

25 comprobaciones contra el backend real, todas correctas:

- Estado vacío como requisito pendiente.
- Diálogo abierto por teclado, cerrado con Escape y con el foco de vuelta en el botón.
- Código duplicado en su campo con los valores conservados.
- Alta de puntos.
- Corrección de la dirección con el código como etiqueta.
- Desactivación del establecimiento con aviso sobre sus puntos y `Deshacer` que lo reactiva.
- Puntos no disponibles por un establecimiento inactivo, con su explicación.
- Desactivación de un punto.
- Inicio refleja el punto disponible.
- Operador sin destino y sin permiso por URL.
- Móvil a 375 y 320 px sin desbordamiento, con todas las acciones de 44 px.
- Diálogo en tema oscuro.
- Barrido a 640, 768, 1024 y 1440 px.
- Sin respuestas de error inesperadas ni errores de consola.

| Sección | Resultado |
| --- | --- |
| Antes de construir | Brief de D14; lista agrupada por volumen pequeño (D7), sin fechas (P2) ni identificadores (P3). |
| Tarea y jerarquía | `Crear establecimiento` es la única acción principal, junto al título. Las acciones de cada establecimiento y punto están en su fila, con tooltip y nombre accesible. |
| Datos y lenguaje | `Establecimiento 001`, `Punto 001-002`, `Activo`, `Inactivo`, `Disponible` y `No disponible` con su motivo; ningún identificador interno visible. |
| Selección de componentes | Alta y corrección en `FormDialog` (registros cortos); desactivar en un paso con `Deshacer`; iconos distintos para desactivar y reactivar. |
| Tablas | Se declara la excepción de abajo; los estados usan `StatusBadge` con icono y texto. |
| Formularios y diálogos | Reglas del contrato en el cliente (tres dígitos, dirección de una línea); envío duplicado bloqueado también durante la validación; errores de código en su campo. |
| Navegación y responsive | Destino `Establecimientos` en `Configuración` solo para administradores; en móvil, las acciones bajan a su propia fila con objetivos de 44 px. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Contraste de 3:1 para iconos significativos | El icono de advertencia (`--warning`) mide 2.5:1 sobre la franja en tema claro (5.3:1 en oscuro). Es decorativo (`aria-hidden`), siempre acompaña a un texto que lleva el significado y es el mismo tono que ya usa `StatusBadge`. Oscurecerlo exige un token nuevo en `design-foundations.md`, fuera de este cambio. |
| Tablas | Empresa, Ambiente e Inicio no son colecciones. Establecimientos es una lista agrupada y no `AppDataTable`, porque el MVP espera decenas de establecimientos con sus puntos anidados (D7, Q-26): búsqueda, filtros y paginación se añaden si el volumen lo pide. |
| Editar, detalle y eliminar como registro | La configuración es un único registro vigente: se corrige en la misma página y no se elimina; el historial es P3. |
| Atajos y vistas guardadas | Uso raro (D14); no se añaden aceleradores. |

## Hallazgos corregidos durante la revisión

- A 320 px el distintivo de ambiente empujaba el menú de cuenta fuera de la cabecera.
- Un doble clic en `Guardar datos` podía enviar dos veces, porque el botón seguía activo durante la validación asíncrona del formulario.
- Los iconos de desactivar y reactivar en Establecimientos eran dos círculos casi iguales: reactivar usa ahora una flecha de restaurar.
