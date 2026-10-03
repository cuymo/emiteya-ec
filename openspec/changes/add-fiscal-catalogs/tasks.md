# Tasks

## 1. Política decimal, contratos y permisos

- [ ] 1.1 Añadir `packages/contracts/src/decimal.ts` con las especificaciones `tarifa`, `importe`, `precioUnitario` y `cantidad` y su tipo XSD de origen, y `decimalString(spec)` (design D10); añadir `decimal.js` 10.6.0 en versión exacta al backend e implementar `platform/decimal` con `FiscalDecimal(spec)`, la forma canónica y la conversión desde y hacia el `Decimal` de Prisma por texto; verificar con pruebas que cada especificación coincide con su `simpleType` de `docs/product/sri-xsd/factura_V1.1.0.xsd`, que se rechazan números JSON, signo, exponente, coma, separadores, ceros a la izquierda, espacios y escala de más sin redondear, que la forma canónica es la más corta y exacta, que nada pasa por `number`, y que `check:versions` pasa
- [ ] 1.2 Añadir `packages/contracts/src/fiscal-catalogs.ts` (vistas de catálogos, entradas con sus versiones y la versión aplicable, política, registro y matriz; cuerpo estricto de la habilitación) y sus rutas en el registro de OpenAPI (design D11); verificar con pruebas de contrato que rechazan `companyId` y campos desconocidos en el cuerpo, que los porcentajes e importes son `decimalString` y que ninguna vista expone datos de otra empresa
- [ ] 1.3 Añadir `fiscalCatalogs.read` (`ADMIN` y `OPERATOR`) y `fiscalCatalogs.manage` (`ADMIN`) al mapa central y al frontend, y las acciones `fiscal_catalog.entry_enabled` y `fiscal_catalog.entry_disabled` a la auditoría (design D12 y D13); verificar con las pruebas del mapa de acceso y añadir la fila de habilitación a `docs/security/access-control.md`

## 2. Esquema de datos

- [ ] 2.1 Añadir a Prisma y a una migración las siete tablas de design D14 con las columnas tipadas y los `CHECK` de design D8 (porcentaje solo en `PERCENTAGE`, tipo de impuesto coherente, `entryKey` con su patrón y sin único sobre el código, catálogos habilitables) y los triggers de inmutabilidad, transiciones permitidas y no superposición (design D4); verificar con `migrations.test.ts` y pruebas de integración que rechazan cada violación (borrado, cambio de descripción o valor publicado, superposición, porcentaje en una tarifa no porcentual, habilitación de un catálogo no habilitable, fila de habilitación de una entrada inexistente) y aceptan cerrar una vigencia y retirar una entrada
- [ ] 2.2 Documentar las tablas y sus restricciones en `docs/architecture/database.md`, y en `docs/product/domain-model.md` las entradas versionadas, la identidad por `entryKey`, la política de consumidor final con su identidad canónica y que tipos de comprobante, ambiente y tipo de emisión son constantes del protocolo (CTX §56); verificar que nombran cada restricción de la migración

## 3. Datasets, resolución de vigencia y carga

- [ ] 3.1 Transcribir de la ficha técnica v2.34 (SHA-256 `7333aebf…13c9`) los datasets de design D2 con el formato de design D3: tipos de identificación con sus reglas y el `07` reservado (design D7), impuestos, tarifas de IVA con su `rate_kind`, las 75 filas de ICE con los `entryKey` explícitos de design D6 y sin tarifas, IRBPNR `5001` sin tarifa, formas de pago con sus fechas y la política de consumidor final con su identidad; y los datasets del registro de esquemas y de la matriz (ADR 0014); crear `docs/product/sri-catalogs/README.md`; verificar con pruebas el esquema de cada archivo, el manifiesto contra los archivos, los valores críticos fijados, los duplicados de ICE (solo 3041 y 3541, tres filas cada uno con denominaciones distintas y `entryKey` únicos), el patrón `codigoPorcentaje` de cada código, los patrones de identificación con ejemplos y el registro contra los XSD y sus hashes; y revisar la transcripción fila a fila contra la ficha
- [ ] 3.2 Implementar `resolveCatalogEntry` como función pura de dominio y como puerto de aplicación con fecha explícita (design D5), y la regla de arquitectura que impide leer las tablas de entradas fuera de `catalogs`; verificar con pruebas unitarias de los bordes (último día, día siguiente, antes del inicio, sin fin) y de la reproducción tras añadir una versión (mismo identificador y mismos valores), y con la prueba de arquitectura
- [ ] 3.3 Implementar el cargador al arrancar con advisory lock y transacción (design D3) y montarlo en `main.ts` después del aprovisionamiento; verificar con pruebas de integración que la carga es idempotente, que una alteración de lo publicado o una superposición aborta el arranque sin modificar nada y nombra la entrada, que aplica el cierre de vigencias y la retirada, que dos cargas simultáneas dejan un solo resultado y que no genera auditoría

