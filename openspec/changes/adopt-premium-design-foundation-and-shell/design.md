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
- **Aislamiento** (decisión del propietario). La medición compara solo el cambio de escala. Entre
  la línea base y el codemod no entra Geist, ni radios, colores, shell, jerarquía tipográfica ni
  rediseño alguno. Esos cambios empiezan después de demostrada la equivalencia.
- **Alcance del criterio de 0 píxeles.** Vale solo para esta prueba. No se espera igualdad entre la
  interfaz anterior y el shell premium.
  - Si el rasterizado del navegador produjera ruido de píxeles sin cambio de geometría, no se relaja
    la prueba en silencio.
  - Se informa la causa exacta, y la igualdad de cajas pasa a ser la prueba geométrica que manda,
    solo después de documentar por qué esa diferencia no tiene que ver con el espaciado.
  - Las capturas nunca se retocan a mano.
- **Reversión:** revertir ese único commit.
- **Ciclo de vida del codemod.** Entra con sus pruebas en el commit que lo ejecuta, y se borra en
  un commit inmediatamente posterior del mismo grupo. Es de un solo uso y se niega a volver a
  ejecutarse, así que conservarlo en el árbol no aporta. El historial guarda su código y su
  resultado para reproducirlo. La transformación queda descrita en `design-foundations.md`.
  - Solo toca `frontend/src`: ni backend ni recursos fiscales generados.
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
- **Variantes de shadcn** (decisión del propietario: copiar, no instalar). Las de
  `shadcn/tailwind.css` (`data-open`, `data-closed` y las demás que usan los primitivos copiados)
  se copian a `globals.css`, solo las que se usan, con su origen anotado y el aviso MIT de shadcn
  en `THIRD_PARTY_NOTICES.md`.
  - No se instala el paquete `shadcn` ni su CLI.
  - No se copia CSS de la plantilla que no se use.
  - Como el paquete no está en el árbol de la plantilla, la definición de cada variante se toma de
    la fuente publicada de shadcn/ui (MIT), con la referencia anotada.
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
  - **Aprobado por el propietario como transitorio** (2026-10-14). Son variantes de compatibilidad
    de la migración, nada más:
    - el código premium nuevo no las usa;
    - una pantalla migrada no las conserva;
    - se retiran a medida que avanza la migración, hasta el 100 %.

    El botón de solo icono es un tamaño o una composición, no un color nuevo: lleva siempre
    `aria-label`, y tooltip cuando el contexto lo pide.
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
- **Aprobado por el propietario** (2026-10-14). Nunca hay dos controles de tema visibles ni
  enfocables al mismo ancho: el del menú solo se renderiza por debajo de 640 px y el de la barra
  solo desde 640 px. Los dos usan el mismo estado de `next-themes`.

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
- **Condiciones** (decisión del propietario: aprobado de forma condicional). Se usa `geist` solo si
  la inspección del paquete instalado confirma todo esto:
  - trae los woff2 dentro del paquete;
  - no pide nada a Google ni a otro origen, ni en ejecución ni en el build;
  - su licencia (la de la fuente, OFL-1.1, y la del paquete) permite este uso;
  - funciona en la imagen de Docker de producción;
  - funciona bajo la CSP actual.

  Si algo de eso falla, se para con `GEIST_SOURCE_BLOCKER`, sin añadir binarios y sin tocar la CSP.
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
  - **Sin destello.** La decisión es síncrona: el shell solo se renderiza con la sesión ya cargada
    (`SessionGate`), y la ruta y el rol se conocen antes del primer render del contenido. El
    contenido protegido nunca llega a montarse, así que no pide sus datos.
  - **No es la autoridad de seguridad.** La defensa en profundidad es la guarda del shell más la
    comprobación de la pantalla más la autorización de la API, que es la que manda.
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
  - En escritorio los grupos operativos siempre están abiertos; Configuración se pliega (D24).
- **Estado por defecto:** expandida.
- **Correcciones del control de calidad UX:** clic en toda la barra colapsada (D21), desplazamiento
  a cualquier altura (D22) y destino actual a la vista (D23).

### D13. Paleta de comandos

- **Construcción:** `cmdk` sobre `command`, con el `CommandDialog` sobre `ui/dialog`.
- **Apertura:** Ctrl/⌘ + K desde cualquier pantalla autenticada, o el disparador de la barra.
- **Contenido** (todo del modelo de rutas, filtrado por rol):
  - grupo «Ir a»: los destinos y Mi cuenta;
  - grupo «Crear»: las acciones de creación rápida.
