
# Original Project Requirements

This document is the original source material provided for the project.

It is preserved for traceability.

It is NOT the canonical behavioral specification of the implemented system.

Current implemented behavior is defined by `openspec/specs/`.

**ESPECIFICACIÓN DE REQUERIMIENTOS DE SOFTWARE**

Facturación Electrónica  
Ecuador · MVP Open Source

Documento de ingeniería de requerimientos para un facturador electrónico autoconfigurable, enfocado exclusivamente en emitir, almacenar y consultar los seis tipos de comprobantes electrónicos soportados por el SRI, con catálogos e inventario mínimo.

| **Campo**                  | **Definición**                                                                                 |
|----------------------------|------------------------------------------------------------------------------------------------|
| Versión                    | 1.0                                                                                            |
| Fecha de corte             | 1 de octubre de 2026                                                                           |
| Estado                     | Base de implementación del MVP                                                                 |
| Tipo de producto           | Aplicación open source / self-hosted                                                           |
| Jurisdicción               | Ecuador                                                                                        |
| Alcance fiscal             | Comprobantes electrónicos SRI – esquema off-line                                               |
| Referencia técnica vigente | Ficha Técnica de Comprobantes Electrónicos Esquema Off-line v2.34, actualizada a julio de 2026 |

| **Decisión de alcance.** Este proyecto NO es un ERP, POS completo ni sistema contable. Su objetivo es que un contribuyente configure sus datos una vez y pueda emitir correctamente los seis documentos electrónicos del SRI, conservarlos, consultarlos y exportar información básica. Todo requisito que no contribuya directamente a ese objetivo queda fuera del MVP. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# Contenido

> 1\. Resumen ejecutivo y visión del producto
>
> 2\. Objetivos, alcance y no objetivos
>
> 3\. Marco normativo y técnico de referencia
>
> 4\. Actores, perfiles y supuestos
>
> 5\. Arquitectura funcional del MVP
>
> 6\. Requerimientos funcionales transversales
>
> 7\. Configuración de empresa y emisión
>
> 8\. Requerimientos por tipo de comprobante
>
> 9\. Catálogos, inventario mínimo y terceros
>
> 10\. Gestión, consulta y archivo de documentos
>
> 11\. Reportes y exportación
>
> 12\. Reglas de secuenciales, estados e idempotencia
>
> 13\. Modelo de datos conceptual
>
> 14\. Requerimientos no funcionales
>
> 15\. Seguridad, firma y protección de datos
>
> 16\. Integración con SRI y resiliencia
>
> 17\. API y extensibilidad open source
>
> 18\. Criterios de aceptación y pruebas
>
> 19\. Matriz de trazabilidad del MVP
>
> 20\. Definition of Done y go-live
>
> 21\. Backlog excluido / post-MVP
>
> 22\. Fuentes oficiales y control de cambios normativos

# 1. Resumen ejecutivo y visión del producto

**Propósito.** Construir una aplicación open source, simple y autoconfigurable para contribuyentes ecuatorianos que necesiten emitir comprobantes electrónicos del SRI sin adoptar un ERP. El usuario configura su empresa, establecimientos, puntos de emisión, firma, secuenciales y catálogos; luego emite, consulta, descarga y reporta documentos.

| **Fuente oficial vigente.** El SRI reconoce seis documentos que pueden emitirse electrónicamente: factura, liquidación de compras de bienes y prestación de servicios, nota de crédito, nota de débito, comprobante de retención y guía de remisión. La página oficial consultada también indica que el software puede ser propio y que la emisión actual utiliza el esquema off-line. \[SRI-01\] |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 1.1 Visión

**“Configura tu contribuyente, emite los seis documentos electrónicos del SRI y conserva todo tu historial en una sola aplicación open source.”**

## 1.2 Propuesta de valor del MVP

- **Simplicidad:** el sistema debe poder configurarse y utilizarse sin conocimientos de ERP o contabilidad.

- **Cobertura documental:** soporte completo de los seis comprobantes electrónicos definidos para el MVP.

- **Control de datos:** el usuario conserva sus XML, RIDE, respuestas y base de datos en su propia instalación.

- **Trazabilidad:** cada documento debe tener historial de emisión, envío y autorización.

- **Exportabilidad:** los principales listados deben poder exportarse a Excel.

- **Extensibilidad:** arquitectura modular y API preparada para que otros proyectos integren el motor fiscal.

# 2. Objetivos, alcance y no objetivos

## 2.1 Objetivos del MVP

1.  Permitir configurar todos los datos tributarios y visuales necesarios de una empresa/contribuyente.

2.  Permitir administrar establecimientos y puntos de emisión.

3.  Permitir administrar secuenciales independientes por establecimiento, punto de emisión y tipo de documento.

4.  Permitir cargar y utilizar un certificado de firma electrónica de forma segura.

5.  Permitir emitir los seis tipos de comprobantes electrónicos contemplados en el alcance.

6.  Persistir documentos, XML, RIDE, respuestas SRI, estados y trazabilidad.

7.  Proporcionar catálogos mínimos de productos/servicios y personas.

8.  Proporcionar un inventario opcional y sencillo para facilitar la emisión de facturas.

9.  Proporcionar reportes operativos exportables a XLSX.

10. Ser instalable, auditable y extensible como proyecto open source.

## 2.2 Dentro del alcance

