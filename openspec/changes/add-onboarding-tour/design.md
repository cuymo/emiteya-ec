# Design

## Context

El shell (`components/shell/app-shell.tsx`) envuelve todas las pantallas autenticadas y conoce la
sesión (`useSession`: nombre, correo y rol, sin identificador). El modelo de rutas
(`lib/navigation/routes.ts`) y `lib/permissions.ts` deciden qué ve cada rol. La CSP prohíbe los
atributos `style` en el HTML del servidor; los estilos escritos con el CSSOM sí se aplican.

## Decisions

### D1. driver.js, sin un recorrido propio

driver.js 1.10.2 (MIT, sin dependencias, unos 20 kB) resalta un elemento con una capa recortada y
abre una ventana con `role="dialog"`, título y descripción enlazados, teclado (flechas y Escape) y
desplazamiento al elemento. Escribe las posiciones con `element.style`, que la CSP permite. Sus
textos entran con `innerHTML`: el recorrido solo usa textos fijos del código, nunca datos del
usuario ni de la empresa. ADR 0030 registra la decisión.

### D2. Tramos por pantalla

driver.js recorre el DOM de una sola pantalla. El recorrido es una lista de tramos
(`features/onboarding/tour-steps.ts`), cada uno con su dirección, el permiso que lo habilita y sus
pasos (un selector `data-tour`, un título, una descripción y el lado de la ventana):

| Tramo | Dirección | Permiso | Pasos |
| --- | --- | --- | --- |
| Inicio | `/` | `invoices.read` | Bienvenida, indicadores, requisitos pendientes, estado de facturación electrónica, Configuración en la barra |
| Configuración | `/configuracion/empresa` | `taxpayer.configure` | Pestañas, Empresa, Establecimientos, Firma electrónica, Correos, Ambiente |
| Primera factura | `/facturas`, luego `/borradores/nuevo` | `invoices.draft` | «Nueva factura»; comprador, productos y «Emitir factura» |

- Al pasar de tramo, el recorrido navega con el router, espera hasta 8 s a que aparezca el primer
  elemento del tramo y abre driver.js con los pasos cuyo elemento está a la vista. «Anterior» en el
  primer paso de un tramo vuelve al último del tramo anterior.
- Un paso sin selector (la bienvenida y el cierre) es una ventana centrada.
- Un paso cuyo elemento no está (los requisitos con la empresa lista, la barra lateral en un
  teléfono, «Emitir factura» para quien no emite) se omite.
- Con `prefers-reduced-motion`, sin animación.
- El progreso dice el tramo y el paso: «Inicio · 2 de 5».
- Abrir el editor no crea un borrador: el borrador nace al guardar.

### D3. Primera vez, en el navegador

Decisión del propietario (2026-10-24): se recuerda en `localStorage`, con la clave
`emiteya.recorrido.v1:{correo}` en minúsculas. Se marca al terminar o al cerrar (botón, Escape o
clic fuera), nunca al empezar, y un fallo del almacenamiento (modo privado) solo hace que se vuelva
a ofrecer.

- **Arranque solo:** el shell lo abre cuando la ruta es Inicio, la clave falta y el tablero ya
  mostró sus indicadores o sus requisitos. Un enlace directo a otra pantalla no lo abre: espera a
  que el usuario llegue a Inicio.
- **Repetir:** «Ver recorrido» en el menú de la cuenta lo abre desde el principio, en cualquier
  pantalla.

### D4. Apariencia

`popoverClass: "emiteya-tour"` y reglas en `globals.css` con los tokens: superficie `popover`,
borde, radio, sombra, «Siguiente» y «Terminar» como el botón primario y «Anterior» como el
secundario. Textos en español: «Siguiente», «Anterior», «Terminar» y «Cerrar el recorrido».

### D5. Arneses

El arnés visual y el script de la política de seguridad abren Inicio en un navegador nuevo: marcan
la clave de sus usuarios antes de cargar la página, para que el recorrido no tape sus capturas ni
sus clics. Las pruebas del recorrido la dejan vacía.

## Risks

- Un elemento renombrado deja su paso sin ancla: las pruebas del recorrido comprueban que cada
  `data-tour` existe en su pantalla.
