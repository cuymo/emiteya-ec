# Formato del paquete de portabilidad (`PORTABILITY_FORMAT_V1`)

Formato versión 1 del paquete que exporta `add-data-portability` (Q-28 resuelta; design D2 a D8;
ADR 0024). Es diseño de portabilidad del proyecto: ni el ERS (SEC-010) ni el CTX fijan un formato.
El paquete se lee sin la aplicación y su integridad se verifica con herramientas estándar. **No es
un respaldo**: no contiene la firma ni los datos internos de autenticación, y no se importa ni se
restaura (la restauración es la del respaldo operativo, `deployment.md`).

## Estructura

```
datos-AAAAMMDD-HHMMSS.zip
  manifest.json
  LEEME.txt
  data/empresa.xlsx  data/terceros.xlsx  data/productos.xlsx
  data/comprobantes.xlsx  data/inventario.xlsx  data/auditoria.xlsx
  documents/<produccion|pruebas>/<tipo>/<numero>/snapshot.json
                                     /firmado.xml  /autorizado.xml  /ride.pdf
                                     /sri/<intento>-<operacion>.<xml|bin>
  assets/logos/<sha256>.<png|jpg>
  SHA256SUMS
```

- **Contenedor:** ZIP64 (ADR 0024). Verificado con `zipfile` de Python, Info-ZIP `unzip`, 7-Zip y `bsdtar`. Un lector anterior a ZIP64 no abre un paquete con más de 65 535 archivos o más de 4 GiB.
- **Nombre del archivo:** `datos-AAAAMMDD-HHMMSS.zip`, con la fecha y la hora de Ecuador en que el paquete quedó listo. Nunca el RUC, un nombre ni un correo.
- **Orden de las entradas**, determinista: `manifest.json`, `LEEME.txt`, los seis libros, las carpetas de los comprobantes por ambiente, tipo y número, los logos y, al final, `SHA256SUMS`.
- **Métodos:** STORE para PDF, XLSX, PNG y JPEG; DEFLATE para XML, JSON y texto. Fecha DOS fija (1980-01-01); el momento del paquete va en el manifiesto.
- **Rutas:** cada segmento cumple `^[A-Za-z0-9][A-Za-z0-9._-]*$`, con un máximo de 200 caracteres por ruta, sin rutas absolutas, `..`, barras invertidas, caracteres de control ni enlaces simbólicos. Salen solo de componentes que genera el servidor:
  - `<ambiente>`: `produccion` o `pruebas`. El paquete trae siempre los dos cuando tienen datos;
  - `<tipo>`: `01-factura`, `03-liquidacion-de-compra`, `04-nota-de-credito`, `05-nota-de-debito`, `06-guia-de-remision` o `07-comprobante-de-retencion`;
  - `<numero>`: `EEE-PPP-SSSSSSSSS`, único por ambiente y tipo;
  - `<intento>`: el número del intento con el SRI, con tres dígitos o más; `<operacion>`: `recepcion`, `autorizacion` o `validez`; la extensión es `xml` si el tipo de contenido conservado es XML y `bin` en otro caso.

## `manifest.json`

JSON UTF-8 con sangría de dos espacios. Nunca lleva el inventario de los archivos: esa autoridad es
`SHA256SUMS`.

| Campo | Contenido |
| --- | --- |
| `format`, `formatVersion` | `PORTABILITY_FORMAT_V1` y `"1"`. Un cambio incompatible sube la versión |
| `generatedAt`, `generatedAtEcuador` | El momento en que se armó el paquete, en UTC y en Ecuador |
| `snapshotAt`, `snapshotAtEcuador` | El momento único de los datos: todo el paquete corresponde a él |
| `generator` | La aplicación y su versión |
| `company` | RUC, razón social y nombre comercial de la configuración vigente en `snapshotAt` |
| `scope` | La descripción del alcance, los ambientes, los tipos y los estados incluidos |
| `counts` | Comprobantes por ambiente, tipo y estado; artefactos por clase; respuestas del SRI; logos; archivos del paquete |
| `datasets` | Cada conjunto con su libro, sus hojas y sus filas |
| `formats` | Las versiones de los snapshots por tipo, las de los XSD de los XML, la de las columnas de los libros (`sheetColumnsVersion`) y la descripción de `SHA256SUMS` |
| `exclusions` | Lo que el paquete nunca contiene, con su motivo |
| `absent` | Cada artefacto esperado pero ausente: ambiente, tipo, número, clave de acceso, artefacto y motivo |

