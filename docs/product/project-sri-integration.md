# SPEC CONTEXT — Integración con SRI para Comprobantes Electrónicos de Ecuador

**Proyecto:** Facturador Electrónico Open Source Ecuador  
**Documento:** Contexto técnico de integración / fuente de verdad para implementación  
**Versión:** 1.0  
**Fecha de corte:** 1 de octubre de 2026  
**Jurisdicción:** Ecuador  
**Esquema SRI:** Comprobantes electrónicos — método de autorización *off-line*  
**Referencia técnica principal:** Ficha Técnica de Comprobantes Electrónicos Esquema Off-line v2.34, actualizada a julio de 2026  
**Alcance:** Factura, Liquidación de compra de bienes y prestación de servicios, Nota de crédito, Nota de débito, Guía de remisión y Comprobante de retención.

---

## 0. Propósito de este documento

Este documento existe para que un desarrollador —humano o asistido por IA— pueda implementar de manera consistente la integración del MVP con el Servicio de Rentas Internas (SRI) del Ecuador.

No reemplaza los XSD, WSDL, resoluciones ni la Ficha Técnica oficial. Su función es:

1. reunir en un solo contexto las reglas técnicas oficiales relevantes;
2. traducirlas a decisiones de arquitectura y contratos de código;
3. impedir que el equipo “invente” tags, estados, algoritmos o flujos;
4. definir qué fuente prevalece cuando exista una duda;
5. separar explícitamente las **reglas del SRI** de las **decisiones internas del proyecto**;
6. servir como documento de contexto para implementación, revisión de código, pruebas y mantenimiento normativo.

> **Regla principal:** el XSD oficial correspondiente a la versión del comprobante es la fuente canónica de la estructura XML. Este documento resume la integración, pero ningún ejemplo aquí autoriza a omitir la validación contra el XSD oficial.

---

# 1. Reglas de autoridad documental

Cuando dos fuentes parezcan contradecirse, el proyecto NO debe decidir silenciosamente cuál “parece correcta”.

Orden práctico para implementación:

1. **Norma vigente publicada en Registro Oficial**: obligaciones y efectos jurídicos.
2. **Resoluciones/circulares vigentes del SRI**: reglas operativas y tributarias.
3. **XSD oficial publicado por el SRI**: estructura exacta que debe aceptar el XML.
4. **Ficha Técnica vigente del SRI**: protocolo, catálogos, firma, Web Services, anexos y reglas técnicas.
5. **WSDL vigente expuesto por el SRI**: contrato técnico real del Web Service.
6. **Guías y preguntas frecuentes del SRI**: apoyo interpretativo/operativo.

## 1.1 Prohibiciones para quien implemente

No se debe:

- crear tags XML que no consten en el XSD oficial;
- cambiar el orden de nodos definido por el XSD;
- “mejorar” unilateralmente el algoritmo de firma exigido por el SRI;
- asignar una tarifa tributaria por inferencia sin un catálogo/regla vigente;
- generar un nuevo secuencial después de una respuesta ambigua del SRI;
- tratar un timeout como rechazo;
- marcar un comprobante como AUTORIZADO solo porque fue recibido;
- reenviar con nueva clave de acceso cuando la Ficha exige reutilizar la misma;
- validar todos los RUC con un único algoritmo local y rechazarlos si no pasan;
- almacenar dinero en `float`/`double` como fuente de verdad;
- hardcodear certificados SSL del SRI;
- asumir que una versión histórica de un XSD continúa siendo la adecuada para un caso nuevo;
- asumir que el portal de anulación del SRI equivale a un Web Service público de anulación.

---

# 2. Fuentes oficiales consultadas

## SRI-01 — Portal oficial de Facturación Electrónica

https://www.sri.gob.ec/facturacion-electronica

Contiene:

- esquema actual;
- Ficha Técnica vigente;
- paquetes XSD/XML de los seis documentos;
- guías;
- base legal;
- información de ambientes de pruebas y producción.

## SRI-02 — Ficha Técnica de Comprobantes Electrónicos Off-line v2.34

Actualizada a julio de 2026.

https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/f8d9bb36-5632-4f96-b463-b9265b55338c/FICHA%20TE%CC%81CNICA%20COMPROBANTES%20ELECTRO%CC%81NICOS%20ESQUEMA%20OFFLINE%20Versio%CC%81n%202.34.pdf

Esta es la referencia técnica principal de este documento.

## SRI-03 — Paquetes XSD/XML oficiales

Se descargan desde SRI-01. El SRI publica actualmente:

- Factura: 1.0.0, 1.1.0, 2.0.0, 2.1.0.
- Nota de crédito: 1.0.0, 1.1.0.
- Nota de débito: 1.0.0.
- Liquidación de compra: 1.0.0, 1.1.0.
- Guía de remisión: 1.0.0, 1.1.0.
- Comprobante de retención: 1.0.0, 2.0.0.
- Paquete adicional de XSD para notas de crédito/débito con devolución de IVA.

Los archivos XSD oficiales deben conservarse en el repositorio con versión, origen, fecha de descarga y hash.

## SRI-04 — Registro de proveedores de sistemas/servicios de facturación electrónica

Resolución NAC-DGERCGC26-00000027. Publicada en Quinto Suplemento del Registro Oficial No. 335, 28 de julio de 2026.

Registro Oficial:

https://www.registroficial.gob.ec/quinto-suplemento-no-335/

Información SRI:

https://www.sri.gob.ec/detalle-noticias?idnoticia=1318&marquesina=1

## SRI-05 — Anulación de comprobantes electrónicos

Resolución NAC-DGERCGC25-00000014:

https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar?id=137046a6-787c-47fb-a2d7-176595d292dc&nombre=NAC-DGERCGC25-00000014.pdf

Resolución reformatoria NAC-DGERCGC25-00000017:

https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar?id=e98fc8a6-299e-4ea9-8de7-2f6c70dbb4f5&nombre=NAC-DGERCGC25-00000017.pdf

## SRI-06 — Preguntas frecuentes de facturación electrónica

Debe consultarse siempre desde el portal SRI para trabajar con la versión publicada más reciente. Se considera fuente operativa complementaria, no sustituto del XSD/Ficha/Resolución.

---

# 3. Alcance documental oficial

Los códigos de documento usados por el SRI son:

| Documento | `codDoc` | Raíz XML | Versiones oficiales publicadas |
|---|---:|---|---|
| Factura | `01` | `factura` | 1.0.0, 1.1.0, 2.0.0, 2.1.0 |
| Liquidación de compra de bienes y prestación de servicios | `03` | `liquidacionCompra` | 1.0.0, 1.1.0 |
| Nota de crédito | `04` | `notaCredito` | 1.0.0, 1.1.0 |
| Nota de débito | `05` | `notaDebito` | 1.0.0 |
| Guía de remisión | `06` | `guiaRemision` | 1.0.0, 1.1.0 |
| Comprobante de retención | `07` | `comprobanteRetencion` | 1.0.0, 2.0.0 |

## 3.1 Decisión del MVP sobre versiones

**DECISIÓN DE PROYECTO, NO REGLA UNIVERSAL DEL SRI:**

Para operaciones ordinarias del MVP se propone iniciar con:

- Factura: `1.1.0`.
- Nota de crédito: `1.1.0`.
- Nota de débito: `1.0.0`.
- Guía de remisión: `1.1.0`.
- Liquidación de compra: `1.1.0`.
- Comprobante de retención: `2.0.0` (versión ATS).

La aplicación debe implementar un **registro de versiones** para no acoplar el dominio a una sola versión:

```ts
type SriDocumentType =
  | "01" // factura
  | "03" // liquidación
  | "04" // nota crédito
  | "05" // nota débito
  | "06" // guía remisión
  | "07"; // retención

interface SriSchemaVersion {
  documentType: SriDocumentType;
  version: string;
  xsdPath: string;
  sha256: string;
  downloadedAt: string;
  sourceUrl: string;
  activeFrom?: string;
  activeTo?: string;
  supportedByApp: boolean;
}
```

No seleccionar una versión solo porque sea numéricamente mayor. Algunas versiones de factura existen para escenarios especiales.

---

# 4. Arquitectura obligatoria de integración

El flujo común para los seis documentos debe ser:

```text
Datos de dominio
    ↓
Validación de negocio
    ↓
Reserva atómica de secuencial
    ↓
Generación de clave de acceso
    ↓
Construcción XML según versión
    ↓
Validación contra XSD oficial
    ↓
Firma XAdES-BES
    ↓
Persistencia del XML firmado + hash
    ↓
WS Recepción SRI
    ↓
RECIBIDA / DEVUELTA / respuesta ambigua
    ↓
Consulta asíncrona de autorización por clave
    ↓
AUTORIZADO / NO AUTORIZADO / EN PROCESAMIENTO
    ↓
Persistencia de XML autorizado + respuesta SRI
    ↓
RIDE + entrega + archivo
```

## 4.1 Principio de separación

El sistema debe separar:

```text
Dominio comercial
    ↓
Mapper fiscal
    ↓
Builder XML por documento/versión
    ↓
Validador XSD
    ↓
Firmador
    ↓
Cliente SOAP SRI
    ↓
Orquestador de estados
```

Nunca mezclar lógica de pantalla con SOAP ni XML con persistencia de ventas.

---

# 5. Configuración tributaria requerida por código

El motor fiscal necesita, como mínimo, una configuración persistente equivalente a:

```ts
interface TaxpayerConfig {
  ruc: string;                        // 13 dígitos
  legalName: string;                  // razón social
  tradeName?: string;                 // nombre comercial
  mainAddress: string;                // dirMatriz

  specialTaxpayerNumber?: string;     // cuando corresponda
  accountingRequired?: boolean;       // cuando corresponda
  withholdingAgent?: boolean;         // cuando corresponda
  largeTaxpayer?: boolean;            // cuando corresponda
  rimpeCategory?: "EMPRENDEDOR" | "NEGOCIO_POPULAR" | null;

  providerRuc?: string;               // cuando aplique Anexo 26

  environment: 1 | 2;                 // 1 pruebas, 2 producción
  emissionType: 1;                    // off-line = normal
}
```

Además:

```ts
interface Establishment {
  code: string;       // exactamente 3 dígitos
  address: string;
  active: boolean;
}

interface EmissionPoint {
  establishmentCode: string; // 3
  code: string;               // 3
  active: boolean;
}

interface FiscalSequence {
  establishmentCode: string;
  emissionPointCode: string;
  documentType: SriDocumentType;
  nextNumber: bigint;
}
```

La unicidad debe imponerse en base de datos:

```text
UNIQUE (
  taxpayer_id,
  environment,
  establishment_code,
  emission_point_code,
  document_type,
  sequential
)
```

---

# 6. Ambientes del SRI

| Ambiente | Código XML/clave | Validez tributaria |
|---|---:|---|
| Pruebas/Certificación | `1` | No |
| Producción | `2` | Sí, cuando el comprobante es autorizado |

El UI debe mostrar de forma inequívoca el ambiente.

No permitir que una instancia cambie accidentalmente de pruebas a producción durante la misma operación.

---

# 7. Web Services oficiales

## 7.1 Recepción y autorización — Pruebas

```text
https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl
https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl
```

## 7.2 Recepción y autorización — Producción

```text
https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl
https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl
```

## 7.3 Consulta de validez — Pruebas

```text
https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl
https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaFactura?wsdl
```

## 7.4 Consulta de validez — Producción

```text
https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl
https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaFactura?wsdl
```

## 7.5 Regla de configuración

No hardcodear certificados TLS del SRI ni fingerprints.

Las URL pueden tener defaults en configuración, pero deben residir en un módulo central versionado:

```ts
interface SriEndpoints {
  receptionWsdl: string;
  authorizationWsdl: string;
  documentQueryWsdl: string;
  invoiceQueryWsdl: string;
}
```

La Ficha Técnica advierte que los certificados digitales SSL del SRI pueden cambiar.

---

# 8. Clave de acceso — 49 dígitos

La clave de acceso se construye con 48 dígitos de datos + 1 dígito verificador módulo 11.

## 8.1 Estructura

| Posición lógica | Campo | Longitud |
|---|---|---:|
| 1 | Fecha de emisión `ddmmaaaa` | 8 |
| 2 | Tipo de comprobante | 2 |
| 3 | RUC emisor | 13 |
| 4 | Ambiente | 1 |
| 5 | Serie = establecimiento + punto emisión | 6 |
| 6 | Secuencial | 9 |
| 7 | Código numérico | 8 |
| 8 | Tipo de emisión | 1 |
| 9 | Dígito verificador módulo 11 | 1 |
| | **Total** | **49** |

Ejemplo conceptual:

```text
DDMMAAAA
+ COD_DOC
+ RUC
+ AMBIENTE
+ ESTAB(3)
+ PTO_EMI(3)
+ SECUENCIAL(9)
+ CODIGO_NUMERICO(8)
+ TIPO_EMISION(1)
= 48 dígitos

DV = modulo11(48_digitos)

CLAVE = 48_digitos + DV
```

## 8.2 Reglas

- El secuencial siempre se representa con 9 dígitos, completando con ceros a la izquierda.
- Establecimiento y punto de emisión tienen 3 dígitos cada uno.
- El `codigoNumerico` tiene 8 dígitos y su generación corresponde al emisor.
- En esquema off-line el tipo de emisión es `1`.
- El valor de `claveAcceso` debe coincidir con los datos internos del XML.
- La clave debe ser única para el documento.
- En esquema off-line la clave de acceso se convierte en el número de autorización cuando el SRI autoriza.

## 8.3 Módulo 11

Implementación de referencia:

```ts
export function sriModulo11(first48Digits: string): number {
  if (!/^\d{48}$/.test(first48Digits)) {
    throw new Error("La base de la clave debe tener exactamente 48 dígitos");
  }

  let factor = 2;
  let sum = 0;

  for (let i = first48Digits.length - 1; i >= 0; i--) {
    sum += Number(first48Digits[i]) * factor;
    factor++;
    if (factor > 7) factor = 2;
  }

  const result = 11 - (sum % 11);

  if (result === 11) return 0;
  if (result === 10) return 1;
  return result;
}
```

Pruebas obligatorias:

- vector oficial de la Ficha;
- longitud incorrecta;
- caracteres no numéricos;
- cambio de un solo dígito;
- secuenciales 1, 9, 10, 999999999.

## 8.4 Código numérico

No debe depender de `Math.random()` como único mecanismo si existe riesgo de colisión.

Puede derivarse de una fuente aleatoria criptográfica o de una estrategia interna reproducible, siempre preservando 8 dígitos y la unicidad global de la clave.

**La unicidad real no debe depender solo del código numérico:** la base de datos debe imponer restricciones de secuenciales y clave.

---

# 9. Identificaciones

Códigos publicados por el SRI:

| Tipo | Código |
|---|---:|
| RUC | `04` |
| Cédula | `05` |
| Pasaporte | `06` |
| Venta a consumidor final | `07` |
| Identificación del exterior | `08` |

Consumidor final:

```text
tipoIdentificacionComprador = 07
identificacionComprador = 9999999999999
```

## 9.1 Restricciones importantes

- Liquidación de compra: no permite consumidor final.
- Nota de crédito, nota de débito y comprobante de retención: el receptor/sujeto debe identificarse con el tipo que corresponda.
- No implementar un único “algoritmo de RUC” como regla de rechazo universal. El propio SRI advierte que existen RUC para los que no hay un algoritmo específico exigido a los establecimientos.
- La validación local debe centrarse en tipo, longitud/formato cuando el XSD lo exija y reglas expresamente oficiales.

---

# 10. XML — reglas transversales

## 10.1 Codificación

```xml
<?xml version="1.0" encoding="UTF-8"?>
```

El SRI define UTF-8.

## 10.2 Identificador del comprobante

La raíz debe incluir:

```xml
id="comprobante"
```

y la versión exacta del XSD utilizado.

## 10.3 Orden

XML no debe construirse serializando un objeto arbitrario sin preservar el orden.

El builder debe generar los elementos exactamente en el orden exigido por el XSD.

## 10.4 Escapado

Como mínimo:

```text
&  -> &amp;
<  -> &lt;
>  -> &gt;
"  -> &quot;   cuando aplique en atributo
'  -> &apos;   cuando aplique en atributo
```

La propia Ficha advierte expresamente sobre `&`.

## 10.5 Fechas

La mayoría de fechas documentales del XML utilizan:

```text
dd/mm/aaaa
```

La clave utiliza:

```text
ddmmaaaa
```

No reutilizar el mismo formatter.

## 10.6 Decimales

Utilizar tipo decimal exacto, por ejemplo:

```ts
type Money = Decimal;
type Quantity = Decimal;
type Rate = Decimal;
```

No:

```ts
number // como fuente de verdad para dinero
```

La Ficha indica diferencias de precisión según versión; la 1.0.0 trabaja típicamente con dos decimales y la 1.1.0 permite hasta seis en determinados campos.

La cantidad de decimales final debe obedecer **al XSD del campo concreto**, no a una regla genérica de la aplicación.

## 10.7 Cálculos

El sistema debe verificar invariantes antes de construir el XML:

```text
sum(detalle.precioTotalSinImpuesto)
≈ totalSinImpuestos

sum(totalImpuesto.valor)
+ totalSinImpuestos
- descuentos
+ propina
... = importeTotal
```

La igualdad y tolerancia deben definirse conforme al esquema/campo y política decimal, nunca con comparación de `float`.

## 10.8 Información adicional

La sección `infoAdicional` es condicional y no debe utilizarse para inventar campos estructurados que ya tengan tag oficial.

Cada `campoAdicional` debe respetar nombre/longitud definidos cuando una norma/anexo lo exige.

---

# 11. Nodo común `infoTributaria`

Los seis documentos comparten conceptualmente información tributaria equivalente a:

