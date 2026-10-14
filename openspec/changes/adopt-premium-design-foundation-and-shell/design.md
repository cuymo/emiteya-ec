# Design

## Context

La motivación está en `proposal.md`, y el comportamiento en `specs/web-application-shell/spec.md`.
La revisión de preparación del 2026-10-14 inventarió la plantilla y el frontend. Este es el estado
observado en `redesign-frontend` (`2a3abdc`).

**Frontend** (`frontend/src/`):
- Next 16.3.8, React 19.3.0, Tailwind 4.3.3 configurado en CSS y radix-ui 1.6.7.
- `globals.css` define `--spacing: 0.5rem` (base 8), radios de 4, 6 y 8 px, la fuente del sistema
  y tokens OKLCH propios: `surface`, `surface-subtle`, `foreground-muted`, `danger`, `neutral`,
  `overlay` y las capas `--z-*`.
- Sobre esa escala hay unas 1.532 clases de espaciado repartidas en 127 archivos `.tsx`.
- Primitivos propios:
  - `components/ui/button.tsx`, sin cva, con tamaños `md` (40 px), `sm` (32), `icon` (44) e
    `icon-sm` (40). Lo importan 45 archivos.
  - `components/ui/menu-and-tooltip.tsx`, importado por 4 archivos.
  - `components/ui/dialog.tsx`, que devuelve el foco también en diálogos controlados.
  - `components/states.tsx`, con `Skeleton`, `StatusBadge` y `EmptyState`. 44 archivos usan
    su `Skeleton`.
- Shell actual:
  - `components/app-shell.tsx`: cabecera de 64 px con marca «Facturador SRI», tema, cuenta, cajón
    móvil hecho con `Dialog` y enlace para saltar al contenido.
  - `components/navigation.tsx`: grupos «Operación» y «Configuración».
  - `app/(app)/layout.tsx` compone `EnvironmentNotice`, `CertificateNotice` y `EnvironmentBadge`.
- **CSP** (`lib/web-security-policy.ts`, ADR 0025):
  - nonce por petición en los scripts;
  - `style-src-elem 'self' 'unsafe-inline'`, una deuda declarada;
  - `style-src-attr 'none'`;
  - `img-src`, `font-src` y `connect-src` limitados al propio origen.

  Un atributo `style` renderizado en el servidor queda bloqueado. Los estilos que React aplica en
  el cliente por CSSOM no.
- `next.config.ts` reescribe `/api/:path*` como `fallback`, después de las rutas dinámicas. Por
  eso una ruta comodín en `app/` taparía la API.
- **Pruebas:**
  - 465 pruebas de Vitest y jsdom, que consultan por rol y texto.
  - `scripts/check-web-security-policy.ts` usa `playwright-core` 1.64.0 con el Chrome del sistema
    y depende de:
    - las etiquetas «Correo», «Contraseña» e «Iniciar sesión»;
    - el botón `/^Cuenta de /`;
    - los enlaces «Comprobantes» y «Usuarios»;
    - el radiogroup «Tema» con «Oscuro» y «Claro»;
    - el ítem de menú «Cerrar sesión».
- Ninguna spec vigente describe el shell. `taxpayer-setup` («Aviso persistente del ambiente»),
  `signing-certificate` («Aviso de vencimiento de la firma») y `user-access` siguen vigentes, y el
  shell nuevo debe seguir cumpliéndolos.

**Plantilla** («Studio Admin», paquete `studio-admin` 2.2.0, MIT, © 2024 Mohammed Arham Khan):
- Está fuera del repositorio, en `../template-shadcn-premium/`: 351 archivos, con un manifiesto
  SHA-256 `68d37d29c57cef002eed931143b55106d1be06941dad1602af02da14bf7ad7c5`. El manifiesto es
  `find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum`, ejecutado desde su raíz.
- El propietario declara que el código se adquirió legítimamente. En el árbol no hay más términos
  que el MIT.
- Primitivos en `src/components/ui/`, estilo `radix-nova`, con cva y las variantes `data-open` y
  `data-closed` de `shadcn/tailwind.css`, sobre `tw-animate-css`.
- Shell en `src/app/(main)/dashboard/` (`layout.tsx`, `_components/sidebar/*`, `_components/header/*`).
- Base de 4 px, `--radius` de 0,625 rem, neutros OKLCH y ningún token semántico de estado.

## Goals / Non-Goals

**Goals:**
- Una sola base de diseño (escala, tokens, radios, tamaños de control y fuente) derivada de la
  plantilla, de la que hereda todo componente futuro.
- Los primitivos del shell, adaptados desde el código fuente real de la plantilla, con trazabilidad
  por componente.
- El shell autenticado que define la spec, sobre un único modelo de rutas.
- La geometría efectiva de cada pantalla actual sin cambios hasta su rediseño, con una prueba
  reproducible.
- Un harness visual local y reglas contra la duplicación, aplicadas solo al código nuevo.

**Non-Goals** (además de lo que excluye la propuesta):
- Rediseñar el contenido de una pantalla de negocio. Cada pantalla conserva su `h1`, sus estados,
  sus tablas y sus formularios, que heredan solo los tokens y los primitivos que ya usan.
- Pasar a los primitivos nuevos lo que el shell no necesita: Input, Select, Dialog, Switch, Table y
  otros. `StatusBadge`, `EmptyState` y `NoticeStrip` siguen como están.
- Reglas de duplicación sobre el código heredado.

