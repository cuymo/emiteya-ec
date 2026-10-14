# Tasks

**Reglas para todos los grupos:**
- **Commits.** Un commit por grupo en `redesign-frontend`, sin push. Ningún grupo contacta al SRI de
  Pruebas ni de Producción.
- **Código de la plantilla.** Se copia desde `../template-shadcn-premium/` (fuera del repositorio)
  y nunca se versiona la plantilla completa.
- **Dependencias.** Cada una entra con versión exacta, con su fila en `docs/architecture/stack.md`
  y revisando el diff del lockfile paquete por paquete.
- **Pantallas heredadas.** Toda pantalla que no forma parte del shell conserva su contenido y su
  geometría.

## 1. Harness visual y línea base previa al rediseño

- [ ] 1.1 Añadir `@playwright/test` 1.64.0 como dependencia de desarrollo exacta del frontend, la
  misma versión que `playwright-core`, con su fila en `stack.md` (design D17).

  Verificar:
  - `corepack pnpm install --frozen-lockfile` pasa;
  - `check:versions` pasa;
  - no se descarga ningún navegador.
- [ ] 1.2 Crear `frontend/playwright.config.ts` y `frontend/visual/`:
  - Chrome del sistema (`channel: "chrome"`);
  - `webServer` con `next build` y `next start`, con un `API_INTERNAL_URL` ficticio;
  - fixtures deterministas de `/api/v1/*` con `page.route`: administrador y operador, Pruebas y
    Producción, firma válida, lista de facturas;
  - reloj fijo 2026-10-14 10:00 `America/Guayaquil` y `es-EC`;
  - `reducedMotion: "reduce"`, `animations: "disabled"` y espera a `document.fonts.ready`.

  Añadir los scripts `test:visual` y `test:visual:update` en el frontend y en la raíz, fuera de
  `verify`.

  Verificar:
  - `corepack pnpm test:visual` arranca, captura y termina en verde dos veces seguidas sin cambiar
    ningún píxel;
  - ninguna petición sale del propio origen.
- [ ] 1.3 Capturar y versionar la línea base previa al rediseño en
  `frontend/visual/__screenshots__/`:
  - shell en escritorio, claro y oscuro (administrador, Pruebas, Inicio);
  - shell en móvil claro;
  - lista de facturas con datos;
  - inicio de sesión.

  Añadir el volcado geométrico (`getBoundingClientRect` de cada elemento visible de esas pantallas a
  un JSON temporal no versionado) como modo del harness (design D3).

  Verificar:
  - `test:visual` pasa contra las imágenes recién versionadas;
  - el volcado geométrico es idéntico en dos ejecuciones.
- [ ] 1.4 Medir con `next build` la tabla de rutas antes del cambio (primera carga y compartido) y
  registrarla en `docs/quality/benchmarks/frontend-shell-<fecha>.{md,json}` como «antes». Documentar
  en `docs/quality/testing.md`:
  - el harness;
  - sus comandos;
  - que es solo Linux;
  - la revisión de cada imagen base en el informe HTML;
  - que no forma parte de `verify`.

  Verificar:
  - el archivo de benchmark existe con los números;
  - los comandos de `testing.md` funcionan tal como están escritos.

## 2. Escala de espaciado de base 4 sin cambio de geometría

- [ ] 2.1 Escribir `scripts/codemods/rebase-spacing-to-4px.ts` (design D3):
  - recorre con el API del compilador de TypeScript los literales de cadena y de plantilla de
    `frontend/src/**/*.{ts,tsx}`;
  - separa variantes, `!` y signo;
  - duplica solo el valor numérico de las utilidades que multiplican `--spacing` (lista de D3);
  - deja intactos el `0`, `px`, fracciones, nombres y valores arbitrarios;
  - informa cada reescritura por archivo;
  - se niega a ejecutarse si `--spacing` ya es `0.25rem`.

  Verificar con pruebas unitarias del codemod:
  - variantes anidadas (`max-md:hover:h-5.5`);
  - negativos (`-mt-1`);
  - `!`;
  - fracciones (`0.5`);
  - tokens que no son de espaciado (`text-sm`, `max-w-2xl`, `outline-offset-2`, `w-1/2`,
    `h-[calc(…)]`);
  - la negativa a ejecutarse dos veces.
