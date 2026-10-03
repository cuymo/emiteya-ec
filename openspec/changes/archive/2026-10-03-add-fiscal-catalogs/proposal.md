# Proposal

## Why

Todo comprobante usa códigos fiscales oficiales y vigentes: tipos de identificación, impuestos y
sus tarifas, formas de pago (CTX §9, §12, §18). Hoy la aplicación no conoce ninguno, y los cambios
que crearán terceros, productos y comprobantes necesitan una fuente única de esos códigos, con su
vigencia y su origen normativo, y una forma exacta de representar tarifas e importes.

Este cambio crea esa base compartida: los catálogos fiscales oficiales como datos normativos
versionados del sistema (ADR 0020, Q-25), la matriz de casos especiales (ADR 0014, Q-38), el
registro de esquemas XSD (ADR 0008) y la política decimal común del producto (ERS RF-007, RF-234,
SRI-REQ-12). Es la primera mitad del cambio 5, dividido antes de implementarse.
`add-parties-and-products` dependerá de él.

## What Changes

- **Política decimal común:** representación exacta de tarifas e importes en dominio, base de datos y JSON. Los decimales viajan como texto; no hay números JSON, exponentes ni redondeo al recibir. Las escalas salen de los tipos del XSD.
- **Catálogos fiscales oficiales**, distribuidos con cada release desde datasets versionados con su fuente (ficha técnica v2.34): tipos de identificación, impuestos, tarifas de IVA, códigos de ICE, código de IRBPNR y formas de pago.
  - Cada entrada conserva su descripción oficial, su vigencia, su fuente y su estado normativo.
  - Una actualización crea versiones y nunca sobrescribe lo histórico.
  - No hay sincronización con el SRI en tiempo de ejecución.
- **Vigencia** resuelta por fecha en una única operación, de modo que un comprobante futuro pueda reproducir qué versión aplicaba.
- **Lo sustentado por la fuente, y nada más.** ICE e IRBPNR guardan el código y su denominación, sin tarifas que la fuente no publique. Los códigos repetidos de la tabla de ICE tienen identidad propia por fila.
- **Habilitación por empresa:** el administrador habilita o deshabilita para su empresa las tarifas de IVA, ICE e IRBPNR y las formas de pago, con auditoría. Nadie crea ni modifica códigos, descripciones, tarifas ni vigencias oficiales.
- **Política de consumidor final** versionada: monto máximo y fuente, y la identidad canónica del consumidor final (tipo 07, identificación 9999999999999, CONSUMIDOR FINAL). Este cambio no crea ningún tercero.
- **Registro de esquemas XSD** y **matriz de casos especiales** con las categorías del ADR 0014, como datos versionados consultables.
- **Permisos de consulta y de habilitación**, y la pantalla `Catálogos fiscales` en `Configuración`.
- **Prueba de contrato** que compara los valores coincidentes de `facturacion-electronica-ec` con nuestros datasets, sin adoptarlos nunca.
- **Obligaciones** documentadas para `add-parties-and-products` y `add-invoice-emission`.

Fuera de alcance:

- **Terceros, productos y el registro del consumidor final por empresa:** son de `add-parties-and-products`, que también trae el contrato común de búsqueda y paginación y la prueba de volumen (Q-26).
- **Cálculo fiscal del comprobante:** tarifas aplicadas, valores de ICE e IRBPNR, redondeo de líneas y totales (Q-14). Tampoco se aplica aquí el límite de consumidor final ni la matriz de casos especiales. Todo eso es de `add-invoice-emission`.
- **Tarifas de ICE e IRBPNR con valores y política del IVA diferenciado:** la fuente usada no las publica como vigentes. Son obligaciones previas a la capacidad que las calcule.
- **Otras tablas de la ficha:** impuestos a retener, retenciones, documentos sustento, países y demás. Llegan con el cambio que las consume.
- **Tipos de comprobante, ambiente y tipo de emisión como catálogo:** son constantes estructurales del protocolo (CTX §56).
- **Validar XML contra los XSD y empaquetarlos en la imagen:** es del spike S-2 y de la emisión.

## Capabilities

### New Capabilities

- `fiscal-catalogs`: catálogos fiscales oficiales versionados con vigencia y fuente, su resolución por fecha y su habilitación por empresa, la política de consumidor final, el registro de esquemas XSD y la matriz de casos especiales.

### Modified Capabilities

- `audit-trail`: añade la auditoría de la habilitación de entradas del catálogo fiscal por empresa. Los requisitos existentes de atomicidad, ausencia de secretos, inmutabilidad y aislamiento se aplican también a estos eventos.

## Impact

- **Backend:**
  - módulo nuevo `catalogs` con los datasets, su carga controlada al arrancar, la resolución de vigencia y la habilitación;
  - política decimal en `platform/decimal`;
  - rutas de lectura y habilitación bajo `/api/v1/` (ADR 0015);
  - permisos nuevos en `identity` y acciones nuevas en `audit`.
- **Base de datos:** tablas de datasets, entradas versionadas, política de consumidor final, registro de esquemas, matriz y habilitación por empresa, con triggers de inmutabilidad.
- **Frontend:** pantalla `Catálogos fiscales` y la primitiva `Switch`.
- **Dependencias:** `decimal.js` en versión exacta en el backend.
- **Documentación:**
  - manifiesto de los datasets con su fuente (`docs/product/sri-catalogs/`);
  - modelo de dominio, base de datos y control de acceso;
  - pila (`stack.md`);
  - obligaciones en `fiscal-emission.md`.
- **Plan:** `add-parties-and-products` depende de este cambio y consumirá `fiscal-catalogs` como dependencia canónica, sin duplicar datasets ni reglas de vigencia.
