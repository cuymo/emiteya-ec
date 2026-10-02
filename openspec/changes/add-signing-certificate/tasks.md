# Tasks

## 0. Gate previo

- [ ] 0.1 Confirmar que el spike S-6 (design D15) se ejecutó con todos sus criterios cumplidos, que su ADR de dependencia está aceptado y que `open-questions.md` registra su resultado y la tabla de ubicaciones del RUC por entidad; verificar que, si no hubo P12 real, el requisito del go-live sigue abierto en `definition-of-done.md`. Sin esto no se empieza el grupo 1

## 1. Contratos, permisos y reglas de dominio

- [ ] 1.1 Añadir `packages/contracts/src/signing-certificate.ts`: esquema estricto de la carga (base64 de hasta 64 KiB decodificado, contraseña de 1 a 256 caracteres sin normalizar, `expectedCurrentId`), anticipación entera de 1 a 90, vistas completa y de vigencia con los estados derivados, y rutas en el registro de OpenAPI; verificar con pruebas de contrato que rechazan `companyId`, campos desconocidos, base64 inválido, tamaños y anticipaciones fuera de rango, y que ninguna vista admite campos secretos
- [ ] 1.2 Añadir los permisos `certificate.read`, `certificate.manage` (solo `ADMIN`) y `certificateValidity.read` (`ADMIN` y `OPERATOR`) al mapa central y al frontend, y las acciones `signing_certificate.loaded`, `signing_certificate.replaced` y `signing_certificate.expiry_alert_changed` a la auditoría; verificar con las pruebas del mapa de acceso y actualizar `docs/security/access-control.md`
- [ ] 1.3 Implementar en `modules/signing/domain` la vigencia derivada (`VALID`, `EXPIRING`, `EXPIRED`, `KEY_UNAVAILABLE`, `NONE`), los días que faltan, la condición de utilizable y la coincidencia del RUC (`MATCH`, `MISMATCH`, `PENDING`) de design D8 y D4; verificar con pruebas unitarias de los bordes (justo al vencer, el día de la anticipación, sin RUC de la empresa, custodia deshabilitada)

## 2. Configuración y custodia cifrada

- [ ] 2.1 Añadir a `config/env.ts` `CERTIFICATE_CUSTODY`, `CERTIFICATE_MASTER_KEY`, `CERTIFICATE_MASTER_KEY_FILE` y `CERTIFICATE_MASTER_KEY_VERSION` (design D6), y la clave de ejemplo en `backend/.env.example`; verificar con pruebas que en producción no arranca sin clave, con las dos variantes a la vez, con una clave que no decodifica a 32 bytes, con un archivo ilegible, con la clave de ejemplo o con `disabled`, que los mensajes no contienen valores, y que `check:dev-start` sigue pasando
- [ ] 2.2 Implementar `CertificateVault` y el anillo de claves con el formato 1 de design D5 (clave de datos por certificado, AES-256-GCM con AAD de empresa, registro y campo, envoltura con versión de clave y `key_check`), y el tipo secreto que no se serializa; verificar con pruebas unitarias: ida y vuelta, fallo con otra clave, con otra versión, con el AAD de otra empresa o de otro registro y con un byte alterado, `canOpen` sin descifrar, y que `JSON.stringify` e `inspect` del secreto no lo revelan
- [ ] 2.3 Documentar las variables y el respaldo de la clave en `docs/architecture/deployment.md`, y la custodia en `docs/security/threat-model.md`; verificar que coinciden con el ADR 0011 y con `env.ts`

## 3. Esquema de datos

- [ ] 3.1 Añadir a Prisma y a una migración `signing_certificate`, `signing_certificate_secret` y `signing_certificate_settings` con el índice único parcial de una firma `ACTIVE` por empresa, las claves compuestas por empresa, el `CHECK` de la anticipación y los triggers de design D2; verificar con `migrations.test.ts` y con pruebas de integración que rechazan una segunda firma `ACTIVE`, un secreto o metadatos de otra empresa, cambiar metadatos salvo `ACTIVE` → `REPLACED`, borrar metadatos y actualizar un secreto, y que permiten borrar un secreto
- [ ] 3.2 Documentar las tablas, sus restricciones y la excepción de destrucción del secreto en `docs/architecture/database.md` y la ubicación de la anticipación en `docs/product/domain-model.md`; verificar que nombran cada restricción de la migración

## 4. Lectura de PKCS#12 y RUC

- [ ] 4.1 Añadir la dependencia que eligió el ADR del spike y el script que genera los P12 sintéticos de las pruebas (design D15 y D16), sin commitear claves privadas; verificar que `check:versions` pasa con la versión exacta y que el script genera todos los fixtures en CI
- [ ] 4.2 Implementar `CertificateReader` (abrir con la contraseña, extraer certificado, clave y metadatos, firma de prueba RSA-SHA1 verificada, cadena legible) y la detección del RUC con la tabla de ubicaciones del spike (design D3 y D4); verificar con los fixtures: moderno y legado, contraseña correcta, incorrecta y no ASCII, vigente, vencido y no vigente, sin clave, clave que no corresponde, EC, RSA de 1024, RUC en cada ubicación, sin RUC y con RUC inválido, cada uno con su código de error y sin la contraseña en ningún mensaje