## 4. API de catálogos fiscales

- [ ] 4.1 Implementar las lecturas y la habilitación como estado deseado con fila bloqueada y auditoría solo de la transición real (design D9, D11 y D13), y montar las rutas en `main.ts`; verificar con pruebas HTTP con dos empresas: consulta de ambos roles con la versión aplicable en `at`, `at` en un borde de vigencia, valores por defecto de la habilitación, operador `403` al habilitar, catálogo no habilitable `400`, entrada inexistente `404`, habilitación repetida sin evento, cambios simultáneos con una sola transición auditada, la empresa B sin efecto ni indicio de la habilitación de A, `companyId` rechazado y `404` en cualquier intento de crear o modificar datos oficiales; regenerar OpenAPI con `openapi:check` en verde

## 5. Contrato con `facturacion-electronica-ec` y obligaciones

- [ ] 5.1 Añadir en `sri-engine` el adaptador de prueba que expone los catálogos de la librería y la prueba que compara los valores coincidentes con nuestros datasets, con la lista explícita de divergencias conocidas (design D16); verificar que pasa, que falla con una divergencia nueva y que `catalogs` no importa la librería (prueba de lint)
- [ ] 5.2 Registrar las obligaciones de design D15: las de `add-invoice-emission` en `docs/architecture/fiscal-emission.md`, y las de `add-parties-and-products` en la fila 5b de `docs/product/capabilities.md`; corregir en `ARCHITECTURE.md` que el registro de esquemas es dato de `catalogs` y lo usa `fiscal/xml`, y añadir `decimal.js` a `docs/architecture/stack.md`; verificar que cada obligación nombra su origen

## 6. Interfaz: Catálogos fiscales

- [ ] 6.1 Añadir la primitiva `Switch`, el formateador de cadenas decimales y el destino `Catálogos fiscales` en `Configuración`; construir la pantalla según su brief de design D17 (IVA y formas de pago con `Switch`, ICE con filtro local y variante visible, IRBPNR, fuente y versión por catálogo, y secciones de solo lectura de tipos, consumidor final, matriz y esquemas); verificar con pruebas de componentes de carga, error con reintento, sin permiso, operador en solo lectura, habilitación con toast y bloqueo mientras guarda, filtro de ICE, formateo sin `number` y el `Switch` por teclado
- [ ] 6.2 Recorrer la pantalla contra el backend real en carga, error, sin permiso y éxito; en móvil a 375 y 320 px con objetivos de 44 px; con teclado; en temas claro y oscuro; con barrido a 640, 768, 1024 y 1440 px; y con `docs/quality/frontend-checklist.md`; verificar que la revisión queda registrada en `ui-review.md` del cambio

## 7. Verificación integral

- [ ] 7.1 Prueba end-to-end por HTTP contra `main.ts` (design D18):
  1. El arranque carga los datasets.
  2. El operador consulta las tarifas con su fuente.
  3. El administrador deshabilita una tarifa y habilita un ICE.
  4. El operador no puede habilitar.
  5. La auditoría tiene las dos transiciones y ninguna por la carga.
  6. Un segundo arranque no cambia nada.

  Verificar que la prueba pasa.
- [ ] 7.2 Ejecutar `corepack pnpm verify`; verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo y build pasan
