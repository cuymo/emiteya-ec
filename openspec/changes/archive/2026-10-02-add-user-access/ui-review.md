# Revisión de la interfaz (tarea 7.6)

Revisión de `docs/quality/frontend-checklist.md` para las tres pantallas de D12: Iniciar sesión,
Usuarios y Mi cuenta, más el shell autenticado. Fecha: 2026-10-02.

## Método

- Recorrido automatizado con Chrome contra el backend y el frontend reales en desarrollo
  (PostgreSQL de Compose): 50 comprobaciones, todas correctas, sin errores de consola ni de
  hidratación. Cubre los estados de las tres pantallas, teclado, foco, dos sesiones simultáneas,
  sesión vencida durante el uso, límite de intentos, 1 y más de 300 usuarios, sin coincidencias,
  móvil (375 y 320 px), cajón de navegación y tema oscuro. Las capturas se inspeccionaron.
- Pruebas de componentes en `frontend/test/` (Vitest con jsdom y Testing Library, por rol y nombre
  accesible), dentro de `corepack pnpm verify`.
- Contraste medido sobre los tokens OKLCH en ambos temas.

## Resultado por sección

| Sección | Resultado |
| --- | --- |
| Antes de construir | Briefs, niveles P0-P3 y presupuesto de acciones de D12; nada se muestra solo porque el backend lo devuelva (`/me` y la lista usan listas permitidas). |
| Tarea y jerarquía | Una acción principal por pantalla (`Iniciar sesión`, `Crear usuario`, `Cambiar contraseña`); título único; filtros junto a la tabla; sin tarjetas ni paneles decorativos. |
| Datos y lenguaje | Etiquetas de negocio (`Administrador`, `Operador`, `Activo`, `Desactivado`); sin identificadores, nombres de proveedor ni detalles de autenticación; fechas con `es-EC`. |
| Fundamentos | Espaciado, radios, capas y duraciones de las escalas; estado con icono y texto; estados de interacción en cada control; pendiente inmediato con geometría estable. |
| Selección de componentes | Rol con tarjetas de selección (dos opciones con consecuencias distintas); estado con chips; tema con control segmentado (menú de un botón por debajo de 640px); contraseña con mostrar u ocultar. |
| Tablas | Tabla compartida con paginación común (`Mostrando A-B de N`, `Filas`, primera a última), búsqueda con pausa, chips, columna opcional `Fecha de alta`, hasta tres acciones de fila con tooltip, fila propia sin acciones de acceso y con explicación, esqueleto, vacío, sin coincidencias, error con reintento y tarjetas en móvil. |
| Formularios y diálogos | React Hook Form y los esquemas Zod del contrato; errores asociados al campo; valores conservados ante errores; doble envío bloqueado; foco dentro del diálogo y de vuelta al disparador; Escape y cierre; desactivar en un paso con `Deshacer`. |
| Feedback y estado | Toda mutación pasa por `useMutationFeedback`; avisos semánticos desplegados, legibles en ambos temas y en móvil; errores desconocidos saneados con referencia; consultas canceladas al cambiar el alcance. |
| Navegación y responsive | Dos niveles como máximo; solo el destino actual con tratamiento sólido; mismo menú en barra lateral y cajón; cabecera estable; sin desbordamiento a 320, 375 y 1280px. |
| Rendimiento | Lista paginada en el servidor (máximo 100 por página); sin consultas en cascada. |
| Tema y accesibilidad | Contraste de texto de 5:1 o más en ambos temas; borde de controles de 3.6:1 (token `--input`); iconos de estado de 4.4:1 o más; foco visible; landmarks y encabezados; objetivos táctiles de 44px por debajo de 768px; movimiento solo con `motion-safe` y avisos que respetan `prefers-reduced-motion`; se puede pegar la contraseña. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Ordenar columnas | D10 no define parámetros de orden; la API ordena por nombre. Ofrecerlo cambiaría el contrato de la API. |
| La fila abre el registro; editar, detalle y eliminar | No hay vista de detalle: nombre, correo, rol y estado ya están en la fila, y auditoría e historial son P3 fuera de la pantalla. Editar nombre o correo y eliminar están fuera de alcance (proposal); se desactiva en su lugar. |
| Navegación reordenable, archivos y trabajos en segundo plano | No aplican a estas pantallas. |
| Atajos y vistas guardadas | Uso ocasional (D12); no se añaden aceleradores. |

## Hallazgos corregidos durante la revisión

- El foco no volvía al disparador al cerrar un diálogo controlado: el diálogo base recuerda quién lo abrió.
- Un 401 de `/api/auth/change-password` no llevaba al inicio de sesión: la sesión vencida se trata igual venga de la API propia o de Better Auth.
- Una página fuera de rango mostraba un intervalo imposible: se lleva a la última página.
- En móvil, la cabecera partía el nombre del producto y los correos se cortaban a mitad de palabra.
- El borde de los campos no alcanzaba 3:1.
- Un aviso nuevo tapaba la acción `Deshacer` de uno anterior: los avisos se muestran desplegados.