```text
ambiente
tipoEmision
razonSocial
nombreComercial        [cuando corresponda]
ruc
claveAcceso
codDoc
estab
ptoEmi
secuencial
dirMatriz
```

El builder debe recibir un snapshot inmutable:

```ts
interface SriTaxInfoSnapshot {
  ambiente: 1 | 2;
  tipoEmision: 1;
  razonSocial: string;
  nombreComercial?: string;
  ruc: string;
  claveAcceso: string;
  codDoc: SriDocumentType;
  estab: string;
  ptoEmi: string;
  secuencial: string;
  dirMatriz: string;
}
```

Nunca generar el XML leyendo datos de empresa “en vivo” después de reservar el documento. Si el usuario cambia la dirección mañana, un documento de ayer debe conservar exactamente los datos con los que se emitió.

---

# 12. Factura — `codDoc=01`

## 12.1 Raíz

Para la versión ordinaria propuesta:

```xml
<factura id="comprobante" version="1.1.0">
```

## 12.2 Bloques funcionales

```text
factura
├── infoTributaria
├── infoFactura
├── detalles
│   └── detalle[]
│       ├── datos del ítem
│       ├── detallesAdicionales? 
│       └── impuestos
├── reembolsos?            [si aplica y versión/regla lo admite]
└── infoAdicional?
```

## 12.3 Datos clave de `infoFactura`

Según versión/caso, incluye entre otros:

- fecha de emisión;
- dirección del establecimiento cuando corresponda;
- contribuyente especial cuando corresponda;
- obligado a llevar contabilidad cuando corresponda;
- tipo de identificación del comprador;
- razón social/nombres del comprador;
- identificación;
- totales sin impuestos;
- descuentos;
- total con impuestos;
- propina;
- importe total;
- moneda;
- pagos;
- otros campos condicionados por anexos.

## 12.4 Detalle

Conceptualmente:

```ts
interface InvoiceLine {
  mainCode?: string;
  auxiliaryCode?: string;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  discount: Decimal;
  netAmount: Decimal;
  taxes: SriLineTax[];
}
```

No asumir que `codigoPrincipal` siempre es obligatorio para todos los casos: validar contra XSD y regla de versión.

## 12.5 Impuestos

Códigos generales de impuesto de la Ficha:

| Impuesto | Código |
|---|---:|
| IVA | `2` |
| ICE | `3` |
| IRBPNR | `5` |

Catálogo de porcentajes de IVA publicado en la Ficha incluye códigos para 0%, 12%, 14%, 15%, 5% y otros casos según vigencia.

**Regla de arquitectura:** guardar el catálogo por vigencia. No hacer:

```ts
const IVA = 15;
```

Hacer:

```ts
interface TaxRateRule {
  taxCode: string;
  percentageCode: string;
  rate: Decimal;
  validFrom: string;
  validTo?: string;
  source: string;
}
```

## 12.6 Formas de pago

Catálogo de la Ficha Técnica:

| Forma | Código |
|---|---:|
| Sin utilización del sistema financiero | `01` |
| Compensación de deudas | `15` |
| Tarjeta de débito | `16` |
| Dinero electrónico | `17` |
| Tarjeta prepago | `18` |
| Tarjeta de crédito | `19` |
| Otros con utilización del sistema financiero | `20` |
| Endoso de títulos | `21` |

No mapear “transferencia” por texto libre. El dominio debe elegir el código SRI que corresponda según el catálogo vigente.

## 12.7 Versiones 2.0.0 / 2.1.0

Están asociadas a estructuras especiales publicadas por el SRI, incluyendo rubros de terceros y factura sustitutiva de guía de remisión.

**MVP:** no habilitarlas accidentalmente para factura ordinaria. Deben activarse únicamente cuando el caso especial haya sido implementado y probado.

---

# 13. Nota de crédito — `codDoc=04`

## 13.1 Raíz

```xml
<notaCredito id="comprobante" version="1.1.0">
```

## 13.2 Propósito técnico

La nota de crédito se liga a un documento modificado.

Debe existir una relación explícita en el modelo:

```ts
interface CreditNoteReference {
  modifiedDocumentType: string;
  modifiedDocumentNumber: string;
  modifiedDocumentIssueDate: string;
  reason: string;
  modificationValue: Decimal;
}
```

## 13.3 Bloques funcionales

```text
notaCredito
├── infoTributaria
├── infoNotaCredito
├── detalles
│   └── detalle[]
└── infoAdicional?
```

## 13.4 Validaciones

- receptor identificado;
- documento sustento existente cuando la lógica del caso lo requiera;
- número completo del documento modificado;
- fecha del documento sustento;
- motivo;
- monto;
- impuestos coherentes con el documento sustento y las reglas aplicables;
- tarifa de IVA vinculada a la fecha/documento sustento cuando así corresponda.

## 13.5 Consumidor final

No usar una nota de crédito como mecanismo genérico para “corregir cualquier factura”.

Las reglas de anulación/notas de crédito vigentes desde 2025/2026 contienen restricciones específicas, incluyendo tratamiento especial de comprobantes emitidos como consumidor final. El módulo debe aplicar las reglas normativas vigentes y no permitir una corrección fiscal que la norma prohíba.

---

# 14. Nota de débito — `codDoc=05`

## 14.1 Raíz

```xml
<notaDebito id="comprobante" version="1.0.0">
```

## 14.2 Bloques funcionales

```text
notaDebito
├── infoTributaria
├── infoNotaDebito
├── motivos
│   └── motivo[]
└── infoAdicional?
```

## 14.3 Datos centrales

`infoNotaDebito` contiene, según XSD/regla:

- fecha de emisión;
- establecimiento;
- datos tributarios condicionales;
- comprador identificado;
- referencia al comprobante modificado;
- impuestos/totales;
- pagos cuando corresponda.

`motivos` contiene la razón y el valor.

Ejemplo de modelo:

```ts
interface DebitReason {
  reason: string;
  value: Decimal;
}
```

La tarifa de IVA debe observar la regla vinculada al documento de sustento.

---

# 15. Guía de remisión — `codDoc=06`

## 15.1 Raíz

```xml
<guiaRemision id="comprobante" version="1.1.0">
```

## 15.2 Bloques conceptuales

```text
guiaRemision
├── infoTributaria
├── infoGuiaRemision
├── destinatarios
│   └── destinatario[]
│       └── detalles
│           └── detalle[]
└── infoAdicional?
```

## 15.3 Datos operativos

La estructura contempla información como:

- dirección del establecimiento;
- dirección de partida;
- identificación/nombre del transportista;
- fechas de inicio y fin de transporte;
- placa;
- destinatarios;
- motivo de traslado;
- dirección de destino;
- documento sustento cuando corresponda;
- detalle de bienes transportados.

Modelo conceptual:

```ts
interface Shipment {
  carrier: PartySnapshot;
  departureAddress: string;
  transportStartDate: string;
  transportEndDate: string;
  vehiclePlate: string;
  destinations: ShipmentDestination[];
}
```

## 15.4 Validación temporal

La Ficha contempla error cuando la fecha de inicio de transporte es menor que la fecha de emisión de la guía.

Validar localmente antes de firmar.

---

# 16. Comprobante de retención — `codDoc=07`

## 16.1 Versión propuesta

```xml
<comprobanteRetencion id="comprobante" version="2.0.0">
```

La versión 2.0.0 integra información asociada al módulo de compras del ATS.

## 16.2 Bloques conceptuales

```text
comprobanteRetencion
├── infoTributaria
├── infoCompRetencion
├── docsSustento
│   └── docSustento[]
│       ├── impuestosDocSustento
│       ├── retenciones
│       └── pagos? / reembolsos? según caso
└── infoAdicional?
```

## 16.3 `infoCompRetencion`

Contiene, entre otros:

- fecha de emisión;
- dirección de establecimiento cuando corresponda;
- contribuyente especial cuando corresponda;
- obligado a llevar contabilidad cuando corresponda;
- tipo de identificación del sujeto retenido;
- razón social;
- identificación;
- período fiscal.

## 16.4 Catálogo de impuesto retenido

| Impuesto | Código |
|---|---:|
| Renta | `1` |
| IVA | `2` |
| ISD | `6` |

Los **códigos de retención y porcentajes cambian con normativa**.

No crear enums inmutables en código fuente que requieran un deploy cada vez que el SRI actualice porcentajes.

Diseño:

```ts
interface WithholdingRule {
  taxType: "RENTA" | "IVA" | "ISD";
  sriTaxCode: string;
  sriRetentionCode: string;
  percentage: Decimal;
  validFrom: string;
  validTo?: string;
  legalSource: string;
  enabled: boolean;
}
```

## 16.5 Retención de IVA

La Ficha vigente incluye, entre otros, porcentajes/códigos como 10%, 20%, 30%, 50%, 70%, 100% y casos 0%, pero la aplicación debe consumir su catálogo versionado, no asumir que la tabla nunca cambia.

## 16.6 Documento sustento

La retención debe relacionarse con su documento sustento. El dominio debe almacenar una referencia estructurada, no un campo de texto libre.

---

# 17. Liquidación de compra — `codDoc=03`