| **Área**              | **Incluido en MVP**                                                                               |
|-----------------------|---------------------------------------------------------------------------------------------------|
| Configuración         | Empresa, RUC, razón social, nombre comercial, dirección, logo, datos tributarios, email/teléfono. |
| Estructura de emisión | Establecimientos, puntos de emisión, secuenciales por tipo documental.                            |
| Firma                 | Carga de certificado, validación de vigencia, uso server-side.                                    |
| SRI                   | Ambientes pruebas/producción, generación XML, XSD, firma, recepción, autorización y reconsulta.   |
| Documentos            | Factura, NC, ND, retención, guía de remisión, liquidación de compra.                              |
| Terceros              | Clientes/proveedores en catálogo único.                                                           |
| Catálogo              | Productos y servicios.                                                                            |
| Inventario            | Stock opcional, entradas manuales, salidas por factura, ajustes e historial básico.               |
| Archivo               | XML firmado/autorizado, RIDE, respuesta SRI, hash y trazabilidad.                                 |
| Reportes              | Listados filtrables y exportables a Excel.                                                        |
| Usuarios              | Administrador y operador, con permisos básicos.                                                   |

## 2.3 Fuera de alcance

- Contabilidad general, plan de cuentas, asientos o estados financieros.

- POS completo, caja, arqueos, turnos, comisiones y formas de pago conciliadas.

- Compras, órdenes de compra, cuentas por pagar y cuentas por cobrar.

- ATS, declaraciones tributarias, RDEP u otros anexos.

- Nómina, roles de pago, talento humano.

- CRM, marketing, e-commerce, delivery o agenda.

- Multibodega avanzada, lotes, seriales, caducidad o producción.

- Restaurantes, comandas, mesas, cocina o recetas.

- Integración bancaria o conciliación.

- Gestión de anulación en línea como módulo administrativo completo; solo los flujos necesarios para documentos soportados y correcciones permitidas.

# 3. Marco normativo y técnico de referencia

El sistema deberá tratar la normativa y la ficha técnica del SRI como dependencias versionadas. El código no debe asumir que XSD, catálogos, reglas o endpoints permanecerán invariables.

| **ID** | **Referencia**                                                                                        | **Uso en requisitos**                                                                                                 |
|--------|-------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| SRI-01 | SRI – Facturación Electrónica (consulta 01-oct-2026).                                                 | Seis documentos; firma; software propio; ambientes pruebas/producción; esquema off-line; ficha técnica vigente v2.34. |
| SRI-02 | Ficha Técnica de Comprobantes Electrónicos Esquema Off-line v2.34 (julio 2026).                       | XML, clave de acceso, validaciones, recepción, autorización, mensajes y esquemas.                                     |
| SRI-03 | SRI – Facturador SRI / manual de usuario.                                                             | Benchmark funcional mínimo; menú de emisión de seis documentos y gestión de comprobantes.                             |
| SRI-04 | Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios, texto vigente aplicable. | Requisitos documentales, conservación y reglas generales.                                                             |
| INT-01 | Investigación integral POS SaaS + SRI Ecuador, corte 06-sep-2026.                                     | Riesgos técnicos: secuenciales, idempotencia, XSD, firma, estados, archivo y resiliencia.                             |

| **Control de cambios.** Antes de cada release que toque XML, XSD, catálogos o reglas de negocio, se debe comparar la versión oficial vigente del SRI y registrar fecha, fuente, impacto y pruebas realizadas. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 4. Actores, perfiles y supuestos

| **Actor**             | **Responsabilidad**                                                                                    |
|-----------------------|--------------------------------------------------------------------------------------------------------|
| Administrador         | Configura empresa, firma, establecimientos, puntos, secuenciales, usuarios y catálogos; accede a todo. |
| Operador              | Emite comprobantes, consulta documentos y usa catálogos según permisos.                                |
| SRI                   | Sistema externo que recibe y autoriza/no autoriza comprobantes.                                        |
| Receptor              | Cliente, proveedor, transportista u otro tercero relacionado con el comprobante.                       |
| Administrador técnico | Instala, actualiza, respalda y monitorea la instancia self-hosted.                                     |

## 4.1 Supuestos

- Cada instalación podrá soportar una empresa en el MVP; la arquitectura no debe impedir multiempresa futuro.

- El contribuyente dispone de RUC activo, firma electrónica vigente, acceso a internet y habilitación correspondiente ante el SRI.

- El sistema no determinará automáticamente las obligaciones tributarias del contribuyente.

- Los impuestos, códigos y configuraciones deben validarse contra catálogos y reglas SRI vigentes.

- Las credenciales y certificados pertenecen al contribuyente y deben permanecer bajo su control.

# 5. Arquitectura funcional del MVP

**Capas recomendadas**

| **Capa**           | **Responsabilidad**                                                      |
|--------------------|--------------------------------------------------------------------------|
| UI Web             | Configuración, emisión, consultas, catálogos y reportes.                 |
| Aplicación/Dominio | Reglas de negocio, estados, secuenciales, permisos, inventario mínimo.   |
| Motor fiscal       | Generación XML, clave de acceso, validaciones, XSD, firma, RIDE.         |
| Orquestador SRI    | Recepción, consulta de autorización, reintentos seguros, reconciliación. |
| Persistencia       | Base de datos + almacenamiento durable de artefactos.                    |
| Exportación        | Generación XLSX y descarga de información.                               |
| Observabilidad     | Logs redactados, métricas, eventos y auditoría.                          |

