## MODIFIED Requirements

### Requirement: Consulta de facturas
El sistema SHALL listar las facturas emitidas de la empresa con paginación, filtro por estado y búsqueda por número o comprador. El detalle muestra el estado, el número, la clave de acceso, la fecha, el comprador, las líneas, los totales y las formas de pago tomados del snapshot, y el diagnóstico del último intento si sigue reservada. Desde la transmisión, muestra también los mensajes del SRI del último resultado, los datos de la autorización y el historial de la transmisión. Ni el listado ni el detalle exponen el XML firmado, el XML autorizado ni las respuestas originales del SRI.

#### Scenario: Factura firmada
- **WHEN** un usuario consulta una factura firmada
- **THEN** ve su número, su clave de acceso, sus totales y el estado firmado, sin diagnóstico

#### Scenario: Factura reservada con diagnóstico
- **WHEN** un usuario consulta una factura reservada cuya firma falló
- **THEN** ve la etapa y el motivo del último intento, si es reintentable, y la acción de reintentar si tiene permiso

#### Scenario: Búsqueda por número
- **WHEN** un usuario busca `001-001-000000012`
- **THEN** el resultado contiene solo esa factura de su empresa

#### Scenario: Factura autorizada
- **WHEN** un usuario consulta una factura autorizada
- **THEN** ve el estado autorizado, el número y la fecha de autorización y el ambiente confirmado

#### Scenario: Factura devuelta o no autorizada
- **WHEN** un usuario consulta una factura devuelta o no autorizada
- **THEN** ve todos los mensajes del SRI con su identificador, su mensaje y su información adicional

#### Scenario: Historial de la transmisión
- **WHEN** un usuario consulta el historial de la transmisión de una factura
- **THEN** ve sus transiciones y un resumen de cada intento con el SRI (operación, momento, resultado y mensajes), sin la respuesta original

#### Scenario: Filtro por estado de transmisión
- **WHEN** un usuario filtra las facturas por un estado de la transmisión, como resultado incierto o revisión manual
- **THEN** el resultado contiene solo las facturas de su empresa en ese estado

#### Scenario: Transmisión detenida
- **WHEN** un usuario consulta una factura cuya transmisión se detuvo al agotar sus intentos
- **THEN** ve que la transmisión está detenida y su último motivo, sin datos técnicos sensibles

### Requirement: Permisos de facturas
Cada operación de facturas SHALL exigir su permiso antes de leer o escribir datos: consultar facturas (`invoices.read`), gestionar borradores (`invoices.draft`), emitir (`invoices.emit`), reintentar la firma (`invoices.retrySigning`) y pedir una reconciliación con el SRI (`invoices.reconcile`). Sin sesión, el sistema responde no autenticado; si la política de acceso no concede el permiso, responde prohibido, sin efecto. La empresa y el rol salen siempre de la sesión. Con la matriz de acceso vigente, administradores y operadores tienen los cuatro primeros permisos: crear borradores, emitir y corregir un comprobante con XML inválido corresponde a ambos roles. Pedir una reconciliación es solo del administrador.

#### Scenario: Permiso exigido por cada operación
- **WHEN** se consulta una factura, se guarda o elimina un borrador, se emite, se reintenta la firma o se pide una reconciliación, y la política de acceso no concede el permiso de esa operación
- **THEN** el sistema responde prohibido antes de leer o escribir datos

#### Scenario: Matriz vigente
- **WHEN** se consulta la política de acceso
- **THEN** administradores y operadores tienen los permisos de consultar, gestionar borradores, emitir y reintentar la firma, y solo los administradores tienen el de reconciliar

#### Scenario: Operador emite
- **WHEN** un operador emite un borrador válido
- **THEN** la factura se emite y queda registrada con el operador como autor

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión intenta emitir, consultar o reconciliar facturas
- **THEN** el sistema responde no autenticado
