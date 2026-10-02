# Technical Debt

## Active Debt

| Item | Impact | Owner | Target |
| --- | --- | --- | --- |
| Sin lint estático de accesibilidad para JSX (`bootstrap-application`). `eslint-plugin-jsx-a11y` y `eslint-plugin-react`, que incluye `eslint-config-next`, no admiten ESLint 10, y ESLint 9 está fuera de soporte. | Errores de accesibilidad detectables estáticamente (atributos ARIA inválidos, `alt` ausente, controles sin nombre) solo se detectan en pruebas o en revisión. Controles actuales: pruebas con Testing Library por rol y nombre accesible, revisión en navegador y `frontend-checklist.md`. | Mantenedores del frontend. | Criterio de salida: reactivar el lint estático de accesibilidad cuando exista una combinación soportada con ESLint 10 y Next.js, sin overrides ni parches no mantenibles. Se revisa en cada actualización de Next.js o de ESLint. |

## Comprobaciones pendientes

| Comprobación | Motivo | Cuándo |
| --- | --- | --- |
| `actions/checkout@v5` y `actions/setup-node@v5` resuelven, y `.github/workflows/verify.yml` pasa en GitHub. | Sin remoto no puede ejecutarse; sus pasos se verificaron en local contra PostgreSQL de Compose. | Primera ejecución real de CI. No bloquea el archive de `bootstrap-application`. |

## Rules

- Debt must describe impact, not just discomfort.
- Debt discovered during implementation is linked to the OpenSpec change that found it.
- Critical debt becomes an OpenSpec change, with `skip_specs: true` when fixing it alters no behavior.

