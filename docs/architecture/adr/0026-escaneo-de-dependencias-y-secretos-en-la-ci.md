# ADR 0026: escaneo de dependencias y de secretos en la CI con herramientas del repositorio

## Status

Accepted el 2026-10-12, en la revisión de `add-ci-dependency-and-secret-scanning`. Es la prioridad 3
del hardening del go-live y responde al requisito de pruebas del ERS («escaneo de
dependencias/secretos»).

## Context

- **La CI no escaneaba nada.** `verify.yml` era un único job de 37 a 40 minutos, con permisos de solo
  lectura.
- **Las funciones de GitHub no están disponibles.** El repositorio es privado y de una organización:
  las alertas de Dependabot, el grafo de dependencias, el escaneo de secretos y el de código (con
  SARIF) están desactivados. La protección tiene que salir del propio repositorio.
- **El lockfile tiene dos documentos YAML.** Primero va el de pnpm, con la versión del gestor; después
  el grafo del proyecto. La documentación de pnpm advierte que un lector de un solo documento puede
  ver cero dependencias.
- **Medido en la readiness y en la implementación:**
  - `pnpm audit --json` ve las 833 dependencias del lockfile real, sin `node_modules`, en menos de un
    segundo.
  - Con el registro caído, sale con el mismo código que «hay vulnerabilidades», pero sin JSON.
  - Gitleaks 8.30.1, en modo git, no informa las reglas por ruta de archivos binarios ni vacíos.
  - Su campo `Match` redactado sigue mostrando el nombre del archivo de un hallazgo por ruta.

## Decision

- **Dependencias: `pnpm audit`**, envuelto en `scripts/check-dependency-security.ts`.
  - Bloquean HIGH y CRITICAL, de producción y de desarrollo; MODERATE y LOW solo se informan.
  - Una salida inutilizable es `ERROR` y nunca pasa.
  - Las excepciones viven en `security/dependency-audit-exceptions.json`: GHSA, paquete, rutas,
    motivo, responsable, revisión y vencimiento de como máximo 90 días. Una excepción vencida,
    incompleta, demasiado amplia u obsoleta hace fallar.
- **Secretos: la CLI de Gitleaks**, fijada en `security/gitleaks.json` por versión, artefacto oficial
  y SHA-256.
  - **En la CI**, `scripts/security/install-gitleaks.sh` comprueba la suma antes de extraer o
    ejecutar nada.
  - **Configuración:** `.gitleaks.toml` extiende las reglas por defecto con reglas acotadas del
    proyecto.
  - **Comprobación de rutas:** `scripts/check-secret-security.ts` añade, solo con git, una
    comprobación de rutas para los archivos binarios.
  - **Alcance:** solo datos de git. En la CI, el historial alcanzable desde el commit del evento; en
    local, además, lo preparado para el commit. Nunca el directorio de trabajo.
  - **Salida:** solo metadatos redactados.
- **Un workflow aparte**, `.github/workflows/security.yml`:
  - dos jobs paralelos e independientes del `verify`;
  - en push, pull request, cada semana y a mano;
  - con `contents: read`, sin secretos y con `persist-credentials: false`.
- **Acciones fijadas por commit**, también las de `verify.yml`. La versión legible va en un
  comentario.

**Alternativas descartadas:**

| Alternativa | Motivo |
| --- | --- |
| OSV-Scanner, Trivy, Grype | Lectura no verificada del lockfile de dos documentos, y una herramienta más sin una brecha concreta |
| `dependency-review-action` | Exige Advanced Security en un repositorio privado |
| `pnpm audit --ignore-unfixable` o ignorados en `pnpm-workspace.yaml` | Ignoran en bloque, sin motivo, responsable ni vencimiento |
| `gitleaks-action` | Exige una clave de licencia en repositorios de organizaciones |
| TruffleHog | AGPL-3.0, y verifica credenciales contra las API de los proveedores |
| SARIF | El escaneo de código no está disponible |
| Pasos dentro de `verify.yml` | La corrida semanal repetiría el `verify` de 40 minutos |

## Consequences

- Un aviso HIGH o CRITICAL nuevo detiene la CI hasta corregirlo o exceptuarlo con revisión y
  vencimiento. Las excepciones iniciales vencen entre el 2026-11-11 y el 2027-01-10, y sus
  correcciones están en `../../quality/technical-debt.md`.
- Una caída del registro de npm hace fallar el job de dependencias con `ERROR`, nunca con `PASS`.
- Gitleaks y los SHA de las acciones no se actualizan solos: cada actualización es un cambio
  revisado.
- Los desarrolladores instalan la versión exacta de Gitleaks para el comando local, que nunca la
  descarga.
- El camino crítico de la CI no cambia: los jobs de seguridad corren en paralelo con `verify`.
- La validación estricta de OpenSpec en la CI queda como el siguiente cambio pequeño
  (`PINNED_OPEN_SPEC_CI_VALIDATION`).
