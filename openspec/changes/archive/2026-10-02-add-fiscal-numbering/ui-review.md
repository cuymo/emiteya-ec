# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para la pantalla `Secuenciales` y su diálogo
`Ajustar` (design D14). Fecha: 2026-10-02.

## Método

- Recorrido automatizado con Chrome (Playwright con el Chrome del sistema, en un directorio
  temporal fuera del repositorio) contra el backend y el frontend reales en desarrollo, sobre una
  instalación nueva aprovisionada en un esquema aislado de la base de pruebas. Las reservas
  concurrentes y el agotamiento se provocan con la operación interna de reserva, porque no tiene
  ruta HTTP (design D4). Las capturas se inspeccionaron.
- Pruebas de componentes en `frontend/test/sequences-screen.test.tsx` y `app-shell.test.tsx`
  (Vitest con jsdom y Testing Library, por rol y nombre accesible), dentro de `corepack pnpm verify`.
- Contraste calculado sobre los tokens OKLCH en ambos temas.

## Secuenciales y Ajustar (tareas 5.1 a 5.3)

53 comprobaciones contra el backend real, todas correctas:

- Destino `Secuenciales` en `Configuración` y título de la pestaña.
- Vacío sin puntos de emisión, con enlace a Establecimientos.
- Parte del ambiente vigente (Pruebas).
- Esqueleto de carga.
- Seis tipos por punto, con el número completo del siguiente y `—` sin reservas.
- Puntos no disponibles con su motivo (punto inactivo, establecimiento inactivo), que siguen admitiendo el ajuste.
- Avance con el aviso "Los números del 1 al 1500 no se usarán." y el foco en el campo al abrir.
- Doble clic con un solo `PUT`.
- Conflicto con una reserva concurrente, con `Recargar` que trae el siguiente y el último reservado vigentes.
- Retroceso: revela `Motivo` y su aviso, que es obligatorio.
- Número reservado señalado en su campo con el dato real; el servidor también lo rechaza con `SEQUENCE_NUMBER_RESERVED`.
- Escape cierra y devuelve el foco a `Ajustar`.
- Reserva del 999999999 y agotamiento:
  - la fila muestra "Agotado" con su explicación y `Ajustar` deshabilitado;
  - el valor interno no aparece en la página.
- Pruebas y Producción con secuencias propias; volver a Pruebas la conserva.
- Teclado: el selector de ambiente con flechas y Espacio, y `Ajustar` con Enter.
- Error de carga con el mensaje genérico, que se recupera al reintentar.
- Operador: sin destino, sin permiso por URL y `403` en la API.
- Móvil a 375 y 320 px:
  - sin desbordamiento;
  - acciones y selector de ambiente de 44 px;
  - el diálogo cabe en la pantalla.
- Tema oscuro en página y diálogo.
- Barrido a 640, 768, 1024 y 1440 px.
- Sin errores de consola. Las únicas respuestas fallidas son las provocadas: la comprobación de sesión antes de iniciarla, los `409` buscados y el `503` simulado.

| Sección | Resultado |
| --- | --- |
| Antes de construir | Brief de D14 (usuario, objetivo, decisión, información mínima y acción principal) en el encabezado del componente. Fechas e identificadores son P2-P3 y quedan fuera. |
| Tarea y jerarquía | Sin acción global: `Ajustar` vive en la fila de cada contador, con tooltip y nombre accesible que nombra el tipo. El selector de ambiente acompaña al título porque filtra toda la lista. |
| Datos y lenguaje | `Punto 001-002`, nombres de los seis tipos, número completo `001-002-000000101`, `Último reservado` con nueve dígitos o `—`, `No disponible` con su motivo y "Agotado". Ningún identificador interno, código de tipo ni el valor interno de agotado visible. |
| Fundamentos | Escalas de espaciado y radios; números con cifras tabulares; estados con icono y texto. |
| Selección de componentes | `SegmentedControl` para dos ambientes visibles a la vez. Entrada numérica exacta para el secuencial (`inputMode="numeric"`, nueve dígitos). `FormDialog` para un registro corto. |
| Tablas | Se declara la excepción de abajo; los estados usan `StatusBadge`. |
| Formularios y diálogos | React Hook Form con las reglas del contrato en el cliente: rango, mayor que el último reservado y motivo al retroceder. El motivo aparece solo al retroceder y no se envía al avanzar. Envío duplicado bloqueado, también con Enter. Un error conserva lo escrito y enfoca el campo. |
| Feedback y estado | La mutación pasa por `useMutationFeedback`, con éxito que nombra el tipo, el punto, el ambiente y el número. El conflicto se explica junto a `Recargar`; los demás errores de la operación, en el cuerpo del diálogo. |
| Navegación y responsive | `Secuenciales` en `Configuración`, solo con `sequences.read`. En móvil las filas apilan tipo, siguiente y último reservado, con la acción a la derecha y 44 px. |
| Rendimiento | Una consulta por ambiente, en caché al alternar. Sin peticiones en cascada: el ambiente vigente sale de la consulta de estado ya compartida con el shell. |
| Tema y accesibilidad | Ambos temas revisados en página y diálogo. Texto atenuado a 6.8:1 (claro) y 7.1:1 (oscuro). Icono de "Agotado" a 4.4:1 y 5.0:1, y su texto a 15.2:1 y 13.6:1. Un `h1` y un `h2` por punto; las listas tienen nombre accesible. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Tablas | Secuenciales es una lista agrupada por punto y no `AppDataTable`, igual que Establecimientos, por el volumen esperado (decenas de puntos, Q-26). La paginación está registrada como deuda técnica junto con la de Establecimientos. |
| Crear, detalle y eliminar | Los contadores nacen con la primera reserva o el primer ajuste y no se eliminan (design D2 y D3); la pantalla solo consulta y ajusta. |
| Tooltip de una acción deshabilitada | Un botón deshabilitado no recibe el puntero ni el foco, así que el tooltip no explica por qué un contador agotado no se ajusta: la explicación va visible en la fila. |

## Hallazgos corregidos durante la revisión

- `SegmentedControl` medía 32 px de alto en móvil. Ahora mide 44 px por debajo de 768 px, como pide `docs/architecture/frontend.md`. El arreglo vale también para el selector de contabilidad de Empresa, revisado en el barrido.
- `Recargar` aparecía encima del mensaje de conflicto que lo explica: ahora van juntos, primero el mensaje y luego la acción.
- La explicación de "Agotado" dependía del tooltip de un botón deshabilitado: ahora es texto visible.
