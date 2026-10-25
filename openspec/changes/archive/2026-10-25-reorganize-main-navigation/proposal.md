# Proposal

## Why

El propietario pidió (2026-10-24) una barra lateral más corta y directa: los comprobantes juntos,
los maestros y el inventario juntos, y Reportes y Configuración como destinos sueltos, con dos
destinos renombrados para que se entiendan sin conocer el sistema.

## What Changes

- La navegación pasa a: Inicio; Comprobantes (Todos los comprobantes, Facturas, Notas de crédito,
  Notas de débito, Retenciones, Liquidaciones de compra, Guías de remisión); Administración
  (Clientes y proveedores, Productos, Inventario); Reportes; y Configuración, en ese orden.
- Inicio, Reportes y Configuración son destinos sueltos, sin etiqueta de grupo; Configuración deja
  de ir fija al pie y sigue a Reportes. Una línea separa los bloques.
- «Archivo de comprobantes» se llama «Todos los comprobantes» y «Terceros», «Clientes y
  proveedores», en toda la aplicación: barra, migas, paleta y título de su pantalla. Las direcciones
  no cambian, y un tercero sigue pudiendo ser transportista.

## Capabilities

### Modified Capabilities

- `web-application-shell`: «Navegación según permisos» (los grupos, su orden, los destinos sueltos
  y los nombres nuevos).

## Impact

- Frontend: el modelo de rutas (`lib/navigation/routes.ts`), la barra lateral, los títulos de
  `/comprobantes` y `/terceros`, sus metadatos y las pruebas y la revisión visual que los nombran.
- Documentación: `docs/architecture/navigation-responsive.md` y las demás que nombran esos destinos.
- Sin cambios en la API ni en los permisos.