**Ausentes legítimos** (`absent`): el RIDE de un comprobante autorizado que todavía no lo tiene, con
`RIDE_PENDING`, o cuya generación está detenida, con `RIDE_STOPPED`. El paquete nunca genera un
RIDE. Un XML que el estado exige (el firmado desde que el comprobante se firma, el autorizado en
`AUTHORIZED`) y falta no es un ausente: la exportación falla con `DATA_EXPORT_ARTIFACT_MISSING`.

## `SHA256SUMS`

Una línea `<sha256 en minúsculas><dos espacios><ruta>` por cada archivo del paquete salvo él mismo,
en el orden de las entradas, en UTF-8 con `\n`. Se verifica con `sha256sum -c SHA256SUMS` (Linux) o
`shasum -a 256 -c SHA256SUMS` (macOS) en la carpeta descomprimida. El SHA-256 del paquete completo
se muestra en la pantalla Portabilidad de datos y queda en la auditoría (`data_export.completed`).

## Comprobantes

Por comprobante, en su carpeta:

- `snapshot.json`: los datos que congeló al reservar su número, como su valor JSON (la base no conserva los bytes originales del `jsonb`); los importes son texto decimal. La autoridad fiscal en bytes son los XML.
- `firmado.xml`, `autorizado.xml` y `ride.pdf`: los bytes exactos que el sistema conserva, verificados por tamaño y SHA-256 antes de escribirlos.
- `sri/`: las respuestas originales del SRI de sus intentos, con sus bytes exactos; una respuesta truncada por su límite se exporta tal cual y "Intentos SRI" la marca. Un intento sin respuesta no tiene archivo. La solicitud enviada no se conserva y no se exporta.

### Snapshots por tipo y versión

Cada snapshot lleva su `snapshotVersion`. Su forma completa es el tipo TypeScript de su módulo, que
se cita; los campos de primer nivel son estos:

| Tipo | Versión | Tipo de origen | Campos de primer nivel |
| --- | --- | --- | --- |
| 01 Factura | 1 y 2 (la 2 añade la decisión de inventario de cada línea) | `backend/src/modules/invoices/domain/snapshot.ts` | `snapshotVersion`, `schema`, `builderVersion`, `catalogDatasets`, `taxpayerConfig`, `issueDate`, `environment`, `environmentCode`, `issuer`, `buyer`, `lines`, `totals`, `payments`, `specialCases`, `key` |
| 03 Liquidación de compra | 1 | `backend/src/modules/purchase-settlements/domain/snapshot.ts` | `snapshotVersion`, `schema`, `builderVersion`, `calculationVersion`, `catalogDatasets`, `taxpayerConfig`, `issueDate`, `environment`, `environmentCode`, `issuer`, `supplier`, `eligibility`, `lines`, `totals`, `payments`, `currency`, `counts`, `key` |
| 04 Nota de crédito | 1 | `backend/src/modules/credit-notes/domain/snapshot.ts` | `snapshotVersion`, `schema`, `builderVersion`, `calculationVersion`, `catalogDatasets`, `taxpayerConfig`, `issueDate`, `environment`, `environmentCode`, `issuer`, `buyer`, `cause`, `reason`, `invoice`, `lines`, `totals`, `declarations`, `key` |
| 05 Nota de débito | 1 | `backend/src/modules/debit-notes/domain/snapshot.ts` | `snapshotVersion`, `schema`, `builderVersion`, `calculationVersion`, `catalogDatasets`, `taxpayerConfig`, `issueDate`, `environment`, `environmentCode`, `issuer`, `buyer`, `invoice`, `concepts`, `taxes`, `totals`, `payments`, `declarations`, `key` |
| 06 Guía de remisión | 1 | `backend/src/modules/shipping-guides/domain/snapshot.ts` | `snapshotVersion`, `schema`, `builderVersion`, `catalogDatasets`, `taxpayerConfig`, `issueDate`, `environment`, `environmentCode`, `issuer`, `departure`, `transporter`, `plate`, `transportStart`, `transportEnd`, `recipients`, `counts`, `key` |
| 07 Comprobante de retención | 1 | `backend/src/modules/withholding-receipts/domain/snapshot.ts` | `snapshotVersion`, `schema`, `builderVersion`, `calculationVersion`, `catalogDatasets`, `taxpayerConfig`, `issueDate`, `environment`, `environmentCode`, `issuer`, `subject`, `relatedParty`, `fiscalPeriod`, `supports`, `totals`, `key` |

## Libros

Seis libros XLSX escritos con el escritor compartido (`platform/xlsx/`, ADR 0023):

