# Proposal

## Why

Cada comprobante electrónico lleva un secuencial de nueve dígitos que, junto con el
establecimiento y el punto de emisión, forma su número y entra en su clave de acceso (CTX §8.1).
Un secuencial duplicado lo rechaza el SRI, y uno reutilizado rompe la trazabilidad fiscal del
contribuyente. Hoy la empresa ya tiene establecimientos, puntos y ambiente (`add-taxpayer-setup`),
pero nada asigna esos números.

Este cambio da al sistema una numeración que no duplica ni reutiliza, aunque muchas emisiones
ocurran a la vez. También da al administrador del contribuyente una forma controlada y auditada
de fijar el siguiente secuencial, por ejemplo para continuar la numeración de un sistema anterior
(ERS RF-120..125, RNF-003, AC-04). Es requisito del cambio de emisión.

## What Changes

- Un contador de secuenciales independiente por empresa, ambiente, establecimiento, punto de emisión y tipo de comprobante (ADR 0003, Q-02). Pruebas y Producción numeran por separado, y volver a un ambiente continúa su secuencia.
- Reserva del siguiente secuencial: atómica, sin duplicados bajo concurrencia entre procesos e instancias, y sin reutilizar nunca un número reservado, aunque lo que ocurra después falle. Es una operación interna que invocará la emisión; no se expone en la API.
- Formato del secuencial de nueve dígitos y del número completo `EEE-PPP-SSSSSSSSS`, y comportamiento al agotarse los nueve dígitos.
- Consulta de los secuenciales por ambiente, punto y tipo, y ajuste administrativo del siguiente valor. Retroceder exige una operación explícita con motivo, y nunca se vuelve a un número ya reservado.
- Auditoría de cada ajuste del siguiente secuencial, con su valor anterior y nuevo (ERS RF-121, RF-125, SEC-007).
- Permisos nuevos en el mapa central de acceso para consultar y ajustar secuenciales (Q-22).
- Pantalla `Secuenciales` en `Configuración` para el administrador.

Fuera de alcance:

- Emisión, borradores, snapshot, clave de acceso, código numérico, máquina de estados y el momento exacto en que la emisión reserva el secuencial (`add-invoice-emission`; Q-01 ya fija que ocurre al emitir, tras la validación de negocio).
- Reconciliación con el SRI ante secuenciales registrados (errores 43 y 45) y revisión manual (`add-sri-transmission`).
- El bloqueo de la identidad tributaria al primer artefacto fiscal (`add-invoice-emission`, Q-31).
- Catálogos fiscales (`add-business-catalogs`): los seis códigos de comprobante son datos estructurales estables del protocolo (CTX §56), no un catálogo.
- Mostrar el secuencial a los operadores fuera de los comprobantes que emitan.
- Reiniciar o "liberar" números ya reservados, y numeraciones distintas del secuencial de nueve dígitos.
- Paginación de la lista de secuenciales (volumen esperado pequeño, Q-26).

## Capabilities

### New Capabilities

- `fiscal-numbering`: contadores de secuenciales por ambiente, establecimiento, punto de emisión y tipo de comprobante; reserva atómica sin duplicados ni reutilización; formato y límite del secuencial; consulta y ajuste administrativo del siguiente valor.

### Modified Capabilities

- `audit-trail`: añade la auditoría de los ajustes del siguiente secuencial. Los requisitos existentes de atomicidad, ausencia de secretos, inmutabilidad y aislamiento se aplican también a estos eventos.

## Impact

- Backend:
  - módulo `fiscal` nuevo con la numeración y sus rutas de consulta y ajuste bajo `/api/v1/` (ADR 0015);
  - una operación interna de reserva para el cambio de emisión;
  - permisos nuevos en el mapa central de `identity` y una acción nueva en `audit`.
- Base de datos:
  - tablas de contadores y de reservas, con la unicidad del secuencial que incluye el ambiente (CTX §5) y claves foráneas compuestas por empresa;
  - restricciones de rango y la invariante de que el siguiente valor siempre supera al mayor reservado;
  - una restricción única nueva en `emission_point` como destino de la clave compuesta.
- Frontend: destino `Secuenciales` en `Configuración`.
- Documentación: `access-control.md`, `database.md`, `fiscal-emission.md` (cómo invocará la emisión la reserva) y `domain-model.md`.
- Dependencias: requiere `add-taxpayer-setup` archivado (establecimientos, puntos, disponibilidad y ambiente). Lo usará `add-invoice-emission`.
