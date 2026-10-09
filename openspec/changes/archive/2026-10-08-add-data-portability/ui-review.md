# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para Portabilidad de datos (`/configuracion/portabilidad`), con la solicitud, el progreso, el paquete listo, la descarga, la confirmación al generar de nuevo, el reemplazo, los mensajes y el gate del streaming de la descarga (design D16 y D23; tarea 6.3). Fecha: 2026-10-08.

## Método

- **Recorrido automatizado** con Chromium (`playwright-core` 1.64.0 en un directorio temporal fuera del repositorio).
  - Corre contra el backend real (`main.ts` como proceso) y el frontend compilado (`next start`), a través de la reescritura `/api/*` del frontend. La instalación es nueva, en un esquema aislado de la base de pruebas y con un directorio de paquetes propio en disco; el esquema se borra al terminar.
  - Sin firma ni transmisión, y sin ninguna llamada al SRI. No se usó ninguna firma real, ningún archivo de credenciales ni ninguna contraseña real.
  - La preparación es `backend/test/integration/portability-e2e-harness.ts`:
    - por la API real: la configuración tributaria, el logo, dos establecimientos con su punto y una operadora;
    - con los arneses de integración: comprobantes de los seis tipos en los dos ambientes, artefactos, respuestas del SRI (una truncada), terceros, productos, inventario, una firma activa y una reemplazada con sus secretos marcados, y los datos de autenticación marcados de un usuario que no inicia sesión.
  - El recorrido completo se repitió después de corregir los hallazgos, sobre una instalación nueva: 57 comprobaciones, todas correctas en el último.
- **Paquete descargado por el navegador**, verificado con herramientas independientes del generador:
  - su SHA-256 es el que muestra la pantalla;
  - `sha256sum -c --strict SHA256SUMS` dentro del paquete extraído con `unzip`: 40 archivos `OK`;
  - Python `zipfile`: `testzip()` sin errores, 41 entradas;
  - openpyxl 3.1.5: los seis libros abren, con 19 hojas;
  - `manifest.json` es JSON con `formatVersion` `"1"`, y `LEEME.txt` dice que no es un respaldo.
- **Capturas inspeccionadas** a página completa (15):
  - en escritorio y tema claro: el vacío, la cola, el paquete listo, el foco de la descarga, la confirmación, la generación con el paquete vigente, el reemplazo en la historia, el `409` y la falla de integridad;
  - el paquete listo a 375 y 320 px en los dos temas, y en escritorio en tema oscuro;
  - la operadora sin acceso.
- **Pruebas de componentes:**
  - `frontend/test/data-portability-screen.test.tsx` (12):
    - la carga, el vacío con la explicación, el error con reintento, el operador y el `403` sin acceso;
    - la cola, el progreso por fase sin porcentaje hasta quedar lista, con la historia actualizada;
    - el paquete listo con su SHA-256 copiable y la descarga por enlace, sin `fetch`;
    - la confirmación al generar de nuevo, el `409`, cada código de falla, una falla más reciente que el paquete vigente y la caducidad (vencida sin barrer, por vencimiento y por reemplazo).
  - La entrada de la navegación, solo para el administrador, en `app-shell.test.tsx`.
  - La ruta de la descarga del mismo origen, en `data-export-download-route.test.ts` (3).
- **Contraste:** medido en el navegador sobre el color calculado del elemento que contiene cada texto visible de `main`, de los diálogos y de los avisos, convertido a sRGB a través de un lienzo (los tokens son `oklch`), con los fondos translúcidos compuestos sobre su fondo real, en los dos temas.
- **Consola:** se registran los errores y las respuestas fallidas de todas las páginas recorridas. Son esperados:
  - el `401` de `GET /api/v1/me` en la pantalla de inicio de sesión, antes de iniciarla;
  - el `409`, simulado a propósito en el navegador para ver su mensaje.

  Se separa como ruido previo a este cambio el `404` del favicon: el frontend no publica favicon.

## Pantalla (tareas 6.1 y 6.3)

- **Orientación:**
  - título "Portabilidad de datos · Facturador SRI" y la entrada "Portabilidad de datos" activa en el grupo Configuración;
  - una sola acción primaria en cada estado: "Generar exportación" sin paquete vigente, y "Descargar paquete" con uno, con "Generar exportación" como secundaria.
- **Explicación:** los dos ambientes, sin la firma ni los secretos, sin las contraseñas ni las sesiones, sin los borradores, que no es un respaldo, que caduca 24 horas después de quedar listo y la lista `SHA256SUMS`.
- **Generación:**
  - tras solicitar se ve "En cola" con "Esperando su turno para generarse." y que se puede salir de la pantalla;
  - después, la fase y, cuando se conoce, "N de M comprobantes", nunca un porcentaje.
- **Paquete listo:**
  - el momento de los datos, la caducidad, el tamaño legible y en bytes, y el SHA-256 en monoespaciado, partido en cuatro grupos y con "Copiar SHA-256", que lo copia completo;
  - ningún identificador interno, ruta ni nombre de archivo interno.
