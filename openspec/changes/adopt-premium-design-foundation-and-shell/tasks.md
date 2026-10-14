# Tasks

**Reglas para todos los grupos:**
- **Commits.** Un commit por grupo en `redesign-frontend`, sin push, sin archivar y sin publicar en
  `main`.
- **SRI.** Ningún grupo contacta al SRI de Pruebas ni de Producción. `SRI_TRANSMISSION_ENABLED`
  sigue desactivado.
- **Código de la plantilla.** Se copia desde `../template-shadcn-premium/` (fuera del repositorio)
  y nunca se versiona la plantilla completa.
- **Dependencias.** Cada una entra con versión exacta, con su fila en `docs/architecture/stack.md`,
  revisando el diff del lockfile paquete por paquete, y con `security:dependencies` en verde.
- **Pantallas heredadas.** Toda pantalla que no forma parte del shell conserva su contenido y su
  geometría.
- **Pruebas existentes.** Ninguna prueba de comportamiento se borra. Cada aserción que cambia queda
  explicada en el commit que la cambia.

## 1. Etapa A: aviso de terceros y dependencias

- [x] 1.1 Crear `frontend/THIRD_PARTY_NOTICES.md` con:
  - el aviso MIT de «Studio Admin» (© 2024 Mohammed Arham Khan, versión 2.2.0);
  - el aviso MIT de shadcn/ui, origen de los primitivos y de las variantes CSS;
  - la sección «Archivos derivados», que cada grupo completa;
  - la aclaración de que el archivo no recoge términos de compra externos que no estén en la
    plantilla.

  Verificar que el archivo existe con los dos avisos completos.
- [x] 1.2 Añadir las dependencias con versión exacta compatible y una fila cada una en `stack.md`:
  - de ejecución: `class-variance-authority`, `cmdk`, `tw-animate-css` y `geist`;
  - de desarrollo: `@playwright/test` 1.64.0 (la misma que `playwright-core`) y
    `@axe-core/playwright`.

  No se instala `shadcn`. Nada las importa todavía.

  Verificar:
  - `corepack pnpm install --frozen-lockfile` pasa;
  - `check:versions` pasa;
  - `security:dependencies` pasa;
  - no se descarga ningún navegador;
  - el diff del lockfile solo trae esas dependencias y sus transitivas revisadas.
- [x] 1.3 Inspeccionar el paquete `geist` instalado (design D9):
  - los woff2 están dentro del paquete;
  - `geist/font/sans` usa `next/font/local`, sin `next/font/google` ni ninguna URL remota;
  - la licencia de la fuente (OFL-1.1) y la del paquete.

  Si algo falla, parar con `GEIST_SOURCE_BLOCKER`.

  Verificar con un informe de la inspección en el commit: archivos, licencias y ausencia de URLs
  remotas.

## 2. Etapa B: harness visual y línea base de la prueba de espaciado

- [x] 2.1 Crear `frontend/playwright.config.ts` y `frontend/visual/` (design D17):
  - Chrome del sistema;
  - `webServer` con `next build` y `next start`, con un `API_INTERNAL_URL` ficticio;
  - fixtures deterministas de `/api/v1/*` con `page.route`;
  - reloj fijo 2026-10-14 10:00 `America/Guayaquil` y `es-EC`;
  - `reducedMotion: "reduce"`, `animations: "disabled"` y espera a `document.fonts.ready`;
  - los proyectos `spacing-proof` y `shell`.

  Scripts en el frontend y en la raíz, fuera de `verify`: `test:visual`, `test:visual:update` y
  `test:visual:spacing-proof`. Una ejecución normal nunca escribe imágenes base.

  Verificar:
  - el proyecto `spacing-proof` captura dos veces seguidas sin ningún píxel distinto;
  - ninguna petición sale del propio origen.
