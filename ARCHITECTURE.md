# Architecture Map

Estado: arquitectura objetivo del MVP, que se construye mediante los cambios OpenSpec de
`docs/product/capabilities.md`. El código existe hasta `add-minimal-inventory` (cambio 9): la
emisión local de la factura hasta `SIGNED`, su transmisión al SRI con jobs persistidos hasta
`AUTHORIZED`, con la transmisión apagada por defecto; el archivo documental: el RIDE generado una
vez, la bandeja, las descargas verificadas y el historial de entregas; y el inventario mínimo:
stock contabilizado por las facturas autorizadas, las entradas y los ajustes, con su kárdex. El
correo y los reportes siguen siendo objetivo.

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
| `backend/` módulo `taxpayer` | Empresa y sus versiones, ambiente, establecimientos y puntos.                               | `taxpayer-setup`                                    |
| `backend/` módulo `signing`  | Firma electrónica: carga, custodia cifrada (ADR 0011), vigencia y firma de documentos en el pool criptográfico. | `signing-certificate`, `document-emission` |
| `backend/` módulo `catalogs` | Conocimiento fiscal normativo: catálogos fiscales versionados, resolución de vigencia, habilitación por empresa, política de consumidor final, registro de esquemas y matriz de casos especiales. Ofrece lecturas internas sin sesión a otros módulos. | `fiscal-catalogs` |
| `backend/` módulo `parties`  | Terceros y el consumidor final del sistema de cada empresa.                                 | `parties`                                           |
| `backend/` módulo `products` | Productos y servicios, su precio unitario y sus referencias a entradas fiscales.            | `products`                                          |
| `backend/` módulo `invoices` | Borradores de factura, emisión hasta `SIGNED` (evaluación, snapshot, reserva, XML, XSD, firma y artefacto), reintento de la firma, consultas con el resumen y el historial de la transmisión, y la reconciliación manual. Compone las lecturas internas de los demás módulos. Detalle en `docs/architecture/fiscal-emission.md`. | `invoices`, `document-emission` |
| `backend/` módulo `sri-engine` | Piezas del protocolo del SRI detrás de puertos propios: clave de acceso, builder XML de la factura, validación XSD con el paquete verificado y firmador XAdES-BES (ADR 0018, ADR 0021). Desde el cambio 7, también el adaptador SOAP propio, los endpoints, el circuit breaker y los clasificadores de recepción, autorización y validez. | `document-emission`, `sri-transmission` |
| `backend/` módulo `fiscal`   | Numeración, comprobante electrónico, máquina de estados, transiciones y artefactos, y la orquestación SRI: jobs `sri.*`, evidencia de cada intento, reconciliación y barrido. Detalle en `docs/architecture/fiscal-emission.md`. | `fiscal-numbering`, `document-emission`, `sri-transmission`, los seis tipos, `document-archive` |
| `backend/` módulo `inventory` | Stock opcional contabilizado por hechos fiscales autorizados (no reserva de disponibilidad): inicialización única con `INICIAL`, entradas y ajustes con clave de idempotencia, saldo materializado igual a la suma de su kárdex, control por producto, lista, detalle y kárdex. La salida de una factura la registra su seguidor al entrar en `AUTHORIZED`, con la decisión congelada en el snapshot (Q-18). Detalle en `docs/architecture/backend.md`. | `inventory`                                         |
| `backend/` módulo `credit-notes` | Notas de crédito contra facturas propias autorizadas: borrador y vista previa, cálculo único de los importes, capacidad acreditable reservada, aplicada o liberada según el estado de la nota (fallando cerrado), declaraciones del usuario, emisión con la reserva y la firma compartidas de `fiscal`, reintento de firma y consultas. La devolución de stock la registra el seguidor de `inventory`. Detalle en `docs/architecture/backend.md`. | `credit-notes` |
| `backend/` módulo `debit-notes` | Notas de débito contra facturas propias autorizadas: borrador y vista previa, cálculo único por tratamiento de IVA de la factura (`calculateDebitNoteAmounts`), una sola forma de pago del catálogo vigente, declaración del usuario, emisión con la reserva y la firma compartidas de `fiscal`, reintento de firma, consultas y reconciliación manual. Sin capacidades ni inventario. Detalle en `docs/architecture/backend.md`. | `debit-notes` |
| `backend/` módulo `withholding-receipts` | Comprobantes de retención 2.0.0 de renta e IVA a un proveedor, con documentos sustento externos: borrador y vista previa, cálculo único y versionado (`calculateWithholdingAmounts`), evaluación con los catálogos de retención y de sustento vigentes, emisión con la reserva y la firma compartidas de `fiscal`, reintento de firma, consultas y reconciliación manual. Sin capacidades, inventario ni facturas propias. Detalle en `docs/architecture/backend.md`. | `withholding-receipts` |
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

