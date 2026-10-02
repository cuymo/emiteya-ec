# Tasks

## 1. Gate, contratos, permisos y dominio (sin base de datos)

- [x] 1.1 Confirmar que `add-taxpayer-setup` está archivado en `main` y que `corepack pnpm verify` pasa antes de empezar; verificar que `openspec list --specs` muestra `taxpayer-setup`, `audit-trail` y `user-access`
- [x] 1.2 Añadir `sequences.read` y `sequences.adjust` (solo `ADMIN`) al mapa central, a su espejo del frontend y a la tabla de permisos implementados de `docs/security/access-control.md`, retirando "Ajustar secuenciales" de la matriz propuesta (D10); verificar con las pruebas de cada celda y `access-policy-doc.test.ts`
- [x] 1.3 Crear en `packages/contracts` los tipos de comprobante, `formatSequential`, `documentNumber`, el esquema del ajuste (`nextNumber` y `expectedNextNumber` de 1 a 999999999, `reason` obligatorio al retroceder), los parámetros de ruta y la vista del contador con `nextNumber` nulo cuando está agotado (D6, D9, D12); verificar con pruebas: 1 y 999999999 con nueve dígitos, `001-002-000000001`, 0, 1000000000 y decimales rechazados también como valor esperado, el formato que rechaza 1000000000, retroceso sin motivo rechazado, avance sin motivo aceptado, motivo de más de 300 caracteres o con salto de línea rechazado, ambiente y tipo inválidos rechazados, y `companyId` rechazado
- [x] 1.4 Implementar en `fiscal/domain/` los seis códigos en su orden, los límites (1, 999999999 y el valor de agotado) y la clasificación de un ajuste (sin cambio, avance o retroceso, y si supera al último reservado); verificar con pruebas unitarias de cada caso, incluido un contador agotado que no admite ningún ajuste
- [x] 1.5 Actualizar `docs/product/domain-model.md` (atributos del contador con el último reservado, la reserva como registro y el significado de reservado); verificar que coincide con D2 y D4

## 2. Esquema y migración

- [x] 2.1 Añadir los modelos `FiscalSequence` y `FiscalSequenceReservation`, la restricción única `(company_id, establishment_id, id)` en `emission_point` y la migración `add_fiscal_numbering`, con sus `CHECK`, claves foráneas compuestas y, en SQL, los triggers de clave inmutable, sin borrado, `last_reserved` monótono y reservas de solo agregado (D2, D13); verificar que `prisma validate`, la generación y `prisma migrate deploy` pasan, y que la regeneración con el CLI de Better Auth deja el esquema igual
- [x] 2.2 Probar las invariantes en PostgreSQL con dos empresas; verificar con pruebas de integración que:
  - una reserva duplicada falla por la restricción única;
  - `next_number` igual o menor que `last_reserved` falla, y también fuera de rango;
  - cambiar la clave falla, borrar un contador falla, y bajar o anular `last_reserved` falla;
  - `UPDATE`, `DELETE` y `TRUNCATE` de reservas fallan;
  - las claves compuestas rechazan un punto de otra empresa o de otro establecimiento.
- [x] 2.3 Extender `migrations.test.ts` con las restricciones y triggers nuevos; verificar que pasa
- [x] 2.4 Documentar en `docs/architecture/database.md` las tablas, restricciones y triggers, y corregir el modelo objetivo de `fiscal_sequence` con el rango de D6; verificar que el documento enumera cada nombre de la migración

## 3. Reserva atómica

- [ ] 3.1 Implementar la unidad de trabajo de `fiscal` (con los valores por defecto de Prisma salvo que la medición de 3.5 justifique otros, D5) y los repositorios de contadores y reservas con `companyId` obligatorio; verificar con pruebas de integración con dos empresas que ninguna operación alcanza datos de la otra
- [ ] 3.2 Implementar `reserveSequentialIn` y `createSequentialReservation` (D4); verificar con pruebas:
  - primera reserva 1 y creación perezosa del contador;
  - tipos, puntos y ambientes independientes;
  - vuelta a un ambiente que continúa su secuencia;
  - punto o establecimiento inactivo rechazados sin consumir número, y continuación tras reactivar;
  - fila de reserva con su clave, y `last_reserved` igual al máximo de las reservas.
- [ ] 3.3 Probar qué significa reservado: verificar que una transacción revertida después de reservar no consume el número (la siguiente reserva lo recibe) y que una falla posterior a la confirmación deja un hueco sin reutilizar el número
- [ ] 3.4 Probar las carreras de creación y ajuste de D3 sin que llegue ningún error de restricción al dominio; verificar con pruebas:
  - B: primera reserva y primer ajuste sobre una clave sin contador, con orden determinista (una transacción retenida antes de confirmar) en ambos sentidos, más ejecuciones simultáneas repetidas sobre claves nuevas;
  - C: reserva y ajuste sobre un contador existente, con los mismos órdenes y repeticiones;
  - en ambas, un único contador por clave, ningún número duplicado, `next_number > last_reserved`, y solo los resultados de dominio previstos (`409 SEQUENCE_CHANGED` o el valor ajustado aplicado).