# 6. Requerimientos funcionales transversales

| **ID** | **Requerimiento**                                                                                                                           |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------|
| RF-001 | El sistema deberá permitir autenticación de usuarios locales.                                                                               |
| RF-002 | El sistema deberá soportar roles Administrador y Operador.                                                                                  |
| RF-003 | El sistema deberá registrar auditoría de cambios críticos: configuración tributaria, firma, secuenciales y documentos.                      |
| RF-004 | El sistema deberá distinguir de forma inequívoca los ambientes SRI de Pruebas y Producción.                                                 |
| RF-005 | El sistema deberá mostrar una advertencia persistente cuando esté configurado en ambiente de Pruebas.                                       |
| RF-006 | El sistema deberá validar datos obligatorios antes de permitir la firma/envío.                                                              |
| RF-007 | El sistema deberá utilizar aritmética decimal exacta para importes, bases, impuestos, descuentos y totales.                                 |
| RF-008 | El sistema deberá registrar fecha/hora y usuario creador de cada documento.                                                                 |
| RF-009 | El sistema deberá impedir edición destructiva de un documento una vez firmado; toda corrección deberá seguir el flujo documental permitido. |
| RF-010 | El sistema deberá permitir guardar borradores sin consumir el secuencial definitivo hasta el momento definido por la política de emisión.   |

# 7. Configuración de empresa y emisión

## 7.1 Empresa

| **ID** | **Requerimiento**                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| RF-101 | Registrar RUC, razón social, nombre comercial, dirección matriz, teléfono, correo y campos tributarios exigidos por el esquema vigente.                                           |
| RF-102 | Cargar, reemplazar y eliminar logo; usarlo en el RIDE sin incorporarlo al XML salvo que el esquema lo requiera.                                                                   |
| RF-103 | Registrar atributos tributarios aplicables (p. ej. obligado a llevar contabilidad, contribuyente especial/agente de retención cuando corresponda) sin inferirlos automáticamente. |
| RF-104 | Validar formatos y longitudes conforme a especificaciones oficiales.                                                                                                              |
| RF-105 | Guardar historial de cambios de configuración crítica.                                                                                                                            |

## 7.2 Establecimientos y puntos de emisión

| **ID** | **Requerimiento**                                                                            |
|--------|----------------------------------------------------------------------------------------------|
| RF-110 | Crear, editar, activar y desactivar establecimientos con código de tres dígitos y dirección. |
| RF-111 | Crear, editar, activar y desactivar puntos de emisión asociados a un establecimiento.        |
| RF-112 | Impedir duplicados de código dentro del mismo ámbito.                                        |
| RF-113 | Permitir definir un establecimiento y punto de emisión predeterminados por usuario.          |

## 7.3 Secuenciales

| **ID** | **Requerimiento**                                                                                      |
|--------|--------------------------------------------------------------------------------------------------------|
| RF-120 | Mantener un contador independiente por establecimiento + punto de emisión + tipo de documento.         |
| RF-121 | Permitir configurar el siguiente secuencial solo a administradores, dejando auditoría obligatoria.     |
| RF-122 | Reservar secuenciales de forma atómica y segura ante concurrencia.                                     |
| RF-123 | No reutilizar un secuencial ya reservado para un comprobante firmado/enviado.                          |
| RF-124 | Validar el formato de nueve dígitos y representar el número completo establecimiento-punto-secuencial. |
| RF-125 | Impedir retroceder el secuencial sin una operación administrativa explícita y auditable.               |

## 7.4 Firma electrónica

| **ID** | **Requerimiento**                                                                                                         |
|--------|---------------------------------------------------------------------------------------------------------------------------|
| RF-130 | Permitir cargar un certificado compatible con el esquema de firma requerido por el SRI.                                   |
| RF-131 | Solicitar la contraseña del certificado y almacenarla únicamente mediante un mecanismo cifrado/secret store configurable. |
| RF-132 | Nunca exponer archivo ni contraseña de firma al navegador después de su carga.                                            |
| RF-133 | Mostrar titular, emisor y fecha de expiración cuando puedan extraerse de forma segura.                                    |
| RF-134 | Bloquear emisión si el certificado está vencido o no puede firmar.                                                        |
| RF-135 | Generar alertas configurables antes del vencimiento.                                                                      |

# 8. Requerimientos por tipo de comprobante

| **Documento**            | **Código** | **Propósito**                                                                  | **Datos mínimos conceptuales**                                                                                                                |
|--------------------------|------------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Factura                  | 01         | Venta/transferencia de bienes o prestación de servicios.                       | Adquirente, fecha, establecimiento/punto, detalles, cantidades, precios, descuentos, impuestos, totales, pagos/campos requeridos por esquema. |
| Liquidación de compra    | 03         | Casos permitidos de liquidación de compra de bienes y prestación de servicios. | Proveedor, identificación, dirección, detalles, impuestos/retenciones aplicables según esquema.                                               |
| Nota de crédito          | 04         | Corrección/anulación permitida de un comprobante relacionado.                  | Documento modificado, motivo, fecha, valores y detalles exigidos.                                                                             |
| Nota de débito           | 05         | Cobros adicionales permitidos asociados a un comprobante.                      | Documento relacionado, motivos y valores.                                                                                                     |
| Guía de remisión         | 06         | Traslado de mercadería.                                                        | Direcciones, transportista, identificación, placa cuando aplique, fechas, destinatarios y detalle trasladado.                                 |
| Comprobante de retención | 07         | Registro de retenciones efectuadas.                                            | Sujeto retenido, periodo, documentos sustento, impuestos, códigos, bases, porcentajes y valores.                                              |

