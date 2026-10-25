# Política de seguridad

EmiteYa maneja datos fiscales, firmas electrónicas y credenciales de correo de empresas reales.
Tomamos en serio cualquier vulnerabilidad.

## Versiones con soporte

Solo la rama `main` recibe correcciones de seguridad. No hay versiones anteriores mantenidas.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de vulnerabilidades de GitHub: pestaña
**Security** del repositorio → **Report a vulnerability**. Si no está disponible, abre un issue
pidiendo un canal privado, sin detalles técnicos.

Incluye:

- qué componente afecta (API, interfaz, firma, transmisión al SRI, correo, despliegue);
- cómo reproducirlo, con datos de prueba;
- el impacto que esperas (acceso a otra empresa, lectura de secretos, emisión indebida…).

**Nunca envíes** una firma electrónica real (`.p12`/`.pfx`), su contraseña, contraseñas SMTP,
claves de cifrado, cookies de sesión ni datos tributarios de terceros. Si los necesitas para
explicar el problema, descríbelos.

## Qué esperar

- Confirmamos la recepción y empezamos a evaluarlo lo antes posible; el objetivo es responder en
  una semana.
- Te contamos si lo reproducimos, la gravedad que le damos y el plan de corrección.
- Publicamos la corrección y, con tu permiso, te damos crédito en el aviso.

## Pruebas responsables

- Prueba solo contra tu propia instalación. Nunca contra instalaciones de terceros.
- **Nunca contra el ambiente de Producción del SRI.** La transmisión viene apagada
  (`SRI_TRANSMISSION_ENABLED=0`); si la enciendes, hazlo solo en el ambiente de Pruebas del SRI y
  con tus propias credenciales.
- No uses ingeniería social, denegación de servicio ni acceso físico.

## Más información

El modelo de amenazas, el control de acceso y la custodia de secretos están en `docs/security/`.
La configuración segura de un despliegue está en `docs/architecture/deployment.md`.
