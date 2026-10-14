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

- [x] 4.1 Reescribir los tokens de `globals.css` según D4:
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
- [x] 4.2 Comprobar el contraste de cada par de tokens usado (4,5:1 en texto, 3:1 en elementos no
  textuales y bordes de formulario), en claro y oscuro. Ajustar y anotar lo que no cumpla.

  Verificar con una prueba que calcula el contraste desde los valores OKLCH.
- [x] 4.3 Importar `tw-animate-css` y añadir la regla global `prefers-reduced-motion`. Copiar a
  `globals.css` solo las variantes de shadcn que usan los primitivos del grupo 5, con su origen
  anotado (D4).

  Verificar:
  - el build genera las variantes `data-open` y `data-closed`;
  - con movimiento reducido no hay animaciones;
  - `THIRD_PARTY_NOTICES.md` lista el CSS copiado.
- [x] 4.4 Usar solo `geist/font/sans` en `app/layout.tsx`, con la variable en `<html>` y
  `--font-sans` sobre `var(--font-geist-sans)`. Sin Geist Mono (D9).

  Verificar:
  - el build sirve el woff2 desde `/_next/static/media`;
  - cero peticiones de fuentes a otros orígenes;
  - `check:web-security-policy` sin violaciones de `font-src`;
  - una sola fuente por página.

  Si falla, parar con `GEIST_SOURCE_BLOCKER`.
- [x] 4.5 Crear el ADR `docs/architecture/adr/0028-sistema-de-diseno-y-componentes-de-la-plantilla.md`
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

- [x] 5.1 Copiar y adaptar desde `../template-shadcn-premium/src/` los primitivos de la tabla de
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
- [x] 5.2 Convertir `components/ui/button.tsx` en el botón derivado (D5, D6):
  - variantes `primary`, `secondary`, `outline`, `ghost`, `destructive` y `link`;
  - tamaños `default` (36), `sm` (32), `xs` (24), `icon`, `icon-sm` e `icon-xs`, con 44 px en móvil;
  - tamaños transitorios `legacy-md` (por defecto), `legacy-sm`, `legacy-icon` y `legacy-icon-sm`.

  Reescribir las 14 llamadas explícitas a su par `legacy-*`.

  Verificar:
  - una prueba por tamaño: la escala aprobada, y que cada `legacy-*` conserva las mismas clases de
    alto, relleno, separación, objetivo táctil e icono que el botón anterior. Es una comprobación de
    clases, no un volcado geométrico, porque Geist (grupo 4) ya cambió las métricas del texto;
  - revisión visual de las pantallas heredadas con el botón nuevo;
  - ningún archivo nuevo usa `legacy-*`.
- [x] 5.3 Convertir `components/ui/menu-and-tooltip.tsx` en fachada sobre `dropdown-menu` y
  `tooltip`, con la misma API y alto. Hacer que el `Skeleton` de `states.tsx` reexporte
  `ui/skeleton` con `motion-safe`.

  Verificar:
  - las pruebas existentes de menús, tooltips y esqueletos pasan sin cambios;
  - no queda otra implementación.
- [x] 5.4 Documentar:
  - `component-system.md`: capas, propiedad, regla de extensión, fachadas y variantes `legacy-*`
    como compatibilidad transitoria;
  - `frontend.md`: la tabla de contratos;
  - `technical-debt.md`: `legacy-*`, fachadas y `StatusBadge` pendiente de `Badge`.

  Verificar que Vitest, typecheck, lint y build pasan.

## 6. Etapa D: modelo de rutas canónico

- [x] 6.1 Crear `frontend/src/lib/navigation/` (D10, D15). Contenido:
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
- [x] 6.2 Documentar en `navigation-responsive.md` la arquitectura de información aprobada, la regla
  de migas jerárquicas y que el modelo es la única fuente.

  Verificar que el documento coincide con el modelo.

## 7. Etapa D: shell, barra superior, contexto, ambiente, cuenta, tema y migas

- [x] 7.1 Crear en `components/shell/`:
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
- [x] 7.2 Crear la presentación de `CompanyContext` (no es un control) y su conexión en
  `features/company/`. Adaptar `EnvironmentBadge` al `Badge` derivado. Mantener `EnvironmentNotice` y
  `CertificateNotice` en ese orden.

  Verificar con pruebas de la spec: empresa con y sin nombre comercial, sin selector, contexto no
  disponible, otra empresa no visible, Pruebas con la barra colapsada y en móvil, Producción sin
  color, ambiente desconocido y aviso de la firma.