| **Nota de ingeniería.** La tabla anterior es conceptual. La implementación debe tomar como contrato definitivo los XSD, catálogos y validaciones de la versión oficial vigente; no debe codificar solo los campos descritos en este documento. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 8.1 Factura

| **ID** | **Requerimiento**                                                                                                                    |
|--------|--------------------------------------------------------------------------------------------------------------------------------------|
| RF-201 | Crear factura desde catálogo de cliente o consumidor final cuando legalmente proceda.                                                |
| RF-202 | Agregar una o más líneas desde catálogo de productos/servicios o mediante ingreso manual permitido.                                  |
| RF-203 | Calcular subtotal, descuentos, impuestos y total con precisión decimal.                                                              |
| RF-204 | Permitir formas de pago requeridas por el esquema vigente.                                                                           |
| RF-205 | Descontar stock solo para productos con control de inventario activado y únicamente al confirmar la emisión según política definida. |
| RF-206 | Evitar descontar stock dos veces durante reintentos o reconciliaciones.                                                              |

## 8.2 Nota de crédito

| **ID** | **Requerimiento**                                                                                                        |
|--------|--------------------------------------------------------------------------------------------------------------------------|
| RF-210 | Permitir iniciar una NC desde un documento existente para reducir errores de referencia.                                 |
| RF-211 | Exigir motivo y referencia al comprobante modificado cuando el esquema/regla vigente lo requiera.                        |
| RF-212 | Aplicar devolución de stock solo si el usuario indica que la corrección implica retorno físico y la política lo permite. |
| RF-213 | Validar restricciones legales vigentes antes de enviar; no asumir que toda factura puede recibir NC.                     |

## 8.3 Nota de débito

| **ID** | **Requerimiento**                                                  |
|--------|--------------------------------------------------------------------|
| RF-220 | Permitir referenciar el comprobante asociado.                      |
| RF-221 | Registrar motivos y valores de débito conforme al esquema vigente. |
| RF-222 | Validar totales y relación documental antes de firma.              |

## 8.4 Comprobante de retención

| **ID** | **Requerimiento**                                                                           |
|--------|---------------------------------------------------------------------------------------------|
| RF-230 | Permitir seleccionar/crear proveedor o sujeto retenido.                                     |
| RF-231 | Registrar periodo fiscal del comprobante.                                                   |
| RF-232 | Permitir uno o varios detalles de retención con impuesto, código, base, porcentaje y valor. |
| RF-233 | Permitir relacionar documentos sustento conforme al XSD vigente.                            |
| RF-234 | Validar códigos y porcentajes contra catálogos configurados/vigentes.                       |

## 8.5 Guía de remisión

| **ID** | **Requerimiento**                                                                                   |
|--------|-----------------------------------------------------------------------------------------------------|
| RF-240 | Registrar transportista, identificación y datos exigidos por la ficha técnica.                      |
| RF-241 | Registrar origen, destino y periodo/fechas de traslado.                                             |
| RF-242 | Registrar uno o varios destinatarios y detalles de bienes trasladados cuando el esquema lo permita. |
| RF-243 | Permitir asociar comprobantes de venta relacionados cuando corresponda.                             |

## 8.6 Liquidación de compra

| **ID** | **Requerimiento**                                                                                             |
|--------|---------------------------------------------------------------------------------------------------------------|
| RF-250 | Permitir crear liquidación solo con los campos y condiciones contempladas por el esquema y normativa vigente. |
| RF-251 | Permitir seleccionar/crear proveedor.                                                                         |
| RF-252 | Registrar detalles de bienes/servicios, impuestos y totales.                                                  |
| RF-253 | Mantener este flujo separado de la factura para evitar mezcla de reglas.                                      |

# 9. Catálogos, inventario mínimo y terceros

## 9.1 Productos y servicios

| **ID** | **Requerimiento**                                                                                                                                      |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| RF-301 | Crear producto o servicio con código principal, código auxiliar opcional, nombre, descripción, precio e impuestos.                                     |
| RF-302 | Permitir activar/desactivar control de stock por producto.                                                                                             |
| RF-303 | Permitir marcar ítems como producto o servicio.                                                                                                        |
| RF-304 | Permitir búsqueda por código, nombre y código auxiliar.                                                                                                |
| RF-305 | Permitir importación masiva desde XLSX/CSV en una versión posterior del MVP solo si no compromete el alcance base; en v1 puede aceptarse carga manual. |

## 9.2 Inventario mínimo

| **ID** | **Requerimiento**                                                                          |
|--------|--------------------------------------------------------------------------------------------|
| RF-310 | Mantener stock actual por producto controlado.                                             |
| RF-311 | Registrar movimiento INICIAL, ENTRADA_MANUAL, SALIDA_FACTURA, DEVOLUCION_NC y AJUSTE.      |
| RF-312 | Cada movimiento deberá referenciar documento/usuario/origen cuando exista.                 |
| RF-313 | No permitir borrar movimientos; las correcciones se registran como ajustes compensatorios. |
| RF-314 | Permitir consultar kardex básico por producto y rango de fechas.                           |
| RF-315 | No implementar costo promedio, valorización contable ni multibodega en el MVP.             |

