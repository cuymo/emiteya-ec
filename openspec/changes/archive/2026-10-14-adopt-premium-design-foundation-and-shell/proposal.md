# Proposal

## Why

El backend y el dominio fiscal están completos, pero el frontend no alcanza la calidad de producto
que necesitan administradores y operadores. Tiene problemas de cuatro tipos:

- **Orientación.** La barra lateral es una lista plana de doce destinos. No existe un ítem
  «Inicio», ni migas de navegación, ni una forma rápida de llegar a un destino o de crear un
  comprobante.
- **Contexto.** La cabecera no muestra la empresa.
- **Sistema visual.** Cada pantalla resuelve su presentación por su cuenta, sobre una escala de
  espaciado de base 8 que no comparte con ningún sistema de componentes de referencia.
- **Estados de ruta.** No hay estados compartidos de carga, error o ruta inexistente.

El propietario adquirió una plantilla de referencia, «Studio Admin» 2.2.0, que trae código fuente
real de primitivos y de un shell de aplicación. La revisión de preparación del 2026-10-14 la
inventarió completa: 73 componentes, 29 reutilizables tal cual y 19 adaptables. Todas las rutas y
recorridos de EmiteYa quedaron mapeados.

Antes de rediseñar cualquier módulo hace falta la base común: los tokens, la escala, los primitivos
y el shell autenticado. Sin ella, cada módulo inventaría su propio sistema visual, que es justo lo
que el rediseño debe evitar.

Este es el primer cambio del rediseño. Establece esa base y el shell sin tocar todavía el contenido
de los módulos de negocio.

## What Changes

- **Base de diseño.** Es técnica y no cambia comportamiento:
  - **Escala.** El espaciado pasa a base 4, la de la plantilla. Cada pantalla existente conserva
    su geometría efectiva, y una prueba visual y geométrica lo demuestra.
  - **Tokens y color.** Los tokens canónicos van en `globals.css`:
    - los neutros y superficies de la plantilla;
    - el azul de EmiteYa como único token primario;
    - los colores semánticos de EmiteYa (éxito, advertencia, información y destructivo);
    - un anillo de foco de alto contraste.
  - **Radios.** Se adopta la escala nombrada de la plantilla y se prohíben los radios arbitrarios.
  - **Controles.** Una sola escala de tamaños: 36 px en formularios y acciones de página, 32 px
    en barras y tablas, y al menos 44 px en móvil.
  - **Fuente.** Geist, una sola familia, servida desde el propio origen.
  - **Primitivos.** Entran solo los que el shell necesita, adaptados desde el código fuente de la
    plantilla, con trazabilidad por componente y sin debilitar la CSP.
- **Shell autenticado** (comportamiento observable, capability nueva `web-application-shell`):
  - **Navegación.**
    - Barra lateral con los grupos aprobados (Inicio, Ventas, Compras, Logística, Documentos,
      Maestros, Análisis y Configuración), filtrada por permisos.
    - Muestra el destino actual.
    - Se colapsa a iconos en escritorio y tableta, y en móvil se abre en un panel lateral.
  - **Barra superior:**
    - migas de navegación derivadas del mismo modelo de rutas;
    - acceso a la paleta de comandos;
    - el contexto de la empresa, solo lectura y sin selector de empresas;
    - el ambiente fiscal;
    - el tema y el menú de cuenta.
  - **Ambiente.** El aviso de Pruebas sigue siendo persistente y no se puede cerrar. Producción se
    identifica con texto e icono, no solo por color.
  - **Creación rápida.** Lleva a las pantallas de creación existentes de los seis comprobantes, sin
    crear ni emitir nada desde el menú.
  - **Paleta de comandos** (Ctrl/⌘ + K). Ofrece navegación y las acciones de creación rápida, sin
    búsqueda en el servidor.
  - **Estados de ruta compartidos:** carga, error, ruta inexistente y destino no permitido.
  - **Accesibilidad.** Se conserva el enlace para saltar al contenido, y los textos para lectores
    de pantalla quedan en español.
- **Marca.** El producto visible pasa a llamarse EmiteYa en lugar de «Facturador SRI», sin logo ni
  favicon inventados.
- **Herramientas de verificación:**
  - **Regresión visual local** con Playwright, con un conjunto canónico pequeño de imágenes base
    versionadas, separado de `verify` por ahora.
  - **Prueba de accesibilidad** del shell.
  - **Reglas de duplicación escalonadas.** Se aplican solo al código nuevo del shell y de los
    primitivos.
- **Decisiones del propietario registradas** (2026-10-14):
  - base de 4 px;
  - tamaños de control;
  - radios de la plantilla, con un ADR que reemplaza la regla de 8 px como máximo;
  - el azul de EmiteYa como primario;
  - los colores de estado;
  - EmiteYa como nombre;
  - Geist;
  - sin React Compiler;
  - sin el arranque de tema ni los preajustes de la plantilla;
  - la CSP intacta.
