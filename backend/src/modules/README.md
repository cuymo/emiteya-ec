# Módulos

Cada módulo de negocio vive en `src/modules/<módulo>/` con tres capas
(`docs/architecture/backend.md`):

```text
<módulo>/
├── domain/           entidades, objetos de valor, errores e invariantes; sin frameworks ni IO
├── application/      casos de uso y puertos; recibe el contexto como datos simples
└── infrastructure/   rutas HTTP, repositorios Prisma, clientes externos y adaptadores de los puertos
```

Reglas, verificadas por ESLint (`eslint.config.base.js`):

- `domain/` no importa `express`, Prisma, `pg`, código generado ni `infrastructure/`.
- `application/` no importa `express` ni `infrastructure/`.
- `infrastructure/` implementa los puertos y es la única capa que conoce frameworks y bases de datos.

Las rutas del módulo se montan bajo `/api/v1` a través del router que recibe `createApp`, y se
registran en `packages/contracts/src/api/routes.ts` para OpenAPI.

Todavía no hay módulos: el primero llega con `add-user-access`.
