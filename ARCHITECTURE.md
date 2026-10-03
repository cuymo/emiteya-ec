# Architecture Map

Estado: arquitectura objetivo del MVP. Todavía no existe código de aplicación; cada
componente se construye mediante los cambios OpenSpec de `docs/product/capabilities.md`.

## System Style

- Monolito modular: API REST en Express con TypeScript y frontend en Next.js con TypeScript (`docs/architecture/stack.md`).
- PostgreSQL es la base de datos principal; Prisma gestiona el acceso y las migraciones; Better Auth gestiona la autenticación.
- Instalación self-hosted con una empresa por instancia. La empresa es el tenant de todos los datos privados, para no impedir multiempresa (ADR 0009).
- El motor fiscal es un núcleo común para los seis comprobantes, con un builder por tipo y versión de XSD (ADR 0002). Está desacoplado de la interfaz y de la persistencia mediante puertos (ADR 0007, ERS RNF-011).
- La emisión es un proceso distribuido y persistente, no una llamada: los pasos locales (reserva, XML, XSD, firma) corren en la petición y los pasos de red con el SRI corren en jobs persistidos en PostgreSQL (ADR 0012, CTX §68).
- Los artefactos fiscales son inmutables, llevan hash SHA-256 y se guardan en un almacenamiento durable detrás de un puerto (ADR 0010).
- XSD, catálogos, reglas, endpoints y límites del SRI son datos versionados, no constantes del código (ADR 0008).

## Main Components

| Componente           | Responsabilidad                                                                                     | Capacidades                                         |
| -------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `frontend/`          | Next.js: configuración, emisión, bandeja, catálogos, inventario y reportes. No conoce secretos.      | Todas las de interfaz                               |
| `backend/` módulo `identity` | Usuarios, membresía en la empresa y roles sobre Better Auth.                                | `user-access`                                       |
| `backend/` módulo `taxpayer` | Empresa y sus versiones, ambiente, establecimientos, puntos y certificado.                  | `taxpayer-setup`, `signing-certificate`             |
| `backend/` módulo `catalogs` | Terceros, productos, catálogos fiscales, política de consumidor final, registro de esquemas y matriz de casos especiales. | `parties`, `products`, `fiscal-catalogs` |
| `backend/` módulo `fiscal`   | Motor fiscal y orquestación SRI, con la estructura de CTX §42. Detalle en `docs/architecture/fiscal-emission.md`. | `fiscal-numbering`, `document-emission`, `sri-transmission`, los seis tipos, `document-archive` |
| `backend/` módulo `inventory` | Stock opcional, movimientos y kárdex; reacciona a eventos fiscales.                        | `inventory`                                         |
| `backend/` módulo `reports`  | Consultas filtradas y exportación XLSX.                                                     | `reports`, `data-portability`                       |
| `backend/` módulo `audit`    | Eventos de auditoría, solo de agregado.                                                     | `audit-trail`                                       |
| `backend/` `platform`        | Configuración validada, runner de jobs, salud, logs, métricas.                              | Transversal                                         |
| `docs/product/`      | Propósito, usuarios, dominio, vocabulario, preguntas abiertas y riesgos.                            | —                                                   |
| `openspec/`          | Especificaciones del comportamiento actual y cambios en curso.                                      | —                                                   |
| `docs/architecture/` | Decisiones técnicas, límites y ADRs.                                                                | —                                                   |

Estructura interna del módulo `fiscal`, adaptada de CTX §42 a las capas de
`docs/architecture/backend.md`:

```text
fiscal/
├── domain/          dominio puro: documents, money, sequences, states, policies, access-key, snapshots
├── application/     casos de uso (emitir, corregir, reconciliar) y workers de orquestación
├── xml/             builders deterministas por tipo y versión; usa el registro de esquemas de `catalogs`
├── signature/       adaptador XAdES-BES y custodia del certificado
├── sri/             clientes SOAP de recepción, autorización y consulta; parser; mapper de errores; endpoints
├── ride/            renderer del RIDE
└── persistence/     repositorios Prisma y almacenamiento de artefactos
```

## Dependency Direction

```text
frontend --HTTP /api--> routes (infraestructura HTTP)
                          -> application (casos de uso, workers)
                               -> domain (puro)
                               -> ports  <- adapters: Prisma, SOAP SRI, firmador, validador XSD,
                                                      almacenamiento, renderer RIDE, XLSX
```

Rules:

- Domain must not depend on frameworks or databases. En `fiscal/domain` viven la clave de acceso, el módulo 11, los cálculos decimales, la máquina de estados y las políticas; no hace IO.
- Los builders XML son funciones deterministas del snapshot del comprobante a bytes; no leen datos vivos de la empresa ni del catálogo (CTX §11).
- Application logic depends on ports/interfaces, not concrete infrastructure. Los puertos del motor fiscal son los de CTX §43: clientes de recepción, autorización y consulta, validador XSD y firmador, más almacenamiento de artefactos y renderer RIDE.
- Infrastructure implements ports and owns external tools. Los objetos de una librería SOAP o de firma nunca cruzan el puerto; se normalizan antes (CTX §44).
- `fiscal` no importa `inventory`: el inventario reacciona a eventos fiscales, así puede desactivarse sin tocar la emisión (ADR 0006).
- Los seis flujos documentales dependen del núcleo común, nunca entre sí (ADR 0002, ERS RF-253).
- UI code should not know server-side secrets. El frontend solo habla con la API; nunca recibe el certificado, su contraseña ni rutas de almacenamiento.

## Boundaries

| Límite               | Regla del proyecto                                                                                                    | Documento                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Autenticación        | Better Auth gestiona sesiones; sin registro público; el primer administrador se siembra por variables de entorno.     | `docs/architecture/authentication.md`       |
| Tenant               | Todo dato privado pertenece a una empresa, resuelta desde la membresía de la sesión, aunque exista una sola.          | ADR 0009, `docs/security/access-control.md` |
| HTTP/API             | Prefijo `/api`, contratos versionados, OpenAPI, validación con Zod, `Idempotency-Key` en la emisión.                  | `docs/architecture/backend.md`, Q-29        |
| Base de datos        | Invariantes fiscales como restricciones; tablas de evidencia solo de agregado; dinero en `NUMERIC`.                    | `docs/architecture/database.md`             |
| Servicio externo SRI | Solo el submódulo `fiscal/sri` llama al SRI, con endpoints por ambiente, timeouts, circuit breaker y respuestas normalizadas. | `docs/architecture/integrations.md`  |
| Jobs                 | Transmisión, autorización, reconciliación y recuperación en jobs persistidos, idempotentes y reanudables.              | `docs/architecture/backend.md`, ADR 0012    |
| Secretos de firma    | Solo el adaptador de firma descifra el certificado, en memoria y durante la firma.                                     | ADR 0011                                    |
| Artefactos           | Se escriben una vez, con hash; la interfaz nunca ve rutas ni nombres de almacenamiento.                                | ADR 0010                                    |
| Frontend/cliente     | La interfaz refleja permisos y estados; el servidor los impone.                                                        | `docs/architecture/frontend.md`             |

## Flujo de emisión

```text
borrador -> Emitir -> validación de negocio -> reserva de secuencial + snapshot -> clave de acceso
         -> XML -> XSD -> firma -> XML firmado + hash persistidos            (petición, transacciones locales)
         -> job: recepción -> respuesta persistida -> job: autorización con backoff
         -> XML autorizado + respuesta persistidos -> RIDE -> entrega         (jobs persistidos)
         -> reconciliación por la misma clave ante cualquier resultado ambiguo
```

Estados, transiciones y reglas de reintento en `docs/architecture/fiscal-emission.md`.

## Detailed Documents

- Architecture index: `docs/architecture/index.md`
- Emisión fiscal y orquestación SRI: `docs/architecture/fiscal-emission.md`
- Requisitos no funcionales: `docs/architecture/non-functional-requirements.md`
- Stack baseline: `docs/architecture/stack.md`
- Bootstrap guide: `docs/architecture/bootstrap.md`
- Backend: `docs/architecture/backend.md`
- Frontend: `docs/architecture/frontend.md`
- Cognitive architecture: `docs/architecture/cognitive-architecture.md`
- Design foundations: `docs/architecture/design-foundations.md`
- Component selection: `docs/architecture/component-selection.md`
- Shared component contracts: `docs/architecture/component-system.md`
- Interface design: `docs/architecture/interface-design.md`
- Data tables: `docs/architecture/data-tables.md`
- Forms and workflows: `docs/architecture/forms-and-workflows.md`
- Feedback and states: `docs/architecture/feedback-and-states.md`
- Navigation and responsive behavior: `docs/architecture/navigation-responsive.md`
- Authentication: `docs/architecture/authentication.md`
- Database: `docs/architecture/database.md`
- Idempotency and concurrency: `docs/architecture/idempotency.md`
- Integrations: `docs/architecture/integrations.md`
- Deployment: `docs/architecture/deployment.md`
- ADRs: `docs/architecture/adr/`