## Decisions

### D1. Procedencia, ubicación y trazabilidad de la plantilla

- **Ubicación.** La plantilla vive fuera del repositorio, en `../template-shadcn-premium/`, y nunca
  se versiona. Un primitivo derivado se copia a `frontend/src/components/ui/` o al shell, y se
  adapta ahí.
- **Trazabilidad.** `tasks.md` registra, por cada componente copiado o adaptado:
  - la ruta de origen;
  - la ruta de destino;
  - la clasificación (TEMPLATE-DERIVED, EMITEYA-EXISTING o NEW SHARED);
  - las adaptaciones;
  - los cambios por CSP y por accesibilidad;
  - las pruebas.
- **Aviso MIT.** `frontend/THIRD_PARTY_NOTICES.md` (al implementar) conserva el aviso y lista los
  archivos derivados.
- **Sin cabeceras por archivo.** El aviso vive en un solo lugar, más un comentario corto de
  procedencia por archivo derivado.
- **Términos de compra.** Si aparecen términos de compra fuera del árbol, no se afirma que el MIT
  los reemplace: se informa al propietario.

### D2. Capas y carpetas

```text
components/ui/            L1  primitivos (TEMPLATE-DERIVED adaptados, más los EMITEYA-EXISTING que siguen)
components/shell/         L2  AppShell, AppSidebar, Topbar, AppBreadcrumbs, CommandPalette,
                              QuickCreateMenu, AccountMenu, CompanyContext (presentación)
components/route-states/  L2  RouteLoading, RouteError, RouteNotFound, RouteForbidden
lib/navigation/           --  modelo de rutas canónico (D10)
hooks/use-mobile.ts       --  derivado de la plantilla (alias `@/hooks` ya declarado en components.json)
features/company/         L3  conexión de datos del contexto de empresa y del ambiente (ranuras del shell)
```

- **Sin dependencias hacia el dominio.** El shell no importa features. Los datos de empresa y
  ambiente entran por ranuras desde `app/(app)/layout.tsx`, como hoy `notice` y `status`.
- **Lo que se reemplaza y se borra:** `components/app-shell.tsx` y `components/navigation.tsx`.

### D3. Escala de espaciado: de base 8 a base 4 sin cambio de geometría

- **Mecanismo:** un codemod de un solo uso, `scripts/codemods/rebase-spacing-to-4px.ts`, escrito en
  TypeScript y ejecutado con el type stripping de Node, como los demás scripts.
  - Recorre los literales de cadena y de plantilla de `frontend/src/**/*.{ts,tsx}` con el API del
    compilador de TypeScript, que ya es dependencia de la raíz.
  - Cada token de clase se separa en variantes (`max-md:`, `hover:`, `[&>svg]:`), importante
    (`!`), signo y utilidad.
  - Duplica el valor numérico de las utilidades que en Tailwind 4 multiplican `--spacing`:
    - espaciado: `p*`, `m*`, `gap*`, `space-x/y`;
    - tamaño: `w`, `h`, `size`, `min-w/h`, `max-w/h` (solo con número);
    - posición: `inset*`, `top`, `right`, `bottom`, `left`, `start`, `end`, `translate-x/y`;
    - otras: `scroll-m*`, `scroll-p*`, `basis`, `indent`, `leading-<n>`, `border-spacing*`.
  - No toca:
    - el `0`, `px`, fracciones, `auto`, `full` ni `screen`;
    - los tamaños con nombre (`max-w-2xl`);
    - los valores arbitrarios (`[…]`, que van en rem o px);
    - ninguna otra utilidad.
- **El mismo commit fija `--spacing: 0.25rem`.**
- **Resultado:** `0.25rem × 2n = 0.5rem × n`, así que cada valor calculado es idéntico.
- **Salvaguardas:**
  - El codemod no se ejecuta si `--spacing` ya vale `0.25rem`, porque no es idempotente.
  - Informa cada reescritura por archivo para revisar el diff.
  - No toca las pruebas: ninguna afirma clases de espaciado.
- **Prueba de equivalencia, obligatoria antes del commit:**
  1. **Imágenes base.** Con el harness de D17 se capturan las imágenes base de la interfaz actual,
     en un commit previo: shell y pantallas heredadas representativas.
  2. **Captura geométrica.** El mismo harness vuelca la caja (`getBoundingClientRect`) de cada
     elemento visible de esas pantallas a un JSON temporal, que no se versiona.
  3. **Comparación.** Después del codemod, las imágenes deben coincidir con 0 píxeles distintos y
     el JSON debe ser idéntico.
  4. **Verificación.** Pasan Vitest, typecheck, lint y build.
- **Reversión:** revertir ese único commit.
- **Alternativas descartadas:**
  - Mantener la base 8 y reducir a la mitad cada clase copiada de la plantilla: diverge del código
    fuente en cada copia futura.
  - Cambiar la escala sin codemod: compacta todas las pantallas heredadas a la vez.
  - Editar a mano: no es reproducible.

### D4. Tokens: propiedad y nombres

**Ubicación.** `globals.css` es la única fuente. Los nombres canónicos son los de la plantilla, y los
valores salen así:

| Token canónico | Valor |
| --- | --- |
| `background`, `foreground`, `card(-foreground)`, `popover(-foreground)`, `secondary(-foreground)`, `muted(-foreground)`, `accent(-foreground)`, `border`, `sidebar-*` | Neutros de la plantilla, en claro y oscuro |
| `input` | El valor de EmiteYa con matiz neutro: el borde de formulario necesita 3:1 (WCAG 1.4.11), y el `input` de la plantilla no lo alcanza |
| `primary`, `primary-foreground`, `sidebar-primary(-foreground)` | El azul de EmiteYa: **un único** token primario |
| `ring`, `sidebar-ring` | El azul de foco de EmiteYa, sólido. No se usa el `ring/50` translúcido de la plantilla |
| `destructive`, `destructive-foreground` (nuevo) | El `danger` de EmiteYa |
| `success`, `warning`, `info` y sus `-foreground` | Los de EmiteYa |
| `overlay` | El de EmiteYa. La superposición de la plantilla (`bg-black/10`) pasa a `bg-overlay` |
| `--radius: 0.625rem` y sus derivados `sm` a `4xl` | La escala de la plantilla, que reemplaza a 4, 6 y 8 px (D6) |
| `--z-*` | Las capas de EmiteYa. Los `z-50` de la plantilla pasan a su capa |

- **Alias heredados** (se retiran al migrar las pantallas): `surface → card`,
  `surface-subtle → muted`, `foreground-muted → muted-foreground`, `danger → destructive`,
  `danger-foreground → destructive-foreground`, `neutral → muted-foreground`. Son alias de un
  mismo valor, no una segunda paleta, y se anotan en `technical-debt.md`.
- **Fuera:** los tokens `chart-*` (no hay gráficos) y los preajustes de la plantilla.
- **Contraste.** Una tarea comprueba 4,5:1 y 3:1 en cada par usado, en ambos temas. Si un neutro de
  la plantilla no cumple, el valor se ajusta y queda anotado; el contraste manda sobre el valor
  literal.
- **Variantes de shadcn.** Las de `shadcn/tailwind.css` (`data-open`, `data-closed` y las demás que
  usan los primitivos copiados) entran por una de dos vías:
  - **(a) Preferida:** copiar al bloque de variantes de `globals.css` solo las que usan los
    primitivos copiados, con el aviso MIT de shadcn en `THIRD_PARTY_NOTICES.md`.
  - **(b)** Añadir `shadcn` como dependencia de desarrollo exacta e importar su CSS.

  La (b) instala la CLI y sus dependencias transitivas solo por una hoja de estilos. La elección
  se registra con la lista de variantes usadas.
- **Animaciones:** `tw-animate-css` como dependencia exacta, solo CSS. Se añade una regla global
  `prefers-reduced-motion` que acorta o anula sus animaciones.

### D5. Tamaños de control

| Tamaño | Alto | Uso |
| --- | --- | --- |
| `default` | 36 px (`h-9`) | Formularios y acciones de página. Es el `lg` de la plantilla, que pasa a ser el tamaño por defecto de EmiteYa |
| `sm` | 32 px (`h-8`) | Barras, tablas y navegación. Es el `default` de la plantilla |
| `xs` | 24 px (`h-6`) | Solo micro-controles dentro de chips |
| `icon` / `icon-sm` / `icon-xs` | 36 / 32 / 24 px | Botones de icono en los mismos contextos |
| Móvil (< 768 px) | ≥ 44 px (`max-md:h-11`, `max-md:size-11`) | Todo control interactivo. `xs` e `icon-xs` amplían su área táctil a 44 px sin cambiar su caja visible |

- **Lo que se descarta de la plantilla:** sus 28 px (`sm` e `icon-sm`), que no entran en la escala.
- **El tamaño es una variante.** Un componente no decide su tamaño según la feature que lo importa;
  quien lo usa elige la variante por contexto. Los controles de una misma fila comparten tamaño.
- **Heredado transitorio.** `Button` es un único componente (D6). Las pantallas heredadas conservan
  su geometría con tamaños transitorios: `legacy-md` (40 px y 44 en móvil, por defecto mientras
  existan pantallas heredadas), `legacy-sm`, `legacy-icon` (44) y `legacy-icon-sm` (40).
  - Conservan alto, relleno, separación y tamaño de icono del botón actual.
  - Al integrar los primitivos, una pasada mecánica aparte reescribe las 14 llamadas explícitas
    (`size="sm"`, `"icon"` e `"icon-sm"`) a su par `legacy-*`. No es el codemod de D3.
  - Las llamadas sin `size` reciben `legacy-md` por defecto.
  - El código nuevo del shell está obligado por lint (D19) a pasar un tamaño de la escala aprobada.
  - Al migrar la última pantalla, el valor por defecto pasa a `default` y los `legacy-*` se borran.
    Queda anotado en `technical-debt.md`.
- **Alternativas descartadas:**
  - Dos componentes `Button`: duplicación.
  - Cambiar ya el alto de los botones heredados a 36 px: altera la geometría de pantallas fuera de
    alcance.

### D6. Primitivos del shell: qué entra y cómo

Entran adaptados desde `../template-shadcn-premium/src/components/ui/`:
- sidebar, sheet, tooltip, dropdown-menu, collapsible, separator, skeleton, avatar, badge, button,
  breadcrumb, kbd y command;
- `empty`, para los estados de ruta (D16);
- el hook `use-mobile`.

No se importa el resto del directorio.

**Adaptaciones comunes:**
- textos para lectores de pantalla en español («Cerrar», «Más», «Alternar barra lateral», el título
  y la descripción de la paleta);