## 9.3 Personas / terceros

| **ID** | **Requerimiento**                                                                                                        |
|--------|--------------------------------------------------------------------------------------------------------------------------|
| RF-320 | Mantener un catálogo único de personas/organizaciones reutilizable como cliente, proveedor, transportista u otros roles. |
| RF-321 | Registrar tipo y número de identificación, razón social/nombres, dirección, email y teléfono.                            |
| RF-322 | No rechazar un RUC únicamente por un algoritmo local no exigido por el SRI; validar formato/reglas oficiales vigentes.   |
| RF-323 | Permitir buscar por identificación o nombre.                                                                             |

# 10. Gestión, consulta y archivo de documentos

| **ID** | **Requerimiento**                                                                                         |
|--------|-----------------------------------------------------------------------------------------------------------|
| RF-401 | Proporcionar una bandeja única de documentos de los seis tipos.                                           |
| RF-402 | Filtrar por fecha, tipo, estado, identificación, número de documento, establecimiento y punto de emisión. |
| RF-403 | Mostrar estado fiscal visible y última respuesta relevante del SRI.                                       |
| RF-404 | Permitir descargar XML firmado y XML/autorización almacenada según formato disponible.                    |
| RF-405 | Generar y descargar RIDE PDF.                                                                             |
| RF-406 | Permitir reenviar RIDE/XML por correo si se implementa servicio de email.                                 |
| RF-407 | Conservar hash de artefactos importantes para detección de alteraciones.                                  |
| RF-408 | Conservar historial de intentos de transmisión y respuestas sin exponer secretos.                         |
| RF-409 | Evitar que la eliminación de un usuario elimine documentos históricos.                                    |

# 11. Reportes y exportación

| **Reporte**         | **Filtros mínimos**                          | **Columnas orientativas**                                                         |
|---------------------|----------------------------------------------|-----------------------------------------------------------------------------------|
| Documentos emitidos | Fecha, tipo, estado, establecimiento, punto. | Fecha, tipo, número, identificación, tercero, subtotal, impuestos, total, estado. |
| Facturas            | Fecha, cliente, estado.                      | Fecha, número, cliente, subtotal, IVA/otros, total.                               |
| Retenciones         | Fecha, proveedor, periodo.                   | Fecha, número, proveedor, impuesto, código, base, porcentaje, valor.              |
| Inventario          | Producto, fecha, movimiento.                 | Código, producto, stock actual / movimientos.                                     |
| Terceros            | Rol, identificación, estado.                 | Identificación, razón social, email, teléfono, rol.                               |

| **ID** | **Requerimiento**                                                                           |
|--------|---------------------------------------------------------------------------------------------|
| RF-501 | Todos los reportes deberán poder exportarse a XLSX.                                         |
| RF-502 | El XLSX deberá preservar números de identificación como texto para evitar pérdida de ceros. |
| RF-503 | Importes deberán exportarse como valores numéricos con formato monetario, no como texto.    |
| RF-504 | La exportación deberá respetar filtros aplicados.                                           |
| RF-505 | Los reportes no reemplazan obligaciones contables ni anexos tributarios.                    |

# 12. Reglas de secuenciales, estados e idempotencia

## 12.1 Estados mínimos

| **Estado**            | **Significado**                                                        |
|-----------------------|------------------------------------------------------------------------|
| DRAFT                 | Documento editable; aún no firmado.                                    |
| SEQUENCE_RESERVED     | Secuencial reservado de forma atómica.                                 |
| XML_BUILT             | XML generado.                                                          |
| XSD_VALID             | XML validado contra XSD aplicable.                                     |
| SIGNED                | XML firmado y almacenado.                                              |
| SEND_UNKNOWN          | Resultado de transmisión ambiguo; requiere reconciliación.             |
| RECEIVED              | Recepción aceptada por SRI; pendiente autorización.                    |
| PENDING_AUTHORIZATION | En consulta de autorización.                                           |
| AUTHORIZED            | Autorizado; estado terminal exitoso.                                   |
| RETURNED              | Devuelto por validaciones de recepción; corregible según mensaje.      |
| NOT_AUTHORIZED        | SRI devolvió resultado terminal no autorizado.                         |
| MANUAL_REVIEW         | Requiere intervención por inconsistencia o condición no automatizable. |

## 12.2 Idempotencia y concurrencia

| **ID** | **Requerimiento**                                                                                     |
|--------|-------------------------------------------------------------------------------------------------------|
| RF-520 | Cada operación de emisión deberá tener una idempotency key interna.                                   |
| RF-521 | Repetir una solicitud con la misma idempotency key no deberá crear un segundo comprobante.            |
| RF-522 | Un timeout de red no deberá generar automáticamente un nuevo secuencial ni nueva clave.               |
| RF-523 | Ante resultado ambiguo, el sistema deberá consultar/reconciliar por la misma clave antes de reenviar. |
| RF-524 | La transición de estados deberá estar validada por una máquina de estados.                            |
| RF-525 | Cada transición deberá registrarse con fecha, causa, actor y metadatos técnicos no sensibles.         |