- [ ] 2.2 Ejecutar el codemod y fijar `--spacing: 0.25rem` en `frontend/src/app/globals.css`, en el
  mismo commit.

  Verificar la equivalencia antes de hacer el commit:
  - `test:visual` con 0 píxeles distintos contra la línea base del grupo 1;
  - el volcado geométrico idéntico al previo;
  - `corepack pnpm --filter @facturador/frontend typecheck`, `lint` y Vitest del frontend pasan;
  - el build pasa;
  - el diff solo toca clases de espaciado y `--spacing`.
- [ ] 2.3 Actualizar la tabla de espaciado de `docs/architecture/design-foundations.md` a base 4.
  Cambian los números de los tokens; los valores en px no.

  Documentar en el commit que la reversión es revertirlo.

  Verificar que la tabla coincide con `globals.css`.

## 3. Tokens, radios, fuente y variantes CSS

- [ ] 3.1 Reescribir los tokens de `globals.css` según la tabla de D4:
  - nombres canónicos de la plantilla y neutros de la plantilla;
  - `input` de EmiteYa (3:1);
  - el azul de EmiteYa como único `primary` y `ring` sólido;
  - `destructive` con su `-foreground` desde `danger`;
  - `success`, `warning` e `info` con sus `-foreground`;
  - `overlay` y las capas `--z-*`;
  - los tokens `sidebar-*`;
  - la escala de radios de la plantilla.

  Mantener los alias heredados (`surface`, `surface-subtle`, `foreground-muted`, `danger`,
  `danger-foreground`, `neutral`) apuntando a los canónicos. Sin `chart-*` ni preajustes.

  Verificar:
  - una prueba unitaria lee `globals.css` y comprueba que cada alias resuelve a un canónico;
  - existe un solo `--primary` por tema;
  - no hay colores literales fuera del bloque de tokens.
- [ ] 3.2 Comprobar el contraste de cada par de tokens usado: texto 4,5:1 y elementos no textuales
  y bordes de formulario 3:1, en claro y oscuro. Ajustar y anotar cualquier neutro de la plantilla
  que no cumpla.

  Verificar con una prueba que calcula el contraste de los pares declarados a partir de los valores
  OKLCH de `globals.css`.
- [ ] 3.3 Añadir `tw-animate-css` (exacta, solo CSS) y una regla global `prefers-reduced-motion`
  que anule o acorte sus animaciones.

  Incorporar las variantes de `shadcn/tailwind.css` que usan los primitivos del grupo 4, por la vía
  (a) de D4: copiar solo la lista usada, con su origen. Si se elige la (b), registrar por qué.

  Verificar:
  - el build genera las variantes `data-open` y `data-closed`;
  - con `prefers-reduced-motion` las animaciones no se ejecutan (prueba en el harness);
  - `stack.md` está actualizado.
- [ ] 3.4 Añadir `geist` (exacta) y usar solo `geist/font/sans` en `app/layout.tsx` (D9):
  - la clase de la variable en `<html>`;
  - `--font-sans: var(--font-geist-sans), <pila actual>`;
  - sin Geist Mono.

  Confirmar en el paquete el origen y la licencia de la fuente. Si no son inequívocos, parar e
  informar antes de añadir binarios.

  Verificar:
  - el build sirve el woff2 desde `/_next/static/media`;
  - el harness no registra ninguna petición de fuentes a otros orígenes;
  - `check:web-security-policy` pasa sin violaciones de `font-src`;
  - se carga una sola fuente por página.
