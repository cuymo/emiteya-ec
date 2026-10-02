# XSD oficiales del SRI

Material fuente oficial, igual que el ERS y CTX: no se edita. Son los esquemas de las versiones
que usa el producto (ADR 0008, Q-13), descargados del portal de facturación electrónica del SRI
(CTX SRI-01, SRI-03) y conservados byte a byte (`.gitattributes` los trata como binarios).

- Portal: https://www.sri.gob.ec/facturacion-electronica
- Descarga: 2026-10-02T15:38:05Z.
- Los paquetes ZIP oficiales contienen además las versiones no usadas y XML de ejemplo, que no se versionan aquí.
- El registro de esquemas del motor fiscal (ADR 0008, CTX §19.3) los referenciará cuando llegue su cambio.

## Esquemas

| Código | Comprobante | Versión | Archivo | SHA-256 |
| --- | --- | --- | --- | --- |
| `01` | Factura | 1.1.0 | `factura_V1.1.0.xsd` | `62db9bf0ecceb00ef2b7ed136e59224815e5e5e33c77efc6a0552001e052eb8b` |
| `03` | Liquidación de compra | 1.1.0 | `LiquidacionCompra_V1.1.0.xsd` | `58c9cd96edf93d92ef6692cd028e689080257c9ba2941fe04fe1d426ebc4b5b6` |
| `04` | Nota de crédito | 1.1.0 | `NotaCredito_V1.1.0.xsd` | `379e9f270d71ab4578f130a736c9abe5eb1d7969375ecdef55d2973583ec5ab0` |
| `05` | Nota de débito | 1.0.0 | `NotaDebito_V1.0.0.xsd` | `f40323adef667a2d95de75a611272a78b73a7f82711201bd7a7a52d3bb353fd6` |
| `06` | Guía de remisión | 1.1.0 | `GuiaRemision_V1.1.0.xsd` | `4777fd94b5f7b108da3db0dd3d2c71d1539ced221cba246ebeaa40fb17f3dee1` |
| `07` | Comprobante de retención | 2.0.0 | `ComprobanteRetencion_V2.0.0.xsd` | `1e006d6d16c791c8f5b23d1f3e006cd066ccba2bfb797a3cb9098bd09c793cb7` |

## Paquetes de origen

Prefijo de las URL: `https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/`.

| Paquete | Ruta | SHA-256 del ZIP |
| --- | --- | --- |
| XML y XSD Factura | `05546998-6f29-4870-be3b-62650f312a6c/XML%20y%20XSD%20Factura.zip` | `ba1ff0c4e329fe759c3f88dc75f2975780b315b6eb3d0069071b77c1f26fec03` |
| XML y XSD Liquidación | `ee386507-04f8-4a45-b9cd-6d4e4c6ac1e6/XML%20y%20XSD%20Liquidaci%c3%b3n.zip` | `4ecd62bb9be31469a4fa80d16b891ed8e1ee1afd8b4f9a799e3818e9d96dc329` |
| XML y XSD Nota de Crédito | `dfc944cd-5f18-4433-a626-3cc64cfc4549/XML%20y%20XSD%20Nota%20de%20Cr%c3%a9dito.zip` | `9b7e9c1a240ae39a858aa8fbaf91c41c761417e7bd763ccb20ffc0b81ad1bd43` |
| XML y XSD Nota de Débito | `ccc3913a-879e-41b6-82b7-11b627b7d1d8/XML%20y%20XSD%20Nota%20de%20D%c3%a9bito.zip` | `068a70165bf76974fb64ea435d66d927863569083b1a5ce5d017b4f50d21ab14` |
| XML y XSD Guía de Remisión | `642ba34d-82d0-49d8-9622-5946f8eda268/XML%20y%20XSD%20Gu%c3%ada%20de%20Remisi%c3%b3n.zip` | `2830d06822b7110f0dd29364320071f5389b8c4471b2c842fe965e38d6c59ba2` |
| XML y XSD Comprobante de Retención | `90950fca-73a7-4cfb-9c2d-3142b10435f2/XML%20y%20XSD%20Comprobante%20de%20Retenci%c3%b3n.zip` | `d365dec7ffe15199ddb1eefa8b91c12e4bdc884cbc40b4177410466148c255f8` |

Los archivos dentro de los paquetes tienen fecha 2022-02-07.

## Campos del emisor

Restricciones comunes a las seis versiones, usadas por `add-taxpayer-setup` (ERS RF-104):

| Campo XML | Obligatorio | Restricción |
| --- | --- | --- |
| `ruc` | Sí | `[0-9]{10}001` |
| `razonSocial` | Sí | 1 a 300 caracteres, sin saltos de línea |
| `nombreComercial` | No | 1 a 300 caracteres, sin saltos de línea |
| `dirMatriz` | Sí | 1 a 300 caracteres, sin saltos de línea |
| `dirEstablecimiento` | No | 1 a 300 caracteres, sin saltos de línea |
| `estab`, `ptoEmi` | Sí | `[0-9]{3}` |
| `ambiente` | Sí | `1` o `2` |
| `obligadoContabilidad` | No | `SI` o `NO` |
| `contribuyenteEspecial` | No | 3 a 13 caracteres alfanuméricos; en retención 2.0.0, 3 a 5 |
| `agenteRetencion` | No | Solo dígitos, hasta 8: número de resolución |
| `contribuyenteRimpe` | No | Texto fijo `CONTRIBUYENTE RÉGIMEN RIMPE` |
