# Design

## Context

El tablero (`openspec/specs/dashboard/spec.md`) lee un resumen calculado por el servidor
(`GET /dashboard`) y, en el navegador, la vigencia de la firma (`GET /signing-certificate/validity`)
y la disponibilidad del correo (`GET /email/availability`). La spec prohíbe calcular importes en el
navegador.

## Decisions

### D1. La variación de las ventas la calcula el servidor

`month.invoices.previousChangePercent` es la variación de lo autorizado frente al mes anterior, en
porcentaje con un decimal, redondeado a la mitad hacia arriba, con signo; `null` si el mes anterior
no tuvo ventas. Así el navegador no divide importes. El porcentaje de facturas autorizadas sí se
calcula en el navegador: es una razón entre dos conteos, no un importe.

### D2. La conexión con el SRI se lee de los intentos guardados

`sri.lastContact` es el último intento de la empresa en su ambiente vigente (`sri_attempt`, por
`started_at`): su fecha y si llegó a recibir una respuesta HTTP menor que 500. `sri.transmissionEnabled`
refleja `SRI_TRANSMISSION_ENABLED`. El tablero nunca abre una conexión al SRI; un despliegue sin
transmisión muestra «Apagado».

| Situación | Texto | Estado |
| --- | --- | --- |
| Transmisión apagada | El envío al SRI está apagado en este servidor | Apagado |
| Sin intentos | Todavía no hay comunicaciones con el SRI | Sin datos |
| Último intento con respuesta | Última comunicación correcta: {fecha y hora} | Disponible |
| Último intento sin respuesta | La última comunicación no tuvo respuesta: {fecha y hora} | Sin respuesta |

### D3. La entrega de comprobantes combina la disponibilidad y el resumen

`attention.emailFailed` (ya existe) y `email.pending` (nuevo: último envío `PENDING` o `RETRYING`)
salen del resumen; `configured` y `deliveryEnabled`, de `GET /email/availability`. En orden:

| Situación | Texto | Estado | Enlace |
| --- | --- | --- | --- |
| Envío apagado en el despliegue | El envío por correo está apagado | Apagado | — |
| Sin servidor de correo | Falta configurar el servidor de correo | Configurar | Configuración › Correos |
| Con envíos fallidos | {n} correos sin enviar | Revisar | Todos los comprobantes, «Correo: No enviado» |
| Con envíos en cola | {n} correos en cola | Enviando | — |
| Ninguno pendiente | Los correos están al día | Al día | — |

### D4. Indicadores

- Icono en una caja redondeada con el tono del dato (azul; ámbar para los problemas cuando hay), un
  enlace con flecha arriba a la derecha con nombre accesible, el título, la cifra y una línea.
- Degradado azul suave de abajo hacia arriba sobre la tarjeta (`bg-linear-to-t` desde
  `primary` con poca opacidad hasta `card`), igual en el tema oscuro.
- La variación va en una insignia junto a la cifra: verde con flecha hacia arriba si sube, roja con
  flecha hacia abajo si baja, neutra si no cambia. Nunca solo por el color: lleva el signo.
- Enlaces: Ventas → Facturas autorizadas; Facturas autorizadas → Facturas; Problemas → Todos los
  comprobantes con «Devueltos»; Borradores → Facturas con «Borradores».

### D5. El panel deja el ambiente y el inventario

El ambiente ya se ve en la barra superior y los productos agotados en Avisos e Inventario; los
comprobantes con atención, en Avisos y en el indicador de problemas. Cada fila del panel enlaza a su
sección solo si el rol puede abrirla, con el permiso de la navegación.

## Risks

- Un despliegue que nunca transmite muestra siempre «Sin datos» o «Apagado»: es la verdad, no un
  error.