- [ ] 3.5 Crear el ADR `docs/architecture/adr/0028-…` (Accepted, 2026-10-14) sobre la adopción del
  sistema de diseño y del código fuente de «Studio Admin». Contenido:
  - procedencia: versión 2.2.0, MIT, manifiesto SHA-256 de design, ubicación fuera del repositorio;
  - capas y propiedad de los tokens;
  - regla de extensión y política de duplicación;
  - adaptación a la CSP;
  - radios, escala de 4 px, tamaños de control y Geist;
  - que reemplaza la regla de radios de 8 px como máximo.

  Actualizar en `design-foundations.md` los tokens, los radios y la fuente. Crear
  `frontend/THIRD_PARTY_NOTICES.md` con el aviso MIT de shadcn por las variantes copiadas, y
  anotar los alias en `technical-debt.md`.

  Verificar:
  - el ADR está en el índice de ADR;
  - los documentos coinciden con `globals.css`.
- [ ] 3.6 Regenerar las imágenes base afectadas por los tokens, los radios y la fuente, revisando el
  diff en el informe HTML. La geometría de las pantallas heredadas no cambia salvo por las métricas
  de la fuente.

  Verificar:
  - `test:visual` pasa con las imágenes nuevas;
  - Vitest, typecheck, lint y build pasan.

## 4. Primitivos del shell derivados de la plantilla

- [ ] 4.1 Añadir `class-variance-authority` y `cmdk` (exactas) con su fila en `stack.md`.

  Verificar que el install congelado y `check:versions` pasan.
- [ ] 4.2 Copiar y adaptar desde `../template-shadcn-premium/src/` los primitivos de la tabla de
  trazabilidad (al final de este archivo) a `frontend/src/components/ui/` y el hook a
  `frontend/src/hooks/use-mobile.ts`, con un comentario de procedencia por archivo (D6, D7).

  Adaptaciones comunes:
  - textos para lectores de pantalla en español;
  - `z-50` a capas `--z-*`;
  - colores literales a tokens (`bg-black/10` a `bg-overlay`);
  - tamaños según D5;
  - ningún `style` renderizado en el servidor (las variables del sidebar en CSS);
  - sin `SidebarInput` ni variantes sin uso;
  - el botón de cerrar del panel móvil, visible;
  - `CommandDialog` sobre el `ui/dialog` existente;
  - el `sheet` con la devolución del foco de `ui/dialog`.

  Si un API exige radix-ui 1.8, adaptar a 1.6.7, o parar e informar.

  Verificar:
  - typecheck;
  - una prueba de cada primitivo: roles, nombres accesibles en español, teclado básico y devolución
    del foco del `sheet` controlado;
  - completar las columnas de adaptación de la tabla.
- [ ] 4.3 Convertir `components/ui/button.tsx` en el botón derivado de la plantilla (D5, D6):
  - variantes `primary`, `secondary`, `outline`, `ghost`, `destructive` y `link`;
  - tamaños `default`, `sm`, `xs`, `icon`, `icon-sm` e `icon-xs`, con 44 px en móvil;
  - tamaños transitorios `legacy-md` (por defecto), `legacy-sm`, `legacy-icon` y `legacy-icon-sm`,
    con la geometría actual.

  Reescribir las 14 llamadas con `size="sm"`, `"icon"` e `"icon-sm"` a su par `legacy-*`.

  Verificar:
  - una prueba de geometría de cada tamaño;
  - el volcado geométrico de las pantallas heredadas sin cambios de caja;
  - las imágenes base heredadas con solo cambios de estilo, revisados.
- [ ] 4.4 Convertir `components/ui/menu-and-tooltip.tsx` en fachada sobre `dropdown-menu` y
  `tooltip`, con la misma API y el mismo alto de ítem. Hacer que el `Skeleton` de `states.tsx`
  reexporte `ui/skeleton` con `motion-safe`.

  Verificar:
  - las pruebas existentes que usan menús, tooltips y esqueletos pasan sin cambios;
  - no queda otra implementación de menú, tooltip ni esqueleto.
