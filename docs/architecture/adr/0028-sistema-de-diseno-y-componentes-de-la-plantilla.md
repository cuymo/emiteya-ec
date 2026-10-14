# ADR 0028: Sistema de diseño y componentes derivados de la plantilla «Studio Admin»

## Status

Accepted el 2026-10-14, en la revisión del propietario de `adopt-premium-design-foundation-and-shell`.

Reemplaza la regla «Default to 8px or less in work surfaces» de `../design-foundations.md` y la escala
de espaciado de base 8.

## Context

- **Por qué hace falta.** El frontend estaba completo en funcionalidad, pero cada pantalla resolvía
  su presentación por su cuenta. El propietario adquirió una plantilla con código fuente real de
  primitivos y de un shell de aplicación para usarla como base visual y de componentes de todo el
  rediseño.
- **La plantilla:**
  - «Studio Admin» (next-shadcn-admin-dashboard), paquete `studio-admin` 2.2.0, MIT, © 2024
    Mohammed Arham Khan.
  - El propietario declara que la adquirió de forma legítima, y el árbol no contiene otros términos
    que el MIT.
  - Se conserva fuera del repositorio, en `../template-shadcn-premium/` respecto de la raíz del
    proyecto: 351 archivos con el manifiesto SHA-256
    `68d37d29c57cef002eed931143b55106d1be06941dad1602af02da14bf7ad7c5`. El manifiesto es
    `find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum` desde su raíz.
- **Choques con EmiteYa que la revisión de preparación (2026-10-14) dejó a la vista:**
  - escala de espaciado de base 4 contra la de base 8 de EmiteYa;
  - radios de 10 px como base contra el máximo de 8 px;
  - neutros sin tokens semánticos de estado;
  - un script de tema en línea sin nonce y atributos `style` renderizados en el servidor, que la
    CSP del ADR 0025 bloquea;
  - 17 fuentes de Google, analítica de Vercel y recursos remotos;
  - TanStack Table 9, React Compiler y zustand.

## Decision

- **Fuente de la verdad visual.** Los primitivos y el shell se derivan del código fuente de la
  plantilla, no de capturas. Solo se copia lo que se usa, con un comentario de procedencia por
  archivo y una fila en la tabla de trazabilidad del cambio que lo introduce.
  - El aviso MIT de la plantilla, el de shadcn/ui y la licencia de Geist están en
    `frontend/THIRD_PARTY_NOTICES.md`.
  - El árbol de la plantilla nunca se versiona ni se redistribuye.
- **Capas**, con una sola dirección de dependencia (`../component-system.md`):

  | Capa | Ubicación | Contenido |
  | --- | --- | --- |
  | L1 | `frontend/src/components/ui/` | Primitivos derivados de la plantilla y los propios de EmiteYa |
  | L2 | `components/shell/`, `components/route-states/` y los compartidos existentes | Componentes compartidos de aplicación |
  | L3 | `features/` | Componentes de dominio |

  Los datos del dominio entran al shell por ranuras, nunca por importación.
- **Propiedad de los tokens.**
  - `frontend/src/app/globals.css` es la única fuente.
  - **Nombres:** los canónicos son los de la plantilla (`background`, `card`, `popover`, `muted`,
    `accent`, `border`, `input`, `ring`, `sidebar-*`).
  - **Valores:**
    - neutros y superficies de la plantilla;
    - el azul de EmiteYa como único `primary`;
    - los semánticos de EmiteYa (`destructive`, `success`, `warning`, `info`) con sus `-foreground`;
    - un anillo de foco sólido.
  - **Contraste.** Manda sobre el valor literal: el borde de formulario conserva 3:1 y algunos
    semánticos del tema claro bajan de luminosidad. `frontend/test/design-tokens.test.ts` lo
    comprueba.
  - **Alias heredados.** `surface`, `surface-subtle`, `foreground-muted`, `danger`,
    `danger-foreground` y `neutral` apuntan a los canónicos hasta que cada pantalla migre: son el
    mismo valor, no una segunda paleta.
- **Escalas:**
  - **Espaciado:** base 4 (`--spacing: 0.25rem`). El paso desde base 8 se hizo con un codemod de un
    solo uso y se demostró sin cambio de geometría (cero píxeles, cajas idénticas).
  - **Radios:** los de la plantilla, todos con nombre (`--radius` de 0,625 rem y sus derivados `sm` a
    `4xl`). No se admite un radio arbitrario en código nuevo; un primitivo derivado que lo necesite
    por razones técnicas lo documenta como excepción aislada.
- **Tamaños de control:**
  - 36 px en formularios y acciones de página;
  - 32 px en barras, tablas y navegación;
  - 24 px solo en micro-controles dentro de chips;
  - al menos 44 px de objetivo táctil por debajo de 768 px.

  El tamaño es una variante del componente, nunca una decisión de la feature. Las variantes
  `legacy-*` de `Button` conservan la geometría de las pantallas aún no migradas: son transitorias,
  el código nuevo no las usa y se retiran al completar la migración.
- **Fuente.** Una sola familia, Geist Sans variable, servida desde el propio origen con el paquete
  `geist` (`next/font/local`, OFL-1.1), sin red en el build ni en ejecución.
- **Regla de extensión.** Si la plantilla no trae un componente que EmiteYa necesita, se construye
  componiendo los primitivos existentes, con los mismos tokens, tamaños, radios, foco y convenciones
  responsive y de accesibilidad, con pruebas propias. Se reutiliza en cada lugar con la misma
  necesidad.
- **Duplicación.** Un solo componente por patrón: un `Button`, un sistema de menú y tooltip, un
  esqueleto. Las implementaciones anteriores que siguen en uso pasan a ser fachadas sobre el
  primitivo derivado. Las reglas de lint se aplican de forma escalonada: primero al código nuevo del
  shell y de los primitivos, y se amplían a medida que migran las pantallas.
- **Adaptación a la CSP.** La seguridad manda sobre la copia literal, y la política del ADR 0025 no
  cambia:
  - ningún atributo `style` renderizado en el servidor (las variables de los primitivos van a
    `globals.css`);
  - sin script de tema propio de la plantilla (sigue `next-themes` con el nonce);
  - sin recursos de otros orígenes;
  - sin analítica.
- **Lo que no se adopta:**
  - React Compiler;
  - el arranque de tema y los preajustes de tema, fuente y diseño;
  - las preferencias en zustand;
  - TanStack Table 9, que se decide en su propio cambio;
  - `@base-ui/react`;
  - las dependencias de demostración (Recharts, FullCalendar, dnd-kit, vaul, embla, simple-icons).

## Consequences

- **A favor:**
  - Cada componente futuro hereda una sola base visual y una sola escala.
  - El código de la plantilla se copia sin convertir proporciones.
  - La procedencia y la licencia de cada archivo derivado quedan trazadas.
- **Costes:**
  - Conviven de forma temporal los alias de tokens, las fachadas de compatibilidad y las variantes
    `legacy-*`. Están anotados en `../../quality/technical-debt.md` y se retiran por pantalla.
  - Las pantallas heredadas cambian de aspecto por los tokens, los radios y la fuente, sin cambiar
    su geometría ni su contenido.
- **Seguimiento:**
  - TanStack Table 9 y la tabla compartida premium, en su propio cambio;
  - la migración de cada módulo, con su propia propuesta.
