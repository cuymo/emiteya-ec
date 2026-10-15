# Benchmark de carga del frontend: editor de facturas y composición base (2026-10-15)

Mide lo que descarga el navegador al abrir cuatro pantallas del build de producción, y sus
peticiones a `/api/v1`, antes y después de `productize-invoice-editor-and-composition-foundation`
(tareas 1.4 y 7.3). El método es el de `frontend-facturas-2026-10-14.md`:
`corepack pnpm test:visual:bundle` suma los bytes de JavaScript, CSS y fuentes que llegan hasta que la
red queda en calma, con el Chrome del sistema y la API simulada del harness. Esta vez se añade la
nueva factura. Datos en `frontend-editor-2026-10-15.json`.

## Entorno

| Clave | Valor |
| --- | --- |
| next | 16.3.8 (Turbopack) |
| node | v24.21.0 |
| navegador | Google Chrome 154.0.8037.57 |
| os | Linux 7.1.6-1-cachyos |
| commit antes | 58f7dc9, con el harness del grupo 1 sin código de ejecución |
| commit después | cefb533, más el orden de teclado de las líneas del grupo 7 (el botón «Quitar» al final del DOM) |

## Resultados

«Transferido» es el cuerpo comprimido que llega por la red; «Decodificado», el tamaño una vez
descomprimido. Bytes. La fuente no cambia (69652 en las cuatro pantallas).

| Pantalla | Tipo | Archivos | Transferido antes | Transferido después | Diferencia | Decodificado antes | Decodificado después | Diferencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inicio de sesión | js | 16 | 347941 | 348487 | +546 | 1257134 | 1258909 | +1775 |
| Inicio | js | 19 | 371685 | 374024 | +2339 | 1336446 | 1344726 | +8280 |
| Facturas | js | 20 | 395622 | 398114 | +2492 | 1421073 | 1429766 | +8693 |
| Nueva factura | js | 20 | 386285 | 391087 | +4802 | 1381488 | 1397746 | +16258 |
| Todas | css | 1 | 13215 | 13957 | +742 | 72213 | 77300 | +5087 |

## Explicación de cada diferencia

- **CSS (+742 transferidos en todas):** las utilidades nuevas:
  - las variantes de contenedor del formulario (`@form-rail:`, `@form-wide:`, `@lg:`) y sus
    columnas con nombre;
  - los deshabilitados por variante (`disabled:not-aria-busy:`);
  - la selección neutra;
  - el popover.

  Es una sola hoja compartida.
- **JavaScript del shell (+2339 en Inicio y +2492 en Facturas):** el primitivo `Popover` y el
  indicador del ambiente con su explicación. A cambio salen la franja y el control de tema de la
  barra.
- **Inicio de sesión (+546):** la parte compartida del botón, con sus nuevas clases de
  deshabilitado.
- **Nueva factura (+4802):** lo del shell, más los primitivos de formulario (`FormLayout`,
  `FormSection`, `FormGrid` y `FormFieldRow`) y el aviso de la emisión.
- **Dependencias:** ninguna nueva. Desde el inicio del cambio, `package.json` solo suma el script
  `test:visual:review`, y el lockfile no cambia.

## Peticiones a la API

Iguales antes y después en las cuatro pantallas. La nueva factura sigue pidiendo `/me`,
`/company/status`, `/signing-certificate/validity`, `/establishments`, `/me/default-emission-point` y
`/fiscal-catalogs/payment-method/entries`: el editor no hace peticiones nuevas.
