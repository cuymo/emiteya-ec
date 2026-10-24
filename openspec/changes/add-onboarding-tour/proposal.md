# Proposal

## Why

El propietario pidió (2026-10-24) un recorrido guiado la primera vez que alguien entra al sistema,
con driver.js, que muestre solo lo que le interesa: el tablero de Inicio, la Configuración de la
empresa y cómo emitir la primera factura.

## What Changes

- Un recorrido de bienvenida en tres tramos, que se abre solo la primera vez que el usuario llega a
  Inicio en ese navegador:
  - **Inicio:** la bienvenida, los indicadores, lo que falta para emitir si la empresa todavía no
    puede, el estado de facturación electrónica y el acceso a Configuración;
  - **Configuración:** sus pestañas, con Empresa, Establecimientos, Firma electrónica, Correos y
    Ambiente;
  - **Primera factura:** «Nueva factura» en Facturas y, en el editor, el comprador, los productos y
    «Emitir factura».
- El recorrido cambia de pantalla solo y muestra únicamente los pasos que el rol puede usar y que
  están a la vista: un operador no recorre Configuración, y un paso cuyo elemento no aparece se
  omite.
- El recorrido nunca guarda, emite ni cambia datos: solo señala y explica.
- Se recuerda en el navegador, por usuario, cuando se termina o se cierra (decisión del
  propietario: sin cambios en el servidor). Se puede repetir desde «Ver recorrido» en el menú de la
  cuenta.
- driver.js 1.10.2 entra como dependencia de producción del frontend (ADR 0030).

## Capabilities

### Modified Capabilities

- `web-application-shell`: requisito nuevo «Recorrido de bienvenida».

## Impact

- Frontend: `features/onboarding/` (pasos, estado y ejecución), atributos `data-tour` en el tablero,
  la barra lateral, Configuración, Facturas y el editor de facturas; «Ver recorrido» en el menú de
  la cuenta; estilos del recorrido con los tokens.
- Pruebas: los arneses que abren Inicio (visual y de política de seguridad) marcan el recorrido como
  visto para no taparlo.
- Documentación: ADR 0030, `docs/architecture/navigation-responsive.md` y `frontend.md`.
- Sin cambios en el backend ni en la API.