# 13. Modelo de datos conceptual

| **Entidad**         | **Responsabilidad**                              |
|---------------------|--------------------------------------------------|
| company             | Datos generales y tributarios del contribuyente. |
| establishment       | Establecimiento SRI.                             |
| emission_point      | Punto de emisión asociado.                       |
| fiscal_sequence     | Contador por establecimiento+punto+tipo.         |
| certificate         | Metadatos y referencia segura a la firma.        |
| user / role         | Acceso y permisos.                               |
| party               | Cliente/proveedor/transportista reutilizable.    |
| product             | Producto/servicio e impuestos.                   |
| stock_movement      | Movimiento de inventario mínimo.                 |
| electronic_document | Cabecera común de los seis documentos.           |
| document_line       | Detalle de bienes/servicios cuando aplique.      |
| document_relation   | Relaciones entre documentos.                     |
| tax_detail          | Impuestos/retenciones detallados.                |
| sri_attempt         | Intento de recepción/autorización.               |
| artifact            | XML, RIDE y otros archivos con hash.             |
| audit_event         | Trazabilidad de acciones críticas.               |
| report_export       | Opcional: historial de exportaciones.            |

## 13.1 Restricciones de integridad

- UNIQUE(company, establishment_code).

- UNIQUE(establishment, emission_point_code).

- UNIQUE(emission_point, document_type, sequential).

- UNIQUE(access_key) cuando exista.

- UNIQUE(idempotency_key, company).

- Los artefactos de un documento no se borran en cascada por eliminar catálogos o usuarios.

- Todas las cantidades monetarias se almacenan en tipos decimales exactos.

# 14. Requerimientos no funcionales

| **ID**  | **Categoría**  | **Requerimiento**                                                                                                                       |
|---------|----------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| RNF-001 | Compatibilidad | Aplicación web moderna; backend desplegable en Linux mediante contenedores.                                                             |
| RNF-002 | Base de datos  | Motor relacional transaccional; PostgreSQL recomendado.                                                                                 |
| RNF-003 | Concurrencia   | Reserva de secuenciales segura en múltiples procesos/instancias.                                                                        |
| RNF-004 | Disponibilidad | La caída del SRI no debe inutilizar la consulta local ni causar duplicados.                                                             |
| RNF-005 | Rendimiento    | Pantallas de catálogo/documentos deben responder en \<2 s en el percentil 95 para volúmenes razonables de MVP, excluyendo latencia SRI. |
| RNF-006 | Trazabilidad   | 100% de emisiones y cambios críticos auditables.                                                                                        |
| RNF-007 | Recuperación   | Backups documentados y procedimiento de restauración probado.                                                                           |
| RNF-008 | Portabilidad   | Configuración por variables de entorno/secretos; sin dependencias exclusivas de un proveedor cloud.                                     |
| RNF-009 | Accesibilidad  | Navegación por teclado, etiquetas de formularios y contraste razonable.                                                                 |
| RNF-010 | Localización   | Idioma español y moneda USD por defecto; fechas en contexto Ecuador.                                                                    |
| RNF-011 | Mantenibilidad | Módulos fiscales desacoplados de UI y persistencia mediante interfaces claras.                                                          |
| RNF-012 | Observabilidad | Logs estructurados, métricas y health checks.                                                                                           |

# 15. Seguridad, firma y protección de datos

| **ID**  | **Requerimiento**                                                                                                |
|---------|------------------------------------------------------------------------------------------------------------------|
| SEC-001 | Contraseñas de usuarios almacenadas con hash robusto y salt.                                                     |
| SEC-002 | Certificado y contraseña de firma cifrados en reposo; preferencia por secret manager/KMS cuando esté disponible. |
| SEC-003 | Nunca registrar XML completo en logs de producción si contiene datos personales innecesarios; aplicar redacción. |
| SEC-004 | Nunca registrar contraseñas, secretos, tokens ni contenido del P12/PFX.                                          |
| SEC-005 | Aplicar control de acceso server-side a configuración, firma y secuenciales.                                     |
| SEC-006 | Proteger sesiones contra CSRF/XSS/SQL injection mediante prácticas estándar del framework.                       |
| SEC-007 | Registrar auditoría para cambios de firma, secuencial, ambiente SRI y datos tributarios.                         |
| SEC-008 | Permitir backup cifrado o documentar cómo implementarlo.                                                         |
| SEC-009 | Documentar ubicación de datos y responsabilidades para instalaciones self-hosted.                                |
| SEC-010 | Proporcionar mecanismo para exportar datos y artefactos del contribuyente.                                       |

# 16. Integración con SRI y resiliencia