## 17.1 Raíz

```xml
<liquidacionCompra id="comprobante" version="1.1.0">
```

## 17.2 Bloques conceptuales

```text
liquidacionCompra
├── infoTributaria
├── infoLiquidacionCompra
├── detalles
│   └── detalle[]
├── reembolsos?       [cuando corresponda]
└── infoAdicional?
```

## 17.3 Datos clave

Incluye:

- fecha de emisión;
- establecimiento;
- datos tributarios condicionales;
- tipo de identificación del proveedor;
- razón social/nombres del proveedor;
- identificación;
- dirección del proveedor;
- totales;
- impuestos;
- forma(s) de pago;
- detalle de bienes/servicios.

## 17.4 Regla crítica

No se habilita el tipo de identificación consumidor final para liquidaciones de compra.

---

# 18. Catálogos tributarios

No mezclar:

```text
catálogo de UI
```

con:

```text
catálogo fiscal SRI
```

El segundo requiere:

- código;
- descripción;
- vigencia;
- fuente;
- versión de Ficha/Resolución;
- fecha de última revisión.

Modelo:

```ts
interface SriCatalogEntry {
  catalog: string;
  code: string;
  description: string;
  validFrom?: string;
  validTo?: string;
  sourceDocument: string;
  sourceVersion?: string;
}
```

Catálogos mínimos del MVP:

- tipos de documento;
- ambiente;
- tipo de emisión;
- tipos de identificación;
- impuestos;
- códigos porcentaje IVA;
- formas de pago;
- impuestos a retener;
- códigos de retención;
- tipos/códigos de documentos sustento requeridos por retención;
- códigos adicionales que exija cada XSD/anexo implementado.

---

# 19. Validación XSD

## 19.1 Debe ocurrir antes de firmar

```text
build XML
   ↓
validate XSD
   ↓
SIGN
```

No:

```text
build
   ↓
sign
   ↓
enviar
   ↓
esperar que SRI encuentre el error
```

## 19.2 Fail closed

Si:

- no existe XSD;
- hash no coincide;
- versión no está registrada;
- XML no valida;

el documento NO se envía.

## 19.3 Registro de XSD

Ejemplo de manifest:

```json
{
  "documentType": "01",
  "root": "factura",
  "version": "1.1.0",
  "file": "schemas/factura/1.1.0/factura.xsd",
  "sha256": "...",
  "source": "SRI",
  "downloadedAt": "2026-10-01"
}
```

## 19.4 Pruebas XSD

Cada builder debe tener:

- caso mínimo válido;
- caso completo válido;
- campo obligatorio faltante;
- campo fuera de orden;
- longitud inválida;
- decimal inválido;
- fecha inválida;
- catálogo inválido;
- caracteres escapados;
- XML mayor al límite.

---

# 20. Firma electrónica XAdES-BES

La Ficha vigente exige:

| Parámetro | Valor |
|---|---|
| Estándar | XAdES-BES |
| Esquema | 1.3.2 |
| Codificación | UTF-8 |
| Tipo | ENVELOPED |
| Certificado en `KeyInfo` | Sí |
| Certificado | X.509 codificado en Base64 |
| Firma indicada por la Ficha | RSA-SHA1 |
| Longitud de clave indicada | 2048 bits |
| Contenedor típico | PKCS#12 `.p12` |

## 20.1 Importante sobre RSA-SHA1

RSA-SHA1 es un algoritmo legado desde la perspectiva criptográfica moderna, pero continúa expresamente documentado en la Ficha Técnica v2.34 del SRI.

**Regla del proyecto:** no sustituirlo unilateralmente por SHA-256 solo porque sea más moderno. La compatibilidad con el SRI manda. El módulo de firma debe estar aislado para poder migrar cuando el SRI cambie formalmente la especificación.

## 20.2 Nodos cubiertos

La Ficha indica cobertura de:

- comprobante;
- `SignedProperties`;
- `KeyInfo`.

## 20.3 Interfaz del firmador

```ts
interface XmlSigner {
  sign(input: {
    unsignedXml: Uint8Array;
    certificatePkcs12: Uint8Array;
    password: SecretString;
    signingTime: Date;
  }): Promise<Uint8Array>;
}
```

## 20.4 Seguridad

Nunca:

- enviar `.p12` al navegador para firmar en frontend;
- guardar contraseña en texto plano;
- escribir contraseña/certificado en logs;
- incluir el `.p12` en backups no cifrados;
- devolver secretos por API;
- permitir descarga del certificado por usuario sin autorización específica.

## 20.5 Tiempo

La FAQ técnica del SRI advierte sobre firma con fecha posterior al reloj del SRI.

El servidor debe sincronizar tiempo mediante NTP.

Monitorear desviación de reloj.

## 20.6 Validaciones previas

Antes de firmar:

- certificado puede abrirse;
- tiene clave privada;
- está vigente;
- identidad/RUC corresponde cuando aplique;
- `notBefore <= now <= notAfter`;
- cadena puede procesarse;
- XML ya validó XSD.

---

# 21. Persistencia antes de la red

Antes de llamar al SRI, almacenar:

```text
document_id
document_type
schema_version
environment
establishment
emission_point
sequential
access_key
unsigned_xml_hash
signed_xml
signed_xml_hash
created_at
state = SIGNED
```

Esto es fundamental.

Si el proceso muere después de enviar pero antes de guardar la respuesta, debe ser posible reconstruir la verdad consultando **la misma clave**.

---

# 22. WS de recepción

Método documentado:

```java
validarComprobante(byte[] xml)
```

El `xml` enviado debe estar firmado.

## 22.1 Resultado `RECIBIDA`

Significa que el SRI recibió el comprobante para procesamiento.

NO significa autorizado.

Transición:

```text
SIGNED
  ↓
SENT
  ↓
RECEIVED
  ↓
PENDING_AUTHORIZATION
```

## 22.2 Resultado `DEVUELTA`

El SRI devuelve mensajes con información como:

```ts
interface SriMessage {
  identifier?: string;
  message?: string;
  additionalInformation?: string;
  type?: string;
}
```

Persistir el arreglo completo.

No guardar únicamente el primer error.

## 22.3 Respuesta ambigua

Si ocurre:

- timeout;
- socket reset;
- proxy error;
- proceso cae;
- respuesta SOAP no puede parsearse después del envío;

NO concluir:

```text
DEVUELTA
```

Estado interno:

```text
SEND_UNKNOWN
```

Acción:

```text
consultar por la MISMA clave
```

antes de cualquier reenvío.

---

# 23. WS de autorización

Método documentado:

```java
autorizacionComprobante(String claveAccesoComprobante)
```

La respuesta de autorización puede contener:

- clave consultada;
- número de comprobantes;
- estado;
- número de autorización;
- fecha de autorización;
- ambiente;
- comprobante/XML;
- mensajes.

En el esquema off-line, el número de autorización corresponde a la clave de acceso cuando se autoriza.

## 23.1 Flujo asíncrono

La propia Ficha dispone que después de `RECIBIDA` debe esperarse un tiempo antes de consultar autorización, y recomienda que ese intervalo sea parametrizable.

No implementar:

```ts
send();
await sleep(1500);
queryOnce();
if (!authorized) reject();
```

Implementar:

```ts
while (!terminal && withinPolicyWindow) {
  await scheduleNextPoll(backoff);
  response = await queryAuthorization(accessKey);
  persist(response);
}
```

Estados SRI descritos por la Ficha:

- PPR — en procesamiento.
- AUT — autorizado.
- NAT — no autorizado.

El SRI señala un tiempo máximo de procesamiento de hasta 24 horas desde `RECIBIDA`.

---

# 24. WS de consulta de validez

La Ficha v2.31+ incorpora:

```java
consultarEstadoAutorizacionComprobante(String claveAcceso)
```

Estados que puede devolver `estadoAutorizacion`:

```text
AUTORIZADO
NO AUTORIZADO
PENDIENTE DE ANULAR
ANULADO
```

Puede responder consulta rechazada/error 99 si:

- la clave está fuera del rango de fechas permitido por el servicio;
- no existen datos para los parámetros.

## 24.1 Uso en el MVP

Utilizar este WS para:

- reconciliación;
- confirmar un estado dudoso;
- detectar anulación posterior;
- auditoría operativa;
- recuperación después de fallas.

No debe reemplazar el almacenamiento local del XML/respuesta original.

---

# 25. Consulta de factura comercial negociable

La Ficha vigente también publica un servicio para consultar el estado de confirmación de Factura Comercial Negociable mediante el WS `ConsultaFactura`.

El MVP no necesita implementar factura negociable si está fuera de alcance, pero el cliente SOAP debe diseñarse sin asumir que `ConsultaFactura` es el mismo contrato que `ConsultaComprobante`.

---

# 26. Máquina de estados recomendada

**DECISIÓN DE ARQUITECTURA DEL PROYECTO.**

