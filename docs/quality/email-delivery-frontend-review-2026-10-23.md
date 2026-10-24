# Revisión visual del correo de los comprobantes (2026-10-23)

Tarea 11.3 de `add-email-delivery`. Pantallas revisadas con `frontend-checklist.md` en escritorio
(1440 px) y teléfono (390 px), solo tema claro (decisión del propietario, 2026-10-22). Rama
`redesign-frontend`.

## Condiciones

- **Arnés visual** (`frontend/visual/review`): el build de producción con la API simulada en el
  navegador. No usa backend ni llega al SRI.
- **App desplegada:** el despliegue local de revisión (`emiteya`), redesplegado con
  `deploy/compose.mailpit.yaml` a pedido del propietario.
  - `SRI_TRANSMISSION_ENABLED=0` se verificó en la API antes y después. No hubo ninguna conexión al
    SRI ni ningún envío nuevo.
  - Las capturas se tomaron con un administrador cuyas credenciales salen del archivo privado del
    despliegue, sin imprimirlas.

## Capturas

| Pantalla | Fuente | Escritorio | Teléfono |
| --- | --- | --- | --- |
| Correos: listo, sin configurar y el diálogo de prueba | Arnés | Sí | Sí |
| Confirmación «Emitir» en Pruebas y en Producción, con el destino del correo | Arnés | Sí | Sí |
| Alta de un tercero con tres correos | Arnés | Sí | Sí |
| Bandeja con el filtro «Correo: No enviado» y el indicador de la fila | App desplegada | Sí | Sí |
| Detalle de una factura: tarjeta «Correo», historial y «Reenviar correo» | App desplegada | Sí | Sí |
| Avisos con «1 comprobante sin enviar por correo» | App desplegada | Sí | Sí |
| Configuración → Correos con el servidor de Mailpit | App desplegada | Sí | Sí |

La consola del navegador no registró errores de página en ninguna captura de la app desplegada.

## Hallazgos corregidos

- **Correos:** la insignia «Contraseña guardada» bajaba unos píxeles el campo de la contraseña
  respecto del usuario. Los pares de campos usan ahora `FormGrid`, que alinea etiqueta, control y
  mensaje.
- **Detalle de un comprobante a 390 px:** con cuatro pestañas, la fila de pestañas ensanchaba toda la
  página en 96 px, también fuera de la pestaña del correo. `DocumentDetailTabs` lleva `min-w-0`: las
  pestañas que no caben se desplazan en su fila. La medida se repitió en la app desplegada, con la
  regla aplicada: el ancho de la página quedó en 390 px.
- **Datos del arnés desactualizados:** los terceros todavía tenían `email`, el título del editor de
  facturas había cambiado y faltaban el resumen del tablero (`/dashboard`) y el catálogo de tipos de
  identificación. Se pusieron al día junto con las entradas nuevas de la matriz.

## Lista de comprobación

- **Jerarquía:** cada pantalla tiene una sola acción principal: «Guardar servidor», «Reenviar
  correo», «Emitir…» y «Registrar tercero».
- **Estado:** el estado del correo nunca depende solo del color. La insignia y el indicador llevan
  icono y texto, o su nombre accesible en la fila de la tabla. «Enviado» dice que el servidor lo
  aceptó, sin afirmar que llegó al buzón.
- **Datos ocultos:** no se muestran la contraseña, los datos técnicos del servidor de correo ni
  identificadores internos. El operador ve el destino del correo sin la configuración.
- **Formularios:** React Hook Form con las reglas del contrato. Los rechazos del servidor van junto
  a su campo, no hay doble envío y los valores se conservan ante un error.
- **Teléfono:** no hay desbordamiento horizontal a 390 px después de la corrección de las pestañas,
  y los objetivos táctiles miden al menos 44 px.

## Excepciones declaradas

- **Tema oscuro:** no se revisó, por la decisión del propietario de revisar solo el tema claro.
- **Reenvío real:** el reenvío se abrió en la app desplegada, pero no se envió. Los comprobantes de
  la base local no tienen artefactos, y un envío terminaría en `ARTIFACT_MISSING`, como en la
  comprobación de la tarea 6.2 (`email-delivery-local-check-2026-10-23.md`). El envío con éxito, el
  error y el reintento con la misma clave están cubiertos por las pruebas de componentes.
- **Verificación completa:** la pasada de `verify` queda para la tarea 12.1.