- [ ] 3.5 Probar la desactivación concurrente de D4: verificar que una reserva retenida antes de confirmar, mientras otra conexión desactiva el punto y confirma, se completa y conserva su número, que la siguiente reserva se rechaza sin consumir, y que una reserva que comienza después de la desactivación confirmada se rechaza sin tocar el contador
- [ ] 3.6 Probar el límite: verificar que tras fijar 999999999 la reserva lo recibe, la siguiente falla con `SEQUENCE_EXHAUSTED` sin reiniciar el contador ni exponer el valor centinela, y los demás contadores siguen reservando
- [ ] 3.7 Prueba de ERS AC-04 (D5): 120 reservas simultáneas repartidas entre dos clientes de Prisma independientes, sobre un contador que aún no existe (carrera A) y sobre uno existente, más una variante con fallos inyectados después de la confirmación, con la configuración de transacción por defecto; verificar un único contador, números distintos y consecutivos del 1 al 120, `last_reserved = 120`, `next_number = 121` y 120 reservas, y anotar en `design.md` la duración total, la espera máxima y la configuración que la prueba demuestra suficiente
- [ ] 3.8 Anotar en `docs/architecture/fiscal-emission.md` cómo invocará `add-invoice-emission` la reserva (dentro de la transacción del paso 2, con el ambiente del snapshot y la configuración de transacción de D5), qué significa reservado, y la obligación de no tratar el número como reservado fuera de la transacción hasta su commit (D4); verificar que el documento lo describe

## 4. Consulta, ajuste y auditoría (API)

- [ ] 4.1 Implementar la consulta de D12 (todos los puntos de la empresa por seis tipos, con los contadores inexistentes en su valor inicial y el estado del punto), registrarla en `routes.ts` y regenerar el OpenAPI; verificar con pruebas HTTP: empresa sin reservas, valores tras reservar, ambientes separados, punto no disponible con su estado, contador agotado con `exhausted: true`, `nextNumber: null` y `lastReserved: 999999999`, ambiente inválido `400`, operador `403` con evento de seguridad, y sin datos de otra empresa
- [ ] 4.2 Implementar el ajuste de D9 con la acción `fiscal_sequence.adjusted` en la misma transacción (D11), registrarlo y regenerar el OpenAPI; verificar con pruebas HTTP:
  - avance con evento y números intermedios sin usar;
  - valor igual o menor que el último reservado: `409 SEQUENCE_NUMBER_RESERVED`;
  - valor fuera de rango: `400`;
  - mismo valor sin evento;
  - conflicto con una reserva concurrente: `409 SEQUENCE_CHANGED`;
  - retroceso sin motivo `400` y con motivo aplicado, con el motivo en el evento;
  - ajuste de un punto inactivo aplicado;
  - ajuste de un contador agotado: `409 SEQUENCE_EXHAUSTED`;
  - operador `403`;
  - punto de otra empresa o bajo otro establecimiento: `404` con evento de seguridad;
  - primer ajuste de un contador inexistente;
  - fallo inyectado al auditar que revierte el ajuste.
- [ ] 4.3 Comprobar que ninguna ruta reserva secuenciales; verificar que el registro de rutas y los routers no exponen la reserva

## 5. Interfaz: Secuenciales

- [ ] 5.1 Añadir el destino `Secuenciales` a `Configuración` (solo con `sequences.read`) y construir la pantalla de D14 con el selector de ambiente, la lista por punto y los seis tipos, el número completo del siguiente, el último reservado, el estado del punto y "Agotado" sin siguiente secuencial; verificar con pruebas de componente: lista, cambio de ambiente, vacío con enlace a Establecimientos, error con reintento, sin permiso y que un operador no ve el destino
- [ ] 5.2 Construir el diálogo `Ajustar` con el aviso de números sin usar al avanzar, el motivo obligatorio que se revela al retroceder, el error de número reservado en su campo y el conflicto con `Recargar`; verificar con pruebas de componente y contra el backend real: avance, retroceso con motivo, rechazo por número reservado, conflicto con una reserva concurrente y doble envío bloqueado
- [ ] 5.3 Recorrer `Secuenciales` en carga, vacío, error, sin permiso, éxito, móvil a 375 y 320 px con objetivos de 44 px, teclado, temas claro y oscuro, barrido a 640, 768, 1024 y 1440 px, y `docs/quality/frontend-checklist.md`; verificar que la revisión queda registrada en `ui-review.md` del cambio

## 6. Verificación integral

- [ ] 6.1 Prueba end-to-end por HTTP contra `main.ts`:
  1. El administrador fija en 1501 el siguiente secuencial de factura en `Producción`.
  2. Se reservan facturas en `Pruebas` (1 y 2).
  3. La empresa pasa a `Producción` y la siguiente reserva recibe 1501.
  4. Vuelve a `Pruebas` y la siguiente recibe 3.
  5. El ajuste a un número reservado se rechaza.
  6. El rastro de auditoría contiene el ajuste.

  Verificar que la prueba pasa.
- [ ] 6.2 Ejecutar `corepack pnpm verify`; verificar que formato, lint, pruebas, typecheck y build pasan