- **Filtro propio.** No distingue mayúsculas ni tildes (NFD sin diacríticos) y busca en la
  etiqueta, el grupo y palabras clave. Es determinista y tiene prueba unitaria. Las palabras clave
  de cada destino viven en el modelo de rutas (D26).
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

### D15. Migas de navegación: jerarquía, no repetición

Ajuste del propietario a la propuesta (2026-10-14). `AppBreadcrumbs` deriva la ruta del modelo y
solo se muestra cuando aporta jerarquía.

**Qué entra en la ruta:**
- **Ancestro de sección.** Los grupos operativos (Ventas, Compras, Logística, Documentos, Maestros,
  Análisis) solo agrupan la barra y no son una miga. Configuración sí lo es: es una sección que
  agrupa ajustes. Aparece como texto, porque no es una página.
- **Destino.** En una pantalla interna aparece como enlace a su lista.
- **Miga final.** Lleva `aria-current="page"`. Es la etiqueta del patrón («Borrador de nota de
  crédito», «Detalle de inventario») o, si la pantalla la aporta, la del registro (el número del
  comprobante, el nombre del producto).

**Cuándo no se muestra.** Si la ruta queda con una sola miga, la página actual, el shell no muestra
migas. Pasa en Inicio, en los destinos operativos de primer nivel (Facturas, Productos) y en Mi
cuenta. Por eso nunca repite el título de la pantalla.

**Ejemplos:**
- Facturas › 001-001-000000123;
- Notas de crédito › Borrador de nota de crédito;
- Inventario › {producto};
- Configuración › Empresa;
- Configuración › Secuenciales.

**Etiqueta del registro.** Un contexto del shell, `useBreadcrumbLabel(label)`, permite que la
pantalla aporte la etiqueta del registro. Fuera del shell no hace nada, así que las pruebas de
pantallas aisladas no cambian.
- Se conecta con una sola línea en las seis pantallas de detalle de comprobantes (número) y en la
  de detalle de inventario (nombre del producto). Es lo mínimo para alojarlas en el shell; no
  rediseña su contenido.
- Mientras el dato carga, se ve la etiqueta del patrón.

**Sin un mapa propio.** Las migas no tienen un mapa independiente: salen del mismo modelo que la
barra y la paleta (D10).

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
- **Dos grupos separados**, versionados y generados en Linux. En otros sistemas se actualizan solo
  en local, sin versionar. Nunca se compara el shell premium con las capturas de la interfaz
  anterior esperando igualdad.
  - **A. Prueba de espaciado**, proyecto `spacing-proof`, en `frontend/visual/spacing-proof/`:
    - **Pantallas:**
      - shell en escritorio, claro y oscuro;
      - shell en móvil claro;
      - lista de facturas;
      - inicio de sesión.
    - **Geometría:** un volcado JSON de las cajas de cada pantalla, también versionado.
    - **Cuándo se captura:** en el grupo 2, y se compara en el grupo 3 (D3).
    - **Después:** queda como evidencia congelada de la transición. `test:visual` no lo ejecuta, y
      solo tiene sentido en el commit del codemod (`test:visual:spacing-proof`, documentado en
      `testing.md`).
  - **B. Shell premium**, proyecto `shell`, en `frontend/visual/shell/` (grupo 12). Es la apariencia
    nueva aprobada, con unas 15 imágenes, aunque se prioriza el valor de cobertura sobre un número
    exacto:
    - escritorio claro y oscuro, con la barra expandida y colapsada;
    - tableta;
    - móvil cerrado y con el panel abierto;
    - aviso de Pruebas, y Producción con un operador;
    - paleta abierta y creación rápida abierta;
    - carga, error, dirección inexistente y destino no permitido;
    - lista de facturas heredada dentro del shell nuevo;
    - inicio de sesión.
- **Comandos:**
  - `test:visual`: el proyecto `shell` más la accesibilidad y el teclado;
  - `test:visual:update`: actualizar las imágenes base del proyecto `shell`;
  - `test:visual:spacing-proof`.

  Están en el frontend y en la raíz, fuera de `verify`. Una ejecución normal nunca actualiza imágenes
  base: falta la imagen o hay diferencia, y falla. Solo `…:update` escribe, a propósito.
- **Tolerancia:** 0 píxeles para la prueba de D3, con la política de ruido de D3. Para el uso
  normal, una tolerancia mínima documentada.
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
- **[Una pantalla interna sin etiqueta de registro]** → Muestra la etiqueta del patrón (D15). Nunca
  se muestra una miga que solo repita el título.