- `z-50` pasa a capas `--z-*`;
- colores literales pasan a tokens;
- base de 4 px sin conversión, porque el código conserva sus proporciones;
- tamaños según D5;
- ningún atributo `style` renderizado en el servidor (D7).

**Decisiones por componente:**
- **`button`:** pasa a ser el código de la plantilla adaptado. Variantes `primary` (el `default`
  de la plantilla, con nombre de EmiteYa), `secondary`, `outline`, `ghost`, `destructive` y `link`.
  Tamaños según D5. No hace falta codemod de variantes.
- **`menu-and-tooltip.tsx`:** queda como fachada de compatibilidad sobre los `dropdown-menu` y
  `tooltip` derivados. Conserva su API (`Menu`, `MenuItem`, `Tooltip({label})`, `TooltipProvider`)
  y el alto heredado de sus ítems. Una sola implementación por debajo.
- **`Skeleton` de `states.tsx`:** reexporta el `skeleton` derivado, con `motion-safe`.
- **`command`:** su `CommandDialog` compone el `ui/dialog` existente, que es EMITEYA-EXISTING y
  conserva la devolución del foco, en lugar del diálogo de la plantilla.
- **`sheet`:** primitivo nuevo. Reutiliza el mecanismo de devolución de foco de `ui/dialog`, porque
  el panel móvil de la barra lateral es controlado.
- **`sidebar`:**
  - **Fuera:** `SidebarInput`, para no importar el `input` de la plantilla, y cualquier variante
    sin uso (`floating`, `inset`).
  - **Sin `style` en servidor:** las variables de ancho van en CSS (D7).
  - **Panel móvil:** recupera el botón de cerrar visible, que la plantilla oculta con
    `[&>button]:hidden`.
  - **Atajo:** se conserva Ctrl/⌘ + B, documentado en la ayuda del botón.
  - **Cookie:** se conserva `sidebar_state` (D12).
- **`avatar`:** solo iniciales. Sin `AvatarImage` ni imágenes remotas.
- **`badge`:** variantes semánticas `success`, `warning`, `info`, `destructive`, `neutral` y
  `outline`, con icono obligatorio en los estados. `StatusBadge` sigue siendo el heredado y pasa a
  componer `Badge` en la fase de componentes compartidos. Queda anotado.
- **Qué se queda como está** (EMITEYA-EXISTING): `ui/dialog`, `ui/input`, `ui/select`,
  `ui/switch`, `EmptyState`, `ErrorState`, `StatusBadge` y `NoticeStrip`.

**Dependencias:** `class-variance-authority`, porque los primitivos copiados la usan y EmiteYa no la
tiene, y `cmdk` para la paleta. Las dos van con versión exacta.

**Versiones:** no se sube radix-ui, lucide ni Next.
- Si el typecheck muestra un API de radix-ui 1.8 en el código copiado, se adapta el código a 1.6.7.
  Si eso no es posible, se para y se informa: la subida sería un cambio revisado aparte.
- Si falta un icono en lucide 1.49, se usa uno equivalente existente.

### D7. CSP: la seguridad manda sobre la copia literal

- **Sidebar.** El `SidebarProvider` deja de escribir `style` con `--sidebar-width` y
  `--sidebar-width-icon`.
  - Los valores (16 rem, 3 rem y 18 rem en móvil) van en `globals.css`, sobre
    `[data-slot=sidebar-wrapper]` y `[data-mobile=true]`.
  - El `style` de `layout.tsx` de la plantilla, con el ancho `calc(var(--spacing)*68)`, no se
    copia.
- **Otros `style` de la plantilla.** Están en `progress`, `toggle-group`, `sonner` y `chart`, que
  quedan fuera del corte. Cuando se adopten, irán por la misma regla.
- **Tema.** No se adopta `ThemeBootScript` ni las preferencias en cookie de la plantilla.
  `next-themes` sigue con el nonce.
- **Recursos remotos.** Nada de avatares remotos, Vercel Analytics, jsDelivr ni fuentes externas.
- **Verificación.** `check:web-security-policy` amplía sus flujos con la paleta abierta y cerrada,
  la barra colapsada y expandida y el menú de creación rápida, y exige cero violaciones. Además se
  revisa el HTML de una página autenticada y no debe contener ningún atributo `style`.
- **La política no cambia:** `lib/web-security-policy.ts` queda igual.

### D8. Tema

- **Se conserva** `next-themes`, con el nonce, el tema por defecto del sistema y la clase en
  `<html>`.
- **En pantallas medianas y anchas** (≥ 640 px), el radiogroup «Tema» actual (`ThemeToggle`,
  EMITEYA-EXISTING, que la prueba e2e usa) se queda en la barra superior, con los tokens nuevos.
- **En pantallas estrechas**, el botón `ThemeMenu` desaparece. «Tema» pasa a ser un grupo de
  opciones de radio del menú de cuenta: Claro, Oscuro y Sistema.
- **Por qué:** así se cumple la arquitectura aprobada («Tema» en el menú de cuenta) sin duplicar el
  control en la misma anchura, que la Definition of Done prohíbe.
- Queda señalado para la revisión del propietario.

### D9. Fuente: Geist desde el propio origen

- **Opción preferida:** el paquete `geist`, versión exacta, del que solo se usa `geist/font/sans`.
  - Envuelve `next/font/local` con los woff2 incluidos en el paquete.
  - El build sirve la fuente desde `/_next/static/media` sin red ni archivos binarios en el
    repositorio, y `font-src 'self'` la admite.
  - Es una sola familia, variable. Geist Mono no entra: la monoespaciada sigue con la pila del
    sistema.
  - `--font-sans` pasa a `var(--font-geist-sans)` con la pila actual como respaldo.