Esa estructura es el objetivo. Hoy, `fiscal` tiene la numeración, el comprobante, las
transiciones, el puerto de artefactos y la orquestación de la transmisión (handlers de los jobs,
evidencia y reconciliación), y en sus carpetas `archive/` el archivo documental: el job del RIDE,
su barrido, la bandeja, las descargas y las entregas. El builder, la clave, la validación XSD, el
transporte SOAP, los parsers y el renderer del RIDE viven en `sri-engine`; la firma, en `signing`;
la cola de jobs, en `platform/jobs`; la primitiva de los pools de workers (criptográfico y del RIDE),
en `platform/workers`; y la orquestación de la emisión local, en `invoices`.

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
  - La salida de una factura es otro seguidor del mismo puerto genérico de transiciones: se registra al entrar en `AUTHORIZED`, en la misma transacción, y su fallo revierte la autorización. `main.ts` lo compone al arrancar, como el seguidor del archivo, y una prueba de arquitectura comprueba la dirección (Q-18).
  - El inventario nunca bloquea la emisión, la firma, la transmisión ni la autorización; el saldo puede quedar negativo (Q-19).
  - `invoices` y `products` tampoco importan `inventory` (design D1 de `add-minimal-inventory`): reciben puertos que implementa el inventario y compone `main.ts`. `invoices` recibe `StockReads` (los saldos, para congelar en el snapshot versión 2 la decisión `inventoryAffectsStock` de cada línea y para los avisos del borrador); `products` recibe `InventoryInitialization` (para rechazar el cambio de la marca de un producto con inventario desde su corrección).
  - La devolución de stock de una nota de crédito (`add-credit-notes`, Q-20) es otro seguidor del mismo puerto (`creditNoteReturnFollower`): al entrar la nota en `AUTHORIZED`, en la misma transacción, registra la `DEVOLUCION_NC` del retorno físico reservado, por producto; en `RETURNED` o `NOT_AUTHORIZED` libera la reserva. Lee solo sus filas de reserva y el número de la nota de `fiscal`: el inventario no importa `credit-notes`, y la capacidad devolvible le llega a la nota por el puerto `ReturnCapacity` que compone `main.ts`.
  - `inventory` usa las lecturas exportadas de `products` (el producto, la página de la lista y el cambio de la marca), de `invoices` (las líneas de inventario del snapshot, nunca el producto vigente) y de `fiscal`. `test/architecture/inventory-dependency-direction.test.ts` comprueba que solo `main.ts` lo compone y que la transmisión no nombra la salida.
- Las notas de crédito dependen de la factura, de `fiscal` y del inventario, nunca al revés (design D1 de `add-credit-notes`):
  - `fiscal`, `invoices` e `inventory` no importan `credit-notes`; `main.ts` compone la lectura de la factura (`invoiceCreditSource`), la capacidad devolvible (`stockReturnCapacity`), la firma compartida con el perfil de la nota y los seguidores;
  - la capacidad acreditable sigue a la nota con otro seguidor del puerto genérico (`creditCapacityFollower`), compuesto antes que la devolución de stock: `AUTHORIZED` la aplica, `RETURNED` y `NOT_AUTHORIZED` la liberan, y ningún otro estado ni problema operacional la toca;
  - `test/architecture/credit-notes-dependency-direction.test.ts` comprueba la dirección y el orden de los seguidores.
- Las notas de débito dependen de la factura y de `fiscal`, nunca al revés (design D1 y D12 de `add-debit-notes`):
  - `fiscal`, `invoices`, `inventory` y `credit-notes` no importan `debit-notes`, y `debit-notes` no importa `inventory` ni `credit-notes`: la nota de débito no toca la capacidad acreditable ni el inventario, y no tiene seguidores propios;
  - `main.ts` compone la lectura de la factura (`invoiceCreditSource`, la misma de la nota de crédito, sin cambios) y la firma compartida con `debitNoteSigningProfile`; los seguidores existentes no hacen nada para un comprobante `05`;
  - `test/architecture/debit-notes-dependency-direction.test.ts` comprueba ambas direcciones.
- El comprobante de retención depende de `fiscal`, `taxpayer`, `catalogs` y `signing`, nunca al revés (design D1 de `add-withholding-receipts`):
  - `fiscal`, `invoices`, `inventory`, `credit-notes` y `debit-notes` no importan `withholding-receipts`, y `withholding-receipts` no importa ninguno de ellos ni `parties`: sus documentos sustento son referencias externas, así que no lee ni modifica comprobantes propios, capacidades ni inventario, y no tiene seguidores propios;
  - `main.ts` compone la lectura de los proveedores (`supplierReader` de `parties`, puerto `WithheldPartyReader`) y la firma compartida con `withholdingReceiptSigningProfile`; los seguidores existentes no hacen nada para un comprobante `07`;
  - el diagnóstico compartido de la firma (`fiscal/application/signing-diagnostics.ts`) y el motivo de una transmisión detenida (`fiscal/application/transmission-messages.ts`) viven en `fiscal`; `invoices` los reexporta para la factura y las notas;
  - `test/architecture/withholding-receipts-dependency-direction.test.ts` comprueba ambas direcciones.
