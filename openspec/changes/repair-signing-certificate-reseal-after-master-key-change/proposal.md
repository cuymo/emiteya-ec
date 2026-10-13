# Proposal

## Why

Es la corrección acotada del único bloqueante de software de la revisión final del go-live (C1). El
administrador de una empresa cuya firma quedó no disponible porque la instalación cambió o perdió
su clave de custodia no puede recuperarla: el sistema le pide volver a cargarla, pero cargar otra vez
el mismo P12 no cambia nada. Sin esa recuperación no existe el procedimiento operativo documentado y
probado para sustituir la clave maestra que exige el go-live (`definition-of-done.md`, ADR 0011).

**Evidencia del ensayo local del 2026-10-13** (material sintético, sin firmar comprobantes ni
tráfico al SRI):
1. Carga con la clave antigua: `200`, `VALID`, secreto con la versión de clave 1.
2. Con la clave nueva: `KEY_UNAVAILABLE`, no utilizable.
3. Carga del mismo P12 por la vía normal con la clave nueva: `200`, `unchanged: true`, sigue
   `KEY_UNAVAILABLE`, misma firma.
4. Consulta posterior: sigue `KEY_UNAVAILABLE`; el secreto sigue con la versión 1, sin volver a
   cifrarse.
5. Vuelta a la clave antigua: `VALID`.

**Causa:** dos reglas de la spec `signing-certificate`, razonables por separado, chocan en este
caso. «Reemplazo de la firma» dice que cargar otra vez la firma vigente no cambia nada (escenario
«Misma firma otra vez»); «Firma utilizable» dice que, si la clave configurada no abre el secreto, el
administrador debe volver a cargarla. La carga evalúa la primera regla antes que cualquier otra
cosa: compara la huella del certificado y responde sin cambios aunque el secreto no pueda abrirse.
La pantalla de la firma repite la contradicción: pide volver a cargarla y después informa «Esa firma
ya era la vigente: no cambió nada».

**Alcance del daño:** un contribuyente tiene normalmente un solo P12 vigente. Después de cambiar la
clave maestra, o de restaurar un respaldo sin la clave original (riesgo R-15), la empresa no puede
firmar hasta conseguir un certificado nuevo de su entidad certificadora. La única salida hoy es
cargar otro P12 válido y después el original, que exige una segunda firma y deja otra firma como
vigente mientras tanto: no puede documentarse como un procedimiento seguro.

## What Changes

- **La idempotencia de la misma firma queda acotada.** Cargar otra vez la firma vigente sigue sin
  cambiar nada solo mientras su secreto pueda abrirse con la clave de custodia configurada.
- **Recuperación de la custodia.** Si el secreto de la firma vigente no puede abrirse con la clave
  configurada, cargar un P12 válido del mismo certificado, con su contraseña correcta y todas las
  validaciones de una carga normal, vuelve a custodiar la firma con la clave configurada. La firma
  sigue siendo la misma, con sus metadatos; el secreto anterior se destruye y lo reemplaza el nuevo;
  la respuesta indica que hubo un cambio (`unchanged: false`) y la firma vuelve a ser utilizable.
- **Recuperar es una modificación como el reemplazo:** exige el permiso de administrador, la
  empresa del usuario, el mismo bloqueo por empresa y que el administrador indique la firma vigente
  que ve. Una recuperación con una vista desactualizada es un conflicto y no cambia nada.
- **Después de recuperar, la idempotencia vuelve:** cargar otra vez el mismo P12 responde sin
  cambios.
- **Una carga de recuperación rechazada no toca nada:** contraseña incorrecta, archivo inválido,
  certificado fuera de vigencia o cualquier otro rechazo de la carga deja intactos la firma y su
  secreto.
- **Auditoría propia:** un evento nuevo, distinto de la carga y del reemplazo, registra que la
  custodia se restableció con la clave configurada: actor, empresa, metadatos de la firma y la
  versión de clave anterior y la configurada, sin archivo, contraseña, clave privada ni material
  cifrado.
- **Mensaje de la pantalla:** la confirmación de una recuperación dice que la firma vuelve a poder
  usarse, en lugar de «ya era la vigente» o «reemplazaste».
- **Documentación del comportamiento:** el ADR 0011, `deployment.md` y el comentario del contrato
  de la carga dicen que volver a cargar la misma firma restablece su custodia.

**Fuera de alcance:**
- La rotación automática de la clave maestra y el recifrado en bloque: la deuda sigue abierta (ADR
  0011).
- Varias claves maestras activas a la vez, el respaldo de una clave antigua dentro de la aplicación
  y la custodia doblemente cifrada. La vuelta atrás de una sustitución de clave es operativa:
  restaurar el respaldo previo de la base de datos junto con la clave antigua.
- El procedimiento operativo final de sustitución de la clave maestra y el cierre de C1 en la
  `definition-of-done.md`: se escriben después de aplicar este cambio y volver a ensayarlo.
- Un modo general de «forzar el reemplazo», campos nuevos en la API o un rediseño del historial de
  firmas.
- Cualquier cambio fiscal: XML, XSD, clave de acceso, SOAP, endpoints del SRI, reconciliación,
  numeración, aritmética tributaria y evidencia de certificación. La recuperación no firma
  comprobantes ni contacta al SRI.
- Las revisiones normativas pendientes (Q-27, Q-37, Q-53, matriz normativa) y el registro offline
  del WSDL de Producción (C2 y C3).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `signing-certificate`: la carga de la misma firma vigente distingue entre una custodia que se abre
  (sin cambios) y una que no se abre (recuperación de la custodia con la clave configurada), con sus
  validaciones, concurrencia, aislamiento e idempotencia posterior.
- `audit-trail`: la auditoría de la firma electrónica registra la recuperación de la custodia, y
  «cargar otra vez la firma vigente» deja de ser siempre un caso sin evento.

## Impact

- **Backend:** el caso de uso de carga de `signing` (`signing-certificate.ts`) y la lista de
  acciones de auditoría. Reutiliza las operaciones existentes del repositorio de firmas (bloqueo,
  borrado e inserción del secreto); sin migración: el modelo ya permite destruir el secreto de una
  firma vigente e insertar otro.
- **API:** `PUT /api/v1/signing-certificate` conserva su contrato; cambia el significado de
  `unchanged` en el caso de una custodia que no se abre. Sin campos nuevos.
- **Frontend:** solo el texto de confirmación de la carga en `features/signing`.
- **Pruebas:** integración del caso de uso y de la API, y un ensayo end-to-end que reinicia el
  backend real con una clave nueva sobre el mismo esquema (C1), con fixtures sintéticos.
- **Operación:** hace posible el procedimiento de sustitución de la clave maestra que C1 exige.
  Ningún cambio en la topología de despliegue, en el respaldo ni en la restauración.
