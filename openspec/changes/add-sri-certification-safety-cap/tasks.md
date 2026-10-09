# Tasks

## 1. Cuerpo de la recepción construido una sola vez

- [x] 1.1 Implementar `prepareReception(signedXml)` en `sri-engine/infrastructure/soap-envelopes.ts`
  (design D2). Calcula el base64 una sola vez, arma el sobre con ese mismo texto y devuelve el sobre y
  sus tres medidas (`signedXmlBytes`, `base64PayloadBytes`, `soapRequestBytes`). `receptionEnvelope`
  sigue dando los mismos bytes. Verificar con pruebas unitarias:
  - las medidas coinciden con las longitudes reales;
  - el sobre preparado es igual byte a byte al de `receptionEnvelope`.
- [x] 1.2 Cambiar `SriGateway` para que exponga la preparación y para que
  `submit(environment, prepared)` entregue al transporte exactamente `prepared.envelope`, después del
  circuit breaker, sin volver a armarlo. Verificar con una prueba unitaria y un transporte espía:
  - el `Buffer` que recibe el transporte es el mismo objeto preparado;
  - el circuit breaker sigue funcionando.
- [x] 1.3 Adaptar el handler `sri.transmit` y las pruebas de integración que simulan el gateway
  (`transmit-handler.test.ts` y los arneses de transmisión) a la nueva firma, sin cambiar su
  comportamiento. Verificar con el typecheck del backend. Las pruebas de integración corren en la
  verificación global con PostgreSQL.

## 2. Sesión de certificación en la transmisión

- [x] 2.1 Añadir la constante `CERTIFICATION_SAFETY_CAP_BYTES = 40_000` en
  `fiscal/domain/certification-safety-cap.ts`, con su origen documentado. Añadir la bandera
  `SRI_CERTIFICATION_SAFETY_CAP_ENABLED` (`0`/`1`, por defecto `0`) en `config/env.ts` y en la
  configuración de la transmisión (design D1). Verificar con una prueba del esquema de entorno:
  - por defecto la bandera está apagada;
  - no existe ninguna variable para el valor.
- [x] 2.2 Añadir los motivos de parada `CERTIFICATION_SIZE_CAP_EXCEEDED` y
  `CERTIFICATION_ENVIRONMENT_NOT_TEST`, con sus mensajes de negocio (design D5). Verificar con una
  prueba de `stopMessage`.
- [x] 2.3 Implementar la resolución pura de `effectiveSizePolicySource` (design D3), la guarda del
  ambiente en `executeSriStep`, antes de llamar al SRI y solo con la sesión encendida (design D4), y
  el orden de comprobaciones de la recepción (design D3), con su registro sin contenido (design D6). Verificar con pruebas unitarias del handler, con dobles en
  memoria y un gateway espía:
  - sesión apagada y sin política: `SIZE_POLICY_MISSING` y 0 llamadas;
  - Pruebas, sesión encendida y máximo de 39 999 bytes: pasa el tope;
  - exactamente 40 000: bloqueado y 0 llamadas;
  - más de 40 000: bloqueado y 0 llamadas;
  - XML por debajo y base64 en el tope o encima: bloqueado;
  - XML y base64 por debajo y SOAP en el tope o encima: bloqueado;
  - Producción con la sesión encendida: bloqueado antes de la red, también en la autorización y la
    reconciliación;
  - la sesión no cambia los endpoints ni el ambiente;
  - política más estricta: la oficial bloquea;
  - política más permisiva: el tope sigue bloqueando a partir de 40 000;
  - el bloqueo no crea intento con el SRI ni transición;
  - el cuerpo enviado es el medido.
- [x] 2.4 Sumar a `transmit-handler.test.ts` (PostgreSQL) el camino feliz de la sesión sin política
  y la guarda de Producción. Verificar en la verificación global con PostgreSQL. Estado
  2026-10-09: escritas y con typecheck; **NOT RUN** porque Docker no está disponible. Se ejecutan en
  la 5.2.

## 3. Readiness, métrica y registro de arranque

- [x] 3.1 Ampliar `createTransmissionGate` con la sesión (design D6): la precondición de tamaño se
  cumple con una política o con la sesión, y el estado lleva `sizeGate`
  (`certificationSafetyCapEnabled`, `capBytes` y `effectiveSizePolicySource`). Verificar con
  `test/fiscal/transmission-gate.test.ts` las cuatro fuentes:
  - `SRI_OFFICIAL_POLICY`;
  - `CERTIFICATION_CONSERVATIVE_CAP`;
  - `SRI_OFFICIAL_AND_CERTIFICATION_CAP`;
  - `MISSING`.
- [x] 3.2 Cablear en `main.ts`:
  - la bandera;
  - `sriSizeGate` en `/health/ready`;
  - las métricas `sri_certification_safety_cap_enabled` y `sri_certification_gate_blocks_total`
    (etiqueta `reason`);
  - la última comprobación de la sesión en la readiness;
  - el registro de arranque.

  Verificar con el typecheck y una prueba de la métrica en el interruptor.

## 4. Documentación

- [x] 4.1 Documentar la bandera en `docs/architecture/deployment.md`: una variable de la sesión de
  certificación, apagada por defecto, con el tope no configurable y sin que sea un límite oficial.
  Actualizar `docs/quality/sri-certification.md`:
  - la sesión y su habilitación;
  - las mediciones como evidencia de readiness;
  - la regla de los modos especiales, con lo prohibido (atajos fiscales, manipular la base, saltar
    validaciones o la firma, fingir autorizaciones, relajar la seguridad) y lo permitido (controles
    que solo hacen más restrictiva la sesión de Pruebas);
  - Security Data soportado, sin afirmar que el P12 concreto es compatible, con el sello electrónico,
    la persona natural sin RUC y la contraseña no ASCII como límites conocidos.

  Mantener Q-47 abierta como compuerta del go-live en `open-questions.md`. Verificar leyendo los
  documentos.

## 5. Verificación

- [x] 5.1 Verificación focalizada:
  - las pruebas unitarias de los grupos 1 a 3;
  - el typecheck y el lint del backend;
  - `openspec validate add-sri-certification-safety-cap --strict`;
  - `/opsx:verify add-sri-certification-safety-cap`.
- [ ] 5.2 Verificación global (`corepack pnpm verify`), con PostgreSQL disponible, antes de integrar
  en `main`. La ejecuta el cierre del cambio, no este apply.