- El archivo documental depende de la transmisión, nunca al revés (design D1 y D5 de `add-document-archive`):
  - la transmisión solo conoce el puerto genérico de seguidores de las transiciones (`fiscal/application/document-transitions.ts`) y los invoca en la misma transacción que guarda cada transición;
  - el seguidor del archivo encola `document.render_ride` al llegar a `AUTHORIZED`, y `main.ts` lo compone al arrancar;
  - las pruebas de arquitectura comprueban que ningún archivo fuera de `archive/` y de la composición importa el archivo, y que solo el worker del RIDE carga pdfmake.
- `invoices` no lee tablas de otros módulos (design D1 de `add-invoice-emission`):
  - compone sus lecturas internas exportadas: la configuración y el punto de `taxpayer`, el tercero de `parties`, el producto de `products`, las consultas de `catalogs` y la firma vigente de `signing`;
  - usa, dentro de su unidad de trabajo, las operaciones transaccionales exportadas: `reserveSequentialIn` y el repositorio de documentos y artefactos de `fiscal`, y `lockTaxIdentityIn` de `taxpayer`;
  - las pruebas de arquitectura de `parties`, `products` y `catalogs` comprueban que ningún otro módulo lee sus tablas.
- `parties` y `products` consumen `catalogs` solo por sus lecturas internas, sin leer sus tablas; `catalogs` no importa `parties` ni `products`, y estos no se importan entre sí. `identity` crea el consumidor final mediante un iniciador de empresa que registra `main.ts`, sin importar `parties` (add-parties-and-products, design D1 y D5).
- Los seis flujos documentales dependen del núcleo común, nunca entre sí (ADR 0002, ERS RF-253).
- UI code should not know server-side secrets. El frontend solo habla con la API; nunca recibe el certificado, su contraseña ni rutas de almacenamiento.

## Boundaries

| Límite               | Regla del proyecto                                                                                                    | Documento                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Autenticación        | Better Auth gestiona sesiones; sin registro público; el primer administrador se siembra por variables de entorno.     | `docs/architecture/authentication.md`       |
| Tenant               | Todo dato privado pertenece a una empresa, resuelta desde la membresía de la sesión, aunque exista una sola.          | ADR 0009, `docs/security/access-control.md` |
| HTTP/API             | Prefijo `/api`, contratos versionados, OpenAPI, validación con Zod, `Idempotency-Key` en la emisión.                  | `docs/architecture/backend.md`, Q-29        |
| Base de datos        | Invariantes fiscales como restricciones; tablas de evidencia solo de agregado; dinero en `NUMERIC`.                    | `docs/architecture/database.md`             |
| Servicio externo SRI | Solo el adaptador SOAP propio de `sri-engine` llama al SRI, con el `fetch` nativo en infraestructura, endpoints configurables por ambiente, timeouts, circuit breaker y respuestas originales persistidas antes de clasificarlas. | `docs/architecture/integrations.md`, ADR 0018 |
| Jobs                 | Transmisión, autorización, reconciliación y recuperación en una cola durable propia en PostgreSQL, con jobs idempotentes y reanudables. Los estados del job no son estados fiscales. | `docs/architecture/backend.md`, ADR 0012    |
| Secretos de firma    | Solo el adaptador de firma descifra el certificado, en memoria y durante la firma.                                     | ADR 0011                                    |
| Artefactos           | Se escriben una vez, con hash; la interfaz nunca ve rutas ni nombres de almacenamiento.                                | ADR 0010                                    |
| Frontend/cliente     | La interfaz refleja permisos y estados; el servidor los impone.                                                        | `docs/architecture/frontend.md`             |

## Flujo de emisión

```text
borrador -> Emitir (Idempotency-Key) -> transacción: bloqueos, validación, snapshot, secuencial,
            identidad tributaria y clave de acceso -> RESERVED            (cambio 6, implementado)
         -> XML -> XSD -> firma -> XSD -> XML firmado + hash persistidos -> SIGNED   (petición)
         -> job: recepción -> respuesta persistida -> job: autorización con backoff
         -> XML autorizado + respuesta persistidos -> AUTHORIZED   (cambio 7, implementado)
         -> reconciliación por la misma clave ante cualquier resultado ambiguo
         -> job del RIDE en la misma transacción que AUTHORIZED -> RIDE_PDF guardado una vez
         -> bandeja, descargas verificadas e impresión, con su historial  (cambio 8)
         -> salida de inventario en la misma transacción que AUTHORIZED, por las líneas con
            inventoryAffectsStock en el snapshot versión 2; saldo que puede quedar negativo (cambio 9)
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
