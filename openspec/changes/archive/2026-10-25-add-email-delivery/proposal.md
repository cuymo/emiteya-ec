# Proposal

## Why

Hoy el sistema emite y autoriza los seis comprobantes, pero no los entrega: el usuario descarga el
XML y el RIDE y se los hace llegar al receptor por su cuenta. El art. 6 de la Resolución
NAC-DGERCGC18-00000233 da por entregado un comprobante electrónico cuando el emisor envía con éxito
el XML y el RIDE al correo que dio el receptor. Omitir el envío, o enviar uno solo de los dos
archivos, es falta de entrega, una infracción distinta de no transmitir al SRI. El art. 5 obliga a
entregar aunque el receptor no lo pida. El propietario pidió que el sistema envíe por correo cada
comprobante autorizado, como lo hace el Facturador SRI, con avisos y reenvío cuando un envío falla.
Q-24 dejó el correo para P1 con un puerto de notificación sin implementar; este cambio lo
implementa.

## What Changes

- Nuevo: Configuración → «Correos», solo para el administrador. Allí se registra el servidor SMTP
  de la empresa (servidor, puerto, seguridad, usuario y contraseña guardada cifrada, que nunca se
  vuelve a mostrar), el remitente, una copia oculta opcional para la empresa y el envío automático.
  También tiene un correo de prueba para el ambiente de Pruebas y la opción de enviar un correo de
  prueba.
- Nuevo: cada comprobante autorizado se envía automáticamente por correo con su XML autorizado y su
  RIDE, en un mismo mensaje, a su receptor:
  - factura, al comprador;
  - nota de crédito y nota de débito, al comprador de la factura que modifican;
  - comprobante de retención, al proveedor retenido;
  - liquidación de compra, al proveedor;
  - guía de remisión, a sus destinatarios y a su transportista.
  Sin correo del receptor, o con el consumidor final, no se envía, y el comprobante lo dice.
- Nuevo: en el ambiente de Pruebas del SRI, los correos van solo al correo de prueba configurado,
  marcados como de prueba sin validez tributaria, nunca a los receptores (decisión del propietario,
  2026-10-23).
- Nuevo: cada envío tiene un estado basado en lo que el servidor de correo confirma: pendiente,
  enviado (el servidor lo aceptó), reintentando, fallido con su motivo, sin destinatario o con el
  envío desactivado. Nunca «entregado» ni «leído». Los fallos temporales se reintentan solos; los
  definitivos se detienen y se avisan.
- Nuevo: el usuario puede reenviar el correo de un comprobante autorizado, con los destinatarios
  propuestos y editables, y ve el historial de envíos del comprobante.
- Nuevo: un aviso con los comprobantes cuyo correo no se pudo enviar, y un filtro en la bandeja.
- Terceros: un tercero admite hasta tres correos en lugar de uno (decisión del propietario,
  2026-10-23).
- Despliegue: el envío está apagado por defecto con un interruptor de configuración, como la
  transmisión al SRI, y sale a Internet solo con una salida SMTP explícita. Para el despliegue
  local de revisión, un buzón de pruebas que atrapa los correos sin entregarlos a nadie (Mailpit);
  en producción, el SMTP real de la empresa (decisión del propietario, 2026-10-23).
- Plan por fases: primero el backend completo (datos, configuración, envío, reintentos, API y
  despliegue), después la interfaz.

## Fuera de alcance

- Avisar al receptor de un cambio de estado de un comprobante, como una anulación (art. 5,
  reformado por la Resolución NAC-DGERCGC25-00000014). El sistema todavía no registra anulaciones
  (Q-16); queda para un cambio posterior.
- Confirmar la recepción o la lectura: sin buzón de entrada no se procesan rebotes posteriores a la
  aceptación del servidor ni acuses de lectura.
- Un portal web para que el receptor descargue sus comprobantes (alternativa opcional del art. 6).
- Correos de la cuenta: recuperación de contraseña, invitaciones o cambio del correo de inicio de
  sesión. Este cambio solo usa el correo para los comprobantes.
- Proveedores de correo por API (SendGrid, Amazon SES y similares): solo SMTP.
- Plantillas de correo editables por la empresa: el asunto y el texto son fijos.
- Agregar el correo del receptor al XML (`infoAdicional`): el XML de los comprobantes no cambia.
- El RIDE impreso en dos ejemplares para firmar de las liquidaciones de compra (art. 6, 2.d): ya se
  imprime desde el archivo; este cambio solo recuerda hacerlo.

## Capabilities

### New Capabilities

- `email-delivery`: entrega por correo de los comprobantes autorizados. Cubre el servidor de correo
  de la empresa, el envío automático a los receptores de cada tipo, el destino de prueba del
  ambiente de Pruebas, los estados y los reintentos, el reenvío manual, el historial de envíos, los
  avisos de los no enviados y el interruptor del envío.

### Modified Capabilities

- `parties`: un tercero admite hasta tres correos, validados uno por uno y sin repetirse.
- `document-archive`: el historial de entregas deja de afirmar que no hay entregas por correo (el
  correo tiene su propio historial); la bandeja filtra por el estado del correo.
- `audit-trail`: se auditan los cambios del servidor de correo, los correos de prueba y los
  reenvíos manuales; los envíos automáticos no, porque su historial es su fuente de verdad.
- `production-deployment`: la salida deliberada a Internet cubre también el servidor SMTP, separada
  de la del SRI, y el despliegue local de revisión puede incluir un buzón de pruebas sin salida.
- `web-application-shell`: Configuración agrega la sección «Correos».

## Impact

- **Backend:** un módulo nuevo de correo (configuración, destinatarios, envío y reintentos) con su
  cola de trabajos, enganchado después de la generación del RIDE; la bóveda de la firma pasa a
  cifrar también la contraseña SMTP; migraciones (configuración del correo, envíos, hasta tres
  correos por tercero); permisos nuevos; endpoints bajo `/api/v1`.
- **Dependencias:** un cliente SMTP para Node (nodemailer), con su ADR.
- **Contratos:** esquemas de la configuración del correo, los envíos y el reenvío; los correos del
  tercero pasan a ser una lista.
- **Despliegue:** interruptor `EMAIL_DELIVERY_ENABLED` apagado por defecto, salida SMTP explícita
  separada de la del SRI y un buzón de pruebas para el despliegue local de revisión.
- **Frontend (fase posterior):** la sección «Correos», los correos del tercero, el estado y el
  reenvío en el detalle, el destinatario en la confirmación de la emisión, el filtro y el aviso.
- **Documentación:** integraciones, despliegue, seguridad (secretos y datos personales), API,
  modelo de dominio y la respuesta de Q-24.