- [x] 2.2 Capturar y versionar la línea base de la interfaz actual en `frontend/visual/spacing-proof/`:
  - shell en escritorio, claro y oscuro (administrador, Pruebas, Inicio);
  - shell en móvil claro;
  - lista de facturas con datos;
  - inicio de sesión.

  Añadir y versionar el volcado geométrico de esas pantallas: la caja de cada elemento visible, con
  su ruta en el DOM.

  Verificar:
  - `test:visual:spacing-proof` pasa contra lo versionado;
  - el volcado es idéntico en dos ejecuciones.
- [x] 2.3 Medir con `next build` la tabla de rutas antes del cambio (primera carga y compartido) en
  `docs/quality/benchmarks/frontend-shell-2026-10-14.{md,json}`, como «antes». Documentar en
  `docs/quality/testing.md`:
  - el harness y sus tres comandos;
  - que es solo Linux;
  - la separación entre la prueba de espaciado y el shell premium;
  - la revisión de imágenes en el informe HTML;
  - que nunca actualiza imágenes de forma automática;
  - que no forma parte de `verify`.

  Verificar:
  - el benchmark tiene números;
  - los comandos documentados funcionan tal como están escritos.

## 3. Etapa B: escala de espaciado de base 4 con geometría equivalente

- [x] 3.1 Escribir `scripts/codemods/rebase-spacing-to-4px.ts` y sus pruebas (design D3):
  - literales de cadena y de plantilla de `frontend/src/**/*.{ts,tsx}` con el API del compilador de
    TypeScript;
  - separa variantes, `!` y signo;
  - duplica solo el número de las utilidades que multiplican `--spacing`;
  - deja intactos el `0`, `px`, fracciones, nombres y valores arbitrarios;
  - informa cada reescritura por archivo;
  - se niega a ejecutarse si `--spacing` ya es `0.25rem`;
  - no toca backend, contratos ni recursos fiscales.

  Verificar con las pruebas:
  - variantes anidadas, negativos, `!` y valores con `.5`;
  - tokens que no son de espaciado (`text-sm`, `max-w-2xl`, `outline-offset-2`, `w-1/2`,
    `h-[calc(…)]`);
  - la negativa a ejecutarse dos veces.
- [x] 3.2 Ejecutar el codemod y fijar `--spacing: 0.25rem`, sin ningún otro cambio visual.

  Verificar la equivalencia antes de hacer el commit:
  - `test:visual:spacing-proof` con 0 píxeles distintos;
  - el volcado geométrico idéntico al versionado;
  - typecheck, lint, Vitest y build del frontend pasan;
  - el diff solo toca clases de espaciado y `--spacing`.

  Si hay ruido de rasterizado con la geometría idéntica, aplicar la política de D3: informar la
  causa y no relajar en silencio.
- [x] 3.3 Actualizar la tabla de espaciado de `design-foundations.md` a base 4 y describir la
  transformación. Hacer el commit con el codemod y su resultado. En un commit inmediatamente
  posterior, borrar el codemod y sus pruebas (D3).

  Verificar:
  - el historial contiene el codemod y su resultado;
  - el árbol final no tiene el codemod;
  - la tabla coincide con `globals.css`.

## 4. Etapa C: tokens, radios, fuente y variantes CSS

- [ ] 4.1 Reescribir los tokens de `globals.css` según D4:
  - canónicos de la plantilla, con sus neutros;
  - `input` de EmiteYa (3:1);
  - un único `primary`, el azul de EmiteYa, y `ring` sólido;
  - `destructive` con su `-foreground`;
  - `success`, `warning` e `info` con sus `-foreground`;
  - `overlay`, las capas `--z-*` y los tokens `sidebar-*`;
  - la escala de radios de la plantilla;
  - los alias heredados apuntando a los canónicos.

  Sin `chart-*`, preajustes ni otros azules.

  Verificar con una prueba que lee `globals.css`:
  - cada alias resuelve a un canónico;
  - hay un solo `--primary` por tema;
  - no hay colores literales fuera del bloque de tokens;
  - cada radio es un token con nombre.
