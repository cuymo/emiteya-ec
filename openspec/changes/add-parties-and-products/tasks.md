# Tasks

## 1. Contratos, permisos, puertos de `fiscal-catalogs` y fronteras

- [x] 1.1 Añadir el contrato común `packages/contracts/src/pagination.ts` (design D10) y los contratos `parties.ts` y `products.ts`: consultas no estrictas, cuerpos estrictos con `expectedVersion`, `unitPrice` como `decimalString(DECIMAL_SPECS.precioUnitario)`, `taxes` con su forma de tres posiciones (design D7), vistas con `systemRecord`, `taxConfiguration` y `meta`, y la vista de `tax-summary`. `users.ts` no cambia. Verificar con pruebas de contrato que se rechazan `companyId` y campos desconocidos en los cuerpos, un precio como número JSON o con exponente o coma, los casos límite de design D9 (`999999999999.999999` y `0.000001` aceptados; `1000000000000`, `0.0000001` y `1.1234560` rechazados con el mensaje de su límite), un impuesto dado por porcentaje o denominación y un arreglo de ICE, y que `pageSize` admite de 1 a 100 con 25 por defecto
- [x] 1.2 Añadir `parties.read`, `parties.manage`, `parties.changeStatus`, `products.read`, `products.manage` y `products.changeStatus` al mapa central y a su espejo en el frontend (`ADMIN`, todos; `OPERATOR`, lectura y gestión, sin cambio de estado; design D12), y las acciones `party.*` y `product.*` a la auditoría (design D13). Confirmar las filas de `docs/security/access-control.md`. Verificar con las pruebas del mapa de acceso
- [x] 1.3 Añadir a `catalogs` los puertos internos de design D2 (`consumerFinalPolicy`, `identificationRule`, `availability` y la función de dominio `calculationDataStatus`), sin HTTP ni sesión, reutilizando `resolveCatalogEntry`, `effectiveEnablement` e `isUsable`. Verificar con pruebas:
  - unitarias de `calculationDataStatus` para cada tipo de tarifa;
  - de integración de `availability`: valor por defecto, decisión de la empresa, entrada vencida, retirada y futura, y aislamiento entre dos empresas;
  - de la política en sus bordes de vigencia;
  - de que ninguna operación exige un `RequestContext`
- [x] 1.4 Añadir las pruebas de arquitectura de design D1:
  - frontera de tablas de `parties` y de `products`, conservando la de `catalogs`;
  - `catalogs` no importa `parties` ni `products`, y estos no se importan entre sí.

  Corregir en `ARCHITECTURE.md` la propiedad de `catalogs`, `parties` y `products`. Verificar que las pruebas pasan, y que fallan con un archivo de ejemplo que viola cada frontera
- [x] 1.5 Crear `docs/architecture/decimal-policy.md` con la política decimal vigente (design D9; D10 de `add-fiscal-catalogs`) y hacer que `database.md`, `fiscal-emission.md` y `stack.md` remitan a él. Verificar que el documento nombra el patrón universal, las cuatro especificaciones con su origen XSD, la regla de no redondear al recibir y la conversión por texto

## 2. Esquema de datos

- [x] 2.1 Añadir a Prisma y a una migración `party`, `product` y `product_tax` de design D15:
  - `CHECK` de longitudes, saltos de línea, tipo de identificación, estado, roles, coherencia del registro del sistema, precio no negativo y control de stock solo en bienes;
  - unicidades de design D14;
  - claves de búsqueda por prefijo con colación C, sus índices btree y los de orden (design D10);
  - claves foráneas a la empresa, al producto y a `fiscal_catalog_key`;
  - triggers: inmutabilidad del consumidor final, IVA obligatorio por producto (diferido) e IRBPNR solo en bienes (diferido). El consumidor final obligatorio por empresa llega en la tarea 3.1, en una segunda migración, junto con su iniciador.

  Hacer que `insertCompany` de las pruebas cree también el consumidor final. Verificar con `migrations.test.ts` (restricciones, índices y triggers) y con pruebas de integración que rechazan cada violación:
  - dos consumidores finales;
  - un tercero normal con `07`;
  - corregir, desactivar o borrar el consumidor final;
  - un producto sin IVA al confirmar, o con dos IVA;
  - IRBPNR en un servicio, o pasar a servicio un bien que conserva su IRBPNR; en cambio, quitar el IRBPNR y pasar a servicio en la misma transacción se acepta, en cualquier orden;
  - control de stock en un servicio;
  - código principal repetido, con los nulos sin choque;
  - referencia a una entrada inexistente.

  Verificar también que toda la suite del backend pasa con el helper cambiado
- [x] 2.2 Documentar las tablas, su propietario y sus restricciones en `docs/architecture/database.md`, incluidos los triggers sobre `organization` y las claves foráneas a `fiscal_catalog_key` como objetos de `parties` y `products`. Actualizar en `docs/product/domain-model.md` el tercero (roles opcionales, consumidor final por `systemRecord`) y el producto (referencias por `entryKey`, estado tributario derivado, `stockTracked` solo como dato), y en `docs/product/glossary.md` el estado de la configuración tributaria. Verificar que cada restricción de la migración está nombrada