- **Descartadas:**
  - `next/font/google`: descarga en el build y ata el build de Docker a la red de Google.
  - Copiar los woff2 al repositorio: archivos binarios con su propia licencia.
- **Regla de parada.** Si al implementar no es inequívoco el origen o la licencia de la fuente del
  paquete, se para y se informa antes de añadir binarios. La fuente Geist es OFL-1.1, y la licencia
  del paquete se confirma en su `package.json`.
- **Verificación:**
  - cero peticiones de fuentes a otros orígenes en el harness;
  - la imagen de Docker de producción se construye y contiene el woff2;
  - una sola fuente cargada por página.

### D10. Un único modelo de rutas

- **Ubicación:** `lib/navigation/routes.ts`, que alimenta la barra lateral (grupos, destinos y
  destino actual), las migas, la paleta, la creación rápida y la guarda de destino no permitido.
  Sustituye a `GROUPS` de `navigation.tsx`.
- **Contenido:**
  - **Grupos:** en el orden de la spec. Inicio se dibuja como un destino suelto, sin etiqueta de
    grupo.
  - **Destinos:** etiqueta, ruta, icono de lucide, permiso y grupo, con los mismos permisos que hoy.
  - **Rutas internas:** patrón, destino padre, etiqueta de la miga final y permiso.
  - **Acciones de creación:** etiqueta, ruta, permiso de borrador e icono.
- **Rutas internas:**

  | Patrón | Destino | Miga final | Permiso |
  | --- | --- | --- | --- |
  | `/facturas/[id]` | Facturas | Detalle de factura | `invoices.read` |
  | `/borradores/nuevo` | Borradores | Nueva factura | `invoices.draft` |
  | `/borradores/[id]` | Borradores | Borrador de factura | `invoices.draft` |
  | `/notas-credito/[id]` · `/borradores/nueva` · `/borradores/[id]` | Notas de crédito | Detalle · Nueva · Borrador de nota de crédito | `creditNotes.read` · `.draft` · `.draft` |
  | `/notas-debito/…` | Notas de débito | Igual | `debitNotes.*` |
  | `/retenciones/…` | Retenciones | Detalle · Nueva · Borrador de retención | `withholdings.*` |
  | `/guias-remision/…` | Guías de remisión | Detalle · Nueva · Borrador de guía de remisión | `shippingGuides.*` |
  | `/liquidaciones-compra/…` | Liquidaciones de compra | Detalle · Nueva · Borrador de liquidación de compra | `purchaseSettlements.*` |
  | `/inventario/[productId]` | Inventario | Detalle de inventario | `inventory.read` |
  | `/mi-cuenta` | (sin grupo) | Mi cuenta | cualquier usuario |
  | `/` | Inicio | — | cualquier usuario |

- **Destino actual.** Se resuelve por prefijo, como hoy. «Nueva factura» (`/borradores/nuevo`)
  marca Borradores, como ahora.
- **Rutas sin patrón.** Una ruta que no encaja con ningún patrón no se guarda y se renderiza tal
  cual.
- **Pruebas unitarias:**
  - cada una de las 42 páginas encaja con un destino o un patrón;
  - visibilidad por rol;
  - migas por patrón;
  - las acciones de creación de cada rol;
  - paridad: el permiso de cada patrón es el que exige su pantalla, según la tabla revisada.

### D11. Composición del shell

- **Barra lateral** (`AppSidebar`, derivada de `app-sidebar` y `nav-main`):
  - **Cabecera:** la marca «EmiteYa» con un icono neutro de lucide que no usa ningún destino ni
    estado (`Receipt`), enlazada a Inicio, y la creación rápida.
  - **Contenido:** los grupos.
  - **Sin pie:** la cuenta vive solo en la barra superior, para no duplicarla. Se elimina la
    tarjeta de soporte de la plantilla.
- **Barra superior** (`Topbar`): 48 px en escritorio y 56 en móvil, fija.
  - **De 768 px hacia arriba:**
    - a la izquierda, `SidebarTrigger`, un separador y `AppBreadcrumbs`;
    - a la derecha, el disparador de la paleta («Buscar…» con `Kbd`), el contexto de la empresa
      (avatar de iniciales y nombre truncado), el indicador de ambiente (`Badge` con icono y
      texto), «Tema» (≥ 640 px) y la cuenta.
    - Por debajo de 1024 px, la paleta queda solo con su icono y las migas muestran únicamente la
      última miga.
  - **En móvil:**
    - menú, contexto de la empresa (nombre truncado, que crece), paleta como icono y cuenta;
    - las migas pasan a una fila compacta al comienzo del área de contenido.
- **Avisos.** Bajo la barra superior, primero el de ambiente y después el de la firma, los dos
  EMITEYA-EXISTING. En Producción y por debajo de 640 px se conserva la línea actual «Ambiente de
  Producción» en lugar del indicador de la barra.
- **Contexto de la empresa.** `CompanyContext` es presentación pura y no es un botón: no se puede
  activar ni abrir un menú. `features/company` lo conecta con `useCompanyStatus` y le pasa
  `displayName`, carga o error.