- [ ] 4.2 Comprobar el contraste de cada par de tokens usado (4,5:1 en texto, 3:1 en elementos no
  textuales y bordes de formulario), en claro y oscuro. Ajustar y anotar lo que no cumpla.

  Verificar con una prueba que calcula el contraste desde los valores OKLCH.
- [ ] 4.3 Importar `tw-animate-css` y añadir la regla global `prefers-reduced-motion`. Copiar a
  `globals.css` solo las variantes de shadcn que usan los primitivos del grupo 5, con su origen
  anotado (D4).

  Verificar:
  - el build genera las variantes `data-open` y `data-closed`;
  - con movimiento reducido no hay animaciones;
  - `THIRD_PARTY_NOTICES.md` lista el CSS copiado.
- [ ] 4.4 Usar solo `geist/font/sans` en `app/layout.tsx`, con la variable en `<html>` y
  `--font-sans` sobre `var(--font-geist-sans)`. Sin Geist Mono (D9).

  Verificar:
  - el build sirve el woff2 desde `/_next/static/media`;
  - cero peticiones de fuentes a otros orígenes;
  - `check:web-security-policy` sin violaciones de `font-src`;
  - una sola fuente por página.

  Si falla, parar con `GEIST_SOURCE_BLOCKER`.
- [ ] 4.5 Crear el ADR `docs/architecture/adr/0028-sistema-de-diseno-y-componentes-de-la-plantilla.md`
  (Accepted, 2026-10-14). Contenido:
  - procedencia: «Studio Admin» 2.2.0, MIT, manifiesto SHA-256, fuera del repositorio;
  - capas y propiedad de los tokens;
  - regla de extensión y duplicación;
  - adaptación a la CSP;
  - radios con nombre, que reemplazan la regla de 8 px como máximo;
  - escala de 4 px, tamaños de control y Geist.

  Actualizar `design-foundations.md` (tokens, radios y fuente) y anotar los alias en
  `technical-debt.md`.

  Verificar que el ADR está en el índice y que los documentos coinciden con `globals.css`.

## 5. Etapa C: primitivos derivados de la plantilla

- [ ] 5.1 Copiar y adaptar desde `../template-shadcn-premium/src/` los primitivos de la tabla de
  trazabilidad (al final de este archivo) a `frontend/src/components/ui/`, y el hook a
  `frontend/src/hooks/use-mobile.ts`, con un comentario de procedencia por archivo (D6, D7).

  Adaptaciones comunes:
  - textos para lectores de pantalla en español;
  - `z-50` a capas;
  - colores literales a tokens;
  - tamaños según D5;
  - ningún `style` renderizado en el servidor;
  - sin `SidebarInput` ni variantes sin uso;
  - botón de cerrar visible en el panel móvil;
  - `CommandDialog` sobre el `ui/dialog` existente;
  - el `sheet` con la devolución del foco.

  Si un API exige radix-ui 1.8, adaptar a 1.6.7, o parar e informar.

  Verificar:
  - typecheck;
  - una prueba de cada primitivo: roles, nombres en español, teclado y devolución del foco del
    `sheet` controlado;
  - las columnas de la tabla completas;
  - `THIRD_PARTY_NOTICES.md` lista cada archivo derivado.
- [ ] 5.2 Convertir `components/ui/button.tsx` en el botón derivado (D5, D6):
  - variantes `primary`, `secondary`, `outline`, `ghost`, `destructive` y `link`;
  - tamaños `default` (36), `sm` (32), `xs` (24), `icon`, `icon-sm` e `icon-xs`, con 44 px en móvil;
  - tamaños transitorios `legacy-md` (por defecto), `legacy-sm`, `legacy-icon` y `legacy-icon-sm`.

  Reescribir las 14 llamadas explícitas a su par `legacy-*`.

  Verificar:
  - una prueba de geometría por tamaño;
  - el volcado geométrico de las pantallas heredadas sin cambios de caja frente al estado posterior
    al grupo 3;
  - ningún archivo nuevo usa `legacy-*`.
