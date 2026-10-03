# Revisión de la interfaz

Revisión de `docs/quality/frontend-checklist.md` para la pantalla `Firma electrónica`, su diálogo
`Cargar firma` o `Reemplazar firma`, el aviso de vencimiento del shell y la acción del requisito de
firma en Inicio (design D12 y D14). Fecha: 2026-10-02.

## Método

- Recorrido automatizado con Chrome (Playwright con el Chrome del sistema, en un directorio
  temporal fuera del repositorio) contra el backend y el frontend reales en desarrollo, sobre una
  instalación nueva aprovisionada en un esquema aislado de la base de pruebas, con la custodia
  habilitada y una clave maestra aleatoria de un solo uso.
- Las firmas son los PKCS#12 sintéticos de `backend/test/support` (design D16), generados en un
  directorio temporal. El reemplazo concurrente se provoca por la API desde la misma sesión. La
  firma no disponible se provoca reiniciando el backend con otra clave maestra.
- Las capturas se inspeccionaron.
- Pruebas de componentes en `frontend/test/signing-screen.test.tsx`,
  `certificate-notice.test.tsx`, `app-shell.test.tsx` y `readiness-screen.test.tsx` (Vitest con
  jsdom y Testing Library, por rol y nombre accesible), dentro de `corepack pnpm verify`.
- Contraste medido en el navegador sobre los colores calculados, con los fondos translúcidos
  compuestos sobre su fondo real, en ambos temas.

## Firma electrónica, diálogo y aviso (tareas 6.1 a 6.4)

63 comprobaciones contra el backend real en el recorrido principal, más 5 de la firma no
disponible, todas correctas:

- **Inicio y navegación:**
  - Inicio muestra el requisito de firma con su enlace a `Firma electrónica`, y deja de mostrarlo al cargar una firma utilizable;
  - destino `Firma electrónica` en `Configuración` y título de la pestaña.
- **Estados de la pantalla:**
  - vacío con la acción `Cargar firma`, sin aviso en el shell;
  - esqueleto de carga.
- **Errores reales del backend en el diálogo:**
  - sin archivo, en su campo;
  - tipo no admitido, como alerta temprana;
  - el límite mostrado es el efectivo del backend: "hasta 64 KiB", no el tope del contrato;
  - contraseña incorrecta, en su campo con `aria-invalid`;
  - archivo ilegible, en el campo del archivo;
  - firma vencida, en el campo del archivo con su vigencia;
  - sin RUC, en el cuerpo con titular y emisor;
  - incompatible, con el mensaje exacto de design D3.
  - Ningún mensaje repite la contraseña escrita.
- **Primera carga y reemplazo:**
  - primera carga con un RUC distinto: un solo `PUT` con doble clic, éxito que nombra al titular y la vigencia, y el diálogo se cierra;
  - "Utilizable" con vencimiento y días;
  - la advertencia de RUC distinto se presenta como comprobación preventiva y no menciona al SRI;
  - el reemplazo indica qué firma sustituye; con el RUC de la empresa, "Coincide con el RUC de la empresa." y la advertencia desaparece;
  - la misma firma otra vez: "Esa firma ya era la vigente: no cambió nada.".
- **Conflicto:** con un reemplazo concurrente, el diálogo explica el conflicto junto a `Recargar`, y `Recargar` lo resuelve.
- **Cierre:**
  - Escape cierra y devuelve el foco a `Reemplazar firma`;
  - al reabrir, la contraseña está vacía y no queda archivo elegido.
- **Anticipación:** fuera de rango, explicada; guardada con su mensaje.
- **Por vencer:**
  - estado y explicación en la pantalla;
  - aviso del shell con fecha y días, y para el administrador, el enlace `Ir a Firma electrónica`.
- **Teclado:** Tab llega a `Reemplazar firma`, y Enter abre el diálogo con el foco dentro.
- **Error de carga:** el mensaje genérico se recupera al reintentar.
- **Operador:**
  - sin destino y sin permiso por URL;
  - ve el aviso con "Pide a un administrador que la renueve." y sin enlace;
  - la API rechaza la consulta y la carga con `403`;
  - la vigencia solo trae `state`, `usable`, `notAfter` y `daysToExpiry`.
- **Firma no disponible (otra clave maestra):**
  - "No disponible" con su explicación;
  - aviso con enlace para el administrador y "Pide a un administrador que la vuelva a cargar." para el operador;
  - Inicio vuelve a pedir la firma;
  - la vigencia es `KEY_UNAVAILABLE` y no utilizable;
  - el registro de arranque nombra la empresa y la firma, sin secretos.
- **Móvil a 375 y 320 px:**
  - sin desbordamiento;
  - acciones, campo de anticipación y enlace del aviso de 44 px;
  - controles del diálogo de 44 × 44 px o más;
  - el diálogo cabe en la pantalla.
- **Tema oscuro** en página y diálogo.
- **Barrido a 640, 768, 1024 y 1440 px** de Inicio, Empresa, Ambiente, Establecimientos, Firma electrónica, Secuenciales, Usuarios y Mi cuenta. A 320 y 375 px, sin desbordamiento en las mismas pantallas, por el cambio compartido de 44 px.
- **Consola y red:**
  - sin errores de consola;
  - las únicas respuestas fallidas son las provocadas: la comprobación de sesión antes de iniciarla, los `400` y el `409` buscados, y el `503` simulado;
  - aparte, el navegador pide `/favicon.ico`, que no existe desde antes de este cambio.