- [ ] 4.5 Documentar:
  - en `component-system.md`: capas, propiedad (TEMPLATE-DERIVED, EMITEYA-EXISTING, NEW SHARED),
    regla de extensión y fachadas;
  - en `frontend.md`: la tabla de contratos (`Button` con sus tamaños, fachadas, primitivos
    nuevos);
  - en `THIRD_PARTY_NOTICES.md`: el aviso MIT de «Studio Admin» y la lista de archivos derivados;
  - en `technical-debt.md`: los tamaños `legacy-*`, las fachadas y `StatusBadge` pendiente de
    `Badge`.

  Verificar:
  - Vitest, typecheck, lint y build pasan;
  - `test:visual` pasa con las imágenes regeneradas y revisadas.

## 5. Modelo de rutas canónico

- [ ] 5.1 Crear `frontend/src/lib/navigation/routes.ts` y su resolución por ruta (D10):
  - los grupos en el orden de la spec;
  - Inicio suelto;
  - los destinos con su permiso actual;
  - las rutas internas con su miga final y su permiso (tabla de D10);
  - Mi cuenta;
  - las seis acciones de creación con su permiso de borrador.

  Verificar con pruebas unitarias:
  - cada una de las 42 páginas de `app/` encaja con un destino o un patrón;
  - visibilidad por rol (administrador y operador, como en la spec);
  - el destino actual para rutas internas;
  - las migas de cada patrón;
  - las acciones de creación por rol;
  - la paridad del permiso de cada patrón con el que exige su pantalla, según la tabla revisada;
  - una ruta sin patrón no se guarda.
- [ ] 5.2 Documentar en `navigation-responsive.md` la arquitectura de información aprobada (grupos,
  orden y destinos) y que el modelo de rutas es la única fuente de la navegación, las migas, la
  paleta, la creación rápida y la guarda.

  Verificar que los grupos del documento coinciden con el modelo.

## 6. Shell: barra lateral, barra superior, contexto, ambiente, cuenta, tema y migas

- [ ] 6.1 Crear en `components/shell/`:
  - `AppShell`, con el enlace para saltar al contenido, `SidebarProvider` y las ranuras de contexto
    y avisos;
  - `AppSidebar`: marca «EmiteYa» con el icono `Receipt` enlazada a Inicio, los grupos del modelo,
    el destino actual con `aria-current`, el colapso a iconos con tooltips y nombre accesible, y en
    móvil un `Sheet` con grupos plegables;
  - `Topbar`, según D11 y cada anchura;
  - `AppBreadcrumbs` (D15).

  Leer `sidebar_state` en `app/(app)/layout.tsx` con `cookies()` y pasarlo al proveedor. Borrar
  `components/app-shell.tsx` y `components/navigation.tsx`.

  Verificar con pruebas de la spec:
  - shell disponible, verificación de sesión y sin sesión;
  - navegación según permisos y destino actual;
  - colapsar y recargar, destino colapsado accesible, panel móvil con foco devuelto y mismos
    destinos;
  - migas;
  - saltar al contenido.
- [ ] 6.2 Crear la presentación de `CompanyContext` en `components/shell/` (no es un control) y su
  conexión en `features/company/` con `useCompanyStatus`: nombre comercial o razón social, carga
  reservada y error sin nombre supuesto.

  Adaptar `EnvironmentBadge` al `Badge` derivado (icono y texto). Conservar `EnvironmentNotice` y
  `CertificateNotice` bajo la barra, en ese orden.

  Verificar con pruebas de la spec:
  - empresa con y sin nombre comercial;
  - sin selector de empresas;
  - contexto no disponible;
  - otra empresa no visible;
  - Pruebas con la barra colapsada y en móvil;
  - Producción sin depender del color;
  - ambiente desconocido;
  - aviso de la firma dentro del shell.
- [ ] 6.3 Crear `AccountMenu`, derivado de `nav-user`:
  - nombre accesible «Cuenta de {nombre}»;
  - nombre, correo y rol;
  - Mi cuenta;
  - «Tema» como opciones de radio por debajo de 640 px;
  - Cerrar sesión, inactivo tras elegirlo.

  Mantener el `ThemeToggle` (radiogroup «Tema») en la barra desde 640 px y retirar `ThemeMenu` (D8).

  Verificar con pruebas de la spec:
  - contenido del menú, cerrar sesión y cierre repetido;
  - tema: cambiar y recargar, teclado y pantalla estrecha.
