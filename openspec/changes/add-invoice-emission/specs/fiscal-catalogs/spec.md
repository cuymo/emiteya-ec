## MODIFIED Requirements

### Requirement: Registro de esquemas XSD
El sistema SHALL mantener como dato versionado el registro de los esquemas XSD oficiales: tipo de comprobante, raíz, versión, archivo, hash SHA-256, fuente, fecha de descarga y si la aplicación soporta esa versión. El registro MUST incluir además cada archivo que esos esquemas importan para resolver una validación, como `xmldsig-core-schema.xsd`, con su fuente, revisión, hash y ruta lógica. Un esquema solo figura como registrado si su archivo coincide con su hash.

#### Scenario: Consulta del registro
- **WHEN** un administrador consulta los esquemas registrados
- **THEN** ve las versiones registradas de los seis comprobantes, con su hash y su fuente, y cuáles soporta la aplicación
- **AND** ve el esquema importado de la firma XML, con su fuente, su revisión y su hash

#### Scenario: Archivo que no coincide con su hash
- **WHEN** el archivo de un esquema registrado, o de un esquema importado, no coincide con el hash del registro
- **THEN** la verificación del registro falla e identifica el archivo

#### Scenario: Archivo que falta en la instalación
- **WHEN** falta en la instalación un archivo del registro
- **THEN** la verificación del registro falla e identifica el archivo, sin descargarlo ni sustituirlo por otro