- [ ] 5.3 Convertir `components/ui/menu-and-tooltip.tsx` en fachada sobre `dropdown-menu` y
  `tooltip`, con la misma API y alto. Hacer que el `Skeleton` de `states.tsx` reexporte
  `ui/skeleton` con `motion-safe`.

  Verificar:
  - las pruebas existentes de menús, tooltips y esqueletos pasan sin cambios;
  - no queda otra implementación.
- [ ] 5.4 Documentar:
  - `component-system.md`: capas, propiedad, regla de extensión, fachadas y variantes `legacy-*`
    como compatibilidad transitoria;
  - `frontend.md`: la tabla de contratos;
  - `technical-debt.md`: `legacy-*`, fachadas y `StatusBadge` pendiente de `Badge`.

  Verificar que Vitest, typecheck, lint y build pasan.

## 6. Etapa D: modelo de rutas canónico

- [ ] 6.1 Crear `frontend/src/lib/navigation/` (D10, D15). Contenido:
  - grupos en el orden de la spec, con Inicio suelto;
  - destinos con su permiso actual;
  - rutas internas con su miga final y su permiso;
  - Mi cuenta;
  - las seis acciones de creación con su permiso de borrador;
  - la marca de sección de Configuración;
  - la resolución de una ruta en destino actual, migas (sin migas de una sola miga) y permiso.

  Verificar con pruebas unitarias:
  - las 42 páginas encajan;
  - visibilidad por rol;
  - destino actual de las rutas internas;
  - migas: Facturas › Detalle de factura, Configuración › Empresa, ninguna en Facturas ni en
    Inicio;
  - acciones de creación por rol;
  - paridad de permisos con cada pantalla;
  - una ruta sin patrón no se guarda.
- [ ] 6.2 Documentar en `navigation-responsive.md` la arquitectura de información aprobada, la regla
  de migas jerárquicas y que el modelo es la única fuente.

  Verificar que el documento coincide con el modelo.

## 7. Etapa D: shell, barra superior, contexto, ambiente, cuenta, tema y migas

- [ ] 7.1 Crear en `components/shell/`:
  - `AppShell`: enlace para saltar al contenido, `SidebarProvider` y ranuras;
  - `AppSidebar`: marca EmiteYa con `Receipt`, grupos, `aria-current`, colapso a iconos con
    tooltips y en móvil un `Sheet` con grupos plegables;
  - `Topbar`;
  - `AppBreadcrumbs`, con `useBreadcrumbLabel`.

  Leer `sidebar_state` con `cookies()` en el layout. Conectar `useBreadcrumbLabel` con una línea en
  las seis pantallas de detalle de comprobantes (número) y en la de inventario (producto). Borrar
  `components/app-shell.tsx` y `components/navigation.tsx`.

  Verificar con pruebas de la spec:
  - shell disponible, verificación de sesión y sin sesión;
  - navegación según permisos y destino actual;
  - colapsar y recargar, destino colapsado accesible, panel móvil y mismos destinos;
  - las migas de la spec, incluida la ausencia en destinos de primer nivel;
  - saltar al contenido.
- [ ] 7.2 Crear la presentación de `CompanyContext` (no es un control) y su conexión en
  `features/company/`. Adaptar `EnvironmentBadge` al `Badge` derivado. Mantener `EnvironmentNotice` y
  `CertificateNotice` en ese orden.

  Verificar con pruebas de la spec: empresa con y sin nombre comercial, sin selector, contexto no
  disponible, otra empresa no visible, Pruebas con la barra colapsada y en móvil, Producción sin
  color, ambiente desconocido y aviso de la firma.
