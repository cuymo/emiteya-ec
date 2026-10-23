# Comprobación local de la entrega por correo con Mailpit (2026-10-23)

Tarea 6.2 de `add-email-delivery`. Despliegue local de revisión (`emiteya`), con
`deploy/compose.yaml` y `deploy/compose.mailpit.yaml`, en la rama `redesign-frontend`.

## Condiciones

- `SRI_TRANSMISSION_ENABLED=0` verificado en la API antes y después del despliegue. No hubo
  ninguna conexión al SRI.
- `EMAIL_DELIVERY_ENABLED=1` y `EMAIL_ALLOW_PLAINTEXT_SMTP=1`, puestas solo por el override de
  Mailpit. La topología por defecto los deja en `0`.
- Mailpit `v1.32.0`: su SMTP solo se alcanza por la red interna `app`, y su página solo en
  `127.0.0.1:8025`. La API sigue sin salida a Internet.
- Migraciones aplicadas por el servicio `migrate`: `20261023100000_add_email_delivery` y
  `20261023110000_add_party_emails`.

## Resultados

| Paso | Resultado |
| --- | --- |
| Consulta de Correos sin configurar | `settings: null`, envío encendido y sin cifrado admitido por el despliegue |
| Guardar el servidor `mailpit:1025`, sin cifrado ni usuario, con correo de prueba | `200`, versión 1 |
| Correo de prueba | `200`, «El servidor aceptó el correo de prueba.»; visible en Mailpit con su asunto y su destinatario |
| Direcciones propuestas de una factura autorizada en Pruebas | Ambiente `TEST`, va al correo de prueba |
| Reenvío de esa factura | `202`; el envío va solo al correo de prueba |
| Resultado del envío | `FAILED` con `ARTIFACT_MISSING`, sin intento SMTP ni correo en Mailpit |
| Filtro «correo no enviado» de la bandeja | Muestra ese comprobante |

## Limitación de los datos locales

Los comprobantes de la base local de revisión se sembraron sin artefactos: no tienen XML firmado,
XML autorizado ni RIDE. Su generación del RIDE está detenida por `RIDE_SOURCE_INTEGRITY`. Por eso
ningún comprobante local puede salir por correo.

El reenvío que falló es el comportamiento especificado: un correo nunca sale con uno solo de sus
dos archivos («Contenido del correo»).

El correo de un comprobante con sus dos adjuntos está cubierto por las pruebas automáticas contra un
servidor SMTP falso, incluido el RIDE real (`backend/test/integration/email-delivery-flow.test.ts`).
El propietario aceptó esta evidencia para la tarea el 2026-10-23.
