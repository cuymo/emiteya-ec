## REMOVED Requirements

### Requirement: Límite de tamaño del envío al SRI
**Reason**: Q-47 quedó resuelta por política de producto. El límite de tamaño de la transmisión es una constante conservadora del código (`PRODUCT_CONSERVATIVE_POLICY_V1`), no un catálogo oficial versionado. La política oficial nunca se publicó porque la fuente («320 Kb») no define la unidad ni la representación.
**Migration**: Se retiran:
- el catálogo `sri-transmission-policy`, su tabla y su cargador;
- el endpoint `GET /fiscal-catalogs/sri-transmission-policy` y su vista en la pantalla de catálogos.

La política vive en el requisito «Límite de tamaño del envío» de `sri-transmission`. Si el SRI publica una aclaración, la atiende una decisión y un change nuevos.
