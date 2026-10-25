# Proposal

## Why

El propietario pidió (2026-10-25) una página 404 propia: el logo en el centro, el título «Oops…»,
un mensaje claro y un enlace para volver a Inicio, dentro del shell, con la barra lateral, como
cualquier otra pantalla. Hoy la dirección inexistente se muestra fuera del shell, con una cabecera
mínima.

## What Changes

- Con sesión, una dirección inexistente muestra el shell completo (barra lateral, barra superior y
  avisos), con el contenido de la 404 en el centro.
- Sin sesión, la misma 404 sale sola, con el logo, sin pedir datos de la empresa ni llevar al
  inicio de sesión.
- Contenido: el logo de EmiteYa centrado; debajo, «Oops…», el mensaje «No encontramos la página
  que buscas» con la explicación, y el botón «Volver a Inicio».
- Sigue sin haber una ruta comodín: la página 404 raíz de Next (`app/not-found.tsx`) monta el shell
  cuando hay sesión, así que la API, reescrita como `fallback`, no cambia.

## Capabilities

### Modified Capabilities

- `web-application-shell`: «Dirección inexistente».

## Impact

- Frontend: `app/not-found.tsx`, un componente de la 404 y sus pruebas; la revisión visual.
- Documentación: `docs/architecture/navigation-responsive.md`.