- [ ] 6.4 Reescribir `frontend/test/app-shell.test.tsx` conservando cada comportamiento que ya
  cubría:
  - sesión;
  - visibilidad de cada destino por rol, en sus grupos nuevos;
  - destino actual;
  - desplazamiento de la barra con la ventana baja, comprobado por comportamiento y no por clases;
  - error distinto de 401;
  - tema con flechas.

  Verificar:
  - Vitest del frontend pasa;
  - `check:web-security-policy` pasa con sus selectores sin cambios (`Cuenta de`, `Comprobantes`,
    `Usuarios`, «Tema», «Cerrar sesión»).
- [ ] 6.5 Documentar el shell en `navigation-responsive.md` (barra superior, contexto, ambiente,
  barra adaptable, migas, tema y cuenta) y las ranuras y componentes del shell en `frontend.md`. Con
  esto se completan las columnas del shell en la tabla de trazabilidad.

  Verificar:
  - typecheck, lint y build pasan;
  - en el HTML de una página autenticada no hay ningún atributo `style`.

## 7. Creación rápida y paleta de comandos

- [ ] 7.1 Crear `QuickCreateMenu`, derivado del «Quick Create» de `nav-main` (D14):
  - `DropdownMenu` en la cabecera de la barra con las acciones permitidas del modelo, variante
    `outline`;
  - colapsada, un icono con el tooltip «Nuevo»;
  - dentro del panel en móvil;
  - solo navega.

  Verificar con pruebas de la spec:
  - nueva factura;
  - abrir sin elegir (ninguna petición de creación);
  - acción no permitida (con un conjunto de permisos sintético);
  - teclado con el foco devuelto.
- [ ] 7.2 Crear `CommandPalette`, derivada de `search-dialog` (D13):
  - Ctrl/⌘ + K y disparador «Buscar…» con `Kbd`;
  - grupos «Ir a» y «Crear» desde el modelo, filtrados por rol;
  - filtro propio sin mayúsculas ni tildes;
  - contenido cargado bajo demanda;
  - sin consultas a la API;
  - Escape con el foco devuelto.

  Verificar con pruebas de la spec:
  - atajo y destino («credito» encuentra Notas de crédito);
  - acción de creación;
  - sin consultas al servidor (el mock de la API no registra llamadas mientras se escribe);
  - sin resultados;
  - cerrar con Escape;
  - destinos según el rol;
  - pruebas unitarias del filtro.
- [ ] 7.3 Ampliar `scripts/check-web-security-policy.ts` con estos flujos, todos sin ninguna
  violación de la política:
  - abrir y cerrar la paleta;
  - colapsar y expandir la barra;
  - abrir la creación rápida.

  Documentar la paleta y la creación rápida en `navigation-responsive.md`.

  Verificar:
  - `check:web-security-policy` pasa;
  - el build muestra `cmdk` en un chunk diferido, no en la carga compartida.

## 8. Estados de ruta y destino no permitido

- [ ] 8.1 Crear `components/route-states/` (D16): `RouteLoading`, `RouteError`, `RouteNotFound` y
  `RouteForbidden`, construidos con `empty`, `button` y `skeleton`. Añadir:
  - `app/(app)/loading.tsx`;
  - `app/(app)/error.tsx` (cliente, `retry()`, mensaje fijo sin `error.message`);
  - `app/not-found.tsx`, con la marca, un enlace a Inicio y sin llamadas a la API.

  Sin ruta comodín.

  Verificar con pruebas de la spec:
  - navegación lenta;
  - fallo al mostrar;
  - sin detalles técnicos (un error con mensaje técnico no lo muestra);
  - dirección inexistente;
  - la API no cambia: con el servidor de desarrollo, `/api/v1/me` sigue llegando a la API.
- [ ] 8.2 Añadir en `AppShell` la guarda de destino no permitido del modelo de rutas (D11).

  Verificar con pruebas de la spec:
  - operador en Usuarios: se ve `RouteForbidden` y el mock no registra `GET /users`;
  - destino permitido: Catálogos fiscales se muestra.
