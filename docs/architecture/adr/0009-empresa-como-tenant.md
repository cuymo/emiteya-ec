# ADR 0009: La empresa es el tenant

## Status

Accepted, 2026-10-02. Alternativa A.

## Context

El MVP atiende a una empresa por instalación, pero no debe impedir multiempresa (ERS §4.1,
P2). CognitiveStack exige aislar los datos por tenant, y las restricciones del ERS (§13.1) y
de CTX (§5, §27.4) ya incluyen la empresa o el contribuyente.

`add-user-access` es el primer cambio que crea datos privados: usuarios, roles y auditoría.
El registro de la empresa con sus datos tributarios llega después, en `add-taxpayer-setup`.

Alternativas consideradas:

| Alternativa | Descripción | A favor | En contra |
| --- | --- | --- | --- |
| A. Empresa como tenant | `companyId` en todo recurso privado, membresía usuario–empresa–rol y repositorios con alcance obligatorio. | Coincide con ERS, CTX y CognitiveStack; pruebas de aislamiento desde el primer cambio; multiempresa sin migrar cada tabla. | Un parámetro y un filtro que con una sola empresa parecen redundantes. |
| B. Tenant implícito | Sin `companyId`: una instalación es una empresa. | El código más simple hoy. | Contradice las restricciones del ERS y de CTX y las reglas de CognitiveStack, y exigiría un ADR de desviación. Multiempresa obligaría a migrar todas las tablas, incluidas las de evidencia fiscal de solo agregado. |
| C. Instancia por empresa para siempre | Multiempresa significa varias instalaciones. | Aislamiento físico total y sin filtros. | Ninguna interfaz común para varias empresas; más carga de operación. Además, exige evitar el filtro de tenant que CognitiveStack pide. |

## Decision

Modelo conceptual:

| Concepto     | Significado                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `User`       | Identidad: quién es la persona y cómo se autentica. No pertenece por sí misma a ninguna empresa.      |
| `Company`    | Tenant: dueño de todos los recursos privados.                                                         |
| `Membership` | Relación usuario–empresa–rol. El rol existe solo dentro de esa empresa.                               |

Reglas:

- Todo recurso privado del tenant lleva `companyId` y queda aislado por él: cada consulta, actualización y borrado filtra por la empresa del contexto.
- El contexto de empresa y rol se deriva en el servidor desde la sesión autenticada y la membresía. Nunca se confía en un `companyId` ni en un `role` enviados por el cliente: en los payloads de escritura se rechazan por esquema estricto, y en cualquier otro lugar se ignoran.
- Los repositorios de recursos privados exigen el contexto de empresa como parámetro; no existe una búsqueda por identificador sin empresa.
- Las claves foráneas entre recursos de la empresa son compuestas e incluyen `companyId`.
- En el MVP cada usuario tiene una membresía. Si en el futuro tiene varias, la empresa activa es una solicitud que el servidor valida contra la membresía en cada petición.
- El registro único de la empresa se crea al instalar, en la misma operación que siembra al administrador inicial y su membresía, en estado "no preparada para emitir". `add-taxpayer-setup` completa sus datos.
- Que el MVP tenga una sola empresa es una política operativa del aprovisionamiento, no una restricción estructural: ningún índice, `CHECK` ni trigger limita el número de empresas. Soportar varias empresas añadirá flujos de creación y selección, sin migrar este modelo de tenancy.

Este ADR no decide cómo se implementa la membresía: el plugin Organization de Better Auth,
configuración adicional, un adapter o tablas propias. Lo valida el spike S-1 (Q-41). Una
membresía propia exige una justificación y, si afecta la arquitectura, su propio ADR.

## Consequences

- Multiempresa no exigirá migrar cada tabla.
- Las pruebas de aislamiento con dos empresas existen desde el primer cambio.
- Con una sola empresa, el filtro parece redundante.
- Cambiar de opinión después cuesta de forma asimétrica. Pasar de A a B es casi gratis: basta con dejar de usar el filtro. Pasar de B a A después de emitir obliga a migrar todas las tablas y restricciones únicas, entre ellas la unicidad del secuencial y de la idempotencia, a tocar las tablas de solo agregado con permisos especiales, y a revisar cada repositorio y cada prueba.