```text
DRAFT
  ↓
SEQUENCE_RESERVED
  ↓
XML_BUILT
  ↓
XSD_VALID
  ↓
SIGNED
  ↓
SEND_PENDING
  ├──────────────→ SEND_UNKNOWN
  │                    │
  │                    └── consulta por clave
  ↓
RECEIVED
  ↓
PENDING_AUTHORIZATION
  ├──────────────→ AUTHORIZED
  ├──────────────→ NOT_AUTHORIZED
  └──────────────→ MANUAL_REVIEW

XSD_INVALID
RETURNED
CANCEL_PENDING
CANCELLED
```

## 26.1 Estados terminales

Para una emisión concreta:

- `AUTHORIZED`;
- `NOT_AUTHORIZED` solo cuando el SRI realmente lo determina;
- `RETURNED` cuando recepción la devuelve por inconsistencia;
- `CANCELLED` como estado posterior de un comprobante previamente autorizado.

`SEND_UNKNOWN` nunca es terminal.

---

# 27. Reintentos e idempotencia

## 27.1 Regla crítica

El SRI indica que un comprobante rechazado por inconsistencias puede corregirse y reenviarse con **la misma clave y secuencial**.

No crear otro secuencial automáticamente.

## 27.2 Error 70 — clave en procesamiento

La Ficha establece que, ante error 70:

- no reenviar el comprobante;
- no generar otra clave;
- no generar otro secuencial;
- esperar respuesta de autorización/rechazo;
- el proceso puede tomar hasta 24 horas.

Implementación:

```ts
if (sriError.code === "70") {
  document.state = "PENDING_AUTHORIZATION";
  disableResend(document.id);
  scheduleAuthorizationQuery(document.accessKey);
}
```

## 27.3 Clave registrada / secuencial registrado

Errores documentados:

- 43: clave de acceso registrada;
- 45: secuencial registrado.

No resolver generando ciegamente un nuevo comprobante.

Para clave registrada:

1. consultar estado por clave;
2. reconciliar con la base local;
3. escalar si existe inconsistencia.

Para secuencial registrado:

1. bloquear reuso;
2. comprobar si corresponde a un documento ya enviado;
3. nunca hacer “rollback” de contador para reutilizar secuencial.

## 27.4 Idempotency key del API local

Cada operación de emisión debe aceptar:

```text
Idempotency-Key
```

o un equivalente de dominio.

Restricción:

```text
UNIQUE(tenant/taxpayer, idempotency_key)
```

La misma operación repetida debe devolver el mismo `document_id`, no emitir otro secuencial.

---

# 28. Secuenciales

Reserva transaccional:

```sql
BEGIN;

SELECT next_number
FROM fiscal_sequence
WHERE taxpayer_id = ?
  AND establishment = ?
  AND emission_point = ?
  AND document_type = ?
FOR UPDATE;

-- reservar
UPDATE fiscal_sequence
SET next_number = next_number + 1
...;

INSERT INTO sequence_reservation (...);

COMMIT;
```

En bases que lo soporten, puede utilizarse una secuencia/contador atómico equivalente.

## 28.1 Regla

Un secuencial reservado para un comprobante que llegó a emisión fiscal no debe “devolverse al pool”.

La aplicación no debe depender de secuenciales perfectamente continuos para garantizar integridad; debe depender de unicidad y trazabilidad.

---

# 29. Límites del servicio

Ficha v2.34:

- envío individual: máximo 320 KB por comprobante;
- lote: máximo 500 KB o aproximadamente 50 comprobantes.

**DECISIÓN MVP:** usar envío individual. No implementar lote inicialmente.

Validación:

```ts
if (signedXml.byteLength > MAX_SRI_INDIVIDUAL_BYTES) {
  throw new FiscalValidationError("XML excede límite SRI");
}
```

Configurar el límite desde un catálogo técnico versionado, no disperso por el código.

---

# 30. RIDE

El RIDE es la representación impresa del documento electrónico.

El sistema debe generar el RIDE **desde el snapshot/documento autorizado**, no reconstruirlo leyendo datos actuales de empresa/productos.

Debe poder mostrar, según el tipo y las reglas vigentes:

- información del emisor;
- información del receptor/destinatario/sujeto;
- número del comprobante;
- clave/número de autorización;
- fechas;
- detalle;
- impuestos/totales;
- información adicional obligatoria;
- leyendas tributarias que correspondan;
- marca de ambiente de pruebas cuando aplique.

El XML autorizado continúa siendo el artefacto electrónico central. El RIDE no debe usarse como reemplazo del XML archivado.

---

# 31. Archivo probatorio

Por cada documento conservar:

```ts
interface FiscalArtifactSet {
  normalizedPayload: unknown;
  schemaVersion: string;

  unsignedXml?: Uint8Array;
  signedXml: Uint8Array;
  authorizedXml?: Uint8Array;

  signedXmlSha256: string;
  authorizedXmlSha256?: string;

  receptionRaw?: string;
  authorizationRaw?: string;

  ridePdf?: Uint8Array;

  accessKey: string;
  authorizationNumber?: string;
  authorizationDate?: string;

  messages: SriMessage[];
}
```

Recomendaciones de arquitectura:

- object storage cifrado;
- metadatos en base;
- hash SHA-256;
- backups;
- restauración probada;
- no depender del SRI como sistema de backup.

La retención documental debe ajustarse a la obligación legal vigente; el proyecto de requerimientos ha contemplado conservación probatoria de largo plazo.

---

# 32. Códigos de errores

La Ficha Técnica contiene una tabla oficial de errores y advertencias.

El sistema debe:

1. guardar `identificador`;
2. guardar mensaje;
3. guardar `informacionAdicional`;
4. guardar tipo;
5. guardar fase (`RECEPCION`, `AUTORIZACION`, etc.);
6. conservar códigos desconocidos.

Ejemplos relevantes:

| Código | Significado resumido | Tratamiento |
|---:|---|---|
| 35 | Documento inválido / estructura | corregir XML/XSD; misma clave cuando corresponda |
| 39 | Firma inválida | revisar firma/certificado |
| 40 | Error de certificado X509 | revisar PKCS12/certificado |
| 43 | Clave de acceso registrada | consultar por clave |
| 45 | Secuencial registrado | reconciliar; no reutilizar |
| 58 | Estructura de clave inconsistente | corregir datos/clave |
| 65 | Fecha de emisión extemporánea | revisión funcional |
| 67 | Fecha inválida | corregir |
| 70 | Clave en procesamiento | NO reenviar; consultar/esperar |
| 80 | Error en parámetro de clave | corregir consulta |
| 82 | Error fecha inicio transporte | corregir guía |
| 99 | Error de consulta | revisar rango/no existencia según respuesta |

No convertir toda respuesta de error en una excepción genérica `SRI_ERROR`.

Definir:

```ts
class SriTransportError extends Error {}
class SriReceptionReturnedError extends Error {}
class SriAuthorizationError extends Error {}
class SriValidationError extends Error {}
class SriQueryError extends Error {}
```

pero siempre adjuntar el payload oficial original.

---

# 33. Timeouts, backoff y circuit breaker

**DECISIÓN DE ARQUITECTURA.**

Un timeout es un estado de conocimiento, no una decisión fiscal.

Política sugerida:

```text
connect timeout: corto
request timeout: controlado
retry de consulta: sí
retry ciego de envío: no
circuit breaker: sí
backoff + jitter: sí
reconciliación programada: sí
```

Pseudo:

```ts
try {
  const reception = await sri.receive(signedXml);

  if (reception.status === "RECIBIDA") {
    markReceived();
    enqueueAuthorizationPoll(accessKey);
  } else {
    markReturned(reception.messages);
  }
} catch (e) {
  markSendUnknown(e);
  enqueueReconciliation(accessKey);
}
```

---

# 34. Worker de autorización

```ts
async function processAuthorization(documentId: string) {
  const doc = await repo.lock(documentId);

  if (doc.isTerminal()) return;

  const response = await sri.authorization(doc.accessKey);

  await repo.saveRawResponse(documentId, response.raw);

  switch (normalizeSriAuthorization(response)) {
    case "AUTHORIZED":
      await markAuthorized(doc, response);
      await enqueueRide(doc.id);
      await enqueueDelivery(doc.id);
      return;

    case "NOT_AUTHORIZED":
      await markNotAuthorized(doc, response.messages);
      return;

    case "PROCESSING":
      await scheduleNextPoll(doc.id);
      return;

    default:
      await markManualReview(doc.id, response);
  }
}
```

No asumir que la ausencia de un bloque esperado equivale a “NO AUTORIZADO”.

---

# 35. Factura a consumidor final

La Ficha vigente refleja la identificación:

```text
07
9999999999999
```

y las reglas vigentes limitan los casos en los que se puede omitir identificación.

El proyecto debe parametrizar/validar el monto máximo vigente con fuente normativa, no esconderlo en el frontend.

```ts
interface ConsumerFinalPolicy {
  maxAmount: Decimal;
  validFrom: string;
  source: string;
}
```

La investigación oficial vigente al corte identifica USD 50 como umbral general aplicable al consumidor final. Debe revisarse al actualizar normativa.

Además, las reglas vigentes desde 2026 restringen la anulación/nota de crédito de facturas transmitidas con consumidor final. La UI debe advertir antes de confirmar la emisión.