- **[El tema queda en dos lugares según la anchura]** → Un solo estado (`next-themes`), un solo
  control por anchura (D8), aprobado por el propietario.
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
  orden de `tasks.md`. El grupo 3 lleva además un segundo commit que borra el codemod.
- **Etapas del propietario** (2026-10-14), con sus grupos:
  - **A:** aviso de terceros y dependencias (grupo 1).
  - **B:** harness, línea base y espaciado de base 4 con su prueba aislada (grupos 2 y 3).
  - **C:** tokens y primitivos (grupos 4 y 5).
  - **D:** modelo de rutas, shell, creación rápida, paleta y marca (grupos 6, 7, 8 y 10).
  - **E:** estados de ruta y accesibilidad (grupo 9), más las reglas escalonadas (grupo 11).
  - **F:** pruebas en navegador e integración final (grupos 12 y 13).
- **Orden protegido.** El harness y la línea base van antes del codemod, y el codemod va antes de
  los tokens. Así la prueba de equivalencia de D3 compara la interfaz sin otros cambios. Añadir
  dependencias en el grupo 1 no la afecta, porque nada las importa todavía.
- **Reversión:**
  - cada grupo se revierte por separado;
  - el codemod, revirtiendo su commit;
  - el shell, revirtiendo los grupos 6 a 10, porque `app-shell.tsx` y `navigation.tsx` se borran en
    el grupo 7.
- **Sin despliegue ni migraciones.** El cambio no se archiva, no se publica en `main` ni se sube
  hasta la revisión visual y la autorización del propietario.

## Decisiones del propietario (revisión del 2026-10-14)

Aprobado con un ajuste de las migas:
- tema por anchura (D8);
- `empty` en el corte (D6, D16);
- `class-variance-authority` (D6);
- Geist condicionado a la inspección (D9, `GEIST_SOURCE_BLOCKER`);
- variantes de shadcn copiadas y no instaladas (D4);
- creación rápida en `outline` (D14);
- guarda de destino no permitido sin destello (D11);
- tamaños `legacy-*` solo transitorios (D5);
- migas jerárquicas, sin una miga que repita el título (D15).

No quedan preguntas abiertas.

## Correcciones del control de calidad UX (2026-10-14)

Una revisión UX independiente recorrió la aplicación real a 1440, 1024, 768 y 390 px, en los dos
temas, como administrador nuevo, operador diario y usuario ocasional. Su resultado fue «PASS WITH
CORRECTIONS», con un hallazgo S4 y cuatro S3 atribuibles al shell. El propietario aceptó la revisión
y decidió corregir el shell dentro de este change, antes de archivarlo, porque es más barato que
dejar que la misma fricción se propague a cada módulo. Las decisiones siguientes cambian
comportamiento observable. El resto de hallazgos queda registrado para las fases siguientes (al
final de esta sección).

### D21. Barra colapsada utilizable con el puntero (SH-1, S4)

- **Defecto medido.** En modo icono, la etiqueta de cada grupo queda invisible (opacidad 0) y sube
  2 rem sobre el último destino del grupo anterior, pero sigue recibiendo el puntero. En 7 de 21
  iconos, un clic en el centro no navegaba.
- **Corrección en el primitivo** (`ui/sidebar`, `SidebarGroupLabel`). En modo icono, la etiqueta no
  participa en la detección del puntero (`pointer-events: none`). Sigue en el DOM y no cambia la
  semántica: la navegación conserva sus nombres accesibles.
- **Prueba.** El harness colapsa la barra y hace clic en el centro de cada destino visible para el
  rol, a 1440×900 y 1024×768, como administrador y como operador. Cero centros muertos.

### D22. Barra desplazable a cualquier altura (SH-2, S3)

- **Defecto medido.** En modo icono, el contenido de la barra tenía `overflow: hidden`. A 1024×768,
  los últimos destinos quedaban fuera de alcance con el puntero.
- **Corrección en el primitivo** (`SidebarContent`). El desplazamiento vertical funciona expandida y
  colapsada: rueda, panel táctil y teclado, y el foco trae el destino a la vista. Nunca hay
  desplazamiento horizontal.
- **Barra de desplazamiento oculta**, como en la plantilla. Una barra visible restaría ancho al
  carril de 3 rem en los sistemas que no la superponen. D23 y D24 mantienen a la vista el destino
  actual y la mayoría de los destinos.
- **Prueba.** A 1024×768, a 1366×657 (la altura útil de un portátil de 1366×768) y a 1280×560: cada
  destino permitido se alcanza con la rueda sobre la barra y responde al clic en su centro, expandida
  y colapsada.

### D23. Destino actual a la vista (SH-3, S3)