- [ ] 8.3 Documentar en `feedback-and-states.md` los estados de ruta compartidos y la razón de no
  usar una ruta comodín.

  Verificar que typecheck, lint y Vitest pasan.

## 9. Nombre visible del producto

- [ ] 9.1 Cambiar «Facturador SRI» por «EmiteYa» en la interfaz:
  - `metadata` raíz;
  - el `metadata.title` de las 42 páginas («X · EmiteYa»);
  - el texto de marca del inicio de sesión;
  - el esqueleto del shell.

  El README y los nombres de paquetes no cambian.

  Verificar:
  - una prueba que recorre `app/**/page.tsx` y exige títulos terminados en «· EmiteYa»;
  - `frontend/src` no contiene «Facturador SRI»;
  - las pruebas del inicio de sesión pasan;
  - escenarios «Título de una pantalla» y «Marca en el shell y en el inicio de sesión».

## 10. Prevención de duplicación escalonada

- [ ] 10.1 Añadir en `frontend/eslint.config.js` las reglas de D19 solo para
  `src/components/shell/**`, `src/components/route-states/**`, `src/lib/navigation/**` y
  `src/hooks/**`, más la prohibición de `style` en `src/components/ui/**`. `features/**` no cambia.

  Verificar:
  - una prueba que ejecuta ESLint con la configuración real sobre fragmentos de muestra en esas
    rutas detecta cada infracción y acepta el código correcto;
  - `corepack pnpm lint` pasa en todo el repositorio sin tocar código heredado.
- [ ] 10.2 Documentar en `component-system.md` la aplicación escalonada y cómo se amplía al migrar
  cada pantalla.

  Verificar que el documento lista las mismas rutas que la configuración.

## 11. Pruebas del shell en navegador

- [ ] 11.1 Reemplazar las imágenes base del shell por el conjunto canónico del shell premium (D17),
  unas 15 imágenes:
  - escritorio claro y oscuro, con la barra expandida y colapsada;
  - tableta;
  - móvil cerrado y con el panel abierto;
  - Producción con un operador;
  - paleta y creación rápida abiertas;
  - carga, error, dirección inexistente y destino no permitido;
  - lista de facturas heredada dentro del shell;
  - inicio de sesión.

  Revisar cada una en el informe HTML.

  Verificar:
  - `test:visual` pasa dos veces seguidas;
  - las imágenes están versionadas.
- [ ] 11.2 Añadir `@axe-core/playwright` (exacta, de desarrollo) y la prueba de accesibilidad WCAG
  2.2 AA del shell: escritorio claro y oscuro, móvil y paleta abierta. Añadir el recorrido de
  teclado real con el foco visible: barra, paleta, creación rápida, menú de cuenta y tema.

  Verificar:
  - `test:visual` informa cero violaciones de axe;
  - la fila de `stack.md` está añadida.
- [ ] 11.3 Comprobar en el harness:
  - cero peticiones a otros orígenes (fuente, imágenes, analítica);
  - el aviso de Pruebas visible en cada imagen de una empresa en Pruebas.

  Actualizar `testing.md` con el conjunto canónico final.

  Verificar que `test:visual` pasa.

## 12. Verificación integral

- [ ] 12.1 Medir de nuevo la tabla de rutas de `next build` y completar el «después» en
  `docs/quality/benchmarks/frontend-shell-<fecha>.{md,json}`. Comprobar que ningún chunk contiene
  Recharts, FullCalendar, simple-icons, Vercel Analytics ni otras dependencias de demostración, y
  que hay un solo woff2.

  Verificar que el benchmark tiene los dos lados y las comprobaciones de chunks.
- [ ] 12.2 Construir la imagen de producción del frontend de `deploy/` en local y comprobar que
  contiene la fuente servida desde el propio origen y que el build no pidió fuentes a otros
  orígenes.

  Verificar:
  - la imagen se construye;
  - el woff2 está en `.next/static/media`.
