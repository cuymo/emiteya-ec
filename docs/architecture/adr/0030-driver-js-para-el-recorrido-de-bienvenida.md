# ADR 0030: driver.js para el recorrido de bienvenida

## Status

Accepted el 2026-10-24, con la tarea 1.1 de `add-onboarding-tour` (design D1), a pedido del
propietario.

## Context

- **Requisito.** La primera vez que un usuario llega a Inicio, el sistema lo guía por el tablero, la
  Configuración de la empresa y la emisión de la primera factura (spec `web-application-shell`,
  «Recorrido de bienvenida»). El propietario pidió hacerlo con driver.js.
- **Lo que pide un recorrido.** Hace falta:
  - resaltar un elemento con una capa que oscurece el resto;
  - colocar la ventana junto al elemento y seguirlo al desplazar o cambiar el tamaño;
  - desplazar la página hasta el elemento;
  - manejar el teclado (flechas y Escape) y el foco;
  - mostrar el progreso y los botones.

  Escribirlo a mano sería código de posicionamiento y accesibilidad sin relación con la facturación.
- **Límites del frontend.** La CSP prohíbe los atributos `style` en el HTML del servidor
  (ADR 0025). Los estilos escritos con el CSSOM sí se aplican.

## Decision

- **`driver.js` 1.10.2 como dependencia de producción del frontend**, en versión exacta.
  - MIT, sin dependencias, con sus tipos incluidos y unos 20 kB.
  - Posiciona con `element.style`, que la CSP permite, y su ventana lleva `role="dialog"` con el
    título y la descripción enlazados.
  - Se usa solo en `frontend/src/features/onboarding/`. El resto de la aplicación ve
    `useOnboardingTour()` y los anclajes `data-tour`, nunca la API de driver.js.
- **Solo textos fijos.** driver.js escribe el título, la descripción y los botones con `innerHTML`.
  Los pasos solo llevan textos del código, nunca datos del usuario, de la empresa ni del servidor;
  una prueba comprueba que no llevan marcado.
- **Estilos propios.** La hoja de driver.js se importa en el recorrido, y `globals.css` la ajusta a
  los tokens con la clase `emiteya-tour`.

## Consequences

- Una dependencia más en el paquete del shell, que se carga con el recorrido.
- Un cambio de versión de driver.js se revisa con su hoja de estilos y con la prueba del recorrido.