- **Defecto medido.** 21 destinos y 7 títulos necesitan unos 1100 px, así que el destino actual de
  Configuración quedaba por debajo de la barra al cargar, incluso a 1920×1080.
- **Corrección en el shell** (`AppSidebar`). En la carga autenticada, en un enlace directo y en cada
  cambio de ruta, si el destino actual no está entero dentro del área visible de la barra, la barra
  se desplaza lo justo para mostrarlo (equivalente a `block: "nearest"`).
  - Si ya se ve entero, la barra no se mueve.
  - Solo se desplaza la barra, nunca la página.
  - Sin animación en la carga, y suave en los cambios de ruta salvo con movimiento reducido.

### D24. Configuración plegada por defecto

- **Decisión del propietario.** Configuración agrupa ocho destinos de uso esporádico y ocupaba el
  38 % de la barra con el mismo peso visual que el trabajo diario. Es divulgación progresiva: no
  quita ninguna ruta ni oculta permisos.
- **Comportamiento:**
  - fuera de sus pantallas, Configuración empieza plegada;
  - en una de sus pantallas, empieza abierta, y se abre sola al entrar en una;
  - el usuario la abre o la pliega a mano durante la sesión de la interfaz, y nunca se pliega sola;
  - sin persistencia entre dispositivos.
- **Presentación.** En escritorio, su cabecera es un botón con el icono de ajustes, el nombre
  «Configuración» y un indicador de plegado (`aria-expanded`). Colapsada la barra, queda el icono con
  su ayuda «Configuración». En el panel móvil sigue la regla de todos los grupos (D12).
- **Los grupos operativos no se pliegan** para acortar la barra. Conservan la pista de información.
  Con Configuración plegada, la barra expandida entra en unos 890 px.

### D25. Ventas, borradores y archivo: nombres que dicen qué contienen

- **Problema.** Facturas, Comprobantes y Borradores no comunicaban su relación. `/borradores` solo
  contiene borradores de factura, y «Nueva factura» llevaba de Ventas a Documentos.
- **Decisión del propietario** (sin mover rutas):
  - Ventas: Facturas, Borradores de facturas (`/borradores`), Notas de crédito y Notas de débito.
  - Documentos: Archivo de comprobantes (`/comprobantes`), la vista transversal de todos los
    comprobantes.
- **Una sola fuente.** El nombre sale del modelo de rutas. Así cambian a la vez la barra, el destino
  actual, las migas, la paleta y los nombres accesibles. El título del documento y el encabezado de
  esas dos pantallas usan el mismo nombre, para que lo que se pulsa coincida con lo que se ve.
- **Creación rápida.** «Nueva factura» sigue en `/borradores/nuevo`, que ahora marca Ventas ›
  Borradores de facturas como destino actual.
- **Sin cambios** en rutas, API ni backend. Terceros conserva su nombre: la paleta reconoce sus
  sinónimos (D26).

### D26. Paleta de comandos veraz sobre su alcance (SH-4, S3)

- **Problema.** El disparador decía «Buscar…», que promete buscar comprobantes, clientes o
  productos. La paleta solo busca pantallas y acciones de creación, y no debe consultar datos.
- **Alcance declarado:**
  - el disparador dice «Buscar pantalla o acción…»;
  - su nombre accesible, también en el botón compacto, es «Buscar pantalla o acción»;
  - el campo de la paleta usa el mismo texto.
  - No se llama «Búsqueda global» ni «Buscar» a secas.
- **Sinónimos sin red.** Cada destino del modelo de rutas lleva palabras clave que el filtro
  consulta, entre ellas:
  - Terceros: clientes, proveedores, transportistas, contactos.
  - Catálogos fiscales: IVA, ICE, IRBPNR, impuestos, formas de pago, retenciones.
  - Firma electrónica: certificado, P12, PKCS12.
  - Mi cuenta: contraseña, password, cuenta.
  - Secuenciales: secuencial, numeración, número.
  - Archivo de comprobantes: comprobantes, documentos, archivo, facturas emitidas.
  - Borradores de facturas: borradores, factura pendiente, factura sin emitir.
- **Sin resultados falsos.** Un número de comprobante, un cliente o un producto concretos no
  producen resultados inventados. Sin coincidencia, la paleta dice que no encontró una pantalla o
  acción con ese término e indica dónde buscar registros. Nunca afirma que un registro no existe.
- **El disparador completo** aparece desde 1280 px, porque su texto ya no cabe con la barra
  expandida a 1024 px. Por debajo es el botón compacto con el mismo nombre accesible y su ayuda.

