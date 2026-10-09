# Design

## Context

- **Lector.** El lector de PKCS#12 del módulo `signing`, con `node-forge` 1.4.0 (ADR 0019), lee los
  contadores de iteraciones del archivo sin la contraseña.
  - Los contadores son el del MAC, el de cada `EncryptedData` y el de cada `PKCS8ShroudedKeyBag`.
  - Rechaza con `CERTIFICATE_INCOMPATIBLE:ITERATIONS` si alguno supera `MAX_PKCS12_ITERATIONS`.
  - La comprobación es `max(contadores) ≤ techo`, con el borde admitido, antes de verificar el MAC o
    descifrar nada.
- **Pool.** La carga corre en el pool criptográfico (design D18 de `add-signing-certificate`):
  `CRYPTO_WORKERS` (2 por defecto, de 1 a 8) y `CRYPTO_TASK_TIMEOUT_MS` (30 000 por defecto, de 1000
  a 120 000).
  - La tarea `inspect-and-test-sign` abre el P12 dos veces: la inspección y la firma de prueba del
    firmador, que usa la misma familia de parser.
  - Cada emisión lo abre una vez más, en `sign-xml`.
  - Al vencer el plazo, el worker se termina y se reemplaza, y la petición recibe `CRYPTO_TIMEOUT`
    (503, «La operación criptográfica tardó demasiado y se canceló.»).
- **El P12 real de Security Data**, inspeccionado sin contraseña: PKCS#12 legado.
  - MAC SHA-1 con 102 400 iteraciones.
  - `pbeWithSHAAnd3-KeyTripleDES-CBC` para la clave, con 51 200.
  - `pbeWithSHAAnd40BitRC2-CBC` para los certificados, con 51 200.
- **Modelo de coste.** La KDF de PKCS#12 y PBKDF2 son lineales en las iteraciones y se repiten por
  cada derivación:
  - una para el MAC;
  - dos por cada contenido cifrado con PBE de PKCS#12 (clave e IV, y la clave 3DES necesita dos
    bloques de SHA-1);
  - una PBKDF2 por cada contenido PBES2.

  El coste total es la suma, sobre las derivaciones, de iteraciones × bloques.

## Goals / Non-Goals

**Goals:**
- **A.** Se cargan los certificados legítimos con el perfil de Security Data.
- **B.** Un PKCS#12 malicioso no consume CPU sin límite, y nunca bloquea el event loop.
- El techo es el **menor** valor justificado por medición, no una cifra redonda sin evidencia.

**Non-Goals:**
- Cambiar el pool: tamaño, timeout o cola.
- Cambiar el tamaño máximo de subida o los formatos admitidos.
- Agregar un presupuesto total de iteraciones o un límite de contenidos. Ver D4: queda como opción
  futura con su evidencia.
- Convertir, reexportar o reempaquetar P12, o cualquier parser alternativo.

## Decisions

### D1. Medir con el código real antes de decidir

Un script dedicado, `bench:pkcs12-iterations`, fuera de `verify`, mide con el pool criptográfico real
en su configuración por defecto de producción (2 workers, 30 s):
- el importador real (`inspect-and-test-sign`);
- la firma real (`sign-xml`), que no aplica el techo y mide una apertura en todos los perfiles.

**P12 sintéticos**, exportados con OpenSSL y comprobados por OpenSSL, de forma independiente:
- **forma de Security Data:** legado, con MAC N y cifrados N/2. OpenSSL fija las mismas iteraciones
  para el MAC y los cifrados, así que el MAC se recalcula con la KDF de PKCS#12;
- **legado uniforme:** MAC y cifrados N;
- **moderno uniforme:** PBES2 con AES-256 y PBKDF2-HMAC-SHA256, y MAC SHA-256.