| **ID**     | **Requerimiento**                                                                                                        |
|------------|--------------------------------------------------------------------------------------------------------------------------|
| SRI-REQ-01 | Usar endpoints configurables para ambiente de Pruebas y Producción; no codificar URLs en la lógica de negocio.           |
| SRI-REQ-02 | Generar XML conforme a la versión XSD aplicable al tipo documental.                                                      |
| SRI-REQ-03 | Validar XSD localmente antes de firmar/enviar; validación activada por defecto y sin opción de producción para omitirla. |
| SRI-REQ-04 | Firmar electrónicamente conforme al esquema requerido por SRI.                                                           |
| SRI-REQ-05 | Persistir XML firmado antes de llamar a la red.                                                                          |
| SRI-REQ-06 | Persistir la respuesta de recepción antes de consultar autorización.                                                     |
| SRI-REQ-07 | Implementar consulta asíncrona de autorización y reintentos con backoff.                                                 |
| SRI-REQ-08 | Ante timeout o error de red, no asumir rechazo.                                                                          |
| SRI-REQ-09 | Reconciliar por clave de acceso antes de cualquier reenvío que pueda duplicar efectos.                                   |
| SRI-REQ-10 | Mantener mensajes SRI normalizados y también la evidencia técnica necesaria.                                             |
| SRI-REQ-11 | Registrar versión de XSD/regla técnica usada para cada documento.                                                        |
| SRI-REQ-12 | Permitir actualizar catálogos/XSD sin migrar o alterar documentos históricos.                                            |

# 17. API y extensibilidad open source

La API no es un producto SaaS en el MVP, pero debe diseñarse para desacoplar la UI del motor fiscal y facilitar reutilización por terceros.

| **Endpoint conceptual**        | **Uso**                                |
|--------------------------------|----------------------------------------|
| POST /api/invoices             | Crear/emitir factura.                  |
| POST /api/credit-notes         | Crear/emitir nota de crédito.          |
| POST /api/debit-notes          | Crear/emitir nota de débito.           |
| POST /api/withholdings         | Crear/emitir comprobante de retención. |
| POST /api/shipping-guides      | Crear/emitir guía de remisión.         |
| POST /api/purchase-settlements | Crear/emitir liquidación de compra.    |
| GET /api/documents             | Consultar documentos.                  |
| GET /api/documents/{id}        | Detalle/estado/artefactos.             |
| GET /api/reports/...           | Reportes/exportación.                  |

| **ID**  | **Requerimiento**                                                                          |
|---------|--------------------------------------------------------------------------------------------|
| API-001 | Definir contratos de entrada/salida versionados.                                           |
| API-002 | Usar validación server-side independiente de la UI.                                        |
| API-003 | Soportar idempotency key en endpoints de emisión.                                          |
| API-004 | No exponer secretos de firma por API.                                                      |
| API-005 | Documentar la API con OpenAPI.                                                             |
| API-006 | Licencia open source y CONTRIBUTING.md deberán definir reglas de contribución y seguridad. |

# 18. Criterios de aceptación y pruebas

## 18.1 Pruebas obligatorias

- Unitarias para cálculos, redondeos, clave de acceso, validaciones y máquina de estados.

- Integración para persistencia, secuenciales atómicos e idempotencia.

- Contract tests de generación XML contra XSD oficial.

- Pruebas de firma con certificados controlados.

- Pruebas de integración SRI en ambiente de Pruebas para los seis tipos documentales.

- Pruebas de timeout, caída de red, respuesta ambigua, DEVUELTA y errores de autorización.

- Pruebas de concurrencia para demostrar ausencia de secuenciales duplicados.

- Pruebas de exportación XLSX.

- Pruebas de restauración de backup.

- Pruebas de seguridad básicas y escaneo de dependencias/secretos.

## 18.2 Criterios de aceptación por flujo

| **ID** | **Escenario**   | **Resultado esperado**                                                                |
|--------|-----------------|---------------------------------------------------------------------------------------|
| AC-01  | Empresa nueva   | Puede completar configuración mínima y validar que está lista para emitir.            |
| AC-02  | Factura prueba  | Genera XML válido, firma, envía, obtiene autorización y produce RIDE.                 |
| AC-03  | Seis documentos | Existe al menos un caso autorizado en ambiente de Pruebas para cada tipo.             |
| AC-04  | Concurrencia    | 100+ reservas concurrentes no producen secuenciales duplicados.                       |
| AC-05  | Idempotencia    | Repetir exactamente la misma petición no crea un segundo documento.                   |
| AC-06  | Timeout         | El sistema entra a SEND_UNKNOWN/PENDING y reconcilia sin nuevo secuencial.            |
| AC-07  | Histórico       | Documento autorizado puede descargarse posteriormente con XML/RIDE y trazabilidad.    |
| AC-08  | Inventario      | Factura de producto controlado genera una sola salida de stock; reintento no duplica. |
| AC-09  | Reporte         | Filtro mensual exporta XLSX con los mismos registros visibles.                        |
| AC-10  | Backup          | Una restauración recupera configuración, documentos y artefactos.                     |

# 19. Matriz de trazabilidad del MVP

| **Área**                | **Requisitos** | **Aceptación**       |
|-------------------------|----------------|----------------------|
| Configuración empresa   | RF-101..105    | AC-01                |
| Establecimientos/puntos | RF-110..113    | AC-01                |
| Secuenciales            | RF-120..125    | AC-04                |
| Firma                   | RF-130..135    | AC-02                |
| Factura                 | RF-201..206    | AC-02, AC-08         |
| NC                      | RF-210..213    | AC-03                |
| ND                      | RF-220..222    | AC-03                |
| Retención               | RF-230..234    | AC-03                |
| Guía                    | RF-240..243    | AC-03                |
| Liquidación             | RF-250..253    | AC-03                |
| Catálogo/inventario     | RF-301..315    | AC-08                |
| Terceros                | RF-320..323    | AC-02/03             |
| Archivo                 | RF-401..409    | AC-07                |
| Reportes                | RF-501..505    | AC-09                |
| Idempotencia/estados    | RF-520..525    | AC-05/06             |
| SRI                     | SRI-REQ-01..12 | AC-02/03/06          |
| API                     | API-001..006   | Pruebas de contrato  |
| Seguridad               | SEC-001..010   | Pruebas de seguridad |