- **Revisión del propietario de la propuesta** (2026-10-14). Aprobada con un ajuste:
  - **Migas:** aportan jerarquía y no repiten el título. Un destino de primer nivel no muestra
    migas; una pantalla interna sí (Facturas › 001-001-000000123, Configuración › Empresa).
  - **Aprobado tal como estaba propuesto:**
    - el tema por anchura, sin duplicar el control;
    - `empty`;
    - `class-variance-authority`;
    - Geist, condicionado a confirmar que es local, sin red y con licencia clara;
    - las variantes CSS de shadcn copiadas, no instaladas;
    - la creación rápida en `outline`;
    - la guarda de destino no permitido sin destello;
    - los tamaños de botón `legacy-*`, solo transitorios.

### Fuera de alcance

- **Tablas.** No se migran las tablas de datos, y TanStack Table se queda en 8.21.3.
- **Formularios.** No se rediseñan los formularios de negocio: los editores de comprobantes, el
  producto, Empresa ni los catálogos fiscales.
- **Panel de Inicio.** No hay panel ni KPI. Inicio conserva su contenido actual dentro del shell
  nuevo.
- **Rediseño de otros módulos.** No se rediseñan los detalles de comprobantes, terceros, inventario,
  reportes ni configuración.
- **Búsqueda.** No hay búsqueda global con el servidor ni búsqueda por clave de acceso.
- **Borradores.** No se unifican los borradores: el backend no ofrece una consulta paginada
  unificada.
- **Dependencias.** No entran gráficos (Recharts), el selector de rangos de fechas, react-day-picker,
  date-fns, zustand, @base-ui, dnd-kit, vaul, embla, FullCalendar, simple-icons ni Vercel Analytics.
- **Versiones.** No se suben Next, Radix ni Lucide.
- **Backend.** No hay cambios de backend, API, base de datos, dominio fiscal ni motor SRI.
- **SRI.** No hay tráfico al SRI de Pruebas ni de Producción.
- **Comercial.** No hay funciones comerciales, facturación ni suscripciones.
- **Comportamiento futuro.** No se implementan la confirmación reforzada de secuenciales en
  Producción ni el recálculo explícito de los editores; quedan para sus fases.

## Capabilities

### New Capabilities

- `web-application-shell`: el shell autenticado de la interfaz web. Cubre la disponibilidad del
  shell, el contexto visible de la empresa y del ambiente fiscal, la navegación según permisos y el
  destino actual. También la navegación adaptable, las migas, la creación rápida, la paleta de
  comandos, el tema, el menú de cuenta, el enlace para saltar al contenido, los estados de ruta
  compartidos y el nombre visible del producto.

### Modified Capabilities

Ninguna. El aviso persistente del ambiente (`taxpayer-setup`), el aviso de vencimiento de la firma
(`signing-certificate`), el inicio y cierre de sesión (`user-access`) y la política de seguridad del
navegador (`web-security-policy`) siguen igual. El shell nuevo debe seguir cumpliéndolos.

## Impact

- **Frontend** (`frontend/src/`):
  - `app/globals.css`, `app/layout.tsx`, `app/(app)/layout.tsx` y los archivos nuevos `loading`,
    `error` y `not-found`;
  - `components/ui/` (primitivos derivados de la plantilla) y `components/shell/` (nuevo);
  - el modelo de rutas canónico y el hook `use-mobile`;
  - `components/app-shell.tsx` y `components/navigation.tsx`, que el shell nuevo reemplaza;
  - los `metadata` de las 42 páginas, para el nombre del producto;
  - una pasada mecánica sobre las clases de espaciado de todos los archivos `.tsx` para la base de
    4 px, sin cambio visual.
- **Pruebas:**
  - `frontend/test/app-shell.test.tsx` se actualiza conservando cada comportamiento;
  - pruebas nuevas del shell, la paleta y la creación rápida;
  - el harness visual con Playwright y la prueba de accesibilidad;
  - `scripts/check-web-security-policy.ts` conserva sus selectores y añade los flujos del shell.
- **Dependencias** (versión exacta y una revisión por paquete):
  - de ejecución: `cmdk`, `class-variance-authority`, `tw-animate-css` y `geist`;
  - las variantes CSS de shadcn que exigen los primitivos copiados: copiadas o como paquete, según
    `design.md`;
  - de desarrollo: `@playwright/test` y `@axe-core/playwright`.
- **Documentación** (al implementar):
  - `design-foundations.md`, `component-system.md`, `navigation-responsive.md`, `frontend.md`,
    `stack.md` y `testing.md`;
  - un ADR nuevo de adopción del sistema de diseño y del código fuente de la plantilla;
  - `frontend/THIRD_PARTY_NOTICES.md`, con el aviso MIT de la plantilla.
- **Sin impacto** en backend, API, base de datos, contratos, dominio fiscal, motor SRI, despliegue
  ni CI.
