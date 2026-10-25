# Product Overview

## Purpose

Facturador electrónico open source y self-hosted para contribuyentes ecuatorianos. El
contribuyente configura una vez su empresa, establecimientos, puntos de emisión, firma y
secuenciales; después emite los seis comprobantes electrónicos del SRI en el esquema
off-line, los conserva bajo su control, los consulta y exporta información básica a Excel.

> Configura tu contribuyente, emite los seis documentos electrónicos del SRI y conserva todo
> tu historial en una sola aplicación open source.

**Decisión de alcance.** No es un ERP, un POS ni un sistema contable (ADR 0001). Una
funcionalidad entra al producto solo si es indispensable para configurar, emitir, conservar,
consultar o exportar los seis comprobantes. Si no cumple esa condición, es post-MVP o queda
fuera de alcance.

## Users

| Actor                 | Tipo                       | Responsabilidad                                                                                  |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| Administrador         | Usuario, rol `ADMIN`       | Configura empresa, ambiente, firma, establecimientos, puntos, secuenciales, usuarios y catálogos. Resuelve los comprobantes en revisión manual. |
| Operador              | Usuario, rol `OPERATOR`    | Emite comprobantes, consulta la bandeja y usa los catálogos según sus permisos.                  |
| Administrador técnico | Persona fuera de la app    | Instala, actualiza, respalda, restaura y monitorea la instancia. Aplica las actualizaciones normativas. |
| SRI                   | Sistema externo            | Recibe los comprobantes y los autoriza o no.                                                     |
| Receptor              | Tercero, no usa la app     | Cliente, proveedor, transportista o sujeto retenido. Recibe el RIDE o el XML por descarga o impresión; el correo depende de Q-24. |

- Primary user: Operador, que emite a diario.
- Secondary user: Administrador, que configura y resuelve excepciones.
- Admin/operator: Administrador técnico de la instalación self-hosted.

## Problems Solved

- Emitir los seis comprobantes del SRI sin adoptar un ERP ni depender de un proveedor SaaS.
- Evitar secuenciales duplicados, comprobantes duplicados y documentos perdidos cuando fallan el SRI o la red.
- Conservar XML, RIDE y respuestas del SRI bajo control propio, con trazabilidad y detección de alteraciones.
- Obtener listados exportables a Excel sin un sistema contable.
- Reutilizar el motor fiscal desde otros proyectos mediante una API documentada.

## Core Workflows

1. Configuración inicial: el administrador registra la empresa, establecimientos, puntos, secuenciales y firma, elige el ambiente y el sistema confirma que está preparada para emitir (AC-01).
2. Emitir un comprobante: el operador prepara un borrador de cualquiera de los seis tipos y lo emite; el sistema valida, numera, genera, firma, envía y obtiene la autorización, y produce el RIDE (AC-02, AC-03).
3. Corregir mediante el flujo documental: desde un comprobante existente se inicia una nota de crédito o de débito; nunca se edita lo firmado (RF-009, RF-210).
4. Seguimiento fiscal: la bandeja muestra el estado y la última respuesta del SRI; el sistema reconcilia los resultados ambiguos y el administrador resuelve los que quedan en revisión manual (AC-06).
5. Consulta histórica: cualquier comprobante autorizado se descarga después con su XML, RIDE y trazabilidad (AC-07).
6. Inventario mínimo: entradas manuales, ajustes y kárdex de los productos con control de stock; las facturas descuentan existencias una sola vez (AC-08).
7. Reportes: listados filtrables exportados a XLSX con los mismos registros visibles (AC-09).
8. Operación de la instancia: instalación, actualización, respaldo, restauración y actualización normativa a cargo del administrador técnico (AC-10, ERS §22.1).

## Alcance del MVP

| Área                  | Incluido                                                                                   | Capacidad (`capabilities.md`)          |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| Configuración         | Empresa, RUC, razón social, nombre comercial, dirección, logo, datos tributarios, contacto. | `taxpayer-setup`                       |
| Estructura de emisión | Establecimientos, puntos de emisión, secuenciales por tipo de comprobante.                 | `taxpayer-setup`, `fiscal-numbering`   |
| Firma                 | Carga del certificado, validación de vigencia, uso solo en el servidor.                    | `signing-certificate`                  |
| SRI                   | Ambientes, XML, XSD, firma, recepción, autorización y reconciliación por clave. La consulta de validez para observar anulaciones es una capacidad futura (Q-16). | `document-emission`, `sri-transmission` |
| Comprobantes          | Factura, nota de crédito, nota de débito, retención, guía de remisión, liquidación de compra. | Una capacidad por tipo               |
| Terceros y catálogo   | Catálogo único de terceros; productos y servicios.                                         | `parties`, `products`, `fiscal-catalogs` |
| Inventario            | Stock opcional, entradas manuales, salidas por factura, ajustes, historial básico.         | `inventory`                            |
| Archivo y entrega     | XML firmado y autorizado, RIDE, respuestas del SRI, hash, trazabilidad y registro de entrega. | `document-archive`                  |
| Reportes              | Listados filtrables exportables a XLSX.                                                    | `reports`                              |
| Usuarios              | Administrador y Operador con permisos básicos.                                             | `user-access`                          |