- **Celdas:**
  - las identificaciones, los números, las claves y las autorizaciones son texto;
  - los importes y los decimales son números exactos cuando caben en 15 dígitos significativos y 6 decimales, y si no, texto exacto;
  - las fechas fiscales son fechas, sin zona horaria; los momentos, la hora de Ecuador;
  - el texto de los usuarios es texto con `quotePrefix`, nunca una fórmula.
- **Claves entre hojas y archivos:** la clave de acceso del comprobante, el correo del usuario, el código del producto y la identificación del tercero; ningún identificador interno.
- **Hojas que superan el máximo:** una hoja admite 1 048 576 filas, el encabezado más 1 048 575 de datos. Un conjunto mayor sigue en `<Hoja> (2)`, `<Hoja> (3)`…, con el encabezado repetido, el mismo orden y sin perder ni repetir filas; el manifiesto nombra sus hojas.
- **Versión de las columnas:** `sheetColumnsVersion` "1". Cambiar una hoja o una columna cambia esa versión.

### `data/empresa.xlsx`

**Configuración**

| Columna | Celda |
| --- | --- |
| Versión | Decimal |
| Vigente | Texto |
| Desde | Momento (hora de Ecuador) |
| RUC | Texto |
| Razón social | Texto |
| Nombre comercial | Texto |
| Dirección matriz | Texto |
| Teléfono | Texto |
| Correo | Texto |
| Obligado a llevar contabilidad | Texto |
| Contribuyente especial | Texto |
| Agente de retención | Texto |
| Gran contribuyente | Texto |
| RIMPE | Texto |
| RUC del proveedor del sistema | Texto |
| Ambiente | Texto |
| Logo (SHA-256) | Texto |

**Establecimientos**

| Columna | Celda |
| --- | --- |
| Código | Texto |
| Dirección | Texto |
| Estado | Texto |
| Creado | Momento (hora de Ecuador) |

**Puntos de emisión**

| Columna | Celda |
| --- | --- |
| Establecimiento | Texto |
| Punto | Texto |
| Estado | Texto |
| Creado | Momento (hora de Ecuador) |

**Secuenciales**

| Columna | Celda |
| --- | --- |
| Ambiente | Texto |
| Establecimiento | Texto |
| Punto | Texto |
| Tipo de comprobante | Texto |
| Siguiente número | Decimal |
| Último reservado | Decimal |
| Actualizado | Momento (hora de Ecuador) |

**Catálogos habilitados**

| Columna | Celda |
| --- | --- |
| Catálogo | Texto |
| Entrada | Texto |
| Código | Texto |
| Habilitada | Texto |
| Actualizada | Momento (hora de Ecuador) |
| Por | Texto |

**Firmas**

| Columna | Celda |
| --- | --- |
| Estado | Texto |
| Titular | Texto |
| Emisor | Texto |
| Número de serie | Texto |
| Huella SHA-256 | Texto |
| Vigente desde | Momento (hora de Ecuador) |
| Vigente hasta | Momento (hora de Ecuador) |
| RUC detectado | Texto |
| Algoritmo | Texto |
| Bits | Decimal |
| Cargada por | Texto |
| Cargada | Momento (hora de Ecuador) |
| Reemplazada | Momento (hora de Ecuador) |

**Usuarios**

| Columna | Celda |
| --- | --- |
| Nombre | Texto |
| Correo | Texto |
| Rol | Texto |
| Estado | Texto |
| Miembro desde | Momento (hora de Ecuador) |
| Punto predeterminado | Texto |

### `data/terceros.xlsx`

**Terceros**

| Columna | Celda |
| --- | --- |
| Tipo de identificación | Texto |
| Identificación | Texto |
| Razón social | Texto |
| Dirección | Texto |
| Correo | Texto |
| Teléfono | Texto |
| Roles | Texto |
| Estado | Texto |
| Registro del sistema | Texto |
| Creado | Momento (hora de Ecuador) |
| Actualizado | Momento (hora de Ecuador) |

«Correo» lleva los correos del tercero en su orden, separados por comas (hasta tres;
`add-email-delivery`).

### `data/productos.xlsx`

**Productos**

| Columna | Celda |
| --- | --- |
| Código principal | Texto |
| Código auxiliar | Texto |
| Nombre | Texto |
| Descripción | Texto |
| Tipo | Texto |
| Precio unitario | Decimal |
| Control de stock | Texto |
| Estado | Texto |
| Creado | Momento (hora de Ecuador) |
| Actualizado | Momento (hora de Ecuador) |

**Impuestos**