- **Menú de cuenta** (`AccountMenu`, derivado de `nav-user`): está en la barra superior. Su nombre
  accesible es «Cuenta de {nombre}». Contiene nombre, correo y rol, Mi cuenta, «Tema» por debajo
  de 640 px y Cerrar sesión (inactivo tras elegirlo).
- **Guarda de destino no permitido.** `AppShell` resuelve la ruta en el modelo. Si su permiso no
  está en el rol, muestra `RouteForbidden` en lugar de la página, que así no pide datos. Las
  pantallas conservan su comprobación propia como defensa.
- **Pruebas.** `app/(app)/layout.tsx` sigue siendo el único lugar de composición, y la estructura
  conserva los nombres que usan las pruebas: «Barra lateral», «Navegación principal» y «Saltar al
  contenido».

### D12. Barra lateral adaptable

- **Escritorio y tableta** (≥ 768 px): la barra se expande o se colapsa a iconos de 3 rem.
- **Persistencia:** la cookie `sidebar_state` (ruta `/`, 7 días, `SameSite=Lax`, solo preferencia)
  se lee en `app/(app)/layout.tsx` con `cookies()`. Así el servidor renderiza el estado correcto
  sin parpadeo.
- **Colapsada:** cada destino conserva su texto en el árbol de accesibilidad y muestra su nombre en
  un tooltip al recibir foco o el puntero.
- **Móvil:** un `Sheet` lateral de 18 rem con el mismo contenido, botón de cerrar visible, cierre
  al elegir un destino y foco devuelto al botón de menú.
  - Los grupos son plegables, con el del destino actual abierto, porque `navigation-responsive.md`
    pide plegarlos en móvil.
  - En escritorio los grupos siempre están abiertos.
- **Estado por defecto:** expandida.

### D13. Paleta de comandos

- **Construcción:** `cmdk` sobre `command`, con el `CommandDialog` sobre `ui/dialog`.
- **Apertura:** Ctrl/⌘ + K desde cualquier pantalla autenticada, o el disparador de la barra.
- **Contenido** (todo del modelo de rutas, filtrado por rol):
  - grupo «Ir a»: los destinos y Mi cuenta;
  - grupo «Crear»: las acciones de creación rápida.
- **Filtro propio.** No distingue mayúsculas ni tildes (NFD sin diacríticos) y busca en la
  etiqueta, el grupo y palabras clave. Es determinista y tiene prueba unitaria.
- **Sin servidor.** Ninguna consulta mientras se escribe.
- **Carga diferida.** El contenido se carga bajo demanda (`next/dynamic`) en la primera apertura,
  así que no engorda la carga inicial de cada ruta. El atajo y el disparador viven en el shell.
- **Cierre:** al elegir, se navega y se cierra. Con Escape se cierra y el foco vuelve al disparador.

### D14. Creación rápida

- **Base:** el patrón «Quick Create» de `nav-main`, con comportamiento real: un `DropdownMenu` en la
  cabecera de la barra lateral con las acciones permitidas del modelo de rutas.
  - Colapsada, es un botón de icono con el tooltip «Nuevo».
  - En móvil, está dentro del panel.
- **Estilo.** Usa la variante `outline`, no `primary`. La plantilla lo dibuja primario, pero
  EmiteYa admite una sola acción primaria por pantalla y la creación rápida está en todas.
- **Comportamiento:** solo navega. Sin el «Inbox» de la plantilla.

### D15. Migas de navegación

`AppBreadcrumbs` deriva la ruta del modelo:
- el grupo, como texto, porque un grupo no es una página;
- el destino, como enlace;
- la miga final, con `aria-current="page"`.

En un destino de primer nivel, el destino es la miga final. Las etiquetas de registros concretos,
como el número de una factura, quedan para la fase de cabeceras de página.

Duplicación conocida: la última miga repite el `h1` de la pantalla, que no se toca en este cambio.
Se resuelve cuando llegue `PageHeader`.

### D16. Estados de ruta

- **`app/(app)/loading.tsx`:** `RouteLoading` dentro del shell. Esqueleto de cabecera y contenido,
  con `role="status"` y el texto oculto «Cargando la pantalla».
- **`app/(app)/error.tsx`:** componente cliente con `RouteError`.
  - Mensaje fijo en español, sin `error.message`, sin trazas y sin `digest`.
  - Ofrece «Intentar de nuevo» con `retry()` de Next 16.
  - La navegación sigue disponible porque el shell está en el layout.
- **`app/not-found.tsx`:** `RouteNotFound` con la marca EmiteYa y un enlace a Inicio.
  - No llama a la API.
  - Aplica el tema con la clase que ya pone el layout raíz.
- **`RouteForbidden`:** se usa desde la guarda de D11.
- **Sin ruta comodín** (`[...not-found]`): `next.config.ts` reescribe `/api/:path*` como
  `fallback` después de las rutas dinámicas, y un comodín taparía la API. Tampoco se usan
  `forbidden.js`, `authInterrupts` ni `global-not-found`, que son experimentales.
- **Construcción:** con `empty`, `button` y `skeleton`. Los `EmptyState` y `ErrorState` de las
  pantallas se quedan como están.

### D17. Harness de regresión visual

- **Ubicación y herramientas:**
  - `frontend/visual/`, con `frontend/playwright.config.ts` y `@playwright/test` 1.64.0, la misma
    versión que `playwright-core`, como dependencia de desarrollo exacta;
  - el Chrome del sistema (`channel: "chrome"`), sin descargar navegadores, como
    `check:web-security-policy`.
