# Proposal

## Why

El propietario pidió (2026-10-24) indicadores más comerciales en Inicio y un panel que diga si la
facturación electrónica puede seguir funcionando: la firma, la conexión con el SRI y la entrega de
los comprobantes por correo. El panel actual, «Estado del sistema», mezcla el ambiente y el
inventario, que ya tienen su lugar en la barra superior y en Inventario.

## What Changes

- Los cuatro indicadores pasan a ser:
  - «Ventas autorizadas · {mes}», con la variación frente al mes anterior;
  - «Facturas autorizadas», como «15 / 18» y su porcentaje de las facturas del mes;
  - «Problemas de autorización», los devueltos o no autorizados de los últimos 30 días;
  - «Facturas en borrador», pendientes de emitir.
- Cada indicador lleva su icono en una caja, un enlace con flecha a su lista y un degradado azul
  suave de abajo hacia arriba.
- «Estado del sistema» se reemplaza por «Estado de facturación electrónica», con tres filas:
  - **Firma electrónica:** vigencia y días para vencer, con su estado («Activa», «Por vencer»,
    «Vencida», «Sin cargar» o «No utilizable»);
  - **Conexión con SRI:** la última comunicación guardada y si recibió respuesta («Disponible»,
    «Sin respuesta», «Sin datos» o «Apagado»). Se lee de los intentos guardados: el tablero nunca
    contacta al SRI;
  - **Entrega de comprobantes:** los correos sin enviar o en cola («Revisar», «Enviando», «Al día»,
    «Configurar» o «Apagado»).
- El resumen del servidor agrega la variación de las ventas, la última comunicación con el SRI, si
  la transmisión está encendida y los correos en cola.

## Capabilities

### Modified Capabilities

- `dashboard`: «Resumen de la actividad de la empresa» (los datos nuevos) y «Tablero de Inicio» (los
  indicadores y el panel nuevo).

## Impact

- Contrato `packages/contracts/src/dashboard.ts`: campos nuevos en la vista, compatibles hacia atrás
  para el aviso de la barra superior.
- Backend: el módulo `dashboard` con dos puertos nuevos, que exportan `fiscal` (la última
  comunicación con el SRI) y `email` (los correos en cola), compuestos en `main.ts`.
- Frontend: `features/dashboard/dashboard-screen.tsx`, sus pruebas y la revisión visual.
- Documentación: `docs/architecture/` que describe el tablero.
- Sin tráfico nuevo al SRI ni a ningún servidor de correo.
