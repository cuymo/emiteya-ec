# Proposal

## Why

Todos los comprobantes se pueden guardar como borrador, pero cada tipo los muestra en un lugar
distinto:
- las facturas tienen un destino propio en la barra lateral, «Borradores de facturas»;
- los demás tipos muestran un panel «Borradores en curso» encima de su tabla, con los diez más
  recientes y sin paginación ni búsqueda.

El propietario (2026-10-16) quiere una sola regla: cada lista muestra sus borradores en la misma
tabla, con un estado «Borrador» que se puede filtrar, y la barra lateral deja de tener un destino
para ellos.

## What Changes

- **Una lista por tipo con los borradores primero.** Facturas, Notas de crédito, Notas de débito,
  Liquidaciones de compra, Retenciones y Guías de remisión muestran, con el filtro «Todos», primero
  sus borradores (el último editado arriba) y después sus comprobantes emitidos, en la misma tabla,
  la misma paginación y el mismo total.
- **Estado «Borrador» filtrable.** El filtro de estado de cada lista ofrece «Borradores», que
  muestra solo esos. Un estado de comprobante emitido, «Requiere atención» o un filtro que los
  borradores no tienen los excluye.
- **La búsqueda también encuentra borradores**: por el tercero o por el comprobante modificado que
  muestran en la lista.
- **Desde la fila**, un borrador abre su editor y se elimina con confirmación.
- **Navegación.** Se retira «Borradores de facturas» de la barra lateral y de la paleta. Su
  dirección, `/borradores`, lleva a `/facturas?estado=borradores`. Las direcciones de los editores
  no cambian.
- **API.** Cada tipo gana `GET /<prefijo>/entries`, que devuelve la lista unificada. Las listas
  actuales de comprobantes y de borradores se conservan, sin cambios.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `invoices`: la lista de facturas muestra los borradores y los filtra.
- `credit-notes`: la lista de notas de crédito muestra los borradores y los filtra.
- `debit-notes`: la lista de notas de débito muestra los borradores y los filtra.
- `purchase-settlements`: la lista de liquidaciones muestra los borradores y los filtra.
- `withholding-receipts`: la lista de retenciones muestra los borradores y los filtra.
- `shipping-guides`: la lista de guías muestra los borradores y los filtra.
- `web-application-shell`: la navegación ya no tiene «Borradores de facturas».

## Impact

- **Contratos**: `packages/contracts`, con el esquema común de la lista unificada, el estado de
  filtro `DRAFT`, seis consultas, seis vistas y seis rutas nuevas en el registro y en el OpenAPI
  generado.
- **Backend**:
  - un auxiliar puro de paginación en `platform`;
  - `allows` en el autorizador, una comprobación de permiso sin evento de seguridad;
  - un caso de uso `entries` y una ruta por módulo, sin tablas ni migraciones nuevas.
- **Frontend**:
  - las seis listas y sus pruebas;
  - la navegación, la paleta, el indicador de borradores del tablero y la redirección de
    `/borradores`;
  - se retira la pantalla `Borradores de facturas`.
- **Sin cambios**: el SRI, la emisión, la numeración y el Archivo de comprobantes, que nunca
  muestra borradores.
