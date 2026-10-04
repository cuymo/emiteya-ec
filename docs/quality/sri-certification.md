# Certificación con el SRI (S-3 online)

Procedimiento de la parte online de S-3 (`add-sri-transmission`, design D23): diez facturas
representativas, emitidas con la aplicación, autorizadas en el ambiente de Pruebas del SRI. Es una
compuerta previa a la transmisión real y a la puesta en producción. Corre fuera de la CI, en el
entorno de un operador, y no tiene ninguna ruta especial en el código: lo que se certifica es la
aplicación tal como se despliega.

## Compuertas previas a la transmisión real

| Compuerta | Estado | Evidencia |
| --- | --- | --- |
| Vector oficial de la clave de acceso | Cumplida (2026-10-04) | Ficha v2.34, sección 5.2 (ejemplo de verificación) y sección 7.2.3 (clave del ejemplo de recepción), en `backend/test/sri-engine/access-keys.contract.test.ts`; extracto en `docs/product/sri-catalogs/fuentes/ficha-v2.34-clave-de-acceso.txt` |
| Cifra del límite de tamaño (Q-47) | Abierta | Sin una política vigente, la transmisión habilitada no queda lista (design D17) |
| P12 ecuatoriano real | Pendiente | Lo aporta el operador; nunca entra al repositorio |
| RUC habilitado en Pruebas | Pendiente | Lo aporta el operador; nunca entra al repositorio |
| S-3 online | Pendiente | Este procedimiento |

Habilitar la transmisión en producción es una decisión de despliegue posterior a todas las
compuertas (`docs/architecture/deployment.md`).

## Requisitos

- **Datos del operador**, solo en su entorno y nunca en el repositorio, la CI pública, los registros de la ejecución ni los fixtures:
  - un P12 ecuatoriano real y vigente, y su contraseña;
  - un RUC habilitado por el SRI para el ambiente de Pruebas de comprobantes electrónicos;
  - la clave maestra de la custodia de firmas (`CERTIFICATE_MASTER_KEY`).
- **Política de tamaño vigente.** El dataset oficial `sri-transmission-policy` cargado, con la cifra de Q-47 ya resuelta. La política sintética de las pruebas no sirve: no es una cifra oficial.
- **Instalación nueva** sobre una base aislada, con la misma versión que se va a desplegar. Se anota el commit.

## Preparación

1. Arrancar el backend con la custodia habilitada y la transmisión habilitada:
   - `SRI_TRANSMISSION_ENABLED=1`;
   - sin ninguna variable `SRI_ENDPOINT_*`: rigen los endpoints de Pruebas del módulo central (`celcer.sri.gob.ec`);
   - el resto de `SRI_*` con sus valores por defecto.
2. Comprobar que `/health/ready` responde `200` con `"sriTransmission": "enabled"` y que `sri_transmission_enabled` vale `1` en `/metrics`. Si la readiness da `503`, falta una precondición (workers, endpoints o política de tamaño): se corrige, no se rodea.
3. Desde la interfaz, como administrador:
   - configuración tributaria con el RUC de Pruebas y el ambiente de Pruebas;
   - establecimiento y punto de emisión;
   - carga del P12 real en `Firma electrónica`;
   - los clientes y productos de las diez facturas.

## Facturas representativas

Diez facturas emitidas desde la interfaz, como lo haría un usuario. Ninguna se construye fuera de la
aplicación.

| # | Caso |
| --- | --- |
| 1 | Consumidor final por debajo del monto máximo |
| 2 | Cliente con RUC, una línea con IVA 15 % |
| 3 | Cliente con cédula |
| 4 | Cliente con pasaporte |
| 5 | Varias líneas con IVA 15 %, 5 % y 0 % |
| 6 | Descuento por línea |
| 7 | Un servicio |
| 8 | Varias formas de pago |
| 9 | Cantidades y precios con decimales en la frontera de la precisión |
| 10 | Una factura con el número de líneas habitual del negocio del operador |

## Verificación por factura

Cada factura debe terminar en `AUTHORIZED`. Para cada una se verifica, con consultas de solo
lectura sobre la base y con la interfaz:

- **Se envió el XML persistido:** el `sent_artifact_sha256` y el `sent_artifact_size` del intento de recepción (`sri_attempt`) coinciden con el `SIGNED_XML` de la factura (`document_artifact`).
- **El transporte es el real:** el `endpoint` del intento es el de Pruebas del módulo central.
- **La respuesta original quedó guardada** en `sri_response`, antes de su clasificación, con su hash y su tamaño.
- **Los parsers y las transiciones son los reales:** `sri_attempt_result` registra el resultado y la versión del clasificador; `document_state_transition` registra `SIGNED → RECEIVED → AUTHORIZED`, sin estados intermedios inesperados.
- **La autorización quedó guardada:** el número, la fecha y el ambiente en el detalle de la factura, y el artefacto `AUTHORIZED_XML` con la clave de la factura.
- **El historial** de la sección "Transmisión al SRI" muestra el envío y la consulta, sin datos técnicos.

Una factura que no termine en `AUTHORIZED` detiene la certificación hasta entender la causa con su
respuesta original guardada. Si contradice una decisión del diseño (por ejemplo, la clasificación
de un estado o de un código), se abre `/opsx:update`: el comportamiento no se adapta en silencio.

## Respuestas reales como fixtures

Las respuestas reales pasan a ser fixtures de contrato de los clasificadores:

1. Exportar el cuerpo guardado de cada respuesta (`sri_response.body`) de una recepción, una autorización y, si se observaron, de las respuestas con mensajes.
2. Anonimizarlas: el RUC, la razón social, los nombres y las identificaciones del emisor y del comprador se reemplazan por los datos sintéticos de las pruebas; la clave de acceso se recompone con esos datos y su dígito verificador. Nada de la firma ni del certificado del operador queda en el fixture.
3. Guardarlas como fixtures marcados como **reales anonimizados**, con la fecha de la ejecución y la versión de la ficha vigente, junto a pruebas que comprueben el resultado de cada clasificador.

## Registro de la ejecución

Al terminar se registra, sin secretos ni datos del contribuyente: la fecha, el commit, el ambiente,
las diez facturas con su resultado, las incidencias y su resolución. El estado de la compuerta pasa
a cumplida en la tabla de arriba y en la fila S-3 de `docs/product/open-questions.md`.

| Fecha | Commit | Resultado | Notas |
| --- | --- | --- | --- |
| Pendiente | | | |

## Qué no se hace

- No hay rutas, banderas ni modos especiales para la certificación.
- El interruptor de la transmisión no salta invariantes fiscales: con él encendido rigen la integridad del artefacto, el límite de tamaño y la máquina de estados.
- No se reintenta "de todas formas" una factura en revisión manual: sale solo con la reconciliación y evidencia concluyente.
- No se suben al repositorio el P12, su contraseña, el RUC real, la clave maestra ni respuestas sin anonimizar.