# 20. Definition of Done y go-live

| **No negociables para v1.0.** El MVP se considera listo únicamente si cumple todos los puntos siguientes. |
|-----------------------------------------------------------------------------------------------------------|

- Los seis tipos documentales se generan y validan contra XSD oficial vigente.

- Existe evidencia de autorización de casos de prueba para los seis tipos en ambiente SRI de Pruebas.

- No existen secuenciales duplicados bajo pruebas de concurrencia.

- Idempotencia demostrada en emisión.

- Timeout no crea automáticamente un nuevo documento.

- XSD está activo y no puede deshabilitarse accidentalmente en producción.

- Dinero se calcula con decimal exacto.

- Firma y contraseña no aparecen en logs ni respuestas API.

- Documentos firmados y autorizados tienen archivo durable y hash.

- Se puede restaurar un backup completo.

- Los reportes XLSX principales funcionan.

- README de instalación, configuración, actualización y backup está completo.

- Existe SECURITY.md con canal para reportar vulnerabilidades.

- Existe CHANGELOG y se registra la versión de la ficha/XSD compatible.

# 21. Backlog excluido / post-MVP

| **Prioridad futura** | **Función**                              | **Motivo de exclusión actual**                                                  |
|----------------------|------------------------------------------|---------------------------------------------------------------------------------|
| P1                   | Importación masiva de productos/clientes | Útil, pero no necesaria para demostrar emisión completa.                        |
| P1                   | Email transaccional integrado            | Puede delegarse a SMTP; no debe bloquear MVP.                                   |
| P1                   | Anulación electrónica completa           | Requiere flujos/reglas adicionales y aceptación; separar del núcleo de emisión. |
| P2                   | Multiempresa                             | El MVP puede iniciar single-company, dejando arquitectura preparada.            |
| P2                   | API keys para terceros                   | Necesaria solo si el proyecto se usa como motor fiscal externo.                 |
| P2                   | Docker one-click / instalador            | Importante para adopción, no cambia requerimiento fiscal.                       |
| Fuera                | POS/caja                                 | No es objetivo del proyecto.                                                    |
| Fuera                | Contabilidad/ATS/declaraciones           | No es objetivo del proyecto.                                                    |
| Fuera                | Compras/cartera                          | No es objetivo del proyecto.                                                    |
| Fuera                | Verticales sectoriales                   | Aumentan complejidad y desvían el foco.                                         |

# 22. Fuentes oficiales y control de cambios normativos

**Fuentes consultadas al 1 de octubre de 2026**

**SRI-01 · Facturación Electrónica – Servicio de Rentas Internas:** [<u>https://www.sri.gob.ec/facturacion-electronica</u>](https://www.sri.gob.ec/facturacion-electronica)

**SRI-03 · Facturador SRI – Servicio de Rentas Internas:** [<u>https://www.sri.gob.ec/facturador-sri</u>](https://www.sri.gob.ec/facturador-sri)

**SRI-04 · Portal SRI – Reglamento y base legal enlazada desde Facturación Electrónica:** [<u>https://www.sri.gob.ec/facturacion-electronica</u>](https://www.sri.gob.ec/facturacion-electronica)

**Referencia técnica vigente localizada:** Ficha Técnica de Comprobantes Electrónicos Esquema Off-line, versión 2.34, actualizada a julio de 2026, enlazada por el SRI desde su página oficial de Facturación Electrónica.

## 22.1 Política de actualización normativa

11. Antes de cada release, verificar la página oficial de Facturación Electrónica del SRI.

12. Comparar la versión de ficha técnica, XSD, catálogos, endpoints y resoluciones relacionadas.

13. Registrar el cambio en CHANGELOG con fecha efectiva y fuente.

14. Crear pruebas de regresión para todo cambio que afecte XML, impuestos, campos o estados.

15. No modificar la representación histórica de documentos ya emitidos; conservar la versión técnica usada.

## 22.2 Registro de decisiones de arquitectura

| **ADR inicial** | **Decisión**                                                                   |
|-----------------|--------------------------------------------------------------------------------|
| ADR-001         | El sistema es un facturador electrónico, no un ERP.                            |
| ADR-002         | Los seis tipos documentales son flujos separados sobre un núcleo fiscal común. |
| ADR-003         | Secuencial = empresa + establecimiento + punto + tipo documental.              |
| ADR-004         | XML firmado se persiste antes de enviar al SRI.                                |
| ADR-005         | Timeout/resultado ambiguo se reconcilia con la misma clave.                    |
| ADR-006         | Inventario es opcional y mínimo.                                               |
| ADR-007         | API y motor fiscal se desacoplan de la interfaz web.                           |
| ADR-008         | XSD y reglas técnicas se versionan.                                            |

| **Cierre.** Este documento define el MVP. Cualquier nueva funcionalidad debe demostrar que es indispensable para configurar, emitir, conservar, consultar o exportar los seis comprobantes electrónicos. Si no cumple esa condición, se considera post-MVP o fuera de alcance. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
