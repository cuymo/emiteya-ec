# ADR 0029: nodemailer como cliente SMTP para la entrega por correo

## Status

Accepted el 2026-10-23, con la tarea 1.1 de `add-email-delivery` (design D5). El transporte llega
en la tarea 3.4 del mismo cambio.

## Context

- **Requisito.** El art. 6 de la Resolución NAC-DGERCGC18-00000233 da por entregado un comprobante
  electrónico cuando el emisor envía con éxito el XML y el RIDE al correo del receptor. El
  propietario pidió enviarlos con el servidor SMTP de cada empresa (Q-24 pasa de P1 a este cambio).
- **El protocolo pide mucho más que una conexión.** Hacen falta:
  - TLS directo (465) y STARTTLS (587), con el certificado verificado;
  - autenticación (`AUTH PLAIN` y `LOGIN`);
  - MIME multiparte con texto, HTML y dos adjuntos binarios en base64;
  - codificación de cabeceras con acentos (RFC 2047);
  - el resultado por destinatario (aceptados y rechazados).
- **La regla de integraciones no aplica.** «Axios para las APIs HTTP externas»
  (`../integrations.md`, `../stack.md`) no cubre SMTP, que no es HTTP. Este proyecto escribe sus
  propios formatos cuando una biblioteca no cumple sus límites (ADR 0023 y 0024); aquí no hay un
  límite de memoria o formato que lo justifique, y un cliente SMTP propio sería código de seguridad
  sin necesidad.
- **Pruebas.** Las pruebas de integración necesitan un servidor SMTP falso en proceso que pueda
  aceptar, rechazar credenciales o destinatarios, tardar o cortar la conexión, con y sin TLS.

## Decision

- **`nodemailer` 10.2.1 como dependencia de producción del backend**, en versión exacta.
  - MIT-0, sin dependencias, con sus tipos incluidos.
  - Es el cliente SMTP de referencia en Node.
  - Se usa solo en la infraestructura del módulo `email`. El dominio y la aplicación ven un puerto
    propio (`MailTransport`), nunca los tipos de nodemailer.
- **`smtp-server` 3.21.1 solo de desarrollo**, para el servidor falso de las pruebas. MIT-0, del
  mismo autor; depende de `nodemailer` en la misma versión y de `punycode.js` e `ipv6-normalize`.
- **Un transporte por envío, sin pool**, con tiempos agotados configurables. Opciones fijas:
  - `tls.rejectUnauthorized: true` y `minVersion: "TLSv1.2"`;
  - `requireTLS` con STARTTLS.
  - Sin cifrado solo con `EMAIL_ALLOW_PLAINTEXT_SMTP=1`, que pone únicamente el override del buzón
    de pruebas del despliegue de revisión.
- **Mailpit** (`axllent/mailpit`, MIT, versión fija) solo como buzón de pruebas del despliegue local
  de revisión (`deploy/compose.mailpit.yaml`). No es una dependencia del código ni entra en
  producción.
- **Descartados:**
  - Un cliente SMTP propio sobre `node:tls`: TLS, STARTTLS, AUTH, MIME y la codificación de
    cabeceras son una superficie de errores y de seguridad que nodemailer ya resuelve y prueba.
  - `emailjs`: menos uso y mantenimiento.
  - Proveedores por API (SendGrid, Amazon SES): el propietario eligió el SMTP de cada empresa, y
    añadirían cuentas y llaves de terceros.

## Consequences

- **Cambios incompatibles:** nodemailer publica majors con frecuencia (7, 8, 9 y 10 entre 2025 y
  2026). Actualizarlo es un cambio revisado con las pruebas de integración del transporte contra
  `smtp-server`, como cualquier dependencia (`security:dependencies`).
- **Bajo la salida restringida de la certificación** (`scripts/sri-egress/`), las variables de
  proxy no afectan a SMTP. Esa salida solo admite el SRI, y el correo queda fuera de ella.
- **Sin cifrado:** la conexión sin cifrado queda limitada al buzón de pruebas, con una variable
  explícita que la documentación de producción prohíbe.
