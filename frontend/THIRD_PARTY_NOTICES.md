# Avisos de terceros del frontend

Este archivo conserva los avisos de licencia del código y de los recursos de terceros que el
frontend copia o adapta, o que sirve como parte del producto. Las dependencias que se instalan con
pnpm traen su propia licencia en su paquete; aquí solo figuran las que se copian al repositorio o
cuyos archivos sirve la aplicación.

No recoge términos de compra ni condiciones comerciales que no estén en el código fuente recibido.
El árbol de la plantilla no se redistribuye: solo los archivos derivados que lista la sección
correspondiente, adaptados dentro de este repositorio.

## «Studio Admin» (next-shadcn-admin-dashboard)

Plantilla de referencia del sistema de diseño y del shell (ADR 0028). Versión 2.2.0, paquete
`studio-admin`. Los componentes derivados se adaptaron a los tokens, a la política de seguridad del
navegador y a la accesibilidad de este proyecto; la sección «Archivos derivados» los lista.

```text
MIT License

Copyright (c) 2024 Mohammed Arham Khan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn/ui

Origen de los primitivos que usa la plantilla y de las variantes CSS copiadas a
`src/app/globals.css` (las equivalentes de `shadcn/tailwind.css`).

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Geist

Fuente del producto, servida desde el propio origen por el paquete `geist` (ADR 0028). Solo se usa
la familia Geist Sans variable.

```text
Copyright (c) 2023 Vercel, in collaboration with basement.studio

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Archivos derivados

Cada archivo derivado lleva un comentario de procedencia. Origen relativo a `src/` de la plantilla y
destino relativo a `frontend/src/`.

