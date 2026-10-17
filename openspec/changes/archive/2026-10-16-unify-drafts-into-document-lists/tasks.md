# Tasks

**Reglas para todos los grupos:**
- **Commits.** Un commit por grupo en `redesign-frontend`, sin push y sin publicar en `main`.
- **SRI.** Ningún grupo contacta al SRI. `SRI_TRANSMISSION_ENABLED` sigue desactivado.
- **Base de datos.** Sin migraciones ni tablas nuevas.
- **Pruebas.** Las pruebas de integración del backend (base de datos de prueba) y las visuales
  quedan para la verificación final del proyecto, según la regla vigente del propietario.

## 1. Contratos y auxiliares

- [x] 1.1 Añadir en `packages/contracts` el esquema común de la lista unificada (`documentEntry`) y
  el estado de filtro `DRAFT`. Para cada uno de los seis tipos, añadir su consulta y su vista de
  entrada, y registrar `GET /<prefijo>/entries` en `api/routes.ts`. Regenerar el OpenAPI.
- [x] 1.2 Añadir `draftsFirstPage` en `backend/src/platform/pagination`, con sus pruebas unitarias:
  página llena de borradores, página mixta, página solo de emitidos con un desfase que cruza dos
  páginas, y sin borradores.
- [x] 1.3 Añadir `allows(ctx, permiso)` al autorizador, sin evento de seguridad.

## 2. Backend de los seis tipos

- [x] 2.1 Añadir `entries` a cada módulo, con los filtros y la búsqueda de D3 y los permisos de D4,
  y su ruta antes de `/:id`.
- [x] 2.2 Añadir la prueba de integración de la lista unificada de facturas (borradores primero,
  una página que cruza los dos orígenes, `state=DRAFT`, exclusión por estado emitido y por «Requiere
  atención», búsqueda y aislamiento por empresa), que se ejecuta en la verificación final. Los otros
  cinco tipos usan el mismo auxiliar, que tiene sus pruebas unitarias, y la misma composición.

## 3. Frontend

- [x] 3.1 Hacer que las seis listas consuman `entries`: estado «Borrador» y opción «Borradores» en
  el filtro, fila de borrador según D5 con apertura y eliminación, sin el panel «Borradores en
  curso». Actualizar sus pruebas.
- [x] 3.2 Retirar «Borradores de facturas» de la navegación y su pantalla. Redirigir `/borradores`
  a `/facturas?estado=borradores`, mover las palabras clave a Facturas y enlazar ahí el indicador
  del tablero. Actualizar sus pruebas.

## 4. Documentación y cierre

- [x] 4.1 Actualizar `docs/architecture` (navegación, tablas, emisión fiscal) y anotar en
  `technical-debt.md` la cota de búsqueda de D3.
- [x] 4.2 Validar el change, sincronizar las specs y archivarlo.
