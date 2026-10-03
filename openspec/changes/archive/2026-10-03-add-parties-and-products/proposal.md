# Proposal

## Why

Para emitir, cada comprobante necesita un receptor identificado y unos ítems con precio e
impuestos (CTX §9, §12.4, §12.5). La empresa ya tiene configuración, numeración, firma y los
catálogos fiscales oficiales (`add-fiscal-catalogs`, 5a), pero el administrador y el operador
todavía no tienen dónde registrar a sus clientes, proveedores y transportistas, ni sus productos y
servicios. Tampoco existe el consumidor final como registro del sistema.

Este cambio (5b en `capabilities.md`) crea esos dos catálogos del negocio sobre `fiscal-catalogs`
como dependencia canónica (ERS RF-301..305, RF-320..323; obligaciones de design D15 de
`add-fiscal-catalogs`). Es la última dependencia de `add-invoice-emission`, además del spike de XSD.

## What Changes

- **Terceros:**
  - catálogo único por empresa, reutilizable en cualquier rol;
  - roles opcionales y múltiples (cliente, proveedor y transportista) que solo clasifican y filtran; un tercero puede existir sin ningún rol;
  - identificación validada con las reglas del catálogo de tipos de identificación, sin algoritmos locales de rechazo (ERS RF-322), y única por empresa, tipo y número;
  - corrección con control de versión, desactivación y reactivación en lugar de borrado, y búsqueda por identificación o nombre.
- **Consumidor final:**
  - es un tercero del sistema y existe exactamente uno por empresa, con la identidad que publica la política de consumidor final vigente;
  - se crea en la misma operación que la empresa, se repone antes de atender peticiones en las empresas que existían antes del cambio, y la base de datos impide confirmar una empresa sin él;
  - nadie lo edita, desactiva ni borra; el dominio lo reconoce por su marca de registro del sistema;
  - el monto máximo de USD 50 sigue siendo política fiscal y no se copia.
- **Productos y servicios:**
  - bien o servicio, código principal opcional y único por empresa, código auxiliar y nombre;
  - precio unitario sin impuestos, decimal exacto según la política decimal vigente;
  - impuestos referidos a entradas del catálogo fiscal: un IVA obligatorio, y como máximo un ICE y un IRBPNR, este solo en bienes. Nunca se copia una tarifa;
  - control de stock solo como dato de los bienes;
  - corrección con control de versión, desactivación y reactivación, y búsqueda por códigos o nombre.
- **Estado de la configuración tributaria** de cada producto: `READY`, `REVIEW_REQUIRED` o `INCOMPLETE`.
  - Es un estado derivado, nunca guardado; se evalúa en la fecha de hoy en Ecuador con las reglas de `fiscal-catalogs`.
  - Distingue que una entrada exista de que haya datos para calcular su impuesto.
  - Nunca modifica las referencias del producto.
- **Aviso en `Catálogos fiscales`:** cuántos productos activos usan cada entrada, cuántos necesitan revisión, y una confirmación antes de deshabilitar una entrada en uso.
- **Lecturas internas de `fiscal-catalogs`** sin sesión: la política de consumidor final vigente, la resolución de una entrada y su disponibilidad para una empresa en una fecha. Son los puertos que prometía design D1 de 5a. `catalogs` sigue sin depender de terceros ni productos.
- **Contrato común de búsqueda y paginación** para terceros y productos, con orden estable. La lista de usuarios no se modifica.
- **Permisos:** administradores y operadores consultan, crean y editan; solo el administrador desactiva y reactiva.
- **Auditoría:**
  - de terceros: altas, cambios de identificación, nombre o roles, desactivaciones y reactivaciones;
  - de productos: altas, cambios de precio o de impuestos, desactivaciones y reactivaciones.
- **Volumen de referencia de Q-26:** 10 000 terceros y 10 000 productos por empresa, con un benchmark reproducible y controlado; sin `pg_trgm` preventivo.
- **Pantallas:** `Terceros` y `Productos` en la navegación principal.

Fuera de alcance:

- **Cálculo tributario.** Subtotales, IVA, ICE, IRBPNR, totales y redondeo (Q-14) son de `add-invoice-emission`, igual que aplicar el límite de consumidor final y volver a validar los impuestos con la fecha del documento.
- **Tarifas.** Ninguna tarifa, porcentaje ni valor de ICE o IRBPNR, ni copiada de `facturacion-electronica-ec`.
- **Inventario.** Existencias, movimientos y kárdex (`add-minimal-inventory`); el control de stock no genera nada.
- **Importación y borrado.** Ni importación masiva de terceros o productos (ERS RF-305), ni borrado físico por la API.
- **Usuarios.** No se migran al contrato común de paginación.
- **Restricciones por comprobante.** Las del consumidor final por tipo de comprobante (Q-10, Q-12) son de cada comprobante.
- **Catálogos fiscales.** No cambia ningún dataset, entrada, vigencia, valor por defecto ni permiso de habilitación.

## Capabilities

### New Capabilities

- `parties`: catálogo único de terceros de la empresa, su identificación y unicidad, roles, corrección, desactivación, búsqueda y el consumidor final del sistema.
- `products`: catálogo de productos y servicios con precio unitario exacto sin impuestos, referencias a entradas del catálogo fiscal, estado derivado de su configuración tributaria, control de stock como dato, corrección, desactivación, búsqueda y aviso de productos afectados por la habilitación de entradas.

### Modified Capabilities

- `audit-trail`: añade la auditoría de terceros y de productos. Los requisitos existentes de atomicidad, ausencia de secretos, inmutabilidad y aislamiento se aplican también a estos eventos.

## Impact

- **Backend:**
  - módulos nuevos `parties` y `products`;
  - puertos internos nuevos en `catalogs`, sin dependencias hacia los módulos nuevos;
  - un iniciador de empresa en la unidad de trabajo del aprovisionamiento de `identity`;
  - la carga de catálogos pasa a ejecutarse antes del aprovisionamiento, más una reposición del consumidor final al arrancar;
  - permisos nuevos en `identity` y acciones nuevas en `audit`;
  - rutas bajo `/api/v1` (ADR 0015).
- **Base de datos:** tablas de terceros, productos e impuestos del producto, con unicidad por empresa, protección del consumidor final, un consumidor final obligatorio por empresa y referencias a la identidad de las entradas fiscales.
- **Contratos:** paginación común, terceros y productos en `packages/contracts`, y OpenAPI regenerado.
- **Frontend:**
  - pantallas `Terceros` y `Productos`;
  - el uso de cada entrada y la confirmación al deshabilitar en `Catálogos fiscales`.
- **Herramientas:** un benchmark de búsqueda que se ejecuta aparte de `verify`.
- **Documentación:**
  - `ARCHITECTURE.md`, con la propiedad corregida de `catalogs`, `parties` y `products`;
  - base de datos, modelo de dominio, glosario y control de acceso;
  - obligaciones para la emisión;
  - Q-26 y el registro del benchmark.
- **Dependencias:** ninguna nueva.