- [ ] 7.3 Crear `AccountMenu`:
  - «Cuenta de {nombre}»;
  - nombre, correo y rol;
  - Mi cuenta;
  - «Tema» solo por debajo de 640 px, renderizado por media query y no solo oculto;
  - Cerrar sesión, inactivo tras elegirlo.

  Mantener `ThemeToggle` en la barra desde 640 px y retirar `ThemeMenu` (D8).

  Verificar con pruebas de la spec:
  - contenido, cerrar sesión y cierre repetido;
  - tema: cambiar y recargar, teclado y pantalla estrecha;
  - un solo control por ancho: a 375 px y a 1280 px hay exactamente un control de tema enfocable.
- [ ] 7.4 Reescribir `frontend/test/app-shell.test.tsx` conservando cada comportamiento que cubría,
  y explicar en el commit cada aserción cambiada. Los grupos pasan de «Operación» y «Configuración»
  a los grupos nuevos, y las clases `sticky`/`overflow-y-auto` se sustituyen por comprobaciones de
  comportamiento.

  Verificar:
  - Vitest pasa;
  - `check:web-security-policy` pasa con sus selectores sin cambios.
- [ ] 7.5 Documentar el shell en `navigation-responsive.md` y en `frontend.md`.

  Verificar:
  - typecheck, lint y build pasan;
  - el HTML de una página autenticada no tiene ningún atributo `style`.

## 8. Etapa D: creación rápida y paleta de comandos

- [ ] 8.1 Crear `QuickCreateMenu` (D14):
  - en la cabecera de la barra, variante `outline`, sin color propio, 44 px en móvil;
  - colapsada, un icono con el tooltip «Nuevo»;
  - acciones permitidas del modelo;
  - solo navega.

  Verificar con pruebas de la spec: nueva factura, abrir sin elegir (ninguna petición de creación),
  acción no permitida y teclado con foco devuelto.
- [ ] 8.2 Crear `CommandPalette` (D13):
  - Ctrl/⌘ + K y disparador con `Kbd`;
  - «Ir a» y «Crear» desde el modelo y según el rol;
  - filtro sin mayúsculas ni tildes;
  - carga diferida;
  - sin consultas a la API ni resultados inventados;
  - Escape con foco devuelto.

  Verificar con pruebas de la spec: atajo y destino, acción de creación, sin consultas al servidor,
  sin resultados, Escape y destinos según el rol. Añadir pruebas unitarias del filtro.
- [ ] 8.3 Ampliar `scripts/check-web-security-policy.ts` con la paleta, el colapso de la barra y la
  creación rápida, sin violaciones. Documentar la paleta y la creación rápida en
  `navigation-responsive.md`.

  Verificar:
  - `check:web-security-policy` pasa;
  - `cmdk` está en un chunk diferido.

## 9. Etapa E: estados de ruta, destino no permitido y accesibilidad

- [ ] 9.1 Crear `components/route-states/` (`RouteLoading`, `RouteError`, `RouteNotFound` y
  `RouteForbidden`) con `empty`, `button` y `skeleton`. Añadir:
  - `app/(app)/loading.tsx`;
  - `app/(app)/error.tsx`, con `retry()` y un mensaje fijo;
  - `app/not-found.tsx`, sin llamadas a la API.

  Sin ruta comodín.

  Verificar con pruebas de la spec: navegación lenta, fallo al mostrar, sin detalles técnicos,
  dirección inexistente y que la API no cambia.
- [ ] 9.2 Añadir la guarda síncrona de destino no permitido en `AppShell` (D11).

  Verificar con pruebas de la spec:
  - operador en Usuarios: estado sin acceso y ninguna petición `GET /users`;
  - sin destello: el contenido de Secuenciales nunca se monta para un operador;
  - destino permitido.
- [ ] 9.3 Añadir pruebas de teclado de Vitest para la barra (colapso, Ctrl+B, panel móvil con
  Escape y foco devuelto), la paleta, la creación rápida, el menú de cuenta y el tema. Documentar
  los estados de ruta y la razón de no usar comodín en `feedback-and-states.md`.

  Verificar que typecheck, lint y Vitest pasan.

