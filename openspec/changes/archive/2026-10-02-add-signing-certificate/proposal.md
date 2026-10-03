# Proposal

## Why

Para emitir, cada comprobante debe firmarse con la firma electrónica del contribuyente: un
archivo PKCS#12 y su contraseña, que permiten firmar en su nombre (CTX §20). Hoy la empresa ya
tiene datos, establecimientos, puntos y numeración, pero no puede cargar su firma: el requisito
"Firma electrónica" de la preparación para emitir está siempre pendiente.

Este cambio permite al administrador cargar, validar y reemplazar la firma con custodia cifrada,
y vigilar su vencimiento (ERS RF-130..135, SEC-002, SEC-004; ADR 0011, aceptado). Es el último
requisito de la configuración mínima (ERS AC-01) y una dependencia del cambio de emisión, que
firmará con ella.

## What Changes

- Carga de la firma electrónica por el administrador: un archivo PKCS#12 con su contraseña. Se acepta solo si se abre con la contraseña, contiene una clave privada que corresponde al certificado y firma con los parámetros del SRI, está vigente y tiene un RUC detectable (CTX §20.6, Q-17). Un certificado sin RUC detectable se rechaza sin tocar la firma vigente.
- Si el RUC del certificado difiere del RUC de la empresa, la firma se acepta y la aplicación muestra una advertencia preventiva propia, que no se presenta como un error del SRI (Q-17).
- Custodia cifrada (ADR 0011): el archivo y la contraseña se guardan solo cifrados, separados de los metadatos, y nunca vuelven al navegador ni aparecen en logs, errores, respuestas ni auditoría.
- **BREAKING (instalación):** en producción, el backend no arranca sin la clave maestra de la custodia. En desarrollo y pruebas existe un modo explícito sin firma.
- Reemplazo: la firma nueva pasa a ser la vigente, el secreto anterior se elimina y sus metadatos se conservan. Volver a cargar la misma firma no cambia nada.
- Consulta de la firma vigente: titular, emisor, número de serie, vigencia, RUC detectado y si coincide con el de la empresa. El operador ve solo su vigencia.
- Vencimiento: la firma por vencer sigue siendo utilizable y se avisa dentro de la aplicación, con una anticipación que el administrador configura (ERS RF-135). La firma vencida deja de ser utilizable.
- La preparación para emitir considera cumplido el requisito de firma solo con una firma utilizable (ERS RF-134, BR-03).
- Auditoría de la carga, el reemplazo y el cambio de la anticipación del aviso, sin datos secretos (ERS RF-003, SEC-007, BR-53).
- Permisos nuevos en el mapa central de acceso (Q-22).
- Pantalla `Firma electrónica` en `Configuración` y aviso de vencimiento en el shell.
- Gate previo a `/opsx:apply`: el spike S-6 de compatibilidad PKCS#12 y custodia.

Fuera de alcance:

- Firmar comprobantes en XAdES-BES y el adaptador de firma que descifra el secreto (`add-invoice-emission`, ADR 0013, spike S-3).
- Validar la cadena de confianza contra raíces de las entidades certificadoras y consultar la revocación (OCSP o CRL). El SRI lo valida; su rechazo se trata en `add-sri-transmission`.
- Descargar el certificado o su contraseña, por cualquier rol.
- Eliminar la firma sin reemplazarla, y tener más de una firma vigente por empresa.
- Implementar la rotación de la clave maestra y un adaptador de KMS. El formato queda preparado; la rotación verificada es requisito del go-live (ADR 0011).
- Avisos por correo u otros canales externos, y la vigilancia del reloj del servidor (NTP, `deployment.md`).
- Validar un P12 real de una entidad certificadora ecuatoriana: es requisito del go-live, no de este cambio (spike S-6).

## Capabilities

### New Capabilities

- `signing-certificate`: carga, validación, custodia, reemplazo y consulta de la firma electrónica del contribuyente; su identidad tributaria; cuándo es utilizable; y el aviso de su vencimiento.

### Modified Capabilities

- `taxpayer-setup`: la preparación para emitir considera cumplido el requisito de firma con una firma electrónica utilizable, no solo vigente.
- `audit-trail`: añade la auditoría de la carga y el reemplazo de la firma y del cambio de la anticipación de su aviso. Los requisitos existentes de atomicidad, ausencia de secretos, inmutabilidad y aislamiento se aplican también a estos eventos.

## Impact

- Backend:
  - módulo nuevo de firma con la carga, la consulta, la custodia cifrada y el puerto de inspección de PKCS#12;
  - módulo `sri-engine` de infraestructura, el único que importa `facturacion-electronica-ec` (ADR 0018), con el adaptador de firma que usa la firma de prueba al cargar;
  - rutas bajo `/api/v1/` (ADR 0015);
  - implementación del puerto de firma que ya consulta la preparación para emitir;
  - configuración de la clave maestra validada al arrancar;
  - permisos nuevos en `identity` y acciones nuevas en `audit`.
- Base de datos: metadatos de las firmas, su secreto cifrado en un almacenamiento aparte y la anticipación del aviso por empresa, con una sola firma vigente por empresa.
- Frontend:
  - destino `Firma electrónica` en `Configuración`;
  - aviso de vencimiento en el shell;
  - acción del requisito de firma en Inicio.
- Dependencias:
  - `node-forge` 1.4.0 para la inspección de PKCS#12, elegida por el spike S-6 (ADR 0019);
  - `facturacion-electronica-ec` 1.0.1 y `ec-sri-invoice-signer` 1.8.2, en versiones exactas (ADR 0018);
  - Node 24.21.0, que ya es la base del proyecto.
- Documentación: `access-control.md`, `database.md`, `deployment.md` (variables de la clave maestra), `fiscal-emission.md` (obligaciones para la emisión), `threat-model.md` y `domain-model.md`.
- Requiere `add-taxpayer-setup` archivado (empresa, RUC, preparación para emitir). Lo usará `add-invoice-emission`.
