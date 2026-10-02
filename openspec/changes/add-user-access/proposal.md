# Proposal

## Why

Ninguna operación del facturador puede protegerse ni atribuirse a alguien mientras no exista
quién entra al sistema y con qué permisos. El administrador del contribuyente necesita dar
acceso a su equipo, limitar lo que cada persona puede hacer y retirarlo cuando alguien deja
de trabajar con la empresa, sin depender de correo electrónico, porque el correo queda fuera
del MVP (ERS §21). Es el primer cambio con datos privados: fija el aislamiento por empresa
(ADR 0009) sobre el que se construirán todos los demás.

## What Changes

- Aprovisionamiento de la instalación: en el primer arranque se crean la empresa única (tenant, aún sin datos tributarios) y el administrador inicial con su membresía, a partir de la configuración del servidor.
- Inicio y cierre de sesión con correo y contraseña. No existe registro público.
- El administrador crea usuarios dentro de su empresa con un rol (`Administrador` u `Operador`), cambia su rol, los desactiva y reactiva, y les establece una contraseña nueva.
- Cada usuario cambia su propia contraseña.
- No hay recuperación pública de contraseña por correo. Si ningún administrador puede entrar, el administrador técnico usa un comando de recuperación administrativa de emergencia (break-glass) en el servidor, que nunca se expone en la API.
- El contexto de autorización (usuario, empresa, rol) se deriva siempre en el servidor desde la sesión y la membresía. El cliente no puede alterarlo.
- Nadie cambia su propio rol ni se desactiva a sí mismo.
- Rastro de auditoría del tenant, solo de agregado, para cada cambio exitoso de acceso. Los inicios de sesión fallidos y las denegaciones se emiten como eventos de seguridad (logs y métricas), no como auditoría.
- Pantallas: inicio de sesión, `Usuarios` para el administrador y `Mi cuenta`.

Fuera de alcance:

- Datos tributarios de la empresa, establecimientos, puntos de emisión y el punto predeterminado por usuario (ERS RF-113): cambio `add-taxpayer-setup`.
- Recuperación de contraseña por correo, invitaciones por correo y cualquier otro uso del correo (ERS §21, P1).
- Editar el nombre o el correo de un usuario existente.
- Eliminar usuarios: solo se desactivan (ERS RF-409).
- Multiempresa: crear empresas adicionales o cambiar de empresa activa (P2).
- Pantalla para consultar la auditoría.
- Persistir eventos de seguridad o direcciones IP en la base de datos.
- Autenticación de terceros, API keys (P2), inicio de sesión social o de un solo uso, y segundo factor.
- Las filas de la matriz de permisos para operaciones que todavía no existen; cada cambio futuro define las suyas.

## Capabilities

### New Capabilities

- `user-access`: identidad, membresía por empresa y rol, sesión, administración de usuarios y credenciales, y derivación del contexto de autorización en el servidor.
- `audit-trail`: rastro inmutable de los cambios críticos de un actor conocido dentro de una empresa. Este cambio lo introduce con los cambios de acceso, porque CognitiveStack exige auditar cambios de rol y permisos; `add-taxpayer-setup` lo extenderá con los cambios que exigen ERS RF-003, RF-105 y SEC-007.

### Modified Capabilities

Ninguna: `openspec/specs/` está vacío.

## Impact

- Backend: integración con Better Auth (montada en `/api/auth/*`), middleware de contexto de petición, política de autorización central, rutas de usuarios bajo el prefijo general `/api/v1/` (ADR 0015), módulos `identity` y `audit`, eventos de seguridad, comando de recuperación de emergencia y aprovisionamiento al arrancar.
- Base de datos: tablas de Better Auth, empresa, membresía y auditoría, con restricciones únicas, claves foráneas compuestas por `companyId` y protección de solo agregado. Primera migración del producto.
- Frontend: pantalla de inicio de sesión, protección del shell autenticado, módulo `Usuarios` y `Mi cuenta`.
- Configuración: variables de Better Auth y del administrador inicial, validadas al arrancar.
- Documentación: `authentication.md`, `access-control.md`, `database.md`, `deployment.md` y Q-41 en `open-questions.md`. Los valores por defecto de contraseñas y del límite de intentos viven en `docs/security/hardening.md`.
- Dependencias: requiere el cambio `bootstrap-application` aplicado antes de `/opsx:apply`. Ese cambio solo aporta infraestructura base y no implementa nada de autenticación. La integración concreta con Better Auth, incluido cómo se implementa la membresía, depende del spike S-1 (Q-41), que es gate del diseño técnico y de la implementación, no de esta propuesta.