---

# 36. Anulación

La anulación no debe confundirse con:

- nota de crédito;
- devolución comercial;
- reverso interno;
- eliminación de registro.

## 36.1 Estado fiscal

Un documento autorizado nunca se borra.

Puede evolucionar:

```text
AUTHORIZED
  ↓
CANCEL_PENDING
  ↓
CANCELLED
```

## 36.2 Integración pública

La documentación oficial consultada publica el proceso de anulación mediante SRI en Línea/funcionalidades del SRI y el WS de **consulta** permite observar `PENDIENTE DE ANULAR` y `ANULADO`.

Este contexto NO identifica un Web Service público oficial equivalente a:

```text
anularComprobante(...)
```

Por tanto, el MVP no debe inventarlo.

Puede:

- enlazar/instruir el proceso oficial;
- permitir registrar solicitud;
- consultar/reconciliar estado después mediante `ConsultaComprobante`.

## 36.3 Plazos y reglas

La Resolución 25-14 reformada por 25-17 debe revisarse para cada versión del producto. Entre los cambios vigentes se modificó el plazo de anulación al día 7 del mes siguiente en los supuestos contemplados, además de reglas de aceptación y restricciones específicas.

No hardcodear la lógica completa en un único `if`; crear política versionada.

---

# 37. Proveedor de sistema de facturación — Anexo 26

Desde la Resolución NAC-DGERCGC26-00000027 existe un régimen de registro de proveedores de sistemas informáticos o servicios de facturación electrónica.

Cuando el contribuyente utilice un sistema de un tercero y la obligación sea aplicable, la Ficha v2.34 dispone incluir en `infoAdicional`:

```xml
<campoAdicional nombre="RUC Proveedor">RUC_DEL_PROVEEDOR</campoAdicional>
```

Características documentadas:

- nodo: `infoAdicional`;
- tag: `campoAdicional`;
- atributo `nombre`: `RUC Proveedor`;
- contenido: número de RUC del proveedor;
- máximo general del campo: 300 caracteres.

## 37.1 Open source / self-hosted

Este proyecto es open source. Que una instalación concreta tenga o no un “proveedor tercero” depende de la forma real en que se distribuya, opere o preste el servicio.

El código debe soportar:

```ts
providerRuc?: string
```

pero no llenar un RUC ficticio.

## 37.2 Inconsistencia documental a vigilar

La comunicación pública del SRI del 28 de julio de 2026 menciona **60 días hábiles** para la incorporación por emisores que usan sistemas provistos por terceros.

La Ficha Técnica v2.34, Anexo 26, expresa **60 días calendario**.

No resolver esta diferencia por inferencia. La resolución publicada en Registro Oficial y la interpretación vigente deben verificarse antes de go-live.

El soporte técnico del campo debe existir independientemente del cómputo del plazo.

---

# 38. Anexos especiales de la Ficha v2.34

La Ficha no solo define los seis XML “base”. Incluye anexos para casos especiales.

| Anexo | Tema |
|---:|---|
| 1 | XML versión 1.0.0 |
| 2 | RIDE |
| 3 | XML versión 1.1.0 |
| 4 | Factura exportación |
| 5 | Factura reembolso |
| 6 | Factura con subsidios |
| 7 | RIDE con subsidio |
| 8 | Factura con rubros de terceros 2.0/2.1 |
| 9 | Factura sustitutiva de guía 2.0/2.1 |
| 10 | Retención ATS 2.0.0 |
| 11 | Factura Comercial Negociable |
| 12 | Combustibles |
| 13 | Máquina fiscal |
| 14 | Ejemplo XAdES-BES |
| 15 | Compatibilidad dispositivos |
| 16 | Combustibles — requisitos de llenado |
| 17 | Liquidación 1.0/1.1 |
| 18 | Fundas plásticas |
| 19 | Autorretenciones |
| 20 | Devolución automática IVA |
| 21 | Agentes de retención |
| 22 | RIMPE |
| 23 | Materiales de construcción |
| 24 | Grandes contribuyentes |
| 25 | Transporte comercial |
| 26 | RUC proveedor de sistema/servicio |

## 38.1 Regla del MVP

No afirmar “soporte para todo Ecuador” si estos casos no están implementados.

Para cada anexo:

```ts
type FeatureSupport =
  | "SUPPORTED"
  | "BLOCKED"
  | "NOT_APPLICABLE"
  | "UNDER_REVIEW";
```

Si un caso fiscal especial es conocido pero no soportado, **fallar explícitamente** con un mensaje funcional antes de emitir.

Ejemplo:

```text
"Esta operación requiere el esquema de factura de exportación,
que todavía no está soportado por esta versión."
```

Es preferible bloquear que emitir un XML tributariamente incorrecto.

---

# 39. Política de snapshots fiscales

Cada comprobante autorizado debe contener su propia fotografía de:

- emisor;
- establecimiento;
- receptor;
- productos/descripciones;
- impuestos;
- reglas;
- versión de XSD;
- versión del builder;
- versión del renderer RIDE;
- catálogos usados.

Modelo:

```ts
interface FiscalSnapshotMetadata {
  schemaVersion: string;
  builderVersion: string;
  taxCatalogVersion: string;
  taxpayerConfigVersion: string;
  createdAt: string;
}
```

Nunca recalcular documentos históricos usando tarifas/configuración actual.

---

# 40. API interna recomendada

El API del proyecto puede exponer:

```text
POST /api/fiscal/invoices
POST /api/fiscal/purchase-settlements
POST /api/fiscal/credit-notes
POST /api/fiscal/debit-notes
POST /api/fiscal/shipping-guides
POST /api/fiscal/withholdings

GET  /api/fiscal/documents/:id
GET  /api/fiscal/documents/:id/xml
GET  /api/fiscal/documents/:id/ride
POST /api/fiscal/documents/:id/reconcile
POST /api/fiscal/documents/:id/resend        [solo si política lo permite]
```

No exponer una operación genérica:

```text
POST /api/send-any-xml
```

sin validaciones de dominio, XSD, firma y pertenencia del contribuyente.

---

# 41. Contrato común de emisión

```ts
interface EmitCommand<TPayload> {
  taxpayerId: string;
  establishmentCode: string;
  emissionPointCode: string;
  payload: TPayload;
  idempotencyKey: string;
}

interface EmitResult {
  documentId: string;
  accessKey: string;
  sequential: string;
  state: FiscalDocumentState;
}
```

El POST de emisión no tiene por qué esperar a que el SRI llegue a estado final.

Respuesta recomendada:

```json
{
  "documentId": "...",
  "accessKey": "...",
  "sequential": "000000123",
  "state": "PENDING_AUTHORIZATION"
}
```

y permitir seguimiento.

---

# 42. Estructura de clases/módulos sugerida

```text
fiscal/
├── domain/
│   ├── documents/
│   ├── money/
│   ├── sequences/
│   ├── catalogs/
│   ├── states/
│   └── policies/
│
├── xml/
│   ├── schemas/
│   ├── invoice/
│   ├── credit-note/
│   ├── debit-note/
│   ├── shipping-guide/
│   ├── withholding/
│   └── purchase-settlement/
│
├── signature/
│   ├── xades-bes-signer
│   └── certificate-store
│
├── sri/
│   ├── reception-client
│   ├── authorization-client
│   ├── query-client
│   ├── soap-parser
│   ├── error-mapper
│   └── endpoints
│
├── orchestration/
│   ├── emit-service
│   ├── authorization-worker
│   └── reconciliation-worker
│
├── ride/
├── persistence/
└── tests/
```

---

# 43. Interfaces de integración

```ts
interface SriReceptionClient {
  receive(signedXml: Uint8Array): Promise<SriReceptionResponse>;
}

interface SriAuthorizationClient {
  getByAccessKey(accessKey: string): Promise<SriAuthorizationResponse>;
}

interface SriDocumentQueryClient {
  getAuthorizationState(accessKey: string): Promise<SriDocumentQueryResponse>;
}

interface XsdValidator {
  validate(xml: Uint8Array, schema: SriSchemaVersion): Promise<XsdValidationResult>;
}
```

Esto permite cambiar librería SOAP/firma sin cambiar dominio.

---

# 44. Normalización de respuestas

SOAP es transporte. El dominio no debe depender de objetos generados por una librería concreta.

Adaptar:

```ts
interface SriReceptionResponse {
  state: "RECIBIDA" | "DEVUELTA" | "UNKNOWN";
  messages: SriMessage[];
  raw: string;
}

interface SriAuthorizationResponse {
  accessKey?: string;
  status: "AUTORIZADO" | "NO_AUTORIZADO" | "EN_PROCESAMIENTO" | "UNKNOWN";
  authorizationNumber?: string;
  authorizationDate?: string;
  environment?: string;
  authorizedDocumentXml?: string;
  messages: SriMessage[];
  raw: string;
}
```

Persistir `raw` además de la forma normalizada.

---

# 45. XML autorizado

Cuando el WS de autorización entrega el comprobante autorizado:

1. guardar la respuesta SOAP original;
2. extraer el contenido del comprobante;
3. guardar el XML autorizado;
4. calcular hash;
5. guardar número/fecha autorización;
6. marcar `AUTHORIZED`;
7. generar RIDE;
8. habilitar descarga/entrega.

No reconstruir un “XML autorizado” localmente añadiendo campos imaginarios.

---

# 46. Entrega al receptor

La Ficha contempla la entrega/notificación al receptor una vez autorizado y el uso de correo electrónico dentro del esquema operativo.

El MVP debe registrar al menos:

```ts
interface DeliveryAttempt {
  documentId: string;
  channel: "EMAIL" | "DOWNLOAD" | "PRINT";
  recipient?: string;
  status: "PENDING" | "DELIVERED" | "FAILED";
  attemptedAt?: string;
  error?: string;
}
```

La falla de correo NO cambia un comprobante autorizado a no autorizado.

---

# 47. Seguridad de logs

Nunca loggear en producción:

- contraseña del P12;
- P12;
- claves privadas;
- XML SOAP completo sin redacción si contiene PII;
- emails/teléfonos sin necesidad;
- tokens/sesiones.

Sí registrar:

```text
document_id
access_key
document_type
environment
transition
SRI status
SRI error identifier
duration
attempt
correlation_id
```

La clave de acceso no es una contraseña, pero sigue siendo dato fiscal y debe tratarse con control de acceso.

---

# 48. Observabilidad mínima

Métricas:

```text
sri_reception_requests_total
sri_reception_returned_total
sri_authorization_authorized_total
sri_authorization_not_authorized_total
sri_authorization_pending_total
sri_transport_errors_total
sri_error_70_total
sri_error_43_total
sri_error_45_total
sri_request_duration
fiscal_documents_pending_age
certificate_days_to_expiry
```

Alertar:

- documentos `RECIBIDA` sin resolución demasiado tiempo;
- backlog alto;
- aumento de DEVUELTA;
- firma por vencer;
- fallo general de WSDL/SRI;
- errores de aislamiento/datos.

---

# 49. Pruebas de ambiente de certificación

El SRI dispone ambiente de pruebas/certificación para comprobar el funcionamiento del sistema.

Los documentos allí no tienen validez tributaria.

Antes de producción, probar los seis documentos implementados.

Matriz mínima:

| Documento | Happy path | XSD inválido | Firma inválida | DEVUELTA | AUTORIZADO | NAT | timeout/reconciliación |
|---|---:|---:|---:|---:|---:|---:|---:|
| Factura | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| NC | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ND | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Guía | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Retención | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Liquidación | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

El ambiente de pruebas no debe usarse para stress testing.

---

# 50. Golden files

Mantener fixtures reales anonimizados/propios:

```text
tests/golden/
├── invoice/
│   ├── minimal-valid.xml
│   ├── complete-valid.xml
│   └── expected-signed.xml
├── credit-note/
├── debit-note/
├── shipping-guide/
├── withholding/
└── purchase-settlement/
```

No depender de snapshots frágiles que cambian por IDs aleatorios de firma. Normalizar únicamente las partes legítimamente variables.

---

# 51. Pruebas de propiedades

Especialmente:

## Clave

```text
len(clave) == 49
all digits
DV válido
misma entrada -> misma clave si codigoNumerico fijo
```

## Secuencias

Con 100 procesos concurrentes:

```text
100 reservas
100 secuenciales únicos
0 duplicados
```

## Idempotencia

```text
mismo idempotencyKey × N llamadas
= 1 documento
= 1 secuencial
= 1 clave
```

## Dinero

Generar combinaciones aleatorias de:

- cantidades;
- descuentos;
- tarifas;
- centavos/fracciones;

y verificar invariantes.

---

# 52. Casos de recuperación obligatorios

## Caso A — timeout al enviar

```text
SIGNED
→ envío
→ timeout
→ SEND_UNKNOWN
→ consultar clave
→ si existe, reconciliar
→ si no existe y política permite, reenviar MISMO XML
```

## Caso B — error 70

```text
error 70
→ no reenviar
→ no nueva clave
→ no nuevo secuencial
→ consultar autorización
```

## Caso C — proceso muere tras RECIBIDA

```text
reinicio
→ worker encuentra RECEIVED/PENDING
→ consulta autorización
```

## Caso D — proceso muere después de autorización pero antes de guardar

```text
estado local PENDING
→ reconciliador consulta
→ encuentra AUTORIZADO
→ recupera respuesta
→ guarda artefactos
```

## Caso E — clave registrada

```text
43
→ query same access key
→ reconciliar
```

---

# 53. Política de cambios normativos

Crear un registro:

```ts
interface NormativeChange {
  id: string;
  publishedAt: string;
  effectiveAt?: string;
  sourceUrl: string;
  affectedAreas: string[];
  status: "REVIEW" | "IMPLEMENTED" | "NOT_APPLICABLE";
  implementedInVersion?: string;
}
```

Proceso:

```text
Nueva Ficha/Resolución
    ↓
descargar
    ↓
hash/archivar
    ↓
diff técnico
    ↓
identificar XSD/catálogos/reglas afectadas
    ↓
tests
    ↓
release
```

No reemplazar XSD antiguos: conservarlos para reproducibilidad histórica.

---

# 54. Checklist de actualización de Ficha Técnica

Cada vez que SRI publique nueva versión:

- [ ] revisar historial de cambios;
- [ ] comparar códigos de documentos;
- [ ] revisar XSD;
- [ ] revisar tablas de impuestos;
- [ ] revisar retenciones;
- [ ] revisar formas de pago;
- [ ] revisar identificación;
- [ ] revisar firma;
- [ ] revisar Web Services;
- [ ] revisar errores;
- [ ] revisar anexos;
- [ ] revisar RIDE;
- [ ] revisar proveedor RUC;
- [ ] actualizar fixtures;
- [ ] correr integración en certificación;
- [ ] documentar fecha efectiva.

---

# 55. Qué NO debe hardcodearse

No hardcodear como verdad eterna:

```text
IVA = 15%
consumerFinalMax = 50
retención X = Y%
WSDL certificates
RIMPE labels
largeTaxpayer labels
providerRuc requirement date
transport rules
tax catalogs
special annex applicability
```

Sí pueden existir defaults versionados con:

```text
valor
vigencia
fuente
```

---

# 56. Datos que sí son parte estructural estable del protocolo actual

Mientras la Ficha vigente no cambie:

- clave de acceso de 49 dígitos;
- módulo 11;
- códigos de documento 01/03/04/05/06/07;
- ambientes 1/2;
- esquema off-line;
- firma XAdES-BES según parámetros vigentes;
- recepción SOAP;
- autorización por clave;
- XSD por versión;
- `RECIBIDA` / `DEVUELTA`;
- consulta de autorización;
- validación de validez.

Aun estos elementos deben estar encapsulados, no dispersos.

---

# 57. Límites expresos del MVP frente a anexos especiales

El MVP base debe declarar soporte inicial para operaciones comunes.

Hasta que haya implementación específica, bloquear:

- factura de exportación;
- reembolsos complejos;
- subsidios;
- rubros de terceros;
- factura sustitutiva de guía;
- factura comercial negociable;
- combustibles;
- máquina fiscal;
- casos ICE especiales no implementados;
- devolución automática IVA;
- autorretenciones especiales;
- materiales de construcción con requerimientos adicionales si el módulo no los contempla;
- transporte comercial con requisitos especiales;
- cualquier anexo sectorial no probado.

Esto no impide implementar los **seis tipos documentales base**. Evita afirmar cobertura de todos sus casos tributarios especiales.

---

# 58. Definition of Done — motor fiscal

Un tipo documental está “implementado” solo cuando:

- [ ] existe mapper de dominio;
- [ ] existe builder de versión;
- [ ] valida XSD oficial;
- [ ] genera clave correcta;
- [ ] firma XAdES-BES;
- [ ] persiste XML firmado antes de red;
- [ ] envía a recepción;
- [ ] interpreta RECIBIDA/DEVUELTA;
- [ ] consulta autorización asincrónicamente;
- [ ] persiste respuesta original;
- [ ] maneja timeout;
- [ ] maneja error 70;
- [ ] no duplica secuencial;
- [ ] soporta reconciliación;
- [ ] genera RIDE;
- [ ] descarga XML/RIDE;
- [ ] tiene pruebas unitarias;
- [ ] tiene golden files;
- [ ] pasó certificación SRI;
- [ ] tiene documentación de casos no soportados.

---

# 59. Definition of Done — integración SRI global

Antes de habilitar producción:

- [ ] XSD oficiales descargados y hash registrados.
- [ ] Ficha vigente confirmada.
- [ ] WSDL de pruebas verificados.
- [ ] WSDL de producción verificados.
- [ ] reloj/NTP sano.
- [ ] certificado válido.
- [ ] secretos cifrados.
- [ ] logs redactados.
- [ ] secuenciales atómicos.
- [ ] idempotencia.
- [ ] reconciliador activo.
- [ ] workers persistentes.
- [ ] backups/restauración.
- [ ] retención de artefactos.
- [ ] RIDE probado.
- [ ] seis documentos probados en certificación.
- [ ] reglas de consumidor final vigentes revisadas.
- [ ] Anexo 26 revisado para modalidad real de distribución del proyecto.
- [ ] anexos especiales no soportados bloqueados explícitamente.
- [ ] matriz normativa firmada/revisada.

