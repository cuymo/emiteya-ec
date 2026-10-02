# Proposal

## Why

La empresa que deja `add-user-access` es solo un tenant: no tiene RUC, razón social, atributos
tributarios, establecimientos ni puntos de emisión, que son los datos con que el SRI identifica
al emisor en cada comprobante (CTX §5, §11). Sin ellos ningún cambio posterior puede reservar
secuenciales, firmar ni emitir. El administrador del contribuyente necesita registrarlos una
vez, corregirlos cuando cambian sin alterar lo ya emitido, saber en todo momento si la
instalación trabaja en Pruebas o en Producción y comprobar qué le falta para poder emitir
(ERS AC-01). Los operadores necesitan ver el mismo aviso de ambiente y elegir desde dónde emiten
por defecto.

## What Changes

- El administrador registra y corrige los datos de la empresa: RUC, razón social, nombre comercial, dirección matriz, teléfono, correo y los atributos tributarios que declara él mismo, sin que el sistema los infiera: obligado a llevar contabilidad, número de contribuyente especial, número de resolución de agente de retención, gran contribuyente, categoría RIMPE y RUC proveedor (ERS RF-101, RF-103; CTX §5, §37.1).
- Formatos y longitudes conforme a los XSD oficiales vigentes del SRI, conservados en `docs/product/sri-xsd/` con su procedencia (ERS RF-104).
- Cada cambio de configuración tributaria crea una versión inmutable; la versión vigente es la que tomarán los comprobantes en su snapshot, y las anteriores se conservan como historial (ERS RF-105, CTX §39).
- Identidad tributaria bloqueada (`taxIdentityLocked`): mientras no esté bloqueada, el administrador puede corregir el RUC; una vez bloqueada, el RUC de esa empresa no cambia (Q-31). Este cambio define el estado y su invariante; la transición que lo activa la define `add-invoice-emission`.
- Logo de la empresa: cargar, reemplazar y eliminar, como asset inmutable referenciado por la versión de configuración (ERS RF-102, ADR 0017).
- Ambiente SRI `Pruebas` o `Producción`, en Pruebas por defecto. Solo un administrador lo cambia, con una acción explícita y separada de la edición de datos. Mientras el ambiente es Pruebas, todos los usuarios ven un aviso persistente (ERS RF-004, RF-005; CTX §6).
- Establecimientos y puntos de emisión con códigos de tres dígitos únicos en su ámbito e inmutables (ERS RF-110..112): un establecimiento se crea, corrige su dirección, se activa y se desactiva; un punto de emisión se crea, se activa y se desactiva, que es lo que significa editarlo en este cambio, porque ninguna fuente le da otros atributos.
- Cada usuario define su establecimiento y punto de emisión predeterminados, que solo se preseleccionan y no restringen desde dónde emite (ERS RF-113, Q-23).
- Preparación para emitir: el sistema muestra qué requisitos cumple la empresa y cuáles faltan. La firma electrónica figura como pendiente hasta que exista su cambio, de modo que ninguna empresa queda preparada para emitir con este cambio solo (ERS AC-01 parcial).
- Auditoría de cada cambio de datos tributarios, ambiente, logo, establecimientos y puntos de emisión, con valores anteriores y nuevos (ERS RF-003, RF-105, SEC-007).
- Permisos nuevos en el mapa central de acceso para estas operaciones (Q-22).
- Pantallas: `Empresa`, `Ambiente` y `Establecimientos` en `Configuración` para el administrador, aviso de ambiente en el shell, preparación para emitir en `Inicio` y punto predeterminado en `Mi cuenta`.

Fuera de alcance:

- Firma electrónica: carga, custodia y vigencia del certificado y su aviso de vencimiento (cambio `add-signing-certificate`, ERS RF-130..135).
- Secuenciales y su ajuste (cambio `add-fiscal-numbering`, Q-02).
- Catálogos fiscales (cambio `add-business-catalogs`).
- Emisión, snapshots de comprobantes y bloqueo efectivo de la emisión por falta de preparación; la transición que bloquea la identidad tributaria (cambio `add-invoice-emission`).
- Uso del logo en el RIDE (cambio `add-document-archive`).
- Cómo se traduce cada categoría RIMPE a la leyenda del XML y qué anexos especiales se soportan (Q-38, cambio `add-invoice-emission`).
- Si una instalación concreta debe declarar el RUC proveedor (Q-37, antes del go-live). El campo existe, vacío por defecto, y nunca se llena con un valor ficticio.
- Pantalla para consultar el historial de configuración o la auditoría.
- Eliminar establecimientos o puntos de emisión: solo se desactivan.
- Asignar puntos de emisión a usuarios o autorizar por punto (Q-23).
- Que un administrador defina los predeterminados de otro usuario.
- Multiempresa: crear empresas adicionales o cambiar de empresa activa (P2).

## Capabilities

### New Capabilities

- `taxpayer-setup`: datos y atributos tributarios de la empresa con versiones inmutables, identidad tributaria bloqueada, logo, ambiente SRI y su aviso, establecimientos, puntos de emisión, punto predeterminado por usuario y preparación para emitir.

### Modified Capabilities

- `audit-trail`: añade la auditoría de los cambios de configuración tributaria (datos de la empresa, ambiente, logo, establecimientos y puntos de emisión). Los requisitos existentes de atomicidad, ausencia de secretos, inmutabilidad y aislamiento no cambian y se aplican también a estos eventos.

## Impact

- Backend: módulo `taxpayer` nuevo con sus rutas bajo `/api/v1/` (ADR 0015), permisos nuevos en el mapa central de `identity`, acciones nuevas en el módulo `audit` y un puerto de assets de configuración (ADR 0017).
- Base de datos: tablas de configuración tributaria versionada, assets de configuración, establecimientos, puntos de emisión y predeterminados por membresía, con restricciones únicas, claves foráneas compuestas por empresa, protección de solo agregado y la invariante del RUC bloqueado. Sin cambios en las tablas de Better Auth.
- Frontend: tres destinos nuevos en `Configuración`, aviso de ambiente en el shell, preparación para emitir en `Inicio` y predeterminados en `Mi cuenta`.
- Configuración: límite de tamaño del logo, validado al arrancar.
- Documentación: `access-control.md`, `database.md`, `deployment.md`, `domain-model.md`, la contradicción entre CTX §5 y el XSD sobre el agente de retención en `open-questions.md`, y los XSD oficiales con su manifiesto en `docs/product/sri-xsd/`.
- Dependencias: requiere `add-user-access` archivado (empresa, membresía, autorización y auditoría). Habilita los cambios de secuenciales, firma y emisión.
