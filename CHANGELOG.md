# Registro de cambios

Todos los cambios notables de EmiteYa se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usará
[versionado semántico](https://semver.org/lang/es/) desde su primera versión publicada.

El detalle de cada cambio, con su diseño y su especificación, está en
`openspec/changes/archive/`.

## [Sin publicar]

Primera versión pública (v1.0), bajo la licencia AGPL-3.0.

### Comprobantes electrónicos (esquema off-line del SRI)

- Los seis comprobantes base: factura, nota de crédito, nota de débito, comprobante de retención
  (renta e IVA), guía de remisión y liquidación de compra, con borradores editables, clave de
  acceso, XML validado contra el XSD versionado y firma XAdES-BES.
- Transmisión al SRI por jobs (recepción y autorización asíncrona), reconciliación de resultados
  inciertos y detección de anulaciones. **Viene apagada** (`SRI_TRANSMISSION_ENABLED=0`).
- Bandeja de todos los comprobantes con filtros, RIDE en PDF y descarga del XML.
- Entrega por correo del XML autorizado y el RIDE con el servidor SMTP de cada empresa, con
  reintentos, reenvío manual y avisos de envíos fallidos. En el ambiente de Pruebas solo va al
  correo de prueba de la empresa.

### Empresa y catálogos

- Configuración de la empresa, establecimientos, puntos de emisión y numeración auditada.
- Carga, validación y custodia cifrada de la firma electrónica, con aviso de vencimiento.
- Catálogos fiscales oficiales versionados, clientes y proveedores, productos e inventario
  opcional.

### Operación

- Inicio con indicadores comerciales, el estado de la facturación electrónica y «Primeros pasos»
  mientras falte algo para emitir.
- Reportes filtrables exportables a XLSX y portabilidad completa de los datos.
- Usuarios con roles Administrador y Operador, auditoría de cambios críticos, perfil con foto,
  recuperación de la contraseña por correo y un recorrido de bienvenida.

### Seguridad y despliegue

- Política de seguridad del navegador con nonce por documento, protección de origen de la API,
  límites de intentos y secretos cifrados en reposo.
- Despliegue de producción de referencia con Docker Compose (nginx con TLS, red privada y
  respaldos de PostgreSQL).
- Escaneo de secretos y de dependencias en la verificación.