- [x] 7.3 Crear `AccountMenu`:
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
- [x] 7.4 Reescribir `frontend/test/app-shell.test.tsx` conservando cada comportamiento que cubría,
  y explicar en el commit cada aserción cambiada. Los grupos pasan de «Operación» y «Configuración»
  a los grupos nuevos, y las clases `sticky`/`overflow-y-auto` se sustituyen por comprobaciones de
  comportamiento.

  Verificar:
  - Vitest pasa;
  - `check:web-security-policy` pasa con sus selectores sin cambios.
- [x] 7.5 Documentar el shell en `navigation-responsive.md` y en `frontend.md`.

  Verificar:
  - typecheck, lint y build pasan;
  - el HTML de una página autenticada no tiene ningún atributo `style`.

## 8. Etapa D: creación rápida y paleta de comandos

- [x] 8.1 Crear `QuickCreateMenu` (D14):
  - en la cabecera de la barra, variante `outline`, sin color propio, 44 px en móvil;
  - colapsada, un icono con el tooltip «Nuevo»;
  - acciones permitidas del modelo;
  - solo navega.

  Verificar con pruebas de la spec: nueva factura, abrir sin elegir (ninguna petición de creación),
  acción no permitida y teclado con foco devuelto.
- [x] 8.2 Crear `CommandPalette` (D13):
  - Ctrl/⌘ + K y disparador con `Kbd`;
  - «Ir a» y «Crear» desde el modelo y según el rol;
  - filtro sin mayúsculas ni tildes;
  - carga diferida;
  - sin consultas a la API ni resultados inventados;
  - Escape con foco devuelto.

  Verificar con pruebas de la spec: atajo y destino, acción de creación, sin consultas al servidor,
  sin resultados, Escape y destinos según el rol. Añadir pruebas unitarias del filtro.
- [x] 8.3 Ampliar `scripts/check-web-security-policy.ts` con la paleta, el colapso de la barra y la
  creación rápida, sin violaciones. Documentar la paleta y la creación rápida en
  `navigation-responsive.md`.

  Verificar:
  - `check:web-security-policy` pasa;
  - `cmdk` está en un chunk diferido.

## 9. Etapa E: estados de ruta, destino no permitido y accesibilidad

- [x] 9.1 Crear `components/route-states/` (`RouteLoading`, `RouteError`, `RouteNotFound` y
  `RouteForbidden`) con `empty`, `button` y `skeleton`. Añadir:
  - `app/(app)/loading.tsx`;
  - `app/(app)/error.tsx`, con `retry()` y un mensaje fijo;
  - `app/not-found.tsx`, sin llamadas a la API.

  Sin ruta comodín.

  Verificar con pruebas de la spec: navegación lenta, fallo al mostrar, sin detalles técnicos,
  dirección inexistente y que la API no cambia.
- [x] 9.2 Añadir la guarda síncrona de destino no permitido en `AppShell` (D11).

  Verificar con pruebas de la spec:
  - operador en Usuarios: estado sin acceso y ninguna petición `GET /users`;
  - sin destello: el contenido de Secuenciales nunca se monta para un operador;
  - destino permitido.
- [x] 9.3 Añadir pruebas de teclado de Vitest para la barra (colapso, Ctrl+B, panel móvil con
  Escape y foco devuelto), la paleta, la creación rápida, el menú de cuenta y el tema. Documentar
  los estados de ruta y la razón de no usar comodín en `feedback-and-states.md`.

  Verificar que typecheck, lint y Vitest pasan.

## 10. Etapa D: nombre visible del producto

- [x] 10.1 Cambiar «Facturador SRI» por «EmiteYa» en:
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

- [x] 11.1 Añadir en `frontend/eslint.config.js` las reglas de D19, solo para `components/shell/**`,
  `components/route-states/**`, `lib/navigation/**` y `hooks/**`, más la prohibición de `style` en
  `components/ui/**`.

  Verificar:
  - una prueba ejecuta ESLint con la configuración real sobre fragmentos de muestra: detecta cada
    infracción (`radix-ui` directo, color hexadecimal, valor arbitrario, `legacy-*`, `style`,
    `Button` sin `size`) y acepta el código correcto;
  - `corepack pnpm lint` pasa sin tocar código heredado.
