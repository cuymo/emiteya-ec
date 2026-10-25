## MODIFIED Requirements

### Requirement: Dirección inexistente
Una dirección que no corresponde a ninguna pantalla SHALL mostrar el logo de EmiteYa en el centro, el título «Oops…», un mensaje que explica que la página no existe y un enlace para volver a Inicio. Con sesión, SHALL mostrarse dentro del shell, con la barra lateral y la barra superior. Sin sesión, SHALL mostrarse sola, sin solicitar datos de la empresa. Las rutas de la API no SHALL verse afectadas por esa página.

#### Scenario: Dirección inexistente
- **WHEN** un usuario abre una dirección que no existe en la aplicación
- **THEN** ve el logo, «Oops…», que la página no existe y un enlace a Inicio

#### Scenario: Con sesión, dentro del shell
- **WHEN** un usuario con sesión abre una dirección que no existe
- **THEN** la página se muestra con la barra lateral y la barra superior, como cualquier otra pantalla

#### Scenario: Sin sesión
- **WHEN** una persona sin sesión abre una dirección que no existe
- **THEN** ve la misma página sin el shell, y no se piden datos de la empresa

#### Scenario: La API no cambia
- **WHEN** la interfaz llama a una ruta existente de la API después de este cambio
- **THEN** la respuesta es la de la API, no la página de dirección inexistente