- **Descarga:**
  - "Descargar paquete" es un enlace del mismo origen con `download`, que el navegador sigue, y llega con el foco visible (contorno de 2 px) por teclado;
  - el archivo se llama `datos-AAAAMMDD-HHMMSS.zip`, ASCII y sin datos personales.
- **Generar de nuevo:**
  - la confirmación explica que el actual sigue disponible y caduca cuando el nuevo quede listo;
  - mientras el nuevo está en cola, el anterior se sigue descargando;
  - al quedar listo, el anterior figura "Expirada", "Reemplazada por una más reciente".
- **`409`** (simulado): "Ya hay una exportación en cola o generándose. Espera a que termine para generar otra."
- **Paquete alterado en el disco:**
  - el navegador no recibe el archivo (descarga cancelada);
  - la pantalla vuelve a consultar y explica "El paquete guardado no pasó la verificación de integridad y no se entregó. Genera una exportación nueva.", con "Generar exportación";
  - la exportación queda `FAILED` con `DATA_EXPORT_PACKAGE_INTEGRITY`.
- **Operadora:** no ve la entrada y, al abrir la ruta, ve "No tienes permiso para ver esta sección".
- **Móvil a 375 y 320 px, en los dos temas:** tarjetas en lugar de la tabla y sin desbordamiento horizontal.
- **Contraste**, sin ningún texto por debajo de 4.5:1:

  | Vista | Mínimo |
  | --- | --- |
  | Vacío y fallida, claro | 5.95:1 ("Generar exportación") |
  | Lista, confirmación y `409`, claro, con los avisos | 4.83:1 (el texto de un aviso) |
  | Lista a 375 y 320 px, claro | 5.95:1 |
  | Lista a 375 y 320 px, oscuro | 6.71:1 |
  | Lista en escritorio, oscuro | 6.46:1 |

## Gate del streaming de la descarga (design D16)

Un paquete de 5 GiB con bytes aleatorios se publicó como listo en la misma instalación y se descargó en un disco giratorio (WD10EZEX). Se midieron el tiempo hasta las cabeceras (la verificación previa del SHA-256 completo), la duración y la memoria residente del backend y del proceso de Next (`next-server`, sin procesos hijos), con la caché de páginas fría (`POSIX_FADV_DONTNEED`) y caliente.

**Antes de corregir:** a través de la reescritura, la descarga respondía `500` a los 30 s. El reenvío de Next corta una respuesta que no envía nada en 30 s, y la verificación tarda más. Next no almacenaba nada. Directo del backend, la descarga era correcta.

| Camino | Estado | Cabeceras | Total | Crecimiento de la memoria |
| --- | --- | --- | --- | --- |
| Reescritura, caché fría | `500` | 30.3 s | 30.3 s | backend +74 MiB; Next +0 |
| Reescritura, caché caliente | `500` | 30.1 s | 30.1 s | backend +19 MiB; Next +0 |
| Backend directo, caché fría | `200`, SHA-256 correcto | 55.3 s | 92.4 s | backend +13 MiB |
| Backend directo, caché caliente | `200`, SHA-256 correcto | 37.0 s | 73.9 s | backend +21 MiB |

**Corrección:**
- la descarga tiene su ruta del mismo origen, `frontend/src/app/api/v1/data-exports/[id]/download/route.ts`, que reenvía la cookie al backend sin plazo de espera y devuelve su respuesta por streaming;
- el reenvío general de `/api` pasa a `fallback`, para que esa ruta dinámica tenga prioridad;
- la autenticación, el permiso, la empresa y la verificación siguen en el backend.

**Después de corregir:** los 5 GiB llegan completos y con el SHA-256 correcto por la ruta del mismo origen, con la memoria acotada.

| Camino | Estado | Cabeceras | Total | Crecimiento de la memoria |
| --- | --- | --- | --- | --- |
| Next, caché fría | `200`, SHA-256 correcto | 56.2 s | 109.1 s | backend +131 MiB; Next +106 MiB |
| Next, caché caliente | `200`, SHA-256 correcto | 49.5 s | 98.8 s | backend +61 MiB; Next +34 MiB |
| Backend directo, caché fría | `200`, SHA-256 correcto | 47.0 s | 85.7 s | backend +47 MiB |
| Backend directo, caché caliente | `200`, SHA-256 correcto | 40.2 s | 78.8 s | backend +58 MiB |

- El crecimiento es independiente del tamaño del paquete: ningún proceso almacena el cuerpo. El primer paso por la ruta incluye su carga en Next.
- Cada una de las cuatro descargas registró un `data_export.download_started`.
- **Costo de la verificación previa:** en este disco, entre 8 y 11 s por GiB antes del primer byte, y el paquete se lee dos veces (verificación y envío). Queda documentado para el proxy de producción en `deployment.md` ("Proxy inverso y descarga"); `bench:data-portability` lo mide con el paquete de Q-26.

