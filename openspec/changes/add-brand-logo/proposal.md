# Proposal

## Why

EmiteYa ya tiene logo (`logo-emiteyaec.webp`, en la raíz del repositorio sin uso). La interfaz se
identifica solo con el nombre y un icono genérico de recibo, y el navegador muestra el icono por
defecto. Además, el propietario pidió quitar el botón «Nuevo» de la barra lateral (2026-10-24): la
cabecera de la barra lleva el logo, y crear un comprobante sigue a mano desde la lista de cada tipo y
desde la paleta de comandos, que ya ofrece las mismas acciones.

## What Changes

- El logo es la marca oficial de la web: en la cabecera de la barra lateral, junto al nombre EmiteYa,
  y en el inicio de sesión; también como favicon e icono de la aplicación.
- El archivo pasa a `frontend/public/brand/logo-emiteyaec.webp`. Los iconos se generan de él con las
  convenciones de archivos de Next.js en `frontend/src/app/` (`favicon.ico`, `icon.png` y
  `apple-icon.png`). La imagen del frontend copia `public/`.
- Se quita el botón «Nuevo» de la barra lateral (`QuickCreateMenu`). La creación rápida queda en la
  paleta de comandos, con las mismas acciones según el rol y sin crear nada por sí misma.

## Capabilities

### Modified Capabilities

- `web-application-shell`: «Nombre visible del producto» (el logo y el icono del navegador) y
  «Creación rápida» (se ofrece en la paleta de comandos, no en un botón de la barra lateral).

## Impact

- Frontend: `components/brand-logo.tsx`, la barra lateral, el inicio de sesión, los iconos de
  `src/app/` y `public/brand/`; se elimina `components/shell/quick-create-menu.tsx`.
- Despliegue: `deploy/frontend.Dockerfile` copia `frontend/public`.
- Pruebas y guiones que usaban el botón «Nuevo»: las del shell, la revisión visual y
  `scripts/check-web-security-policy.ts`.
- Documentación del shell en `docs/architecture/`.
