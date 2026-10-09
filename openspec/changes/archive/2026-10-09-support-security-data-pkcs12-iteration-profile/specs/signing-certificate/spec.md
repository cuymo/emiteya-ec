## ADDED Requirements

### Requirement: Coste acotado de abrir la firma
El sistema SHALL acotar el coste de abrir el PKCS#12 de la firma con dos defensas que se aplican siempre y juntas:
- un techo de 131 072 iteraciones por contador, comprobado sobre el archivo antes de descifrar nada y antes de comprobar la contraseña. Los contadores son el del código de integridad del archivo (MAC) y el de cada contenido cifrado: el mayor de ellos no debe superar el techo, y un contador igual al techo se admite. Los contadores no se suman.
- un plazo máximo configurado para cada apertura, fuera del hilo que atiende las peticiones. Una apertura que lo excede se cancela.

Un archivo que supera el techo SHALL rechazarse como incompatible, con el motivo propio del coste de cifrado y sin intentar abrirlo. Una apertura cancelada por el plazo SHALL informar que la operación tardó demasiado y se canceló. En ningún caso cambia la firma vigente, y ni el error ni los registros contienen la contraseña ni el contenido del archivo. Las firmas legítimas cuyo perfil de iteraciones está dentro del techo, como el observado en Security Data, SHALL cargarse con las demás condiciones de la carga.

#### Scenario: Firma con el perfil de Security Data
- **WHEN** un administrador carga un PKCS#12 válido y vigente, con RUC, cuyo código de integridad usa 102 400 iteraciones y cuyos contenidos cifrados usan 51 200, con su contraseña correcta
- **THEN** la firma queda como la firma vigente de la empresa

#### Scenario: Contador igual al techo
- **WHEN** un administrador carga un PKCS#12 válido cuyo mayor contador de iteraciones es exactamente 131 072, con su contraseña correcta
- **THEN** el techo no lo rechaza y la carga sigue con las demás comprobaciones

#### Scenario: Contador por encima del techo
- **WHEN** un administrador carga un PKCS#12 en el que el código de integridad o cualquiera de sus contenidos cifrados usa 131 073 iteraciones o más, incluso un valor absurdo
- **THEN** el sistema lo rechaza como incompatible por su coste de cifrado, sin intentar descifrarlo ni comprobar la contraseña
- **AND** el rechazo llega sin el coste de abrirlo
- **AND** la firma vigente no cambia

#### Scenario: Contraseña incorrecta con un perfil admitido
- **WHEN** un administrador carga un PKCS#12 con el perfil de Security Data y una contraseña que no lo abre
- **THEN** el sistema rechaza la carga e indica que la contraseña no corresponde al archivo, no que el archivo es incompatible
- **AND** ni el mensaje de error ni los registros contienen la contraseña

#### Scenario: Apertura que excede el plazo
- **WHEN** abrir un PKCS#12 cuyos contadores están dentro del techo tarda más que el plazo configurado, por ejemplo porque repite muchos contenidos cifrados
- **THEN** la apertura se cancela y el sistema informa que la operación tardó demasiado y se canceló
- **AND** la firma vigente no cambia
- **AND** el sistema sigue atendiendo otras peticiones y otras aperturas mientras tanto