## Lista de comprobación

| Sección | Resultado |
| --- | --- |
| Antes de construir | El brief de D23 (usuario, objetivo, decisión, información mínima y acción principal) está en el encabezado de `data-portability-screen.tsx`, con P0 a P3. Los identificadores internos (P3) no se muestran. |
| Tarea y jerarquía | El estado de la exportación vigente con su acción encabeza la pantalla; los detalles del paquete van con él; la explicación y la historia, debajo. Una sola acción primaria en cada estado. Sin indicadores ni porcentajes. |
| Datos y lenguaje | Estados y fases con las etiquetas del contrato; fechas y horas de Ecuador; tamaños con los separadores de es-EC. Las fallas se explican con lo que se puede hacer, sin códigos, rutas ni detalles internos. |
| Fundamentos | Escalas del proyecto. Los estados van con `StatusBadge` (icono y texto). |
| Selección de componentes | `AsyncButton` para generar; `ConfirmDialog` al generar de nuevo con un paquete vigente; la descarga como enlace con el aspecto de un botón; `AppDataTable` para la historia. |
| Tablas | Historia paginada en el servidor con el pie común; estados de carga y error con "Intentar de nuevo" dentro del marco; tarjetas por debajo de 768 px. Sin filtros ni acciones por fila: la historia solo informa. |
| Formularios y diálogos | Sin formularios: la solicitud no lleva datos. La confirmación cierra al terminar la solicitud y no se puede enviar dos veces. |
| Feedback y estado | La solicitud pasa por `useMutationFeedback`: pendiente en el botón, "Solicitaste la exportación…" al terminar y el `409` explicado. La generación sobrevive a salir de la pantalla. La historia se vuelve a consultar cuando cambia lo vigente. |
| Navegación y responsive | La ruta `/configuracion/portabilidad`, con "Portabilidad de datos" en el grupo Configuración, solo para el administrador. Sin desbordamiento a 375 y 320 px. |
| Rendimiento | Las consultas piden páginas acotadas; la de lo vigente pide una página de 100 y se repite cada 2 s solo mientras hay una en curso, y cada minuto con un paquete listo. El paquete nunca pasa por la memoria de la página. |
| Tema y accesibilidad | Los dos temas, revisados con los mínimos de arriba, también en los avisos. El progreso se anuncia con `aria-live`; la falla, con `role="status"`; el SHA-256 tiene su nombre accesible completo; los objetivos táctiles miden 44 px en móvil. |

## Hallazgos corregidos

| Hallazgo | Corrección |
| --- | --- |
| La insignia del estado del paquete vigente ("Lista", "Fallida") se estiraba a todo el ancho de la tarjeta. | La insignia va en su propio bloque y conserva su ancho. |
| Al terminar una generación, la historia seguía mostrando "En cola": dejaba de consultarse cuando ya no había una activa y su última consulta era anterior. | La consulta de la historia depende de lo vigente (la última exportación, su estado y el paquete listo) y se repite cuando cambia. Una prueba de componentes falla sin la corrección. |
| Los avisos de éxito, error, advertencia e información de toda la aplicación (sonner con `richColors`) tenían entre 3.1 y 4.4:1 en el tema claro. Era previo a este cambio, y lo encontró esta revisión al medir también los avisos. | `globals.css` oscurece el texto de cada tipo en el tema claro; el mínimo medido es 4.83:1. |
| Gate del streaming: a través de la reescritura `/api/*`, un paquete de varios GB respondía `500` a los 30 s. | La ruta de la descarga del mismo origen, sin plazo y por streaming, con el reenvío general en `fallback` (ver el gate). |
| Las dos descargas cortadas por el reenvío registraron `data_export.download_started`, aunque el cliente se había ido antes del primer byte. | El backend abandona la verificación cuando el cliente se desconecta, sin registrar la descarga ni responder, y la cuenta como `aborted` en `data_export_downloads_total`. Lo prueban una prueba de la ruta y una del servicio. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| `409` simulado en el recorrido | Provocar dos solicitudes simultáneas desde la pantalla no es determinista. La respuesta real se prueba por HTTP (`data-portability-api.test.ts`, también con dos solicitudes simultáneas). El recorrido simula la respuesta en el navegador solo para ver el mensaje y su contraste. |
| Fase con progreso en el recorrido | Con los datos de la revisión, la generación termina en pocos segundos y el recorrido solo alcanza a ver "En cola". La fase con "N de M comprobantes" se prueba en los componentes y en las pruebas del job. |
| Paquete del gate | El paquete de 5 GiB del gate es sintético (bytes aleatorios publicados como listos) para medir la descarga sin generar varios GB de artefactos. La generación de un paquete grande la mide `bench:data-portability`. |
| Excel y LibreOffice | La máquina de la revisión no tiene ninguno de los dos. Los libros se abrieron con openpyxl, y el escritor XLSX compartido es el de `add-reports-export` (ADR 0023). |