## 3. Consumidor final

- [ ] 3.1 Implementar en `parties` la creación del consumidor final con la identidad de `consumerFinalPolicy(hoy en Ecuador)`, y el iniciador de empresa de design D5:
  - el puerto `CompanyInitializer` en la unidad de trabajo de `identity`;
  - `initializeCompany` llamado por el aprovisionamiento después de `createCompany`;
  - registro desde la raíz de composición, sin que `identity` importe `parties`.

  Añadir en una segunda migración el trigger de restricción diferido sobre `organization` que exige el consumidor final al confirmar (design D5 y D15). Cambiar el orden de `main.ts` (cargar catálogos → aprovisionar → `ensureConsumerFinalParties()` → escuchar), con fallo fatal si queda una empresa sin consumidor final. Verificar con pruebas de integración, cada una terminando con exactamente un consumidor final por empresa y su identidad intacta:
  - **A. Empresa nueva:** la empresa y su consumidor final quedan garantizados antes de confirmar, un fallo después de `createCompany` no deja ninguno de los dos, y confirmar una empresa sin consumidor final falla en la base de datos;
  - **B. Empresa existente sin consumidor final:** la reposición crea exactamente uno;
  - **C. Segundo arranque:** no crea duplicados ni modifica el existente;
  - dos aprovisionamientos simultáneos y dos reposiciones simultáneas;
  - el alta de un tercero normal con el tipo `07`, y corregir, desactivar y borrar el consumidor final, por la API y directamente en la base de datos;
  - sin política aplicable, el aprovisionamiento falla de forma explícita sin crear nada;
  - el arranque falla si una empresa sigue sin consumidor final;
  - las pruebas de aprovisionamiento de `user-access` siguen pasando
- [ ] 3.2 Documentar en `docs/architecture/deployment.md` el orden de arranque y la política de reversión (design, Migration Plan): después de esta migración, un downgrade binario no es compatible automáticamente; la estrategia normal es avanzar con una corrección, y volver atrás exige un runbook explícito o restaurar una copia compatible, nunca quitar una protección de integridad. Verificar que el documento nombra la invariante y no ofrece eliminar el trigger como paso de reversión

## 4. API de terceros

- [ ] 4.1 Implementar el módulo `parties` (design D3, D4, D10, D13 y D14):
  - dominio: normalización, roles canónicos y claves de búsqueda;
  - aplicación: alta, consulta, corrección con `expectedVersion`, estado deseado, búsqueda y paginación;
  - la identificación se valida con `identificationRule`, con el `07` reservado y sin dígito verificador;
  - la unicidad se traduce a `409 PARTY_IDENTIFICATION_TAKEN`, el consumidor final está protegido con `409 PARTY_SYSTEM_RECORD`, y la auditoría se escribe en la misma transacción.

  Añadir el router, montarlo en `main.ts` y en el harness de pruebas, registrar las rutas y regenerar OpenAPI. Verificar con pruebas unitarias y con pruebas HTTP con dos empresas que cubren cada escenario de la spec `parties` y los de terceros de `audit-trail`, incluidas:
  - las altas simultáneas con la misma identificación;
  - las correcciones simultáneas con la misma versión;
  - las desactivaciones simultáneas con un solo evento;
  - la búsqueda sin tildes;
  - el orden estable al recorrer las páginas;
  - el aislamiento entre empresas.

  Verificar también que `openapi:check` pasa

## 5. API de productos

- [ ] 5.1 Implementar el dominio de `products` (design D6 a D9): precio con `UnitPrice`, reglas de tipo, control de stock e IRBPNR, la forma de los impuestos y la función pura del estado tributario. Verificar con pruebas unitarias:
  - cada motivo (`NOT_IN_FORCE`, `WITHDRAWN`, `DISABLED` y `NO_CALCULATION_DATA`), con ICE, IRBPNR e IVA diferenciado en `INCOMPLETE`;
  - la precedencia `REVIEW_REQUIRED` > `INCOMPLETE` > `READY`;
  - las invariantes del tipo sobre el estado final: de bien a servicio con IRBPNR, de bien a servicio con control de stock, y el cambio simultáneo que deja un estado válido;
  - que el precio nunca pasa por `number`
- [ ] 5.2 Implementar la aplicación y el repositorio de `products`:
  - alta, consulta, corrección con `expectedVersion` y estado deseado;
  - validación con `availability` solo de las referencias nuevas o cambiadas;
  - `409 PRODUCT_MAIN_CODE_TAKEN` desde la restricción única;
  - auditoría solo de altas, estados, precio e impuestos;
  - búsqueda, filtros (incluido `taxStatus`, con los conjuntos de claves de design D8) y `GET /products/tax-summary`.

  Añadir el router, montarlo, registrar las rutas y regenerar OpenAPI. Verificar con pruebas HTTP con dos empresas que cubren cada escenario de la spec `products` y los de productos de `audit-trail`, entre ellos:
  - ICE no habilitado, rechazado y aceptado después de habilitarlo;
  - entrada deshabilitada después de asignarla: `REVIEW_REQUIRED` sin tocar la referencia, y vuelta a `READY` al habilitarla;
  - cierre de vigencia en una versión posterior del dataset, con una fecha inyectada;
  - ICE sin tarifa en `INCOMPLETE`;
  - corrección del precio en revisión;
  - de bien a servicio con IRBPNR y con control de stock, con rechazo estable, y la corrección simultánea que se acepta;
  - altas y correcciones simultáneas;
  - recuentos aislados por empresa;
  - `openapi:check` en verde
