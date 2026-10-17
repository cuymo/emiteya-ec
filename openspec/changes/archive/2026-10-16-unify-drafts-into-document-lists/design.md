# Design

## Context

- **Tablas.** Cada tipo guarda sus borradores en una tabla propia (`InvoiceDraft`,
  `CreditNoteDraft`, etc., con `status` `DRAFT` o `EMITTED`). Sus comprobantes emitidos están en
  `ElectronicDocument`.
- **Responsables.** Cada módulo es dueño de las dos cosas de su tipo. Facturas lee las emitidas a
  través del `DocumentRepository` de `fiscal`.
- **Listas actuales.** Las de emitidos ordenan por creación descendente y admiten búsqueda, estado
  y los filtros de cada tipo. Las de borradores ordenan por última edición y solo paginan.
- **Fronteras.** Las pruebas de arquitectura impiden que un tipo importe a otro, así que la lista
  unificada vive dentro de cada módulo.

## Goals / Non-Goals

**Goals:**
- **Una tabla por tipo**: los borradores primero y después los emitidos, con paginación y total
  exactos del servidor.
- **«Borrador» como estado filtrable.**
- **Búsqueda sobre borradores y emitidos.**
- **Sin destino propio para borradores** en la navegación.

**Non-Goals:**
- **Sin tablas ni migraciones nuevas**, y sin cambiar las listas existentes de la API.
- **Sin borradores en el Archivo de comprobantes, los reportes ni la portabilidad.**
- **Sin ordenar por columna.**

## Decisions

### D1. Una ruta nueva por tipo: `GET /<prefijo>/entries`

- **Respuesta.** Una página de entradas `{ kind: "DRAFT", draft }` o
  `{ kind: "DOCUMENT", document }`, con las vistas de resumen que ya existen. Lleva `meta` con
  `page`, `pageSize` y `total`.
- **Consulta.** La de la lista de emitidos de ese tipo, con `state` ampliado a `DRAFT`.
- **Por qué una ruta nueva.** `GET /<prefijo>` y `GET /<prefijo>/drafts` se conservan tal cual:
  cambiar su forma rompería a quien las usa y sus pruebas. La ruta nueva no introduce un formato
  que cambie según los parámetros.
- **Orden.** Se declara antes de `/:id` en cada router.

### D2. Borradores primero, con una paginación exacta

- **Posiciones.** Los borradores ocupan las primeras `D` posiciones (la última edición primero) y
  los emitidos las siguientes `I`, con el orden de siempre. El total es `D + I`.
- **Una página.** El auxiliar puro `draftsFirstPage` (`platform/pagination`) la arma así:
  1. pide la página `p` de borradores, que coincide con la página global porque van primero, y
     obtiene `D`;
  2. completa con los emitidos desde la posición `max(0, (p−1)·n − D)`, pidiendo como mucho dos
     páginas de emitidos;
  3. si la página ya se llenó de borradores, pide una sola fila de emitidos para conocer `I`.
- **Repositorios.** Solo usa `page` y `pageSize`, así que ningún repositorio cambia.
- **Alternativa descartada.** Mezclar por fecha exigiría una consulta conjunta sobre tablas de dos
  módulos (Facturas lee los emitidos por un puerto de `fiscal`), o traer las dos listas enteras.

### D3. Filtros y búsqueda sobre borradores

- **Estados.**
  - `state=DRAFT` devuelve solo borradores.
  - Cualquier estado de comprobante emitido los excluye, igual que «Requiere atención» de
    Facturas.
- **Filtros de cada tipo.**
  - Notas de crédito: `cause` filtra también los borradores por su causa.
  - Retenciones: `fiscalPeriod` filtra también los borradores por su período.
  - Notas de débito: `cause` excluye los borradores, porque su resumen no lleva causas.
- **Búsqueda.**
  - Filtra los borradores en el servidor por el texto que muestran: el tercero y, si lo hay, el
    número del comprobante modificado.
  - Para eso recorre como mucho los 500 borradores más recientes del tipo, una cota que no limita
    el volumen esperado (decenas por empresa). Sin búsqueda, los borradores se paginan en la base.

### D4. Permisos

- **La ruta** exige el permiso de consulta del tipo, por ejemplo `invoices.read`.
- **Los borradores** aparecen solo si el rol tiene además el permiso de borrador, por ejemplo
  `invoices.draft`. Para eso el autorizador gana `allows(ctx, permiso)`, una comprobación sin
  evento de seguridad: no es una denegación, solo la forma de la lista.
- **Los roles de hoy** tienen los dos permisos en todos los tipos.

### D5. La fila de un borrador

En las seis tablas, un borrador:
- muestra el estado «Borrador» en una insignia neutra con su icono;
- en la columna del número, «Borrador» atenuado, con el tercero o el comprobante modificado como
  enlace a su editor;
- muestra el total previo en verde, o «Incompleto», atenuado;
- en la columna de fecha, «Editado» con su fecha y hora;
- se abre desde la fila, como un comprobante;
- ofrece «Eliminar borrador» en sus acciones, con la confirmación de siempre.

El panel «Borradores en curso» se retira. El filtro de estado ofrece «Borradores» (`?estado=borradores`)
justo después de «Todos».

### D6. Navegación

- **Barra lateral.** Se retira «Borradores de facturas» de Ventas.
- **Paleta.** Sus palabras clave («borradores», «factura pendiente», «factura sin emitir») pasan a
  Facturas.
- **Redirecciones.** `/borradores` lleva a `/facturas?estado=borradores` desde `next.config.ts`,
  igual que la antigua pestaña de Secuenciales.
- **Tablero.** El indicador de borradores pendientes enlaza a esa misma dirección.
- **Sin cambios.** Las direcciones de los editores (`/borradores/nuevo`, `/borradores/[id]` y
  `/<tipo>/borradores/...`) siguen igual.

## Risks / Trade-offs

- **Búsqueda en memoria** sobre los 500 borradores más recientes. Más allá de esa cota, la
  búsqueda no los vería. Se anota en `technical-debt.md`, con la paginación de borradores
  indexada como salida.
- **Hasta tres consultas por página** (una de borradores y dos de emitidos), siempre acotadas por
  el tamaño de página.
- **Dos listas de borradores en la API**: la nueva y la que ya existe. La antigua sigue para quien
  la use; el frontend deja de pedirla.
