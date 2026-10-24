# Proposal

## Why

En el Archivo de comprobantes, la búsqueda («Número o receptor») encuentra por número y por el nombre
del receptor, y la identificación del receptor tiene su propio campo entre los filtros. El
propietario pidió (2026-10-24) buscar las dos cosas en el mismo campo, quitar el campo aparte, llevar
las fechas a la cabecera junto a la búsqueda y que los desplegables ocupen toda su fila.

## What Changes

- La búsqueda de la bandeja también encuentra un comprobante por la identificación de su receptor,
  incluida la de cualquier destinatario de una guía de remisión. El filtro `identification` de la
  API no cambia.
- Interfaz del Archivo de comprobantes:
  - la búsqueda se rotula «Número, receptor o identificación» y se quita el campo «Identificación
    del receptor»;
  - «Desde» y «Hasta» van en la cabecera, a la izquierda de la búsqueda y con su mismo tamaño;
  - los desplegables de la fila de filtros se reparten todo el ancho entre los que se ven.

## Capabilities

### Modified Capabilities

- `document-archive`: «Filtros de la bandeja», que gana la búsqueda por identificación. Parte del
  texto que deja `add-email-delivery`, con el filtro del correo, y se archiva después de ese cambio.

## Impact

- Backend: la búsqueda de `prisma-archive-reads.ts` y su prueba de integración.
- Frontend: `documents-screen.tsx`, `DatePickerField` (variante compacta), `DataTableCard` (la
  cabecera baja la búsqueda a otra fila cuando no cabe) y `DataTableSelectFilter` (ocupar su parte
  de la fila).
- Documentación: `docs/architecture/data-tables.md` y `fiscal-emission.md`.
