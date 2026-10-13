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

## Producción: verificación documental offline

Registro de C3 de la revisión final del go-live (2026-10-13). Es una verificación de contrato, no de
conectividad (`../../quality/definition-of-done.md`): se comparan las cadenas oficiales de la ficha
v2.34 (PDF con SHA-256 `7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9`, extracto
literal en `../sri-catalogs/fuentes/ficha-v2.34-servicios-web.txt`) con el código. Sin consultas
DNS, conexiones, peticiones HTTP ni SOAP, sin descargar el WSDL de Producción y sin contactar
Pruebas.

| Elemento | Ficha v2.34 | Código | Resultado |
| --- | --- | --- | --- |
| Protocolo y host | `https://cel.sri.gob.ec` (7.2.2 y 8.2.2, páginas 17 y 22) | `PRODUCTION_BASE` de `backend/src/modules/sri-engine/infrastructure/endpoints.ts` | Coincide |
| Contexto | `/comprobantes-electronicos-ws` | el mismo | Coincide |
| Recepción | `RecepcionComprobantesOffline?wsdl` | `PRODUCTION.RECEPTION`: `…/RecepcionComprobantesOffline` | Coincide |
| Autorización | `AutorizacionComprobantesOffline?wsdl` | `PRODUCTION.AUTHORIZATION`: `…/AutorizacionComprobantesOffline` | Coincide |
| Consulta de validez | `ConsultaComprobante?wsdl` (8.2.2) | `PRODUCTION.VALIDITY`: `…/ConsultaComprobante` | Coincide |
| Operación de recepción | `validarComprobante`, parámetro `xml`; respuesta `validarComprobanteResponse` / `RespuestaRecepcionComprobante` en `http://ec.gob.sri.ws.recepcion` (7.2.3) | `soap-envelopes.ts` y `reception-classifier.ts` | Coincide |
| Operación de autorización | `autorizacionComprobante`, parámetro `claveAccesoComprobante`; respuesta `autorizacionComprobanteResponse` / `RespuestaAutorizacionComprobante` en `http://ec.gob.sri.ws.autorizacion` (página 18) | `soap-envelopes.ts` y `authorization-classifier.ts` | Coincide |
| Operación de consulta | `consultarEstadoAutorizacionComprobante`, parámetro `claveAcceso`; respuesta `consultarEstadoAutorizacionComprobanteResponse` / `EstadoAutorizacionComprobante` en `http://ec.gob.sri.ws.consultas` (8.2.3) | `soap-envelopes.ts` y `validity-classifier.ts` | Coincide |
| Sobre | SOAP 1.1, `http://schemas.xmlsoap.org/soap/envelope/` en los ejemplos | `SOAP_ENV` de `soap-envelopes.ts`; `text/xml` en `soap-transport.ts` | Coincide |
| `ConsultaFactura` y `autorizacionComprobanteLote` | documentados | no se usan ni se declaran | Fuera de alcance |

Resultado: **coincide**. Supuestos de contrato, declarados y no comprobables sin red:

- Producción publica los mismos servicios que Pruebas con otro host (7.2.1 frente a 7.2.2, 8.2.1
  frente a 8.2.2). El enlace (document/literal, acción SOAP vacía, elementos sin espacio de nombres)
  sale de los WSDL de Pruebas de la tabla anterior.
- El código usa como dirección SOAP la ruta documentada sin `?wsdl`, como la `soap:address` de los
  WSDL de Pruebas. La `soap:address` de Producción no se verifica: exigiría descargar su WSDL.
- Cada dirección se puede sobrescribir por configuración (`SRI_ENDPOINT_PRODUCTION_*`), como
  recomienda 7.1.4 de la ficha, sin fijar certificados.
