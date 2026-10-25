# Cómo contribuir

Gracias por querer mejorar EmiteYa. Este documento resume cómo trabajamos; el detalle está en
`AGENTS.md`, `ARCHITECTURE.md` y `docs/`.

## Antes de empezar

- Lee `docs/product/overview.md` para entender el alcance: un facturador electrónico self-hosted
  para Ecuador, no un ERP, un POS ni un sistema contable.
- Para un cambio de comportamiento, abre primero un issue para acordar el enfoque.
- Al contribuir, aceptas que tu aporte se publica bajo la licencia del proyecto, AGPL-3.0
  (`LICENSE`).

## Entorno

Sigue `README.md`: Node.js 24 con Corepack, pnpm (versión fijada en `package.json`) y Docker para
PostgreSQL. No uses npm ni yarn.

## Cómo cambiamos el comportamiento

- Los cambios no triviales siguen OpenSpec: una propuesta en `openspec/changes/<nombre>/` con su
  diseño, la especificación que cambia y sus tareas. `openspec/specs/` describe el comportamiento
  vigente.
- La documentación se actualiza en el mismo cambio que el comportamiento.
- Las reglas fiscales citan su fuente oficial (`docs/architecture/fiscal-emission.md`).
- La interfaz está en español, con moneda USD y la zona horaria de Ecuador.

## Calidad

- Cada cambio llega con sus pruebas. Antes de abrir el pull request:

  ```bash
  corepack pnpm verify
  ```

- Las dependencias van en versión exacta y se justifican; una dependencia de producción nueva
  necesita su ADR en `docs/architecture/adr/`.
- Commits pequeños y coherentes, con un mensaje corto y descriptivo
  (`feat(frontend): …`, `fix(backend): …`, `docs: …`).

## Lo que nunca debe entrar al repositorio

- Firmas electrónicas reales (`.p12`/`.pfx`), sus contraseñas ni archivos `.env` con valores
  reales. El escaneo de secretos (`corepack pnpm security:secrets`) lo bloquea.
- Datos tributarios de personas o empresas reales.
- Llamadas al SRI en las pruebas: la transmisión está apagada por defecto y las pruebas usan
  dobles.

## Reportar errores de seguridad

No uses issues públicos: sigue `SECURITY.md`.

## Conducta

Este proyecto sigue el `CODE_OF_CONDUCT.md`.