- [ ] 12.3 Recorrer `docs/quality/frontend-checklist.md` sobre el shell:
  - anchuras de 320, 768, 1024 y 1440 px;
  - zoom al 200 %;
  - teclado;
  - temas claro y oscuro;
  - administrador y operador;
  - Pruebas y Producción.

  Comprobar que cada pantalla heredada abre y funciona dentro del shell nuevo.

  Verificar que la lista queda marcada con sus hallazgos resueltos.
- [ ] 12.4 Ejecutar `corepack pnpm verify` y `corepack pnpm test:visual`, sin tráfico al SRI.

  Verificar que ambos pasan.

## Trazabilidad de componentes (referencia)

La tarea que copia o crea cada componente actualiza su fila con las adaptaciones reales.

**Primitivos y hook:**

| Componente | Origen en la plantilla | Destino en EmiteYa | Clase | Adaptaciones | CSP | Accesibilidad | Pruebas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sidebar | `src/components/ui/sidebar.tsx` | `frontend/src/components/ui/sidebar.tsx` | TEMPLATE-DERIVED | Sin `SidebarInput` ni variantes sin uso; anchos en CSS; tamaños D5; cookie `sidebar_state`; Ctrl/⌘ + B | Sin `style` en servidor (variables en `globals.css`) | Botón de cerrar visible en móvil; textos en español; tooltips en colapsado | 4.2, 6.1 |
| sheet | `src/components/ui/sheet.tsx` | `…/ui/sheet.tsx` | TEMPLATE-DERIVED | `bg-black/10` a `bg-overlay`; `z-50` a capas | — | «Cerrar» en español; foco devuelto en modo controlado | 4.2 |
| tooltip | `src/components/ui/tooltip.tsx` | `…/ui/tooltip.tsx` | TEMPLATE-DERIVED | `z-50` a capa; base de la fachada | — | Opaco; se muestra con foco | 4.2, 4.4 |
| dropdown-menu | `src/components/ui/dropdown-menu.tsx` | `…/ui/dropdown-menu.tsx` | TEMPLATE-DERIVED | `z-50` a capa; base de la fachada | — | Teclado Radix | 4.2, 4.4 |
| collapsible | `src/components/ui/collapsible.tsx` | `…/ui/collapsible.tsx` | TEMPLATE-DERIVED | Ninguna | — | `aria-expanded` | 4.2 |
| separator | `src/components/ui/separator.tsx` | `…/ui/separator.tsx` | TEMPLATE-DERIVED | Ninguna | — | Decorativo por defecto | 4.2 |
| skeleton | `src/components/ui/skeleton.tsx` | `…/ui/skeleton.tsx` | TEMPLATE-DERIVED | `motion-safe`; lo reexporta `states.tsx` | — | Oculto a lectores | 4.2, 4.4 |
| avatar | `src/components/ui/avatar.tsx` | `…/ui/avatar.tsx` | TEMPLATE-DERIVED | Solo iniciales, sin `AvatarImage` | Sin imágenes remotas | Iniciales ocultas a lectores; nombre en el contenedor | 4.2 |
| badge | `src/components/ui/badge.tsx` | `…/ui/badge.tsx` | TEMPLATE-DERIVED | Variantes semánticas `success`, `warning`, `info`, `destructive`, `neutral` y `outline`; icono obligatorio en estados | — | Nunca solo color | 4.2, 6.2 |
| button | `src/components/ui/button.tsx` | `…/ui/button.tsx` | TEMPLATE-DERIVED, reemplaza al EMITEYA-EXISTING | Variantes con nombres de EmiteYa; tamaños D5 y `legacy-*` | — | Foco con anillo sólido; 44 px en móvil | 4.3 |
| breadcrumb | `src/components/ui/breadcrumb.tsx` | `…/ui/breadcrumb.tsx` | TEMPLATE-DERIVED | «Más» en español | — | `aria-current="page"` | 4.2, 6.1 |
| kbd | `src/components/ui/kbd.tsx` | `…/ui/kbd.tsx` | TEMPLATE-DERIVED | Ninguna | — | Decorativo junto al nombre accesible | 4.2 |
| command | `src/components/ui/command.tsx` | `…/ui/command.tsx` | TEMPLATE-DERIVED | `CommandDialog` sobre el `ui/dialog` existente; título y descripción en español | — | Combobox de cmdk; foco devuelto | 4.2, 7.2 |
| empty | `src/components/ui/empty.tsx` | `…/ui/empty.tsx` | TEMPLATE-DERIVED | Ninguna | — | Título como encabezado | 4.2, 8.1 |
| use-mobile | `src/hooks/use-mobile.ts` | `frontend/src/hooks/use-mobile.ts` | TEMPLATE-DERIVED | Corte de 768 px | — | — | 4.2 |
| dialog | — | `…/ui/dialog.tsx` | EMITEYA-EXISTING | Base de `CommandDialog` | — | Devolución del foco conservada | 7.2 |

