# ADR 0015: Versionado de la API por prefijo de ruta

## Status

Accepted, 2026-10-02. Decidido en la revisión de `add-user-access`, por delegación explícita
del dueño del producto entre fijar una convención general o no fijar ninguna.

## Context

ERS API-001 exige contratos de entrada y salida versionados para toda la API, no para una
funcionalidad. ERS §17 y CTX §40 proponen rutas sin versión (`/api/invoices`,
`/api/fiscal/invoices`). Sin una convención general, cada cambio inventaría la suya.

Alternativas consideradas:

| Alternativa | A favor | En contra |
| --- | --- | --- |
| Prefijo de ruta `/api/v1/` | Visible, simple de enrutar y de documentar en OpenAPI, y un integrador lo entiende sin leer cabeceras. | La versión aparece en todas las URLs. |
| Cabecera o media type (`Accept: application/vnd...;v=1`) | URLs estables. | Más difícil de probar, cachear y documentar; fácil de omitir. |
| Sin convención hasta tener integradores | Nada que decidir hoy. | Contradice ERS API-001 y obliga a renombrar rutas cuando aparezca el primer integrador. |

## Decision

- Todas las rutas de aplicación viven bajo `/api/v1/`.
- Las rutas que pertenecen a una librería quedan fuera del prefijo: Better Auth en `/api/auth/*`. Su contrato lo versiona la librería.
- Un cambio incompatible en un contrato publicado crea `/api/v2/` para los recursos afectados; `/api/v1/` se mantiene durante un periodo de transición declarado en el `CHANGELOG`.
- Antes del primer release público, `/api/v1/` puede cambiar sin crear `/api/v2/`, porque no tiene consumidores externos.

Este ADR no decide los nombres de los recursos fiscales ni si borrador y emisión son llamadas
separadas: eso sigue en Q-29.

## Consequences

- Una sola convención para toda la API y su especificación OpenAPI (ERS API-005).
- Las rutas propuestas en ERS §17 y CTX §40 se leen con el prefijo, por ejemplo `/api/v1/fiscal/invoices` si Q-29 adopta el segmento `fiscal`.
- La política de deprecación queda definida antes del primer integrador.
