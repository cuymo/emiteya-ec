# Proposal

## Why

Para emitir, cada comprobante necesita un receptor identificado, unos ítems con precio e
impuestos y unos códigos fiscales oficiales y vigentes (CTX §9, §12, §18). Hoy la empresa tiene
configuración, numeración y firma, pero no tiene dónde registrar a sus clientes y proveedores ni
sus productos y servicios, y la aplicación no conoce ningún código fiscal: el administrador y el
operador no pueden preparar nada de lo que una factura reutiliza.

Este cambio crea los catálogos del negocio: terceros, productos y servicios, y los catálogos
fiscales oficiales como datos normativos versionados del sistema (ERS RF-234, RF-301..305,
RF-320..323, SRI-REQ-12; ADR 0020 y la matriz del ADR 0014, que resolvieron Q-25 y Q-38). Es la
última dependencia de la emisión de facturas además del spike de XSD.

## What Changes

- **Catálogos fiscales oficiales** como datos del sistema, distribuidos con cada release desde datasets versionados con su fuente (ficha técnica v2.34): tipos de identificación, impuestos, tarifas de IVA, códigos de ICE, código de IRBPNR y formas de pago. Cada entrada conserva su descripción oficial, su vigencia, su fuente y su estado normativo; una actualización crea versiones y nunca sobrescribe lo histórico. No hay sincronización con el SRI en tiempo de ejecución.
- **Habilitación por empresa:** el administrador habilita o deshabilita para su empresa las tarifas de IVA, ICE e IRBPNR y las formas de pago, con auditoría. Nadie crea ni modifica códigos, descripciones, tarifas ni vigencias oficiales.
- **Política de consumidor final** versionada (monto máximo con su fuente), solo como dato: su aplicación es de la emisión.
- **Registro de esquemas XSD** (tipo, versión, archivo, hash, fuente) y **matriz de casos especiales** con las categorías del ADR 0014, como datos versionados consultables.
- **Terceros:** catálogo único por empresa, reutilizable en cualquier rol, con identificación única por tipo y número validada con el XSD y las reglas oficiales, sin algoritmos locales de rechazo (ERS RF-322). Búsqueda por identificación o nombre; desactivación en lugar de borrado.
- **Consumidor final** como registro especial controlado por el sistema en cada empresa: identidad canónica, no duplicable, no eliminable ni editable como un tercero normal y reconocible por el dominio, no por su texto.
- **Productos y servicios:** código principal opcional y único por empresa, código auxiliar, nombre, tipo bien o servicio, precio unitario decimal exacto, impuestos que referencian entradas del catálogo fiscal (IVA obligatorio; ICE e IRBPNR opcionales, con su propia semántica) y control de stock para bienes. Búsqueda por código, nombre o código auxiliar; desactivación en lugar de borrado.
- **Política decimal** del producto: representación exacta en dominio, base de datos y JSON, sin `number` de JavaScript para dinero ni tarifas, y sin redondeo al recibir datos.
- **Auditoría** de terceros, productos y habilitación de catálogos; no de lecturas ni de la carga de datasets.
- **Permisos** nuevos en el mapa central de acceso (Q-22): administradores y operadores consultan, crean y editan; solo el administrador desactiva y habilita catálogos.
- **Pantallas** `Terceros`, `Productos` y `Catálogos fiscales`.

Fuera de alcance:

- El motor de cálculo fiscal del comprobante: bases, tarifas aplicadas, valores de ICE e IRBPNR, redondeo de líneas y totales (Q-14) y el límite de consumidor final en la factura. Es de `add-invoice-emission`.
- Aplicar la matriz de casos especiales al emitir, insertar el Anexo 26 en el XML (Q-37) y validar XML contra los XSD (spike S-2).
- Catálogos que solo consumen comprobantes posteriores: impuestos a retener, códigos de retención, documentos sustento, países y demás tablas de la ficha. Llegan con el cambio que los usa.
- Tipos de comprobante, ambientes y tipo de emisión como catálogo: son constantes estructurales del protocolo (CTX §56) y ya existen en los contratos.
- Stock, movimientos y kárdex (`add-minimal-inventory`); este cambio solo guarda si un bien controla stock.
- Importación masiva de terceros o productos (ERS RF-305, P1), sincronización automática con el SRI y edición de catálogos oficiales por la empresa.
- Restricciones de consumidor final por tipo de comprobante (Q-10, Q-12): son de cada comprobante.

## Capabilities

### New Capabilities

- `fiscal-catalogs`: catálogos fiscales oficiales versionados con vigencia y fuente, su habilitación por empresa, la política de consumidor final, el registro de esquemas XSD y la matriz de casos especiales.
- `parties`: catálogo único de terceros de la empresa, su identificación, búsqueda, desactivación y el consumidor final del sistema.
- `products`: catálogo de productos y servicios con precio decimal exacto, impuestos referidos al catálogo fiscal, control de stock, búsqueda y desactivación.

### Modified Capabilities

- `audit-trail`: añade la auditoría de terceros, productos y habilitación de catálogos fiscales. Los requisitos existentes de atomicidad, ausencia de secretos, inmutabilidad y aislamiento se aplican también a estos eventos.

## Impact

- Backend:
  - módulo nuevo `catalogs` con terceros, productos, catálogos fiscales, datasets versionados y su carga al arrancar;
  - política decimal compartida para dinero y tarifas;
  - rutas bajo `/api/v1/` (ADR 0015) y un contrato común de búsqueda y paginación;
  - permisos nuevos en `identity` y acciones nuevas en `audit`.
- Base de datos: entradas de catálogo del sistema con sus versiones, habilitación por empresa, terceros, productos y sus impuestos, con restricciones de unicidad por empresa y aislamiento por empresa (ADR 0009).
- Frontend: pantallas `Terceros` y `Productos` en la navegación principal, y `Catálogos fiscales` en `Configuración`.
- Dependencias: `decimal.js` como biblioteca decimal del backend, con versión exacta.
- Documentación: modelo de dominio, base de datos, control de acceso, emisión (obligaciones para `add-invoice-emission`) y registro de los datasets con su fuente.
- `facturacion-electronica-ec` (ADR 0018) no es la fuente de ningún catálogo; a lo sumo, una prueba de contrato compara sus valores coincidentes.