| Destino | Origen | Licencia |
| --- | --- | --- |
| `app/globals.css`, variantes `data-open`, `data-closed`, `data-selected`, `data-disabled`, `data-active`, `data-horizontal`, `data-vertical` y la utilidad `no-scrollbar` | `dist/tailwind.css` del paquete `shadcn` 4.21.5 (no instalado: copiado de su fuente publicada) | MIT de shadcn/ui |
| `app/globals.css`, nombres de los tokens canónicos, neutros y escala de radios | `app/globals.css` de la plantilla | MIT de «Studio Admin» |
| `components/ui/button.tsx` | `components/ui/button.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/badge.tsx` | `components/ui/badge.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/sidebar.tsx` | `components/ui/sidebar.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/sheet.tsx` | `components/ui/sheet.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/dropdown-menu.tsx` | `components/ui/dropdown-menu.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/tooltip.tsx` | `components/ui/tooltip.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/popover.tsx` | `components/ui/popover.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/card.tsx` | `components/ui/card.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/select-menu.tsx` | `components/ui/select.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/pagination.tsx` | `components/ui/pagination.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/data-table/data-table-card.tsx` y `data-table-select-filter.tsx`, la tarjeta de la lista con su cabecera y los filtros con prefijo (composición visual) | `app/(main)/dashboard/users/_components/users.tsx` | MIT de «Studio Admin» |
| `components/data-table/data-table-footer.tsx`, el pie con filas por página y paginación numerada (composición visual) | `app/(main)/dashboard/users/_components/users-table.tsx` | MIT de «Studio Admin» |
| `features/invoices/draft-editor.tsx`, líneas con su fila de encabezados y «Agregar producto» en la cabecera de la sección (composición visual, sin arrastrar ni total de línea calculado en el navegador) | `app/(main)/dashboard/invoice/_components/invoice-items.tsx` | MIT de «Studio Admin» |
| `features/invoices/draft-editor.tsx`, el comprador como campo con su etiqueta y su control a todo el ancho de la columna (composición visual) | `app/(main)/dashboard/invoice/_components/client-selector.tsx` | MIT de «Studio Admin» |
| `features/invoices/draft-editor.tsx`, filas de importe del resumen con la columna numérica a la derecha (composición visual) | `app/(main)/dashboard/invoice/_components/invoice-adjustments.tsx` | MIT de «Studio Admin» |
| `components/layout/form-grid.tsx`, dos columnas por contenedor en los datos de cabecera (composición visual) | `app/(main)/dashboard/invoice/_components/invoice-details.tsx` | MIT de «Studio Admin» |
| `components/segmented-control.tsx`, la opción elegida como pieza elevada dentro de una pista neutra (composición visual) | `components/ui/toggle-group.tsx` (variante por defecto) | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/command.tsx` | `components/ui/command.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/breadcrumb.tsx` | `components/ui/breadcrumb.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/empty.tsx` | `components/ui/empty.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/avatar.tsx` | `components/ui/avatar.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/kbd.tsx` | `components/ui/kbd.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/separator.tsx` | `components/ui/separator.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/collapsible.tsx` | `components/ui/collapsible.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/skeleton.tsx` | `components/ui/skeleton.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/table.tsx` | `components/ui/table.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/toggle.tsx` | `components/ui/toggle.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/toggle-group.tsx` | `components/ui/toggle-group.tsx` (sin el `style` de `--gap`) | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `hooks/use-mobile.ts` | `hooks/use-mobile.ts` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/shell/app-shell.tsx` | `app/(main)/dashboard/layout.tsx` | MIT de «Studio Admin» |
| `components/shell/topbar.tsx` | `app/(main)/dashboard/layout.tsx (cabecera)` | MIT de «Studio Admin» |
| `components/shell/app-sidebar.tsx` | `app/(main)/dashboard/_components/sidebar/app-sidebar.tsx y nav-main.tsx` | MIT de «Studio Admin» |
| `components/shell/account-menu.tsx` | `app/(main)/dashboard/_components/sidebar/nav-user.tsx` | MIT de «Studio Admin» |
| `components/shell/company-context.tsx` | `app/(main)/dashboard/_components/header/account-switcher.tsx (patrón visual)` | MIT de «Studio Admin» |
| `components/shell/quick-create-menu.tsx` | `app/(main)/dashboard/_components/sidebar/nav-main.tsx` (Quick Create) | MIT de «Studio Admin» |
| `components/shell/command-palette.tsx`, `components/shell/command-palette-dialog.tsx` | `app/(main)/dashboard/_components/header/search-dialog.tsx` | MIT de «Studio Admin» |
| `components/data-table/data-table.tsx` | `app/(main)/dashboard/tasks/_components/tasks.tsx` y `users/_components/users-table.tsx` | MIT de «Studio Admin» |
| `components/data-table/data-table-search.tsx` | `app/(main)/dashboard/tasks/_components/tasks-toolbar.tsx` | MIT de «Studio Admin» |
| `components/data-table/row-actions-menu.tsx` | `app/(main)/dashboard/users/_components/users-columns.tsx` | MIT de «Studio Admin» |
| `components/layout/header-actions-menu.tsx`, el menú «⋯» de más acciones del título (composición visual, la del menú de las filas) | `app/(main)/dashboard/users/_components/users-columns.tsx` | MIT de «Studio Admin» |
| `components/layout/page-header.tsx` | `app/(main)/dashboard/file-manager/page.tsx` (encabezado) | MIT de «Studio Admin» |
| `features/documents/document-status-badge.tsx` | `app/(main)/dashboard/tasks/_components/columns.tsx` (insignia de estado) | MIT de «Studio Admin» |
| `components/ui/tabs.tsx` (solo horizontal, con la variante de línea) | `components/ui/tabs.tsx` | MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui |
| `components/ui/chart.tsx` (sin `ChartStyle` ni atributos `style`: colores de los tokens del tema) | `components/ui/chart.tsx` de shadcn/ui, sobre Recharts 3 (MIT, dependencia) | MIT de shadcn/ui |
| `components/ui/calendar.tsx` (en español, tokens del tema, una sola fecha, sin rangos ni números de semana) | `components/ui/calendar.tsx` de shadcn/ui, sobre react-day-picker 9 (MIT, dependencia) | MIT de shadcn/ui |
| `features/dashboard/dashboard-screen.tsx`, el tablero en tarjetas con cabecera, descripción y acción (composición visual) | `app/(main)/dashboard/users/_components/users.tsx` | MIT de «Studio Admin» |