- **Servidor:** `next build` y `next start` con un `API_INTERNAL_URL` ficticio.
- **API simulada:** cada `/api/v1/*` del navegador se responde con `page.route` y fixtures
  deterministas (sesión de administrador u operador, empresa en Pruebas o Producción, firma válida,
  lista de facturas). El servidor no llama a la API: los datos se piden en el cliente.
- **Determinismo:**
  - reloj fijo con `page.clock`: 2026-10-14 10:00, `America/Guayaquil`, `es-EC`;
  - `reducedMotion: "reduce"`;
  - `animations: "disabled"` y cursor oculto;
  - espera a `document.fonts.ready`.
- **Conjunto canónico, versionado** en `frontend/visual/__screenshots__/`, generado en Linux. En
  otros sistemas se actualiza solo en local, sin versionar.
  - **Línea base previa al rediseño** (grupo 1, prueba de D3):
    - shell en escritorio, claro y oscuro;
    - shell en móvil claro;
    - lista de facturas;
    - inicio de sesión.
  - **Shell premium** (grupo 11), unas 15 imágenes:
    - escritorio claro y oscuro, con la barra expandida y colapsada;
    - tableta;
    - móvil cerrado y con el panel abierto;
    - Producción con un operador;
    - paleta abierta y creación rápida abierta;
    - carga, error, dirección inexistente y destino no permitido;
    - lista de facturas heredada dentro del shell nuevo;
    - inicio de sesión.
- **Comandos:** `test:visual` y `test:visual:update`, en el frontend y en la raíz. No forman parte
  de `verify`.
- **Tolerancia:** 0 píxeles para la prueba de D3; una tolerancia mínima documentada para el uso
  normal.
- **Revisión:** cada cambio de una imagen base se revisa en el informe HTML de Playwright, y la
  imagen nueva se versiona en el mismo commit que la causa. El proceso queda en `testing.md`.

### D18. Accesibilidad y teclado

- **Vitest** (dentro de `verify`), con pruebas de teclado de:
  - la barra: colapsar, Ctrl+B, foco en destinos colapsados y panel móvil con Escape y devolución
    del foco;
  - la paleta: Ctrl+K, flechas, Enter y Escape con devolución del foco;
  - la creación rápida;
  - el menú de cuenta;
  - el «Tema» con flechas;
  - el enlace para saltar al contenido.
- **Playwright** (`test:visual`):
  - `@axe-core/playwright` (dependencia de desarrollo exacta) con WCAG 2.2 AA sobre el shell:
    escritorio claro y oscuro, móvil, y la paleta abierta. Cero violaciones.
  - Un recorrido de teclado real con el foco visible.
- **Textos y foco:**
  - todos los textos para lectores de pantalla del shell, en español;
  - foco con el anillo sólido de D4;
  - se conserva la devolución del foco de `ui/dialog`.

### D19. Prevención de duplicación, escalonada

`frontend/eslint.config.js` añade una sección solo para `src/components/shell/**`,
`src/components/route-states/**`, `src/lib/navigation/**` y `src/hooks/**`. Prohíbe:
- importar `radix-ui` directamente, porque se usa `components/ui`;
- importar las fachadas o componentes heredados (`components/ui/menu-and-tooltip`,
  `components/states`, `components/notice-strip`);
- valores arbitrarios de Tailwind en literales: corchetes con valor, no las variantes arbitrarias;
- colores hexadecimales;
- tamaños `legacy-*`;
- el atributo JSX `style`;
- `<Button>` sin `size` explícito.

En `src/components/ui/**` se prohíbe solo el atributo `style`. Los valores arbitrarios internos de
los primitivos derivados quedan permitidos y documentados en el ADR.

`features/**` y el resto del código heredado no cambian de reglas. La aplicación se amplía a medida
que migran las pantallas.

### D20. Marca, rendimiento y documentación

- **Marca.** «EmiteYa» aparece en:
  - la barra lateral, el esqueleto del shell y `RouteNotFound`;
  - el inicio de sesión (solo el texto de la marca);
  - el `metadata` raíz;
  - los `metadata.title` de las 42 páginas: «X · EmiteYa».

  El README, los nombres de paquetes (`@facturador/*`) y la documentación histórica no cambian en
  este cambio.
- **Rendimiento:**
  - la tabla de rutas de `next build` (primera carga y compartido) antes y después, en
    `docs/quality/benchmarks/frontend-shell-<fecha>.{md,json}`;
  - el tamaño del woff2;
  - la comprobación de que ningún chunk contiene Recharts, FullCalendar, simple-icons, Vercel
    Analytics ni otras dependencias de demostración.
- **Documentación** (al implementar, cada documento en el grupo de tareas que cambia su contenido,
  no al final):
  - un ADR nuevo, 0028: procedencia de la plantilla, capas, propiedad de tokens, regla de extensión,
    política de duplicación y de adaptación a la CSP; reemplaza la regla de radios de 8 px como
    máximo;
  - `design-foundations.md`: escala de 4 px, tokens, radios, tamaños y fuente;
  - `component-system.md`: capas, propiedad, fachadas y regla de extensión;
  - `navigation-responsive.md`: shell, grupos, migas, paleta y creación rápida;
  - `frontend.md`: contratos compartidos y modelo de rutas;
  - `stack.md`: dependencias nuevas;
  - `testing.md`: harness visual y revisión;
  - `technical-debt.md`: tamaños `legacy-*`, alias de tokens, fachadas y `StatusBadge` pendiente de
    `Badge`;
  - `frontend/THIRD_PARTY_NOTICES.md`.

