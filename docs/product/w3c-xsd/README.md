# XSD de la firma XML (W3C)

Material fuente oficial, como los XSD del SRI de `../sri-xsd/`: no se edita. Los seis esquemas
del SRI importan `xmldsig-core-schema.xsd` por ruta relativa (`<xsd:import
namespace="http://www.w3.org/2000/09/xmldsig#" schemaLocation="xmldsig-core-schema.xsd"/>`), y
el validador XSD lo necesita para resolver ese import sin red (spike S-2, ADR 0021).

- Fuente: el W3C, dueño del espacio de nombres `http://www.w3.org/2000/09/xmldsig#`, en https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd.
- Descarga: 2026-10-03T10:31:13Z. Revisión del archivo: `$Revision: 1.2 $` del 2013-04-16.
- No se toma la copia empaquetada en `facturacion-electronica-ec`: los XSD internos de una librería no son fuente canónica. Esa copia difiere solo en el comentario de revisión (1.1, 2002).
- `.gitattributes` lo trata como binario para conservar su hash.

| Archivo | SHA-256 |
| --- | --- |
| `xmldsig-core-schema.xsd` | `d102ad3df7664c307e0c2c776ba4a90513b1969974d8a940bae1a77f9f21e15d` |