| Columna | Celda |
| --- | --- |
| Código principal | Texto |
| Producto | Texto |
| Catálogo | Texto |
| Entrada | Texto |

### `data/comprobantes.xlsx`

**Comprobantes**

| Columna | Celda |
| --- | --- |
| Ambiente | Texto |
| Tipo | Texto |
| Número | Texto |
| Clave de acceso | Texto |
| Fecha de emisión | Fecha |
| Estado | Texto |
| Código de estado | Texto |
| Identificación del tercero | Texto |
| Tercero | Texto |
| Subtotal | Importe |
| Impuestos | Importe |
| Total | Importe |
| Número de autorización | Texto |
| Fecha de autorización | Momento (hora de Ecuador) |
| Carpeta | Texto |
| XML firmado (SHA-256) | Texto |
| XML autorizado (SHA-256) | Texto |
| RIDE (SHA-256) | Texto |
| RIDE | Texto |

**Transiciones**

| Columna | Celda |
| --- | --- |
| Clave de acceso | Texto |
| Desde | Texto |
| Hasta | Texto |
| Causa | Texto |
| Actor | Texto |
| Momento | Momento (hora de Ecuador) |

**Intentos SRI**

| Columna | Celda |
| --- | --- |
| Clave de acceso | Texto |
| Intento | Decimal |
| Operación | Texto |
| Ambiente | Texto |
| Inicio | Momento (hora de Ecuador) |
| Fin | Momento (hora de Ecuador) |
| Transporte | Texto |
| HTTP | Decimal |
| Resultado | Texto |
| Mensajes | Texto |
| Archivo de la respuesta | Texto |
| Respuesta (SHA-256) | Texto |
| Respuesta (bytes) | Decimal |
| Tipo de contenido | Texto |
| Truncada | Texto |
| Sobre enviado (SHA-256) | Texto |
| Sobre enviado (bytes) | Decimal |
| Iniciado por | Texto |

**Retenciones**

| Columna | Celda |
| --- | --- |
| Clave de acceso | Texto |
| Sustento | Decimal |
| Línea | Decimal |
| Tipo de sustento | Texto |
| Número de sustento | Texto |
| Fecha de sustento | Fecha |
| Impuesto | Texto |
| Código de retención | Texto |
| Base | Importe |
| Porcentaje | Decimal |
| Valor retenido | Importe |

**Destinatarios**

| Columna | Celda |
| --- | --- |
| Clave de acceso | Texto |
| Posición | Decimal |
| Identificación | Texto |
| Nombre | Texto |

**Entregas**

| Columna | Celda |
| --- | --- |
| Clave de acceso | Texto |
| Evento | Texto |
| Documento | Texto |
| SHA-256 | Texto |
| Usuario | Texto |
| Momento | Momento (hora de Ecuador) |

### `data/inventario.xlsx`

**Existencias**

| Columna | Celda |
| --- | --- |
| Código | Texto |
| Producto | Texto |
| Saldo | Decimal |
| Inicializado | Momento (hora de Ecuador) |
| Actualizado | Momento (hora de Ecuador) |

**Movimientos**

| Columna | Celda |
| --- | --- |
| Momento | Momento (hora de Ecuador) |
| Código | Texto |
| Producto | Texto |
| Posición | Decimal |
| Tipo | Texto |
| Cantidad | Decimal |
| Saldo resultante | Decimal |
| Comprobante | Texto |
| Origen | Texto |
| Usuario | Texto |
| Motivo | Texto |

### `data/auditoria.xlsx`

**Eventos**

| Columna | Celda |
| --- | --- |
| Momento | Momento (hora de Ecuador) |
| Tipo de actor | Texto |
| Actor | Texto |
| Acción | Texto |
| Usuario afectado | Texto |
| Cambios | Texto |

## Exclusiones

Nunca salen, por ninguna vía (design D6):

- la firma electrónica: el archivo P12, cifrado o no, su contraseña, la clave de datos envuelta, sus datos de cifrado y la clave maestra de la custodia; de cada firma solo salen sus metadatos;
- los datos internos de autenticación: hashes de contraseñas, cuentas, sesiones, tokens de verificación e invitaciones; de cada usuario solo su nombre, su correo, su rol y su estado;
- los borradores de los seis tipos de comprobante (política de portabilidad del proyecto para la versión 1; la exclusión no borra nada);
- los catálogos globales del SRI y el registro de XSD (datos públicos del SRI; se exportan las habilitaciones de la empresa);
- los datos técnicos: la cola de trabajos, las claves de idempotencia y las capacidades y reservas derivadas;
- las IP y los user agents, que la auditoría no guarda.
