# WSDL oficiales del SRI

Material fuente oficial, igual que los XSD (`../sri-xsd/README.md`): no se edita. Son los contratos
de los servicios web que usa `add-sri-transmission` (design D10), descargados del ambiente de
Pruebas del SRI y conservados byte a byte (`.gitattributes` los trata como binarios).

- Descarga: 2026-10-04T03:34:23Z, con una lectura `GET` de cada `?wsdl`. Ningún comprobante se
  envió al SRI.
- Las URL de Producción (`cel.sri.gob.ec`) publican los mismos servicios (CTX §7.2, §7.4).
- La ficha v2.34 (§7.2.3 y §8.2.3) da además ejemplos de solicitud y de respuesta, que siguen
  estos contratos. Las respuestas sintéticas de las pruebas usan esa estructura.

| Servicio | Archivo | Espacio de nombres | Operación | SHA-256 |
| --- | --- | --- | --- | --- |
| Recepción | `RecepcionComprobantesOffline.wsdl` | `http://ec.gob.sri.ws.recepcion` | `validarComprobante` (`xml`, base64) | `4a71faf1c349d564b42ce74e64d0f47d4d7d532568359daafca0c16683e2236b` |
| Autorización | `AutorizacionComprobantesOffline.wsdl` | `http://ec.gob.sri.ws.autorizacion` | `autorizacionComprobante` (`claveAccesoComprobante`) | `5fe7b3519009dca5ecb887455e3cb95936940cfe45c0ef56a06915237cce7851` |
| Consulta de validez | `ConsultaComprobante.wsdl` | `http://ec.gob.sri.ws.consultas` | `consultarEstadoAutorizacionComprobante` (`claveAcceso`) | `d23f3c4d3787157371b45b4add0122dfddde2998b6ed39098c52b5f3d8f9bd43` |

URL de origen, ambiente de Pruebas: `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/<servicio>?wsdl`.

En los tres, los elementos hijos no llevan espacio de nombres (`elementFormDefault="unqualified"`),
la acción SOAP es vacía y el estilo es `document/literal`. Los estados de autorización y de
validez son `xs:string`: sus valores salen de la ficha, no del WSDL.

`backend/test/sri-engine/wsdl-manifest.test.ts` comprueba que esta tabla coincide con los archivos.