- [x] 11.2 Documentar en `component-system.md` la aplicación escalonada.

  Verificar que el documento lista las mismas rutas que la configuración.

## 12. Etapa F: pruebas del shell en navegador

- [x] 12.1 Capturar y versionar el proyecto `shell` (D17), revisando cada imagen en el informe HTML.

  Verificar que `test:visual` pasa dos veces seguidas.
- [x] 12.2 Añadir la prueba de accesibilidad con `@axe-core/playwright` (WCAG 2.2 AA) sobre el
  shell: escritorio claro y oscuro, móvil y paleta abierta. Añadir el recorrido de teclado real con
  el foco visible.

  Verificar:
  - cero violaciones de axe;
  - el recorrido de teclado pasa, como complemento de las pruebas de interacción y no como
    sustituto.
- [x] 12.3 Comprobar en el harness que ninguna petición sale del propio origen y que el aviso de
  Pruebas aparece en cada imagen de Pruebas. Actualizar `testing.md` con el conjunto final.

  Verificar que `test:visual` pasa.

## 13. Etapa F: integración final

- [x] 13.1 Medir de nuevo `next build` y completar el «después» del benchmark. Comprobar que no hay
  en los chunks:
  - Recharts, simple-icons, FullCalendar ni Vercel Analytics;
  - las preferencias en zustand de la plantilla;
  - fuentes remotas ni código de negocio de demostración;
  - más de un woff2.

  Verificar que el benchmark tiene los dos lados y las comprobaciones.
- [x] 13.2 Construir en local la imagen de producción del frontend y confirmar que contiene la
  fuente servida desde el propio origen y que el build no pidió fuentes a otros orígenes. Si el
  flujo local de revisión lo permite, reconstruir el despliegue local de revisión con
  `SRI_TRANSMISSION_ENABLED=0` y sin tráfico al SRI.

  Verificar que la imagen se construye y que el woff2 está.
- [x] 13.3 Recorrer `docs/quality/frontend-checklist.md` sobre el shell:
  - 320, 768, 1024 y 1440 px, y zoom al 200 %;
  - teclado;
  - temas claro y oscuro;
  - administrador y operador;
  - Pruebas y Producción.

  Comprobar que cada pantalla heredada abre dentro del shell nuevo.

  Verificar que la lista queda marcada.
- [x] 13.4 Ejecutar, sin tráfico al SRI:
  - `openspec:validate`, `format:check`, `security:dependencies` y `security:secrets`;
  - `verify`;
  - `test:visual`.

  Verificar que todo pasa, o que solo falla un flake ya registrado (AC-04), con evidencia exacta.

## 14. Correcciones del control de calidad UX

La revisión UX independiente del 2026-10-14 fue aceptada por el propietario como entrada autorizada
(design, «Correcciones del control de calidad UX», D21 a D29). Las tareas 1 a 13 quedan como
estaban. Estas corrigen el shell antes de archivar, sin tocar el backend, la API, la base de datos,
la lógica fiscal ni el SRI.

- [x] 14.1 Registrar las correcciones en el design (D21 a D29), en la spec delta y en estas tareas.

  Verificar con `openspec:validate`.
- [ ] 14.2 SH-1: en `ui/sidebar`, que la etiqueta de grupo en modo icono no reciba el puntero, sin
  quitarla del DOM (D21).

  Verificar que la navegación conserva sus nombres accesibles.
- [ ] 14.3 SH-2: en `SidebarContent`, desplazamiento vertical expandida y colapsada, sin
  desplazamiento horizontal (D22).

  Verificar rueda, teclado y foco.
- [ ] 14.4 SH-3: en `AppSidebar`, mostrar el destino actual si queda fuera del área visible de la
  barra, en la carga, en un enlace directo y en cada cambio de ruta (D23):
  - solo la barra, nunca la página;
  - sin moverla si el destino ya se ve entero;
  - con movimiento reducido, sin animación.

  Verificar con pruebas unitarias y en navegador.
- [ ] 14.5 Configuración plegada fuera de sus pantallas y abierta en ellas, con apertura y pliegue
  manual durante la sesión, en escritorio, colapsada y en el panel móvil (D24).

  Verificar que no se pierde ningún destino ni permiso.
- [ ] 14.6 IA de ventas y documentos (D25), sin mover rutas:
  - Ventas › Borradores de facturas (`/borradores`);
  - Documentos › Archivo de comprobantes (`/comprobantes`);
  - las migas, la paleta, el destino actual, los nombres accesibles, el título del documento y el
    encabezado de esas pantallas.

  Verificar que «Nueva factura» marca Ventas › Borradores de facturas.
