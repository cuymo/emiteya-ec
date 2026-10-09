# Proposal

## Why

El administrador de la empresa necesita llevarse fuera del sistema, en un formato que pueda leer sin
esta aplicación, los datos y artefactos que el sistema conserva de su empresa: su configuración,
sus terceros y productos, sus comprobantes con los XML, los RIDE y las respuestas del SRI, su
inventario y su auditoría. Hoy solo puede descargar un comprobante a la vez desde la bandeja o
exportar los cinco reportes filtrados. El ERS pide "un mecanismo para exportar datos y artefactos
del contribuyente" (SEC-010). Es el cambio 16 de `capabilities.md`, el último cambio funcional del
ERS. La revisión de readiness del 2026-10-08 resolvió Q-28 con `PORTABILITY_FORMAT_V1` y fijó las
decisiones D1 a D9 (Trazabilidad de `data-portability` en `capabilities.md`; BR-96 a BR-101).

## What Changes

- **Exportación de portabilidad, solo del administrador:** genera un paquete de los datos y
  artefactos de su empresa. No es un respaldo: el paquete no se importa ni se restaura, y la
  restauración (AC-10) sigue siendo la del respaldo operativo.
- **Formato `PORTABILITY_FORMAT_V1`:** un ZIP64 autodescriptivo y versionado,
  `datos-AAAAMMDD-HHMMSS.zip`, con:
  - `manifest.json` (`formatVersion` "1");
  - `SHA256SUMS` con el inventario completo;
  - `LEEME.txt`;
  - seis libros XLSX en `data/`: empresa, terceros, productos, comprobantes, inventario y
    auditoría;
  - por comprobante, en `documents/<produccion|pruebas>/<tipo>/<documento>/`: su `snapshot.json`
    congelado, su XML firmado, su XML autorizado, su RIDE y sus respuestas originales del SRI;
  - los logos en `assets/logos/`.
  - Las rutas salen solo de componentes generados y validados por el servidor, nunca de texto de
    los usuarios.
- **Contenido:**
  - la configuración del contribuyente con todas sus versiones;
  - establecimientos, puntos, secuenciales y habilitaciones de catálogos;
  - terceros y productos vigentes en todos sus estados;
  - los comprobantes de los seis tipos desde la reserva, en todos sus estados y en los dos
    ambientes, con sus transiciones, sus intentos con el SRI y sus entregas;
  - las existencias y el kárdex;
  - la auditoría;
  - los usuarios y las firmas, solo como metadatos.
- **Exclusiones declaradas:** se declaran en el manifiesto, en `LEEME.txt` y en la pantalla.
  - Nunca salen el P12, su contraseña, la clave de datos envuelta, la clave maestra ni los datos
    internos de autenticación.
  - Los borradores quedan fuera de la versión 1, sin borrar nada.
- **Integridad:**
  - Cada artefacto sale con sus bytes persistidos exactos, nunca regenerado, y con su tamaño y su
    SHA-256 comprobados.
  - Un artefacto alterado hace fallar la exportación sin paquete parcial; uno legítimamente ausente
    se declara con su motivo.
  - El SHA-256 del paquete queda visible para verificarlo por separado.
- **Momento consistente:** el paquete representa un único momento (`snapshotAt`). Lo creado
  después no entra.
- **Generación asíncrona y durable:**
  - estados explícitos `QUEUED`, `GENERATING`, `READY`, `FAILED` y `EXPIRED`;
  - una generación activa por empresa;
  - un paquete vigente por empresa, que caduca a las 24 horas y se borra;
  - descarga autenticada, con el paquete verificado antes del primer byte.
- **Auditoría:** `data_export.requested`, `data_export.completed`, `data_export.failed` y
  `data_export.download_started`, sin rutas, contenido ni datos personales.
- **Pantalla Portabilidad de datos** en Configuración, solo para el administrador. Explica:
  - qué incluye y qué no;
  - que no es un respaldo y no contiene la firma;
  - que trae Pruebas y Producción.

  Muestra el momento del snapshot, el estado y el progreso, la caducidad, el tamaño y el SHA-256,
  y permite descargar y generar de nuevo.
- **Defensa de recursos:**
  - una generación a la vez por instancia;
  - una reserva de disco comprobada antes de copiar los artefactos;
  - la caducidad del paquete.

  Son hipótesis que fija el benchmark. No hay máximo de filas: el paquete está completo o falla.

**Fuera de alcance:**

- Importar, restaurar o reabrir el paquete en este u otro sistema, y cualquier ida y vuelta por la
  aplicación.
- El respaldo y la restauración operativos: AC-10, RNF-007 y SEC-008 siguen siendo compuertas de
  operación y del go-live, con el procedimiento de `deployment.md`.
- Los borradores y el espacio de trabajo incompleto.
- Exportar la firma, sus secretos o la clave maestra, por cualquier vía.
- Exportaciones filtradas, programadas, enviadas por correo o con un enlace firmado. Los listados
  filtrados son los reportes del cambio 15.
- Borrar, purgar o dar de baja datos de la empresa o la cuenta (Q-27: nunca purgar en v1).

## Capabilities

### New Capabilities

- `data-portability`: la exportación de los datos y artefactos de la empresa en el paquete
  `PORTABILITY_FORMAT_V1`. Cubre:
  - el contenido, las exclusiones y la política de borradores;
  - el formato con su manifiesto y su inventario verificable;
  - la integridad de los artefactos y el momento consistente;
  - los dos ambientes;
  - la generación asíncrona con sus estados, la caducidad y la descarga autenticada;
  - la defensa de recursos, los permisos, el aislamiento por empresa y la pantalla.

### Modified Capabilities

- `audit-trail`: se auditan la solicitud, la generación completada o fallida y el inicio de cada
  descarga de una exportación de portabilidad, sin rutas, contenido ni datos personales.

## Impact

- **Backend:**
  - un módulo nuevo de portabilidad que compone las lecturas que exportan los módulos dueños,
    sin escribir en ellos ni leer sus tablas;
  - el registro de las exportaciones, un job durable con renovación de su *lease* y un barrido
    de caducidad y recuperación;
  - las rutas `/api/v1/data-exports`;
  - variables de entorno de defensa de recursos y del directorio privado del paquete.
- **Plataforma:**
  - el escritor XLSX del cambio 15 pasa a una capa neutral, sin cambiar su comportamiento;
  - la cola de jobs gana la renovación del *lease*.
- **Dependencias:** el contenedor ZIP64 lo elige un spike con su ADR 0024, primera tarea del
  cambio. Una biblioteca de producción queda preautorizada si el ADR demuestra todos sus
  criterios.
- **Contratos:** las vistas, los estados y los errores de las exportaciones en
  `packages/contracts`, con su OpenAPI.
- **Frontend:** la pantalla Portabilidad de datos y su entrada en Configuración.
- **Base de datos:** una tabla nueva para el registro de las exportaciones, con sus restricciones.
- **Auditoría:** cuatro acciones nuevas.
- **Documentación:**
  - el formato del paquete en `docs/architecture/data-portability-format.md`;
  - el módulo, el despliegue del directorio privado y la observabilidad.
- **Rendimiento:** `bench:data-portability` con el volumen de Q-26.