## 10. Etapa D: nombre visible del producto

- [ ] 10.1 Cambiar «Facturador SRI» por «EmiteYa» en:
  - el `metadata` raíz;
  - el `metadata.title` de las 42 páginas;
  - el inicio de sesión;
  - el esqueleto del shell y `RouteNotFound`.

  El README y los paquetes no cambian.

  Verificar:
  - una prueba recorre `app/**/page.tsx` y exige «· EmiteYa»;
  - `frontend/src` no contiene «Facturador SRI»;
  - las pruebas del inicio de sesión pasan.

## 11. Etapa E: prevención de duplicación escalonada

- [ ] 11.1 Añadir en `frontend/eslint.config.js` las reglas de D19, solo para `components/shell/**`,
  `components/route-states/**`, `lib/navigation/**` y `hooks/**`, más la prohibición de `style` en
  `components/ui/**`.

  Verificar:
  - una prueba ejecuta ESLint con la configuración real sobre fragmentos de muestra: detecta cada
    infracción (`radix-ui` directo, color hexadecimal, valor arbitrario, `legacy-*`, `style`,
    `Button` sin `size`) y acepta el código correcto;
  - `corepack pnpm lint` pasa sin tocar código heredado.
- [ ] 11.2 Documentar en `component-system.md` la aplicación escalonada.

  Verificar que el documento lista las mismas rutas que la configuración.

## 12. Etapa F: pruebas del shell en navegador

- [ ] 12.1 Capturar y versionar el proyecto `shell` (D17), revisando cada imagen en el informe HTML.

  Verificar que `test:visual` pasa dos veces seguidas.
- [ ] 12.2 Añadir la prueba de accesibilidad con `@axe-core/playwright` (WCAG 2.2 AA) sobre el
  shell: escritorio claro y oscuro, móvil y paleta abierta. Añadir el recorrido de teclado real con
  el foco visible.

  Verificar:
  - cero violaciones de axe;
  - el recorrido de teclado pasa, como complemento de las pruebas de interacción y no como
    sustituto.
- [ ] 12.3 Comprobar en el harness que ninguna petición sale del propio origen y que el aviso de
  Pruebas aparece en cada imagen de Pruebas. Actualizar `testing.md` con el conjunto final.

  Verificar que `test:visual` pasa.

## 13. Etapa F: integración final

- [ ] 13.1 Medir de nuevo `next build` y completar el «después» del benchmark. Comprobar que no hay
  en los chunks:
  - Recharts, simple-icons, FullCalendar ni Vercel Analytics;
  - las preferencias en zustand de la plantilla;
  - fuentes remotas ni código de negocio de demostración;
  - más de un woff2.

  Verificar que el benchmark tiene los dos lados y las comprobaciones.
- [ ] 13.2 Construir en local la imagen de producción del frontend y confirmar que contiene la
  fuente servida desde el propio origen y que el build no pidió fuentes a otros orígenes. Si el
  flujo local de revisión lo permite, reconstruir el despliegue local de revisión con
  `SRI_TRANSMISSION_ENABLED=0` y sin tráfico al SRI.

  Verificar que la imagen se construye y que el woff2 está.
- [ ] 13.3 Recorrer `docs/quality/frontend-checklist.md` sobre el shell:
  - 320, 768, 1024 y 1440 px, y zoom al 200 %;
  - teclado;
  - temas claro y oscuro;
  - administrador y operador;
  - Pruebas y Producción.

  Comprobar que cada pantalla heredada abre dentro del shell nuevo.

  Verificar que la lista queda marcada.
- [ ] 13.4 Ejecutar, sin tráfico al SRI:
  - `openspec:validate`, `format:check`, `security:dependencies` y `security:secrets`;
  - `verify`;
  - `test:visual`.

  Verificar que todo pasa, o que solo falla un flake ya registrado (AC-04), con evidencia exacta.