- [ ] 14.7 Paleta veraz (D26):
  - disparador y campo «Buscar pantalla o acción…», con nombre accesible «Buscar pantalla o
    acción» también en el botón compacto;
  - sinónimos en el modelo de rutas;
  - estado vacío que no afirma la inexistencia de registros.

  Verificar que no hay resultados de registros concretos ni consultas al servidor.
- [ ] 14.8 Ambiente (D27):
  - distintivo con texto a todas las anchuras en la barra superior fija;
  - sin la línea móvil de Producción;
  - franja de Pruebas en una superficie neutra con acento de advertencia, sin cierre;
  - Producción en un distintivo neutro de alta atención, sin verde de éxito.

  Verificar a 390 px, también al desplazar.
- [ ] 14.9 Tema oscuro (D28): solo los tokens de `.dark`, con el contraste antes y después y una
  guarda en `design-tokens.test.ts`.

  Verificar WCAG AA en cada par.
- [ ] 14.10 Botón de navegación móvil con el icono de menú y el nombre «Abrir navegación» (D29).

  Verificar el foco al cerrar el panel.
- [ ] 14.11 Pruebas de regresión UX en el harness (`visual/shell/`), a las anchuras y alturas de
  D21 a D23:
  - clic en el centro de cada icono colapsado, para administrador y operador;
  - alcance con el puntero a poca altura, expandida y colapsada;
  - destino actual a la vista tras un enlace directo;
  - Configuración plegada fuera y abierta dentro;
  - ambiente visible en móvil al desplazar;
  - alcance declarado y sinónimos de la paleta;
  - nombres Borradores de facturas y Archivo de comprobantes.

  Verificar también teclado, axe y foco.
- [ ] 14.12 Capturas:
  - revisar las diferencias de las capturas del shell;
  - actualizar solo las afectadas;
  - añadir estados nuevos: ventana baja, destino de Configuración, Producción en móvil.

  Verificar que ninguna captura ajena cambia.
- [ ] 14.13 Documentar en `navigation-responsive.md`, `design-foundations.md`,
  `feedback-and-states.md`, `frontend.md` y `technical-debt.md`, incluidos los hallazgos aplazados a
  las fases siguientes.
- [ ] 14.14 Ejecutar, sin tráfico al SRI:
  - las pruebas enfocadas;
  - `openspec:validate`, `format:check`, `security:dependencies` y `security:secrets`;
  - `test:visual`;
  - `verify`.

  Verificar que todo pasa.
- [ ] 14.15 Reconstruir el frontend del despliegue local de revisión, con `SRI_TRANSMISSION_ENABLED=0`
  y sin tráfico al SRI, y repetir la revisión UX enfocada en el shell a 1440, 1024, 768 y 390 px.

  Verificar cero hallazgos S4/S5 del shell y SH-1 a SH-3 cerrados.

## Registro de la verificación

- **13.1, carga:** el JavaScript transferido sube entre un 1,7 y un 3,5 % según la pantalla. Se
  añade una sola fuente, Geist Sans variable (69.652 bytes, desde el propio origen). Ningún chunk
  contiene dependencias de demostración, y `cmdk` va en un chunk diferido
  (`docs/quality/benchmarks/frontend-shell-2026-10-14.md`).
- **13.2, Docker:** la imagen de producción del frontend se construye con el woff2 en
  `.next/static/media` y sin peticiones a fuentes externas. El despliegue local de revisión se
  reconstruyó solo en su frontend, con la transmisión al SRI desactivada (el backend registra
  `"sriTransmission":"disabled"`) y sin tráfico al SRI.
- **13.3, lista de comprobación del frontend:**
  - **Pantallas:** `visual/shell/routes.spec.ts` abre las 41 pantallas autenticadas a 320, 768, 1024
    y 1440 px dentro del shell, sin errores no capturados ni desbordamiento horizontal. El zoom al
    200 % equivale a un viewport CSS de la mitad, que queda dentro de ese rango.
  - **Accesibilidad:** cero violaciones de axe (WCAG 2.2 AA).
  - **Teclado:** recorrido real en el navegador.
  - **Temas:** claro y oscuro, con el contraste de tokens comprobado.
  - **Roles:** administrador y operador.
  - **Ambientes:** Pruebas y Producción.
  - **Contra el backend real:** `check:web-security-policy` recorre inicio de sesión, navegación,
    paleta, barra y creación rápida, con 40 comprobaciones en verde, y la revisión local sirve el
    shell.
  - **Lista de comprobación:** sin hallazgos abiertos para el shell.