### D27. Ambiente siempre visible y con menos fatiga

- **Defecto medido.** En móvil, el distintivo de la barra superior se ocultaba por debajo de 640 px.
  En Producción, la línea que lo sustituía se iba al desplazar, y no quedaba ninguna indicación del
  ambiente.
- **Siempre visible.** El distintivo con el texto «Pruebas» o «Producción» va en la barra superior,
  que es fija, a todas las anchuras, incluidas las de un teléfono. La línea móvil de Producción
  desaparece porque queda redundante.
- **Pruebas sin fatiga.** La franja persistente no se puede cerrar y conserva su texto completo.
  Pasa a una superficie neutra y sutil con el icono y un acento lateral de advertencia, en lugar del
  bloque ámbar saturado. La franja de la firma por vencer conserva su tono de advertencia, porque sí
  pide una acción.
- **Producción no es un éxito.** El ambiente es contexto, no un resultado de validación. Producción
  deja el verde con marca de verificación y usa un distintivo neutro de alta atención (contraste
  invertido) con el texto «Producción». No hay ninguna comprobación de conectividad con el SRI.

### D28. Tema oscuro con menos deslumbramiento

- **Defecto medido.** El fondo casi negro (`#0a0a0a`) con texto casi blanco (`#fafafa`) daba 18,96:1:
  deslumbra en sesiones largas.
- **Corrección solo en tokens** (`.dark` en `globals.css`), sin ajustes por pantalla.
  - Fondo `oklch(0.18 0 0)` (`#121212`) y texto `oklch(0.93 0 0)`. El texto y el atenuado (0.72)
    toman los valores del preset Tangerine de la plantilla.
  - Superficies neutras escalonadas: barra 0.2, tarjeta y popover 0.225, muted, secondary y accent
    0.285. El primario, los semánticos, `input` y `ring` no cambian.
- **Contraste medido**, con la misma fórmula que `design-tokens.test.ts`:

  | Par | Antes | Después |
  | --- | --- | --- |
  | Texto / fondo | 18,96:1 | 15,30:1 |
  | Texto / tarjeta | 17,16:1 | 13,92:1 |
  | Atenuado / fondo | 8,28:1 | 7,58:1 |
  | Atenuado / muted | 6,32:1 | 5,79:1 |
  | Texto / acento (hover y activo) | 14,48:1 | 11,68:1 |
  | Texto primario / primario | 6,71:1 | 6,71:1 |
  | Primario (enlace) / fondo | 6,85:1 | 6,50:1 |
  | Borde de control / tarjeta | 3,69:1 | 3,52:1 |

  Todo sigue en WCAG AA o mejor. La prueba de tokens añade una guarda contra el negro y el blanco
  casi puros en el tema oscuro.

### D29. Botón de navegación móvil reconocible

- **Icono.** El botón que abre el panel móvil usa el icono convencional de menú (tres líneas) y no
  el del panel lateral. Escritorio conserva el del panel para colapsar la barra.
- **Nombre accesible:** «Abrir navegación». El panel sigue llamándose «Menú».

### Lo que no cambia en esta corrección

- **Tema:** el control conserva su comportamiento, sus anchuras y su contrato de prueba. Su
  prominencia en la barra superior queda como deuda UX no bloqueante.
- **Contexto de la empresa:** solo lectura, sin enlace ni selector.
- **Para la fase de componentes compartidos y de dominio:**
  - los colores de SEND_UNKNOWN, RESERVED y MANUAL_REVIEW en `StatusBadge`;
  - los mensajes crudos del SRI y la guía tras un resultado fiscal.
- **Para el corte de DataTable y PageHeader:**
  - chips con el primario;
  - números que se parten;
  - exceso de filtros en el archivo;
  - posición del estado;
  - «0-0»;
  - densidad;
  - acción principal de Facturas;
  - tablas nativas en pantallas estrechas.
- **Para los cortes de formularios:**
  - totales después de guardar;
  - posición de Guardar en Empresa;
  - formularios de producto y de tercero;
  - controles nativos.
- **Inicio:** sin rediseño ahora. Queda como trabajo prioritario: con la empresa lista no ofrece
  ninguna acción diaria. El objetivo es Nueva factura, Requieren atención, recientes y el estado de
  la firma.
- **Catálogos fiscales:** sin rediseño. Queda pendiente para su fase de dominio:
  - navegación por categorías;
  - búsqueda;
  - divulgación progresiva;
  - procedencia sin repetir;
  - ayuda para las siglas.

Todo esto queda registrado en `docs/quality/technical-debt.md`.
