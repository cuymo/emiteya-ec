# ADR 0017: Logo y assets de configuración en PostgreSQL

## Status

Accepted, 2026-10-02. Decidido por el dueño del producto en la revisión de readiness de
`add-taxpayer-setup` (Q-42).

## Context

ERS RF-102 pide cargar, reemplazar y eliminar el logo de la empresa y usarlo en el RIDE. La
política de snapshots (CTX §39, ADR 0008) exige que cada comprobante conserve la fotografía del
emisor con que se emitió, de modo que un RIDE histórico debe poder mostrar el logo vigente en
ese momento aunque después se reemplace o se elimine.

El ADR 0010 (Proposed, Q-39) decidirá el almacenamiento general de artefactos fiscales con
el cambio de emisión. Adelantarlo completo solo por el logo ampliaría `add-taxpayer-setup` con
una decisión que todavía no tiene todos sus insumos. El logo es pequeño, pertenece a la
configuración de la empresa y cambia rara vez.

Alternativas consideradas:

| Alternativa | A favor | En contra |
| --- | --- | --- |
| Assets inmutables en PostgreSQL, referenciados por la versión de configuración | Transaccional con la configuración, un solo respaldo, sin servicios nuevos, sin depender de Q-39. | La base de datos guarda contenido binario; acotado por un límite de tamaño. |
| Adelantar el ADR 0010 y guardar el logo como artefacto de escritura única | Un único mecanismo de almacenamiento. | Arrastra Q-39 y un volumen o servicio de objetos al cambio de configuración. |
| Bytes del logo dentro de cada fila de versión de configuración | Lo más simple de leer. | Duplica los mismos bytes en cada versión y mezcla contenido con datos tributarios. |

## Decision

- El contenido del logo se guarda en PostgreSQL como un asset de configuración inmutable de la empresa: sus bytes nunca se sobrescriben ni se borran.
- Cada versión de la configuración tributaria referencia el asset de logo vigente, o ninguno.
- Reemplazar el logo crea un asset nuevo y una versión de configuración nueva que lo referencia.
- Eliminar el logo crea una versión de configuración nueva sin referencia a un logo; el asset anterior se conserva.
- Las versiones de configuración y los snapshots históricos siguen apuntando al asset que referenciaban.
- Los mismos bytes no se duplican: un contenido idéntico de la misma empresa reutiliza su asset.
- Cada asset guarda la metadata mínima para servirlo y verificar su integridad: tipo MIME, tamaño y checksum SHA-256.
- El formato y el tamaño se validan en el borde de entrada, a partir del contenido y no solo de la extensión o del tipo declarado. Los formatos admitidos y el límite concreto son diseño y configuración, salvo que ERS o CTX impongan valores.
- El acceso pasa por un puerto pequeño de assets de configuración (guardar y leer por identificador), de modo que una migración futura a object storage no cambie el contrato de producto.

Este ADR no modifica el ADR 0010, que seguirá decidiendo el almacenamiento de los artefactos
fiscales (XML, respuestas del SRI, RIDE) en su cambio.

## Consequences

- La configuración, su historial y sus logos se respaldan y restauran juntos.
- La base de datos crece con cada logo distinto, acotada por el límite de tamaño y por la deduplicación.
- Si el ADR 0010 adopta otro almacenamiento, los assets de configuración pueden migrarse detrás del mismo puerto.