### Screen brief: el shell autenticado

1. **¿Quién lo usa?** Administradores y operadores de una empresa, a diario, sobre todo en
   escritorio.
2. **¿Qué buscan?** Saber dónde están y en qué empresa y ambiente operan, y llegar al destino o a
   la creación que necesitan.
3. **¿Qué deciden?** A dónde ir o qué crear a continuación, y confirmar que el contexto fiscal es
   el correcto antes de actuar.
4. **¿Qué información mínima necesitan?** El ambiente, la empresa, la ubicación actual y los
   destinos permitidos.
5. **¿Cuál es la acción principal?** El shell no tiene acción primaria: navegar es su trabajo, y la
   acción primaria pertenece a cada pantalla. La creación rápida y la paleta son secundarias.

**Uso y riesgo:**
- Se usa a diario, así que gana atajos (Ctrl+K, Ctrl+B) y densidad.
- Un error de contexto, como emitir creyendo estar en Pruebas, es grave. Por eso el ambiente es P0
  y nunca se oculta.
- Tras navegar, el usuario espera el destino con su contenido intacto.

**Prioridad de la información:**
- **P0:** aviso o indicador de ambiente, empresa, ubicación (destino actual y migas) y contenido.
- **P1:** los grupos de navegación, el disparador de la paleta y la creación rápida.
- **P2:** el tema, el menú de cuenta y los tooltips de la barra colapsada.
- **P3:** nada. El shell no muestra identificadores ni datos técnicos.

**Estados de ruta:**
- **Carga:** el usuario espera; P0 sigue visible.
- **Error:** el usuario reintenta o se va; la acción es «Intentar de nuevo».
- **Inexistente:** la acción es ir a Inicio.
- **No permitido:** la acción es ir a Inicio, sin sugerir que puede obtener acceso por sí mismo.

### Operaciones sensibles

No hay. El cambio no toca el backend ni la API. Cerrar sesión ya existe y solo se protege contra el
doble clic. La guarda de destino no permitido es presentación, y la API sigue autorizando
(`user-access`).

## Risks / Trade-offs

- **[El codemod reescribe un literal que no es una clase]** → Solo cambia tokens con forma exacta de
  utilidad de espaciado. Su informe por archivo se revisa, y la prueba de 0 píxeles con geometría
  idéntica detecta cualquier efecto visible.
- **[Los tokens, la fuente y los radios nuevos cambian el aspecto de las pantallas heredadas]** →
  Es intencional. La geometría se conserva. Las imágenes base heredadas se vuelven a generar en un
  commit propio, revisado en el informe visual.
- **[Las imágenes base dependen del sistema]** → Se generan solo en Linux con el Chrome del sistema,
  fuera de `verify`, y el proceso de revisión queda documentado.
- **[Las variantes de shadcn copiadas se desactualizan]** → Se copia solo la lista usada, con su
  origen, y cada variante nueva que exija otro primitivo pasa por la misma revisión.
- **[La guarda de rutas no coincide con el permiso de la pantalla]** → Una prueba de paridad por
  patrón contra la tabla revisada. Una ruta sin patrón no se guarda.
- **[Las migas repiten el `h1`]** → Aceptado de forma temporal (D15).
- **[El tema queda en dos lugares según la anchura]** → Un solo estado (`next-themes`), un solo
  control por anchura (D8). Queda señalado al propietario.
- **[Los botones heredados se ven distintos]** → La geometría se conserva con `legacy-*` (D5), y el
  cambio de estilo es el de la base aprobada.
- **[cmdk o la fuente engordan la carga inicial]** → La paleta se carga de forma diferida, hay una
  sola fuente variable, y se miden los números antes y después.
- **[Algún primitivo copiado exige radix-ui 1.8]** → Se adapta a 1.6.7, o se para e informa (D6).
- **[Las pruebas que dependen de la estructura del shell]** → `app-shell.test.tsx` se reescribe
  conservando cada comportamiento (visibilidad por rol, destino actual, desplazamiento de la barra,
  sesión, tema). Los nombres que usa `check:web-security-policy` se mantienen.

## Migration Plan

- **Rama y commits.** Todo ocurre en `redesign-frontend`, con un commit por grupo de tareas, en el
  orden de `tasks.md`.
- **Orden protegido.** El harness y la línea base van antes del codemod, y el codemod va antes de
  los tokens. Así la prueba de equivalencia de D3 compara la interfaz sin otros cambios.
- **Reversión:**
  - cada grupo se revierte por separado;
  - el codemod, revirtiendo su único commit;
  - el shell, revirtiendo los grupos 5 a 9, porque `app-shell.tsx` y `navigation.tsx` se borran en
    el grupo 6.
- **Sin despliegue ni migraciones.** El cambio no se publica en `main` hasta su verificación
  completa y la autorización del propietario.

## Open Questions

- **Variantes de shadcn:** copiarlas (preferida) o la dependencia `shadcn` (D4). Se decide al
  implementar con la lista de variantes usadas, sin cambiar la spec ni las tareas.
- **Tema según la anchura** (D8) y **`empty` en el corte** (D6, D16): señalados para la revisión del
  propietario. Si cambian, solo cambia la ubicación del control o la composición de los estados de
  ruta.
