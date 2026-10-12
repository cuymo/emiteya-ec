# Proposal

## Why

El requisito de pruebas del ERS pide «pruebas de seguridad básicas y escaneo de dependencias/
secretos». Es la prioridad 3 del hardening del go-live (`docs/quality/sri-certification.md`,
`docs/quality/testing.md`). Hoy la CI no hace ninguna de las dos cosas.

**El problema es de los mantenedores y del operador que despliega el producto.** Nada avisa si una
dependencia publicada con una vulnerabilidad grave llega al lockfile, o si un secreto entra en el
historial.

**Evidencia de la readiness (2026-10-12):**
- **CI:** `verify.yml` es un único job de 37 a 40 minutos, con permisos de solo lectura y sin
  escaneos.
- **Funciones de GitHub no disponibles:** el repositorio es privado y de una organización. Las
  alertas de Dependabot, el grafo de dependencias, el escaneo de secretos y el de código están
  desactivados. La protección tiene que salir de herramientas del propio repositorio.
- **Hallazgos de dependencias actuales:** `pnpm audit` lee el lockfile real (dos documentos YAML,
  833 dependencias) en menos de un segundo. Encuentra hoy cuatro avisos HIGH y uno MODERATE.
- **Secretos:**
  - Ningún archivo de clave o certificado entró nunca en el historial (548 commits).
  - El `.gitignore` versionado no cubre `*.p12`, `*.pfx` ni `archivosensible.env`: esa protección
    solo existe en la exclusión local del clon.
  - En el directorio de trabajo hay un archivo de secretos real sin versionar, que un escaneo local
    recursivo leería.
- **Acciones de terceros:** las acciones de GitHub se referencian por etiquetas mutables
  (`actions/checkout@v5`, `actions/setup-node@v5`).

## What Changes

- **Escaneo de dependencias en CI.** Un comprobador del proyecto sobre `pnpm audit` falla ante
  avisos HIGH y CRITICAL, de producción y de desarrollo, directos y transitivos. MODERATE y LOW solo
  se informan. No hay período de gracia por antigüedad del aviso.
- **Excepciones revisadas y con vencimiento.** Un archivo versionado registra cada excepción: el
  aviso GHSA, el paquete, el alcance, el motivo, el responsable, la fecha de revisión y el
  vencimiento, de como máximo 90 días.
  - La CI falla ante una excepción vencida, incompleta, más amplia de lo permitido o que ya no
    corresponde a ningún hallazgo.
  - No hay comodines, excepciones por paquete completo ni por severidad.
- **Excepciones iniciales para los cuatro HIGH actuales**, sin corregirlos en este cambio. La
  implementación vuelve a ejecutar el escaneo sobre el lockfile vigente y crea cada excepción solo si
  ese aviso, ese paquete y esas rutas siguen apareciendo. Un HIGH o CRITICAL nuevo detiene el cambio
  antes de activar la compuerta:
  - `mysql2`, 30 días;
  - `deepmerge-ts`, 45 días;
  - `node-forge`, 90 días;
  - `braces`, 90 días.

  El MODERATE de `mysql2` sigue visible. Cada corrección queda como deuda propia.
- **Escaneo de secretos en CI con Gitleaks**, el binario oficial fijado por versión y SHA-256.
  - Recorre en cada push y pull request todo el historial que el checkout del evento pone a su
    alcance.
  - Mantiene activas sus reglas por defecto y añade reglas acotadas del proyecto: archivos PKCS#12,
    el archivo de secretos local, archivos `.env` que no son ejemplos, la clave maestra, el secreto
    de Better Auth, URL de Postgres con contraseña y claves privadas PEM.
  - Redacta los valores y nunca imprime el material encontrado.
  - Si la suma no coincide, la CI no ejecuta el binario y falla con `ERROR`, con una prueba que lo
    ejercita.
- **Un workflow propio de seguridad**, independiente del `verify` de 40 minutos:
  - dos jobs paralelos, uno de dependencias y otro de secretos;
  - en push, pull request, cada semana y a mano;
  - con solo permiso de lectura y sin secretos del repositorio.
- **Todas las acciones fijadas por commit**, también las dos que usa `verify.yml` hoy.
- **`.gitignore` versionado** con `*.p12`, `*.pfx` y `archivosensible.env`, sin cambiar las reglas
  de `.env`.
- **Comandos locales** `security:dependencies` y `security:secrets`. El de secretos:
  - revisa solo el historial y lo preparado para el commit, nunca el directorio de trabajo sin
    versionar;
  - exige que el Gitleaks local sea exactamente la versión fijada, y nunca lo descarga.
- **Respuesta ante un secreto encontrado:** contener, rotar o revocar y evaluar la exposición.
  Reescribir el historial solo con autorización explícita del dueño.

**Fuera de alcance:**
- Corregir o actualizar dependencias: cada corrección es un cambio aparte.
- OSV, Trivy, Grype, TruffleHog, `gitleaks-action` y cualquier otro escáner.
- SARIF y el escaneo de código de GitHub, que no está disponible.
- Activar Dependabot, el grafo de dependencias o el escaneo de secretos de GitHub.
- Fijar por digest la imagen de PostgreSQL: es del hardening de contenedores y despliegue.
- Validar OpenSpec en la CI: es un cambio pequeño posterior, con la CLI fijada.
- Reescribir el historial de git.
- Cualquier cambio fiscal o de ejecución del producto. Ningún paso contacta el SRI, ni Pruebas ni
  Producción.

## Capabilities

### New Capabilities
<!-- Ninguna: el cambio es de CI y de la cadena de suministro, sin comportamiento observable del
producto (`skip_specs: true`). -->

### Modified Capabilities
<!-- Ninguna. -->

## Impact

- **CI:**
  - un workflow nuevo, `.github/workflows/security.yml`;
  - en `verify.yml`, solo las referencias de las acciones pasan a commits fijados, y su
    comportamiento no cambia.
- **Herramientas del repositorio:**
  - dos comprobadores en `scripts/`, con sus pruebas;
  - el archivo de excepciones de dependencias y la configuración de Gitleaks;
  - dos scripts en `package.json`.
- **Dependencias:** ninguna dependencia npm nueva. Gitleaks es una herramienta de CI descargada y
  verificada por suma, que los desarrolladores instalan para el comando local.
- **Documentación:**
  - `docs/architecture/stack.md`, con la versión, el artefacto, la suma y la fuente de Gitleaks;
  - un ADR del escaneo;
  - `docs/security/hardening.md` y `docs/quality/testing.md`;
  - `docs/quality/technical-debt.md`, con las cuatro correcciones pendientes y la validación de
    OpenSpec en la CI.
- **Sin cambios** en el código de ejecución, la base de datos, las API, la interfaz, los flujos
  fiscales ni la evidencia de la certificación.