Valores de N: 100 000, 102 400, 120 000, 131 072, 150 000 y 200 000. RSA 2048, y RSA 4096 en dos
perfiles. Se usan 7 repeticiones con calentamiento. Se miden:
- mediana y máximo; con 7 muestras, el P95 es el máximo;
- CPU y RSS del proceso;
- dos importaciones simultáneas;
- el retraso máximo del event loop del hilo principal;
- un archivo abusivo.

El P12 real no se usa en el benchmark. Resultado completo:
`docs/quality/benchmarks/pkcs12-iterations-2026-10-09.md`.

### D2. El techo es 131 072

Medianas del benchmark final, ya con el techo de 131 072. La importación con 100 000, el techo
anterior, era de 941 ms para la forma de Security Data y de 2,56 s para el moderno uniforme.

| Perfil | 102 400 | 120 000 | 131 072 | 150 000 | 200 000 |
| --- | --- | --- | --- | --- | --- |
| Una apertura (`sign-xml`), forma Security Data | 487 ms | 510 ms | 546 ms | 638 ms | 847 ms |
| Una apertura (`sign-xml`), moderno uniforme | 1,33 s | 1,53 s | 1,67 s | 1,91 s | 2,55 s |
| Importación, forma Security Data | 954 ms | 999 ms | 1,08 s | rechazo < 1 ms | rechazo < 1 ms |
| Importación, moderno uniforme | 2,62 s | 3,04 s | 3,34 s | rechazo < 1 ms | rechazo < 1 ms |

Criterios del dueño del producto:
- **El menor techo que admite 102 400 con un margen operativo razonable.**
  - 120 000 deja un 17 % de margen.
  - 131 072 deja un 28 %, y su peor caso legítimo cuesta un 10 % más que el de 120 000 (3,34 s
    frente a 3,04 s). Es 2^17, en la misma serie binaria que el perfil observado: 102 400 = 100 × 1024
    y 51 200 = 50 × 1024.
  - 150 000 y 200 000 encarecerían el peor caso legítimo un 14 % y un 53 % más que 131 072, sin
    evidencia de un perfil que lo necesite. La proyección sale de la apertura medida.
- **Ninguna evidencia pública** de un perfil mayor de Security Data. La búsqueda del 2026-10-09 no
  encontró documentación del proveedor sobre sus iteraciones. NSS (Firefox) acepta millones porque su
  importación es interactiva y cancelable; no es comparable con una carga de servidor y no se usa como
  base.
- **El parser no se vuelve de varios segundos con la carga normal.**
  - El perfil de Security Data importa en menos de 1 s: 954 ms de mediana.
  - El peor perfil legítimo en el techo, moderno uniforme con 131 072, importa en 3,34 s. Con 100 000
    ya eran 2,56 s, así que el cambio lo encarece un 30 % y queda 9 veces por debajo del timeout de
    30 s.
- **Respeta el pool:** no cambia ni su tamaño, ni su timeout, ni su cola.

### D3. Qué se limita: el máximo de los contadores, sin sumarlos

Se mantiene la semántica actual: `max(MAC, cada cifrado) ≤ 131 072`, con el borde admitido.
Alternativas evaluadas:
- **Sumar los contadores.** El modelo de coste es una suma, pero los perfiles legítimos tienen tres
  contadores y su coste lo domina el mayor. Un presupuesto de suma rechazaría o encarecería perfiles
  legítimos sin cambiar la cota real del caso abusivo, que es el timeout (D4).
- **Techos distintos para el MAC y los cifrados.** El perfil de Security Data usa el doble de
  iteraciones en el MAC que en los cifrados. Un techo menor para los cifrados limitaría poco, y
  agregaría una regla que ningún proveedor documenta.

### D4. Dos defensas, sin debilitar ninguna

- **El techo** rechaza antes de descifrar, en menos de 1 ms, como `CERTIFICATE_INCOMPATIBLE` con
  causa `ITERATIONS`, que tiene su propio mensaje accionable. Sirve también con un contador absurdo
  como 2 147 483 647.