---

# 60. Resumen para un agente de código

Si este archivo se utiliza como contexto para una IA que escribe código, seguir estas instrucciones:

```text
1. Nunca inventes un tag SRI.
2. Usa el XSD oficial del documento y versión.
3. Construye XML determinísticamente y en el orden del XSD.
4. Valida XSD antes de firmar.
5. Firma en XAdES-BES con la parametrización vigente del SRI.
6. Guarda el XML firmado antes de llamar al SRI.
7. Reserva secuenciales atómicamente.
8. Genera una clave de 49 dígitos y módulo 11.
9. Envía el mismo XML firmado a Recepción.
10. RECIBIDA != AUTORIZADO.
11. Después de RECIBIDA consulta autorización asincrónicamente.
12. Timeout != rechazo.
13. Error 70: no reenvíes, no cambies clave, no cambies secuencial.
14. DEVUELTA corregible: reutiliza clave/secuencial cuando la Ficha así lo manda.
15. Guarda todas las respuestas/mensajes del SRI.
16. Usa Decimal exacto para dinero.
17. No hardcodees impuestos/retenciones sin vigencia.
18. No rechaces todos los RUC mediante un único algoritmo local.
19. Nunca borres un comprobante autorizado.
20. Los datos históricos son snapshots, no vistas de configuración actual.
21. No implementes un Web Service de anulación que el SRI no haya publicado.
22. Casos sectoriales no soportados deben bloquearse, no aproximarse.
23. Cada cambio del SRI debe producir revisión, diff, test y release.
```

---

# 61. Contrato de invariantes

Estas invariantes deben expresarse como tests y constraints:

```text
I-01  access_key.length == 49
I-02  access_key is numeric
I-03  access_key DV == modulo11(first48)
I-04  XML clave == DB clave
I-05  XML estab == DB estab
I-06  XML ptoEmi == DB ptoEmi
I-07  XML secuencial == DB secuencial padded(9)
I-08  codDoc corresponde al tipo de documento
I-09  environment XML == environment endpoint
I-10  XSD version == XML version
I-11  signed XML exists before network send
I-12  no duplicate fiscal sequence
I-13  no duplicate access key
I-14  same idempotency key -> same document
I-15  RECIBIDA cannot set AUTHORIZED
I-16  timeout cannot set NOT_AUTHORIZED
I-17  error 70 cannot reserve another sequence
I-18  authorized doc cannot be deleted
I-19  authorized XML hash immutable
I-20  current company edits cannot mutate historical snapshot
```

---

# 62. Eventos de dominio sugeridos

```text
FiscalDocumentCreated
FiscalSequenceReserved
FiscalXmlBuilt
FiscalXmlValidated
FiscalXmlSigned
SriSendAttempted
SriSendUnknown
SriReceived
SriReturned
SriAuthorizationPending
SriAuthorized
SriNotAuthorized
SriMessageRecorded
FiscalRideGenerated
FiscalDocumentDelivered
FiscalCancellationPending
FiscalCancelled
FiscalReconciled
```

Con eventos/auditoría será posible diagnosticar problemas sin leer logs SOAP sensibles.

---

# 63. Tabla final por documento

| Documento | Código | Versión base MVP | Comprador/proveedor | Ítems | Impuestos | Documento sustento | Particularidades |
|---|---:|---|---|---:|---:|---:|---|
| Factura | 01 | 1.1.0 | comprador | Sí | Sí | No general | pagos/totales |
| Liquidación | 03 | 1.1.0 | proveedor identificado | Sí | Sí | según caso | no consumidor final |
| Nota crédito | 04 | 1.1.0 | receptor identificado | Sí | Sí | Sí | motivo/valor modificación |
| Nota débito | 05 | 1.0.0 | receptor identificado | Motivos | Sí | Sí | motivos/cargos |
| Guía remisión | 06 | 1.1.0 | destinatario | Sí | No como factura | según traslado | transportista/placa/ruta |
| Retención | 07 | 2.0.0 | sujeto retenido | docs sustento | retenciones | Sí | ATS/códigos vigentes |

> La tabla es un mapa funcional. El detalle obligatorio/opcional exacto pertenece al XSD oficial.

---

# 64. Riesgos técnicos que deben permanecer visibles

## R1 — XSD desactualizado

Mitigación: manifest + hash + vigilancia normativa.

## R2 — Secuencial duplicado

Mitigación: constraint + transacción + jamás rollback/reuse.

## R3 — Timeout crea doble documento

Mitigación: SEND_UNKNOWN + consulta por clave.

## R4 — Error 70 reenviado

Mitigación: regla explícita + test.

## R5 — Dinero con punto flotante

Mitigación: Decimal.

## R6 — Certificado expuesto

Mitigación: cifrado, server-side, secret store.

## R7 — XML válido pero tributariamente incorrecto

Mitigación: reglas de dominio + catálogo versionado + bloquear anexos no soportados.

## R8 — SRI cambia endpoints/certificados

Mitigación: configuración, TLS estándar, health check.

## R9 — Nueva norma sectorial

Mitigación: feature gate + matriz de soporte.

## R10 — Open source confundido con “proveedor tercero”

Mitigación: configurar Anexo 26 y revisar forma real de prestación antes de producción.

---

# 65. Checklist de revisión de Pull Request fiscal

Todo PR que cambie el motor fiscal debe responder:

1. ¿Qué fuente oficial respalda el cambio?
2. ¿Qué versión/fecha?
3. ¿Afecta XSD?
4. ¿Afecta clave de acceso?
5. ¿Afecta firma?
6. ¿Afecta catálogo tributario?
7. ¿Afecta cálculos?
8. ¿Afecta RIDE?
9. ¿Afecta secuenciales?
10. ¿Afecta estados/reintentos?
11. ¿Incluye fixtures?
12. ¿Incluye tests?
13. ¿Se probó en ambiente SRI de certificación?
14. ¿Cambia un caso especial/anexo?
15. ¿Requiere migración de datos/configuración?

---

# 66. Nota sobre actualización continua

Este documento tiene fecha de corte **1 de octubre de 2026**.

La Ficha Técnica principal utilizada es la **v2.34, julio 2026**.

Antes de cada release que toque emisión electrónica se debe comprobar:

```text
https://www.sri.gob.ec/facturacion-electronica
```

Si el SRI publica una nueva Ficha Técnica, XSD, resolución o catálogo, este SPEC_CONTEXT deja de ser suficiente por sí solo hasta completar el proceso de revisión normativa.

---

# 67. Referencias oficiales rápidas para el repositorio

Recomendación: incluir en el README del módulo fiscal:

```text
SRI Facturación electrónica:
https://www.sri.gob.ec/facturacion-electronica

Ficha Técnica vigente al corte — v2.34:
https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/f8d9bb36-5632-4f96-b463-b9265b55338c/FICHA%20TE%CC%81CNICA%20COMPROBANTES%20ELECTRO%CC%81NICOS%20ESQUEMA%20OFFLINE%20Versio%CC%81n%202.34.pdf

Registro Oficial — Resolución proveedores:
https://www.registroficial.gob.ec/quinto-suplemento-no-335/

SRI — proveedores de sistemas:
https://www.sri.gob.ec/detalle-noticias?idnoticia=1318&marquesina=1

WS Pruebas Recepción:
https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl

WS Pruebas Autorización:
https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl

WS Producción Recepción:
https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl

WS Producción Autorización:
https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl

WS Pruebas Consulta:
https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl

WS Producción Consulta:
https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl
```

---

# 68. Conclusión técnica

La integración con el SRI no debe modelarse como una llamada:

```text
emitirFactura() -> boolean
```

El contrato real es un proceso distribuido y persistente:

```text
documento
→ secuencial
→ clave
→ XML
→ XSD
→ firma
→ persistencia
→ recepción
→ espera
→ autorización
→ archivo
→ RIDE
→ entrega
→ reconciliación
```

Los seis documentos comparten esa infraestructura. Lo que cambia es:

- XSD;
- builder;
- reglas de negocio;
- catálogos;
- relaciones con documentos sustento;
- campos específicos;
- anexos especiales.

La arquitectura correcta es, por tanto:

```text
              MOTOR FISCAL COMÚN
                      │
     ┌────────────────┼────────────────┐
     │                │                │
 clave/secuencia    firma/WS        estados
     │                │                │
     └────────────────┼────────────────┘
                      │
        BUILDERS POR DOCUMENTO
                      │
   ┌──────┬──────┬────┼────┬──────┬──────┐
   │      │      │    │    │      │      │
Factura  NC     ND  Guía Retención Liquidación
```

Ese debe ser el límite conceptual del módulo SRI del MVP.