- **13.4, integración final:** sin tráfico al SRI.
  - **Validaciones:** `openspec:validate` (25/25), `format:check`, `security:dependencies` y
    `security:secrets` (Gitleaks 8.30.1) pasan.
  - **Primer `verify`:** falló de forma determinista en una sola suite.
    `backend/test/data-portability/portability-doc.test.ts` leía `components/navigation.tsx`, que
    este change borra. Ahora lee `lib/navigation/routes.ts`, donde la entrada de Portabilidad tiene
    la misma forma. No cambia ninguna aserción: ruta, etiqueta, permiso y posición dentro del grupo
    Configuración, después de Usuarios.
  - **Segundo `verify`:** pasa completo: 405 de 405 archivos, 3561 pruebas en verde y 1 omitida,
    sin fallos de AC-04, y `check:web-security-policy` con 40 comprobaciones en verde.
  - **`test:visual`:** 27 de 27 en verde: 15 capturas del shell, 5 pruebas de axe, 6 de teclado y
    el recorrido de las 41 rutas.
  - **Prueba de equivalencia del espaciado:** es evidencia congelada del commit del codemod y se
    ejecutó sobre ese commit (cero píxeles distintos y geometría idéntica en las 5 pantallas).

## Trazabilidad de componentes (referencia)

La tarea que copia o crea cada componente actualiza su fila con las adaptaciones reales.

La licencia de todo componente TEMPLATE-DERIVED es MIT de «Studio Admin», sobre primitivos MIT de
shadcn/ui. Los avisos están en `frontend/THIRD_PARTY_NOTICES.md`.

**Primitivos y hook** (rutas relativas a `src/` en la plantilla y a `frontend/src/` en EmiteYa):

| Componente | Origen | Destino | Clase | Adaptaciones | CSP | Accesibilidad | Responsive | Pruebas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sidebar | `components/ui/sidebar.tsx` | `components/ui/sidebar.tsx` | TEMPLATE-DERIVED | Solo variante `sidebar` con colapso a iconos; sin `SidebarInput`, `SidebarRail`, acciones, insignias, submenús ni esqueleto; `SidebarInset` es un `div`; cookie `sidebar_state` con `SameSite=Lax`; Ctrl/⌘ + B; capa `--z-sticky` | Sin `style` (anchos en `globals.css`; el esqueleto, que escribía `style`, no se copia) | Botón «Cerrar menú» visible en móvil; título y descripción del panel en español; tooltips en colapsado | Escritorio y tableta colapsables; `Sheet` en móvil con ítems de 44 px | 5.1, 7.1 |
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
| command | `components/ui/command.tsx` | `components/ui/command.tsx` | TEMPLATE-DERIVED | `CommandDialog` sobre `ui/dialog`, con título y descripción en español dentro del contenido; `CommandInput` con envoltorio propio en lugar de `InputGroup` (evita importar `input-group`, `input` y `textarea`); sin `CommandShortcut` ni el indicador de selección | — | Combobox de cmdk; foco devuelto; ítems de 44 px en móvil | Diálogo arriba en móvil | 5.1, 8.2 |
| empty | `components/ui/empty.tsx` | `components/ui/empty.tsx` | TEMPLATE-DERIVED | Ninguna | — | Título como encabezado | — | 5.1, 9.1 |
| use-mobile | `hooks/use-mobile.ts` | `hooks/use-mobile.ts` | TEMPLATE-DERIVED | Corte de 768 px; `useSyncExternalStore` en lugar de copiar el estado en un efecto; expone `useMediaQuery` | — | — | Decide `Sheet` y el tema por anchura | 5.1 |
| dialog | — | `components/ui/dialog.tsx` | EMITEYA-EXISTING | Base de `CommandDialog`; la devolución del foco pasa a `use-return-focus.ts`, compartida con `sheet` | — | Devolución del foco | — | 5.1, 8.2 |
| use-return-focus | — | `components/ui/use-return-focus.ts` | EMITEYA-EXISTING (extraído de `dialog.tsx`) | Recuerda quién abrió la capa y le devuelve el foco | — | Foco devuelto en capas controladas | — | 5.1 |

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