- **El pool acotado con timeout** acota el coste total.
  - El caso que el techo no detiene es un archivo que repite contenidos cifrados dentro del tamaño
    máximo de subida. Medido:
    - con 100 000 iteraciones, 31 contenidos en 64 312 bytes se aceptaron en 16,8 s;
    - con 131 072, 31 contenidos en 65 335 bytes se aceptaron en 20,0 s, por debajo del plazo.
  - Cualquier caso por encima del plazo termina en `CRYPTO_TIMEOUT`, con el worker reemplazado.
  - El event loop no se bloquea: la CPU está en los workers, y el benchmark y una prueba lo comprueban.
- **Por qué `CRYPTO_TIMEOUT` y no `CERTIFICATE_INCOMPATIBLE:RESOURCE_LIMIT`.** Es el motivo ya
  consistente en el dominio, el mismo de la firma de cada emisión. Un plazo vencido puede deberse a un
  host saturado, y presentarlo como un archivo incompatible engañaría al administrador de un P12
  legítimo.
- **Riesgo residual, igual que antes del cambio.** Un administrador autenticado puede ocupar un worker
  hasta el timeout por carga. Si se quiere un rechazo barato de ese caso, la opción es un límite de
  contenidos cifrados por archivo o un presupuesto ponderado de derivaciones. Necesita una decisión del
  dueño del producto y no forma parte de este change.

### D5. Fixtures sintéticos de las pruebas

`test/support/p12-fixtures.ts`, el único código de pruebas que puede importar node-forge, genera los
casos:
- la forma de Security Data (102 400 y 51 200), con otro titular para probar un reemplazo;
- el borde en el MAC;
- el techo + 1 en el MAC y en un cifrado;
- un contador absurdo, sin recalcular el MAC: el techo debe rechazarlo antes de verificarlo;
- un archivo con contenidos repetidos, para el timeout.

Los casos del techo derivan de `MAX_PKCS12_ITERATIONS`, y una prueba fija su valor documentado.

### D6. Ensayo offline del P12 real

Después de la verificación focalizada se repite el ensayo offline:
- en un espacio de nombres de red sin interfaces (`unshare -rn`), con `SRI_TRANSMISSION_ENABLED=0`;
- con el lector, el importador en el pool, el firmador, el validador XSD y la medición de la recepción
  reales;
- con la contraseña leída de la configuración local de secretos, sin imprimirla.

Se registran solo:
- booleanos: emisor Security Data, OID del RUC, RUC igual al de la empresa, vigencia, firma,
  verificación y XSD;
- algoritmos y tamaño de la clave;
- los contadores de iteraciones;
- los tamaños de los siete documentos frente al tope de la certificación.

**Backend, operación sensible (carga de la firma).** Sin cambios:
- tenant y pertenencia: el administrador de su empresa, con `certificate.manage`;
- idempotencia: misma huella, sin cambios;
- restricciones de datos y auditoría;
- vías de fuga: errores con código y sin la contraseña, comprobado por pruebas.

Sin pantallas, sin migraciones, sin dependencias nuevas y sin desviaciones del stack.

## Risks / Trade-offs

- **Coste máximo legítimo +30 %.** Un P12 moderno con 131 072 iteraciones en todos sus contadores
  importa en 3,34 s frente a 2,56 s. Es aceptable para una operación rara (cargar la firma), dentro
  del timeout y sin bloquear el event loop. Cada emisión con ese P12 tarda unos 1,7 s de CPU en un worker.
- **El techo no acota el coste total por sí solo.** Ver D4: lo acota el timeout, y la mejora queda
  documentada como decisión futura.
- **El benchmark es de un solo equipo** (Ryzen 5 3600). En otro hardware las cifras escalan
  linealmente; la decisión se apoya en las proporciones entre perfiles, no en valores absolutos.
- **Un P12 de Security Data con un perfil mayor** que 131 072 se seguiría rechazando con el mensaje
  de `ITERATIONS`. Solo cambiaría con evidencia nueva y otra medición.
