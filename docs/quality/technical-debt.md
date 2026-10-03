# Technical Debt

## Active Debt

| Item | Impact | Owner | Target |
| --- | --- | --- | --- |
| Sin lint estático de accesibilidad para JSX (`bootstrap-application`). `eslint-plugin-jsx-a11y` y `eslint-plugin-react`, que incluye `eslint-config-next`, no admiten ESLint 10, y ESLint 9 está fuera de soporte. | Errores de accesibilidad detectables estáticamente (atributos ARIA inválidos, `alt` ausente, controles sin nombre) solo se detectan en pruebas o en revisión. Controles actuales: pruebas con Testing Library por rol y nombre accesible, revisión en navegador y `frontend-checklist.md`. | Mantenedores del frontend. | Criterio de salida: reactivar el lint estático de accesibilidad cuando exista una combinación soportada con ESLint 10 y Next.js, sin overrides ni parches no mantenibles. Se revisa en cada actualización de Next.js o de ESLint. |
| Dividir `frontend/src/features/company/company-screen.tsx` (532 líneas; `add-taxpayer-setup`). Reúne el esquema del formulario, la conversión de valores, cinco secciones y el manejo del conflicto de versión. | `frontend.md` pide descomponer un archivo que sigue creciendo: cada atributo tributario nuevo lo alarga y dificulta revisarlo. Hoy funciona y tiene pruebas. | Mantenedores del frontend. | Antes de añadir campos a la pantalla Empresa, o en el primer cambio que la modifique: extraer el esquema y la conversión a un módulo y cada sección a su componente, sin cambiar el comportamiento. |
| Publicar en OpenAPI las restricciones de los campos opcionales (`add-taxpayer-setup`). Los opcionales de `packages/contracts/src/taxpayer.ts` normalizan y convierten vacío en `null` con un `pipe` de Zod, y `z.toJSONSchema` documenta solo la entrada (`string` o `null`), sin el patrón ni la longitud. | Documentación incompleta para integradores (ERS API-005): la API valida igual, pero `docs/generated/openapi.json` no muestra, por ejemplo, el patrón del RUC proveedor. | Mantenedores de la API. | Investigar si merece la pena antes del primer integrador externo o del primer release público: reescribir los opcionales para que el esquema de entrada conserve las restricciones, o añadirlas como metadatos. |
| Paginar `GET /api/v1/establishments` y la pantalla Establecimientos (`add-taxpayer-setup`, design D7). Hoy se devuelven todos, con sus puntos anidados. `GET /api/v1/fiscal-sequences` y la pantalla Secuenciales (`add-fiscal-numbering`, design D14) heredan el mismo límite, con seis contadores por punto. | Sin impacto con el volumen esperado (decenas de establecimientos, Q-26). Con cientos, la respuesta y la lista crecen sin límite. | Mantenedores de la API y del frontend. | Cuando una medición o una instalación real lo pida: paginar con el contrato común y pasar las pantallas a `AppDataTable`. El contrato admite añadirlo sin romper el resto. |
| Actualizar el runner de CI de `ubuntu-24.04` a `ubuntu-26.04`. `.github/workflows/verify.yml` fija `ubuntu-24.04` desde el 2026-10-02, porque GitHub migra `ubuntu-latest` de 24.04 a 26.04 entre el 19 de octubre y el 19 de noviembre de 2026, y una imagen móvil hace la CI no reproducible. | Mientras siga en 24.04, la CI no prueba el sistema operativo que GitHub ofrece por defecto. El riesgo crece cuando GitHub anuncie el fin de soporte de la imagen 24.04. | Mantenedores de CI. | Mantenimiento separado, nunca dentro de un cambio funcional: cambiar la etiqueta a `ubuntu-26.04`, ejecutar la CI completa y revisar las diferencias de herramientas (Node, PostgreSQL de servicios, Chrome). A más tardar cuando GitHub anuncie la retirada de 24.04. |

## Comprobaciones pendientes

Ninguna.

## Resueltas

| Comprobación | Resolución |
| --- | --- |
| `actions/checkout@v5` y `actions/setup-node@v5` resuelven, y `.github/workflows/verify.yml` pasa en GitHub. | Resuelta el 2026-10-02: el workflow pasa en GitHub (ejecución 37026152613, commit `5c316a1`). La primera ejecución falló porque la caché automática de `setup-node` buscaba pnpm antes de que Corepack lo activara; se desactivó con `package-manager-cache: false`. |
| Extraer el arranque de `main.ts` de las pruebas end-to-end (deuda de `add-fiscal-numbering`). | Resuelta el 2026-10-02 en `add-signing-certificate`, que añadía la cuarta prueba end-to-end y una variable de arranque: `backend/test/integration/e2e-backend.ts` aprovisiona el esquema, arranca `main.ts`, espera a `/health/ready`, lo detiene e inicia sesión. Las cuatro pruebas end-to-end lo usan sin cambiar lo que comprueban. |

## Rules

- Debt must describe impact, not just discomfort.
- Debt discovered during implementation is linked to the OpenSpec change that found it.
- Critical debt becomes an OpenSpec change, with `skip_specs: true` when fixing it alters no behavior.

