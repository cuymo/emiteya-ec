# Proposal

## Why

El administrador de una empresa con firma de **Security Data**, una de las entidades certificadoras
acreditadas más usadas en Ecuador, no puede cargar su firma: la aplicación la rechaza como
incompatible antes de comprobar la contraseña.

- El ensayo offline del 2026-10-09 con el P12 real del operador falló con
  `CERTIFICATE_INCOMPATIBLE:ITERATIONS`.
- El archivo es un PKCS#12 legado, perfectamente válido:
  - MAC SHA-1 con 102 400 iteraciones;
  - clave 3DES y certificados RC2-40, con 51 200 iteraciones cada uno.
- El límite actual de la inspección, 100 000 iteraciones por contador (ADR 0019), es una defensa de
  recursos, no una regla de compatibilidad. Se fijó con P12 sintéticos, sin un P12 real de ningún
  proveedor.

Bloquea la certificación en Pruebas y, sobre todo, a cualquier cliente de Security Data.

## What Changes

- **El techo de iteraciones** de la inspección sube del valor actual al **menor** que admite el
  perfil observado de Security Data con un margen operativo razonable. El valor se elige con un
  benchmark del importador real en el pool criptográfico de producción, con P12 sintéticos.
- **Se conservan las dos defensas, sin debilitarlas:**
  - el techo por contador, que se aplica antes de descifrar nada, cuesta menos de un milisegundo y
    rechaza como incompatible;
  - el pool criptográfico acotado con timeout, que corta cualquier apertura demasiado larga sin
    bloquear el event loop.
- **Qué se limita, explícito en la especificación:** el máximo entre el contador del MAC y el de cada
  contenedor cifrado, con un borde inclusivo. No se suman los contadores, y la decisión se justifica
  con el modelo de coste medido.
- **Pruebas:**
  - una regresión obligatoria con la forma de Security Data (MAC 102 400 y contenedores 51 200);
  - los bordes del techo, un contador absurdo y el timeout;
  - un P12 válido que importa y una contraseña incorrecta;
  - que ningún error ni log revela la contraseña.
- **Documentación:**
  - el ADR 0019, con el límite nuevo y su evidencia;
  - un informe de benchmark nuevo en `docs/quality/benchmarks/`;
  - la acción local pendiente del operador: mover el P12 real fuera del árbol del repositorio.
- **Tras implementar:** se repite el ensayo offline con el P12 real, sin red.

**Fuera de alcance:**
- No cambia ninguna regla fiscal, del SRI ni del XSD.
- No se convierte, reexporta ni reempaqueta ningún P12, ni se agrega un parser alternativo.
- Tampoco cambian:
  - el tamaño máximo de subida;
  - el tamaño, timeout o cola del pool criptográfico;
  - el soporte de contraseñas no ASCII con PBES2.
- No se agrega un extractor de RUC ni soporte de sello electrónico.
- No se resuelve Q-47 ni cambia el tope de seguridad de la certificación.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `signing-certificate`: un requisito nuevo sobre el coste acotado de abrir la firma al cargarla.
  - Una firma legítima con el perfil observado de Security Data se carga.
  - Un PKCS#12 con contadores por encima del techo se rechaza como incompatible antes de descifrar.
  - Una apertura que excede el tiempo admitido se cancela sin cambiar la firma vigente.

## Impact

- **Código:** la constante del techo y su comentario en el lector de PKCS#12 del módulo `signing`. No
  cambian la API, los contratos, la base de datos ni la configuración.
- **Pruebas:** el lector de PKCS#12, el inspector en el pool y el generador de P12 sintéticos.
- **Herramientas:** un script de benchmark dedicado en `backend/scripts/`, fuera de `verify`.
- **Seguridad:**
  - el coste de un contenedor en el techo crece en proporción al techo nuevo;
  - el coste total de un archivo hostil con muchos contenedores sigue acotado por el timeout del
    pool, el tamaño máximo de subida y la concurrencia del pool, como hoy.