**Componentes del shell:**

| Componente | Origen en la plantilla | Destino en EmiteYa | Clase | Adaptaciones | CSP | Accesibilidad | Pruebas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AppShell | `src/app/(main)/dashboard/layout.tsx` | `frontend/src/components/shell/app-shell.tsx` | TEMPLATE-DERIVED | Sin preferencias, presets, GitHub ni promoción; ranuras de contexto y avisos; guarda | Sin `style` | Enlace para saltar al contenido; puntos de referencia | 6.1, 8.2 |
| AppSidebar | `…/_components/sidebar/app-sidebar.tsx`, `nav-main.tsx` | `…/shell/app-sidebar.tsx` | TEMPLATE-DERIVED | Grupos del modelo; marca EmiteYa; sin tarjeta de soporte, Inbox ni insignias de demostración | — | `aria-current`; nombre accesible en colapsado | 6.1 |
| Topbar | `src/app/(main)/dashboard/layout.tsx` (header) | `…/shell/topbar.tsx` | TEMPLATE-DERIVED | Composición D11 por anchura | Sin `style` | Controles de 44 px en móvil | 6.1 |
| AppBreadcrumbs | — (compone `ui/breadcrumb`) | `…/shell/app-breadcrumbs.tsx` | NEW SHARED | Derivadas del modelo | — | Página actual anunciada | 6.1 |
| CompanyContext | `…/_components/header/account-switcher.tsx` (patrón visual) | `…/shell/company-context.tsx` | TEMPLATE-DERIVED | Solo lectura, no es un control; sin lista ni cambio de empresa | — | Nombre completo accesible | 6.2 |
| EnvironmentBadge | — | `frontend/src/features/company/environment-notice.tsx` | EMITEYA-EXISTING | Sobre el `Badge` derivado | — | Icono y texto | 6.2 |
| AccountMenu | `…/_components/sidebar/nav-user.tsx` | `…/shell/account-menu.tsx` | TEMPLATE-DERIVED | Mi cuenta, «Tema» en pantallas estrechas, Cerrar sesión; sin Billing ni Notifications | — | «Cuenta de {nombre}» | 6.3 |
| ThemeToggle | — | `frontend/src/components/theme-toggle.tsx` | EMITEYA-EXISTING | Tokens nuevos; desde 640 px | — | Radiogroup «Tema» | 6.3 |
| QuickCreateMenu | `…/_components/sidebar/nav-main.tsx` (Quick Create) | `…/shell/quick-create-menu.tsx` | TEMPLATE-DERIVED | Acciones reales del modelo; `outline` | — | Teclado y foco devuelto | 7.1 |
| CommandPalette | `…/_components/header/search-dialog.tsx` | `…/shell/command-palette.tsx` | TEMPLATE-DERIVED | Ctrl/⌘ + K; filtro sin tildes; carga diferida; sin datos del servidor | — | Foco devuelto; textos en español | 7.2 |
| RouteLoading, RouteError, RouteNotFound, RouteForbidden | — (componen `empty`, `button` y `skeleton`) | `frontend/src/components/route-states/` | NEW SHARED | Mensajes fijos en español | — | `role="status"` en la carga | 8.1, 8.2 |