## Trazabilidad de componentes (referencia)

La tarea que copia o crea cada componente actualiza su fila con las adaptaciones reales.

La licencia de todo componente TEMPLATE-DERIVED es MIT de «Studio Admin», sobre primitivos MIT de
shadcn/ui. Los avisos están en `frontend/THIRD_PARTY_NOTICES.md`.

**Primitivos y hook** (rutas relativas a `src/` en la plantilla y a `frontend/src/` en EmiteYa):

| Componente | Origen | Destino | Clase | Adaptaciones | CSP | Accesibilidad | Responsive | Pruebas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sidebar | `components/ui/sidebar.tsx` | `components/ui/sidebar.tsx` | TEMPLATE-DERIVED | Sin `SidebarInput` ni variantes sin uso; anchos en CSS; tamaños D5; cookie `sidebar_state`; Ctrl/⌘ + B | Sin `style` en servidor | Botón de cerrar visible en móvil; español; tooltips en colapsado | Escritorio y tableta colapsables; `Sheet` en móvil | 5.1, 7.1 |
| sheet | `components/ui/sheet.tsx` | `components/ui/sheet.tsx` | TEMPLATE-DERIVED | `bg-overlay`; capas | — | «Cerrar»; foco devuelto en modo controlado | Lateral en móvil | 5.1 |
| tooltip | `components/ui/tooltip.tsx` | `components/ui/tooltip.tsx` | TEMPLATE-DERIVED | Capa; base de la fachada | — | Opaco; se muestra con foco | — | 5.1, 5.3 |
| dropdown-menu | `components/ui/dropdown-menu.tsx` | `components/ui/dropdown-menu.tsx` | TEMPLATE-DERIVED | Capa; base de la fachada | — | Teclado Radix | Ítems de 44 px en móvil | 5.1, 5.3 |
| collapsible | `components/ui/collapsible.tsx` | `components/ui/collapsible.tsx` | TEMPLATE-DERIVED | Ninguna | — | `aria-expanded` | Grupos del panel móvil | 5.1 |
| separator | `components/ui/separator.tsx` | `components/ui/separator.tsx` | TEMPLATE-DERIVED | Ninguna | — | Decorativo | — | 5.1 |
| skeleton | `components/ui/skeleton.tsx` | `components/ui/skeleton.tsx` | TEMPLATE-DERIVED | `motion-safe`; lo reexporta `states.tsx` | — | Oculto a lectores | — | 5.1, 5.3 |
| avatar | `components/ui/avatar.tsx` | `components/ui/avatar.tsx` | TEMPLATE-DERIVED | Solo iniciales | Sin imágenes remotas | Nombre en el contenedor | — | 5.1 |
| badge | `components/ui/badge.tsx` | `components/ui/badge.tsx` | TEMPLATE-DERIVED | Variantes semánticas; icono en estados | — | Nunca solo color | — | 5.1, 7.2 |
| button | `components/ui/button.tsx` | `components/ui/button.tsx` | TEMPLATE-DERIVED (reemplaza al EMITEYA-EXISTING) | Nombres de EmiteYa; D5 y `legacy-*` | — | Anillo sólido; `aria-label` en solo icono | 44 px en móvil | 5.2 |
| breadcrumb | `components/ui/breadcrumb.tsx` | `components/ui/breadcrumb.tsx` | TEMPLATE-DERIVED | «Más» en español | — | `aria-current="page"` | Fila compacta en móvil | 5.1, 7.1 |
| kbd | `components/ui/kbd.tsx` | `components/ui/kbd.tsx` | TEMPLATE-DERIVED | Ninguna | — | Decorativo | Oculto en móvil | 5.1 |
| command | `components/ui/command.tsx` | `components/ui/command.tsx` | TEMPLATE-DERIVED | `CommandDialog` sobre `ui/dialog`; español | — | Combobox de cmdk; foco devuelto | — | 5.1, 8.2 |
| empty | `components/ui/empty.tsx` | `components/ui/empty.tsx` | TEMPLATE-DERIVED | Ninguna | — | Título como encabezado | — | 5.1, 9.1 |
| use-mobile | `hooks/use-mobile.ts` | `hooks/use-mobile.ts` | TEMPLATE-DERIVED | Corte de 768 px | — | — | Decide `Sheet` | 5.1 |
| dialog | — | `components/ui/dialog.tsx` | EMITEYA-EXISTING | Base de `CommandDialog` | — | Devolución del foco | — | 8.2 |