- [ ] 5.3 Registrar en `docs/architecture/fiscal-emission.md` las obligaciones para `add-invoice-emission`:
  - volver a resolver cada referencia con la fecha del documento, sin fiarse del estado mostrado;
  - un comprobante no puede continuar si necesita calcular un impuesto cuya referencia esté en `INCOMPLETE` en la fecha del documento;
  - reconocer el consumidor final por `systemRecord`;
  - aplicar el límite de la política en la emisión.

  Verificar que cada obligación nombra su origen en este cambio

## 6. Búsqueda y rendimiento (Q-26)

- [ ] 6.1 Añadir pruebas de planes de consulta con `EXPLAIN`, sobre datos sembrados y analizados, que comprueban que las búsquedas por prefijo de identificación, código principal y código auxiliar usan su índice con una condición de rango (colación C), y que el orden usa su índice (design D10). Verificar que pasan en CI
- [ ] 6.2 Implementar el benchmark dedicado `bench:search` de design D16:
  - esquema aislado y `main.ts`;
  - dataset determinista de 10 000 terceros y 10 000 productos en una empresa;
  - calentamiento, 300 mediciones por consulta, y P50, P95 y máximo;
  - registro del entorno;
  - JSON y tabla en `docs/quality/benchmarks/`.

  Ejecutarlo sobre PostgreSQL 17 sin carga ajena y registrar el resultado. Pasar Q-26 a parcial en `docs/product/open-questions.md` y actualizar `capabilities.md`. Verificar que el informe existe con su entorno y que el P95 de cada consulta es de 300 ms o menos. Si alguna lo supera: analizar sus planes de consulta, identificar la causa y detener el apply para proponer con `/opsx:update` el cambio de índices, de estrategia o `pg_trgm`. Nunca subir el umbral

## 7. Interfaz

- [ ] 7.1 Añadir el grupo de navegación "Operación" y la pantalla `Terceros` según su brief de design D17:
  - tabla con paginación de servidor y estado en la URL;
  - búsqueda, y filtros de estado y rol;
  - alta y corrección en `FormDialog`, con la regla del tipo y los roles en chips;
  - el `409` de identificación repetida ofrece abrir el existente;
  - consumidor final marcado "Del sistema" y sin acciones;
  - desactivar y reactivar solo para el administrador, con deshacer.

  Verificar con pruebas de componentes de carga, vacío, error, sin permiso, operador sin acciones de estado, éxito, conflicto de versión, `409` de identificación y teclado
- [ ] 7.2 Construir la pantalla `Productos` según su brief de design D17:
  - tabla con estado tributario y filtros con recuentos;
  - formulario en `FormDialog`: tipo con `SegmentedControl`; precio decimal enviado como texto; IVA e ICE en `Select` de entradas utilizables, con la variante visible; IRBPNR y control de stock solo en bienes;
  - motivos del estado tributario.

  Verificar con pruebas de componentes de carga, vacío, error, sin permiso, éxito, errores por campo (precio, impuesto no disponible, código en uso), formato del precio sin `number` y teclado
- [ ] 7.3 Añadir a `Catálogos fiscales`:
  - "Usada por N productos activos" en cada entrada en uso;
  - "N productos necesitan revisión", con enlace a `Productos` filtrado;
  - el `ConfirmDialog` antes de deshabilitar una entrada en uso.

  Todo compuesto desde `GET /products/tax-summary`. Verificar con pruebas de componentes que confirmar deshabilita, que cancelar no cambia nada, y que una entrada sin uso se deshabilita sin confirmación
- [ ] 7.4 Recorrer `Terceros`, `Productos` y `Catálogos fiscales` contra el backend real:
  - carga, vacío, error, sin permiso y éxito;
  - móvil a 375 y 320 px con objetivos de 44 px;
  - teclado, temas claro y oscuro, y barrido a 640, 768, 1024 y 1440 px;
  - `docs/quality/frontend-checklist.md`.

  Documentar el contrato de paginación en `docs/architecture/frontend.md`. Verificar que la revisión queda registrada en `ui-review.md` del cambio

## 8. Verificación integral

- [ ] 8.1 Prueba end-to-end por HTTP contra `main.ts` (design D18):
  1. El arranque crea el consumidor final.
  2. El operador registra un tercero y un producto con IVA.
  3. El administrador deshabilita esa tarifa y el producto pasa a `REVIEW_REQUIRED`.
  4. El operador no puede desactivar.
  5. La auditoría tiene exactamente los eventos esperados.
  6. Un segundo arranque no duplica el consumidor final.

  Verificar que la prueba pasa
- [ ] 8.2 Ejecutar `corepack pnpm verify`; verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo y build pasan