## Non-Goals

Fuera de alcance (ERS §2.3 y §21):

- Contabilidad general, plan de cuentas, asientos o estados financieros.
- POS, caja, arqueos, turnos, comisiones y conciliación de pagos.
- Compras, órdenes de compra, cuentas por pagar y por cobrar.
- ATS, declaraciones, RDEP u otros anexos.
- Nómina, CRM, marketing, e-commerce, delivery, agenda y verticales sectoriales (restaurantes, comandas).
- Multibodega, lotes, seriales, caducidad, producción, costo promedio y valorización.
- Integración bancaria o conciliación.
- Anulación como módulo administrativo completo. El SRI no publica un Web Service de anulación y el sistema no lo inventa (CTX §36).
- Casos especiales de la ficha sin implementación probada: exportación, reembolsos, subsidios, rubros de terceros, factura sustitutiva de guía, factura comercial negociable, combustibles, máquina fiscal y demás anexos sectoriales. Se bloquean de forma explícita, no se aproximan (CTX §57, Q-38).
- Envío de comprobantes por lote (CTX §29).

Post-MVP, sin construir todavía:

| Prioridad | Función                                       |
| --------- | --------------------------------------------- |
| P1        | Importación masiva de productos y terceros.   |
| P1        | Correo transaccional integrado (RF-406).      |
| P1        | Anulación electrónica completa.               |
| P2        | Multiempresa.                                 |
| P2        | API keys para terceros.                       |
| P2        | Instalador o Docker de un solo paso.          |

## Supuestos

- Cada instalación atiende a una empresa en el MVP, sin que la arquitectura impida multiempresa.
- El contribuyente tiene RUC activo, firma electrónica vigente, acceso a internet y la habilitación del SRI.
- El sistema no determina las obligaciones tributarias del contribuyente.
- Impuestos, códigos y configuraciones se validan contra los catálogos y reglas vigentes del SRI.
- Credenciales y certificados pertenecen al contribuyente y permanecen bajo su control.

## Restricciones

- Jurisdicción Ecuador, esquema off-line. La referencia técnica al 2026-10-01 es la ficha técnica v2.34 (julio de 2026).
- XSD, catálogos, reglas y endpoints del SRI son dependencias versionadas: el código no asume que permanecen fijos (ERS §3, CTX §55, ADR 0008).
- El producto soporta los seis tipos base, no todos sus casos tributarios especiales; no se anuncia "soporte para todo Ecuador" (CTX §38.1).
- La firma sigue los parámetros de la ficha vigente (XAdES-BES, RSA-SHA1) aunque sean criptográficamente legados (CTX §20.1, ADR 0013).
- El servidor sincroniza su reloj por NTP: el SRI rechaza firmas con fecha posterior a su reloj (CTX §20.5).
- El go-live de v1 soporta solo el uso propio o el suministro no comercial de EmiteYa: en ese alcance el RUC del proveedor del sistema (Anexo 26) no aplica. Un despliegue en el que EmiteYa se vende, se licencia o se presta como sistema o servicio de pago necesita una clasificación nueva frente a la NAC-DGERCGC26-00000027 y hoy no está soportado: el producto no escribe ese campo (CTX §37, Q-37).
- Self-hosted en Linux mediante contenedores, configurado por variables de entorno, sin dependencias exclusivas de un proveedor cloud (RNF-001, RNF-008).
- Interfaz en español, moneda USD y fechas en la zona horaria de Ecuador (RNF-010).
- Proyecto open source bajo AGPL-3.0 (`LICENSE`, Q-33 resuelta el 2026-10-25), con `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` y `CHANGELOG.md`, obligatorios para v1.0 (API-006, ERS §20).
- Stack de CognitiveStack (`../architecture/stack.md`); las desviaciones requieren un ADR.

## Estado

No existe código de aplicación y `openspec/specs/` está vacío: ningún comportamiento está
implementado. El siguiente paso es resolver las preguntas bloqueantes de `open-questions.md`
y abrir el primer cambio OpenSpec de la secuencia de `capabilities.md`.

## Source Of Truth

Material de origen, conservado para trazabilidad y no editado:

| Cita  | Documento                                | Gobierna                                                         |
| ----- | ---------------------------------------- | ---------------------------------------------------------------- |
| `ERS` | `docs/product/project-requirements.md`   | Alcance, objetivos y requisitos del producto.                    |
| `CTX` | `docs/product/project-sri-integration.md` | Reglas técnicas del SRI y decisiones de integración.            |

Para cuestiones técnicas del SRI, las fuentes oficiales prevalecen sobre ambos en el orden de
CTX §1, y CTX prevalece sobre el ERS. Para el alcance del producto prevalece el ERS. Cada
contradicción entre ellos se registra en `open-questions.md` y no se resuelve en silencio.

Conocimiento derivado:

- Capacidades y secuencia de cambios: `docs/product/capabilities.md`
- Domain model: `docs/product/domain-model.md`
- Glossary: `docs/product/glossary.md`
- Preguntas abiertas: `docs/product/open-questions.md`
- Riesgos: `docs/product/risks.md`
- Current behavior: `openspec/specs/`
- Changes in progress: `openspec/changes/`
- Architecture: `ARCHITECTURE.md`