**Componentes del shell** (rutas de la plantilla relativas a `src/app/(main)/dashboard/`):

| Componente | Origen | Destino | Clase | Adaptaciones | CSP | Accesibilidad | Responsive | Pruebas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AppShell | `layout.tsx` | `components/shell/app-shell.tsx` | TEMPLATE-DERIVED | Sin preferencias, presets, GitHub ni promoción; ranuras; guarda | Sin `style` | Enlace para saltar al contenido; puntos de referencia | Barra fija | 7.1, 9.2 |
| AppSidebar | `_components/sidebar/app-sidebar.tsx`, `nav-main.tsx` | `components/shell/app-sidebar.tsx` | TEMPLATE-DERIVED | Modelo de rutas; marca EmiteYa; sin tarjeta de soporte, Inbox ni insignias de demostración | — | `aria-current`; nombre accesible en colapsado | Colapsable; `Sheet` | 7.1 |
| Topbar | `layout.tsx` (header) | `components/shell/topbar.tsx` | TEMPLATE-DERIVED | D11 por anchura | Sin `style` | Controles de 44 px en móvil | 48 y 56 px | 7.1 |
| AppBreadcrumbs | — (compone `ui/breadcrumb`) | `components/shell/app-breadcrumbs.tsx` | NEW SHARED | Jerárquicas; sin miga de una sola miga; `useBreadcrumbLabel` | — | Página actual anunciada | Fila compacta en móvil | 6.1, 7.1 |
| CompanyContext | `_components/header/account-switcher.tsx` (patrón visual) | `components/shell/company-context.tsx` | TEMPLATE-DERIVED | Solo lectura; sin cambio de empresa | — | Nombre completo accesible | Nombre truncado | 7.2 |
| EnvironmentBadge | — | `features/company/environment-notice.tsx` | EMITEYA-EXISTING | Sobre `Badge` | — | Icono y texto | Línea en < 640 px | 7.2 |
| AccountMenu | `_components/sidebar/nav-user.tsx` | `components/shell/account-menu.tsx` | TEMPLATE-DERIVED | Mi cuenta, Tema en < 640 px, Cerrar sesión; sin Billing ni Notifications | — | «Cuenta de {nombre}» | Tema según anchura | 7.3 |
| ThemeToggle | — | `components/theme-toggle.tsx` | EMITEYA-EXISTING | Tokens nuevos | — | Radiogroup «Tema» | Desde 640 px | 7.3 |
| QuickCreateMenu | `_components/sidebar/nav-main.tsx` (Quick Create) | `components/shell/quick-create-menu.tsx` | TEMPLATE-DERIVED | Acciones reales; `outline` | — | Teclado; foco devuelto | 44 px en móvil | 8.1 |
| CommandPalette | `_components/header/search-dialog.tsx` | `components/shell/command-palette.tsx` | TEMPLATE-DERIVED | Ctrl/⌘ + K; filtro sin tildes; carga diferida | — | Foco devuelto; español | Disparador de icono en móvil | 8.2 |
| Estados de ruta | — (componen `empty`, `button` y `skeleton`) | `components/route-states/` | NEW SHARED | Mensajes fijos en español | — | `role="status"` | — | 9.1, 9.2 |