## 5. Carga, reemplazo, consulta y preparación para emitir

- [ ] 5.1 Implementar la carga y el reemplazo (design D3 y D7): validación fuera de la transacción, lock advisory, huella igual sin cambios, `409 CERTIFICATE_CHANGED`, transición a `REPLACED`, borrado del secreto anterior, inserción y auditoría en la misma transacción, y `409 CERTIFICATE_CUSTODY_DISABLED`; verificar con pruebas de integración: primera carga, reemplazo con el secreto anterior borrado y los metadatos conservados, misma firma sin evento, valor esperado desactualizado, dos reemplazos simultáneos con un solo éxito, carga rechazada sin cambios, y un fallo al auditar que revierte todo
- [ ] 5.2 Implementar las consultas completa y de vigencia, y la anticipación como estado deseado (design D8 y D9), con la coincidencia del RUC contra el RUC vigente de la empresa; verificar con pruebas de integración: empresa sin firma, RUC que coincide, RUC distinto con su advertencia, RUC de la empresa corregido después, empresa sin datos, firma por vencer, vencida y con clave no disponible, y la misma anticipación sin evento
- [ ] 5.3 Exponer las rutas con sus permisos en el router del módulo y montarlas en `main.ts`; verificar con pruebas HTTP: operador `403` en carga, consulta completa y anticipación, y `200` en la vigencia; la empresa B no ve ni cambia la firma de la empresa A; `companyId` en el cuerpo rechazado; y regenerar OpenAPI con `openapi:check` en verde
- [ ] 5.4 Implementar `SigningCertificateReadiness` e inyectarlo en `taxpayerRouters` (design D12); verificar con pruebas de integración de `GET /company/status`: sin firma pendiente, firma utilizable cumplida, por vencer cumplida, y vencida o con clave no disponible pendiente
- [ ] 5.5 Añadir los gauges de vencimiento y utilizable, la redacción de `file`, el error de arranque por firmas que no pueden abrirse y la prueba de fugas de design D13 y D16; verificar que la prueba busca la contraseña y el base64 de cada fixture en respuestas, errores, logger capturado, auditoría y volcados de las tablas sin encontrarlos
- [ ] 5.6 Escribir en `docs/architecture/fiscal-emission.md` las obligaciones para `add-invoice-emission`: abrir el secreto solo en el adaptador de firma, comprobar que la firma es utilizable antes de firmar y no registrar nunca el material; verificar que nombran la operación y los errores

## 6. Interfaz: Firma electrónica

- [ ] 6.1 Añadir el destino `Firma electrónica` a `Configuración` (solo con `certificate.read`) y construir la pantalla de design D14: estado, vencimiento, titular, RUC y su advertencia como comprobación preventiva, emisor, serie, fecha de carga y la anticipación editable; verificar con pruebas de componente: carga, vacío con la acción, error con reintento, sin permiso, por vencer, vencida, no disponible, RUC distinto, y que un operador no ve el destino
- [ ] 6.2 Construir el diálogo `Cargar firma` o `Reemplazar firma` con `FileField` y `PasswordField`, los errores en su campo o en el cuerpo, el RUC no encontrado con titular y emisor, el conflicto con `Recargar` y la contraseña borrada al cerrar; verificar con pruebas de componente y contra el backend real con fixtures sintéticos: primera carga, reemplazo, contraseña incorrecta, archivo ilegible, sin RUC, conflicto y doble envío bloqueado
- [ ] 6.3 Añadir el aviso de vencimiento al shell para administradores y operadores, y la acción del requisito de firma en Inicio (design D12 y D14); verificar con pruebas de componente: por vencer con fecha y días, vencida, no disponible, sin aviso lejos del vencimiento, enlace solo para el administrador y operador con a quién pedírselo
- [ ] 6.4 Recorrer `Firma electrónica`, el diálogo y el aviso en carga, vacío, error, sin permiso y éxito; en móvil a 375 y 320 px con objetivos de 44 px; con teclado; en temas claro y oscuro; con barrido a 640, 768, 1024 y 1440 px; y con `docs/quality/frontend-checklist.md`; verificar que la revisión queda registrada en `ui-review.md` del cambio

## 7. Verificación integral

- [ ] 7.1 Prueba end-to-end por HTTP contra `main.ts` con fixtures sintéticos:
  1. La empresa configurada sin firma no está preparada.
  2. El administrador carga una firma con RUC distinto: la empresa queda preparada y la advertencia figura.
  3. La reemplaza por otra con el RUC de la empresa y desaparece la advertencia.
  4. Carga una sin RUC, que se rechaza sin cambiar la vigente.
  5. El operador ve solo la vigencia.
  6. La auditoría tiene la carga y el reemplazo sin secretos.
  7. Ninguna tabla contiene el P12 ni la contraseña en claro.

  Verificar que la prueba pasa.
- [ ] 7.2 Ejecutar `corepack pnpm verify`; verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo y build pasan
