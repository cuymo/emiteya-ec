# Spec Delta

## MODIFIED Requirements

### Requirement: Shell autenticado disponible
Toda pantalla autenticada SHALL mostrarse dentro del shell: navegación, barra superior con el
contexto de la empresa y el ambiente, avisos persistentes y el área de contenido de la pantalla.
Mientras se verifica la sesión, el shell SHALL mostrar su estructura y anunciar la verificación,
nunca una pantalla en blanco. Sin sesión, SHALL llevar al inicio de sesión conservando el destino
pedido.

#### Scenario: Pantalla autenticada
- **WHEN** un operador con sesión abre la pantalla de facturas
- **THEN** ve la navegación, la barra superior y el contenido de facturas dentro del shell

#### Scenario: Verificación de la sesión
- **WHEN** un usuario abre una pantalla autenticada y su sesión todavía se está verificando
- **THEN** ve la estructura del shell y un estado anunciado de verificación de la sesión, no una pantalla en blanco

#### Scenario: Sin sesión
- **WHEN** una persona sin sesión abre la pantalla de comprobantes
- **THEN** llega al inicio de sesión, y al iniciar sesión vuelve a la pantalla de comprobantes

#### Scenario: Aviso de la firma dentro del shell
- **WHEN** la firma electrónica de la empresa está por vencer
- **THEN** el shell sigue mostrando el aviso de vencimiento de la firma junto al aviso de ambiente, sin ocultar ninguno de los dos