| Sección | Resultado |
| --- | --- |
| Antes de construir | Brief de D14 (usuario, objetivo, decisión, información mínima y acción principal) en el encabezado de `signing-screen.tsx`, con P0 a P2. La huella y las firmas reemplazadas (P3) quedan fuera. |
| Tarea y jerarquía | Una acción principal, `Cargar firma` en el vacío o `Reemplazar firma` junto al título. El estado con su explicación encabeza la tarjeta; el detalle sigue con etiquetas; la anticipación es un formulario aparte, de menor jerarquía. |
| Datos y lenguaje | Titular y emisor por su nombre común; RUC y serie con cifras tabulares; fechas `dd/mm/aaaa` en hora de Ecuador; días con singular y "vence hoy". La advertencia de RUC nombra los dos RUC y dice que la firma se puede usar. Ningún identificador interno, huella ni dato de la clave. |
| Fundamentos | Escalas de espaciado y radios; estados con `StatusBadge` (icono y texto); franjas con icono y texto. |
| Selección de componentes | `FormDialog` con `FileField` y `PasswordField`. `NoticeStrip` se extrae de la franja de ambiente para compartirla. Entrada numérica corta para la anticipación. |
| Formularios y diálogos | La contraseña se envía exacta y con `autoComplete="new-password"`. Los errores van a su campo (contraseña; archivo, tamaño, clave y vigencia) o al cuerpo (sin RUC, incompatible, ocupado). El conflicto va con `Recargar`. Envío único; al cerrar se borran la contraseña, el archivo y los errores. |
| Feedback y estado | Carga y anticipación pasan por `useMutationFeedback`, con éxito que nombra al titular y la vigencia, o dice que nada cambió. El aviso de vencimiento es una franja persistente bajo la cabecera, solo por vencer, vencida o no disponible. Sin firma, la preparación en Inicio lo dice. |
| Navegación y responsive | `Firma electrónica` en `Configuración`, solo con `certificate.read`, antes de `Secuenciales`. En móvil, el detalle pasa a una columna y la acción a su propia fila. |
| Rendimiento | La pantalla hace una consulta. El aviso hace una consulta de vigencia compartida por el shell, que se invalida al cargar o al cambiar la anticipación. El archivo se lee en el navegador solo al enviar. |
| Tema y accesibilidad | Ambos temas revisados en página y diálogo. Claro y oscuro: texto del aviso a 15.3:1 y 14.1:1; advertencia de RUC a 16.0:1 y 12.7:1; error del diálogo a 15.1:1 y 13.6:1; etiquetas y ayudas atenuadas a 6.5:1 o más. Un `h1` y el `h2` del diálogo; la advertencia de RUC es una nota (`role="note"`), y el aviso, un estado. |

## Excepciones declaradas

| Criterio | Motivo |
| --- | --- |
| Contraste de 3:1 para iconos significativos | El icono de advertencia (`--warning`) mide 2.4:1 sobre la franja en tema claro (8.5:1 en oscuro), igual que en la franja de ambiente (excepción ya declarada en `add-taxpayer-setup`). Es decorativo en el aviso de vencimiento y en `StatusBadge` "Por vencer": `aria-hidden="true"`, no interactivo, y el texto junto a él lleva toda la información. |
| Tablas | La pantalla muestra una sola firma; las reemplazadas no se listan (P3, design D14). |
| Eliminar | No hay acción de eliminar: la firma solo se reemplaza (design D7). |

## Hallazgos corregidos durante la revisión

- El campo del archivo anunciaba "hasta 1024 KB", el tope del contrato, aunque el backend admite por defecto 64 KiB. Ahora la consulta de la firma devuelve `maxBytes` con el `CERTIFICATE_MAX_BYTES` efectivo, y el diálogo lo muestra y lo usa en la alerta temprana con el mismo formato en KiB que el error del backend (`formatCertificateBytes`). Así, subir el límite sigue sin requerir cambios en el frontend (nota en design D9); `signing-screen.test.tsx` lo comprueba con 64 y 128 KiB.
- La ayuda del archivo empezaba en minúscula ("un archivo .p12 o .pfx, …"); ahora dice "PKCS#12 (.p12 o .pfx), hasta 64 KiB.".
- `Button` (tamaños `md` y `sm`), `Input` y el botón de mostrar contraseña medían 32 o 40 px de alto en móvil. Ahora miden 44 px por debajo de 768 px, como pide `docs/architecture/frontend.md`. El arreglo es compartido; se revisó en el barrido de todas las pantallas.
- El enlace del aviso de vencimiento medía 19 px de alto en móvil; ahora mide 44 px.
- A 768 px, la tabla de Usuarios desbordaba la página: el encabezado oculto de la columna de acciones (`sr-only`, posición absoluta) escapaba del contenedor con desplazamiento. El contenedor de `AppDataTable` es ahora `relative`. Es un defecto previo, visible en el barrido.
