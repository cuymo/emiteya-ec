// Registro de las rutas de la API. Cada cambio que añade rutas las registra aquí.
// Las rutas de Better Auth (/api/auth/*) quedan fuera del prefijo /api/v1 y de este registro (ADR 0015).
import { z } from "zod";
import { errorEnvelopeSchema, successEnvelope } from "../envelope.ts";
import {
  listUsersQuerySchema,
  meSchema,
  userIdParamsSchema,
  userListMetaSchema,
  userSchemas,
  userViewSchema,
} from "../users.ts";
import {
  changeEstablishmentStatusSchema,
  defaultEmissionPointViewSchema,
  setDefaultEmissionPointSchema,
  createEmissionPointSchema,
  createEstablishmentSchema,
  emissionPointParamsSchema,
  emissionPointViewSchema,
  establishmentIdParamsSchema,
  establishmentViewSchema,
  updateEstablishmentSchema,
} from "../establishments.ts";
import {
  LOGO_RESPONSE_CONTENT_TYPES,
  LOGO_UPLOAD_CONTENT_TYPES,
  changeEnvironmentSchema,
  companyStatusSchema,
  logoQuerySchema,
  taxpayerViewSchema,
  updateTaxpayerSchema,
} from "../taxpayer.ts";
import {
  adjustSequenceSchema,
  fiscalSequenceViewSchema,
  sequenceParamsSchema,
  sequencesQuerySchema,
} from "../fiscal-numbering.ts";
import { defineRoute, type RouteDefinition } from "./route.ts";

// Documentado con la política de contraseñas por defecto; la longitud real es configuración.
const schemas = userSchemas();

const errors = {
  400: { description: "Datos inválidos; el mensaje indica el campo.", schema: errorEnvelopeSchema },
  401: { description: "Sin sesión o sin membresía activa.", schema: errorEnvelopeSchema },
  403: { description: "El rol no tiene permiso para esta acción.", schema: errorEnvelopeSchema },
  404: { description: "El usuario no existe en la empresa.", schema: errorEnvelopeSchema },
  409: { description: "Conflicto con una regla de acceso.", schema: errorEnvelopeSchema },
};

const userResponse = successEnvelope(userViewSchema);

// Configuración tributaria (add-taxpayer-setup, design D12).
const taxpayerResponse = {
  description: "Configuración tributaria vigente de la empresa.",
  schema: successEnvelope(taxpayerViewSchema),
};
const establishmentResponse = {
  description: "Establecimiento con sus puntos de emisión.",
  schema: successEnvelope(establishmentViewSchema),
};
const emissionPointResponse = {
  description: "Punto de emisión con su disponibilidad.",
  schema: successEnvelope(emissionPointViewSchema),
};
const establishmentNotFound = {
  description: "El establecimiento o el punto no existen en la empresa.",
  schema: errorEnvelopeSchema,
};
const configErrors = {
  400: errors[400],
  401: errors[401],
  403: errors[403],
};

export const apiRoutes: readonly RouteDefinition[] = [
  defineRoute({
    method: "get",
    path: "/me",
    summary: "Consultar la cuenta propia: nombre, correo y rol en la empresa",
    responses: {
      200: { description: "Cuenta propia.", schema: successEnvelope(meSchema) },
      401: errors[401],
    },
  }),
  defineRoute({
    method: "get",
    path: "/users",
    summary: "Listar los usuarios de la empresa con búsqueda, estado y paginación",
    request: { query: listUsersQuerySchema },
    responses: {
      200: {
        description: "Página de usuarios de la empresa.",
        schema: z.strictObject({ data: z.array(userViewSchema), meta: userListMetaSchema }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/users",
    summary: "Crear un usuario con membresía activa en la empresa",
    request: { body: schemas.createUser },
    responses: {
      201: { description: "Usuario creado.", schema: userResponse },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      409: { description: "El correo ya está en uso.", schema: errorEnvelopeSchema },
    },
  }),
  defineRoute({
    method: "put",
    path: "/users/:userId/role",
    summary: "Asignar el rol de otro usuario de la empresa (estado deseado)",
    request: { params: userIdParamsSchema, body: schemas.changeRole },
    responses: {
      200: { description: "Usuario con el rol asignado.", schema: userResponse },
      ...errors,
    },
  }),
  defineRoute({
    method: "put",
    path: "/users/:userId/status",
    summary: "Desactivar o reactivar a otro usuario de la empresa (estado deseado)",
    request: { params: userIdParamsSchema, body: schemas.changeStatus },
    responses: {
      200: { description: "Usuario con el estado asignado.", schema: userResponse },
      ...errors,
    },
  }),
  defineRoute({
    method: "put",
    path: "/users/:userId/password",
    summary: "Establecer la contraseña de otro usuario e invalidar sus sesiones",
    request: { params: userIdParamsSchema, body: schemas.setPassword },
    responses: { 204: { description: "Contraseña establecida." }, ...errors },
  }),
  defineRoute({
    method: "get",
    path: "/taxpayer",
    summary:
      "Consultar los datos tributarios, la versión vigente, el bloqueo de la identidad tributaria y el logo",
    responses: { 200: taxpayerResponse, 401: errors[401], 403: errors[403] },
  }),
  defineRoute({
    method: "put",
    path: "/taxpayer",
    summary:
      "Registrar o corregir los datos y atributos tributarios (estado deseado con la versión esperada)",
    request: { body: updateTaxpayerSchema },
    responses: {
      200: taxpayerResponse,
      ...configErrors,
      409: {
        description:
          "La versión esperada no es la vigente (CONFIG_VERSION_CONFLICT) o el RUC está bloqueado (TAX_IDENTITY_LOCKED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/taxpayer/environment",
    summary: "Cambiar el ambiente SRI entre Pruebas y Producción",
    request: { body: changeEnvironmentSchema },
    responses: {
      200: taxpayerResponse,
      ...configErrors,
      409: {
        description:
          "La versión esperada no es la vigente (CONFIG_VERSION_CONFLICT) o faltan los datos de la empresa (TAXPAYER_NOT_CONFIGURED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/taxpayer/logo",
    summary: "Descargar el logo vigente de la empresa",
    responses: {
      200: {
        description: "Imagen del logo vigente.",
        binaryContentTypes: LOGO_RESPONSE_CONTENT_TYPES,
      },
      401: errors[401],
      403: errors[403],
      404: { description: "La empresa no tiene logo.", schema: errorEnvelopeSchema },
    },
  }),
  defineRoute({
    method: "put",
    path: "/taxpayer/logo",
    summary:
      "Cargar o reemplazar el logo con el contenido de la imagen; crea una versión nueva de la configuración",
    request: { query: logoQuerySchema, binaryBody: { contentTypes: LOGO_UPLOAD_CONTENT_TYPES } },
    responses: {
      200: taxpayerResponse,
      400: {
        description:
          "La imagen no es de un formato admitido, no se puede leer o es demasiado grande en píxeles.",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      409: {
        description:
          "La versión esperada no es la vigente (CONFIG_VERSION_CONFLICT) o faltan los datos de la empresa (TAXPAYER_NOT_CONFIGURED).",
        schema: errorEnvelopeSchema,
      },
      413: { description: "La imagen supera el límite configurado.", schema: errorEnvelopeSchema },
      415: {
        description: "El tipo de contenido no es de una imagen admitida.",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "delete",
    path: "/taxpayer/logo",
    summary: "Eliminar el logo vigente; crea una versión nueva sin logo y conserva el anterior",
    request: { query: logoQuerySchema },
    responses: {
      200: taxpayerResponse,
      400: errors[400],
      401: errors[401],
      403: errors[403],
      409: {
        description:
          "La versión esperada no es la vigente (CONFIG_VERSION_CONFLICT) o faltan los datos de la empresa (TAXPAYER_NOT_CONFIGURED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/establishments",
    summary:
      "Listar los establecimientos de la empresa con sus puntos de emisión y su disponibilidad",
    responses: {
      200: {
        description: "Establecimientos ordenados por código.",
        schema: successEnvelope(z.array(establishmentViewSchema)),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/establishments",
    summary: "Crear un establecimiento con su código de tres dígitos y su dirección",
    request: { body: createEstablishmentSchema },
    responses: {
      201: establishmentResponse,
      ...configErrors,
      409: {
        description: "El código ya existe en la empresa (ESTABLISHMENT_CODE_TAKEN).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/establishments/:establishmentId",
    summary: "Corregir la dirección de un establecimiento; el código no cambia",
    request: { params: establishmentIdParamsSchema, body: updateEstablishmentSchema },
    responses: { 200: establishmentResponse, ...configErrors, 404: establishmentNotFound },
  }),
  defineRoute({
    method: "put",
    path: "/establishments/:establishmentId/status",
    summary: "Activar o desactivar un establecimiento (estado deseado)",
    request: { params: establishmentIdParamsSchema, body: changeEstablishmentStatusSchema },
    responses: { 200: establishmentResponse, ...configErrors, 404: establishmentNotFound },
  }),
  defineRoute({
    method: "post",
    path: "/establishments/:establishmentId/emission-points",
    summary: "Crear un punto de emisión en un establecimiento",
    request: { params: establishmentIdParamsSchema, body: createEmissionPointSchema },
    responses: {
      201: emissionPointResponse,
      ...configErrors,
      404: establishmentNotFound,
      409: {
        description: "El código ya existe en el establecimiento (EMISSION_POINT_CODE_TAKEN).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/establishments/:establishmentId/emission-points/:emissionPointId/status",
    summary: "Activar o desactivar un punto de emisión (estado deseado)",
    request: { params: emissionPointParamsSchema, body: changeEstablishmentStatusSchema },
    responses: { 200: emissionPointResponse, ...configErrors, 404: establishmentNotFound },
  }),
  defineRoute({
    method: "get",
    path: "/me/default-emission-point",
    summary: "Consultar el punto de emisión predeterminado propio y su disponibilidad",
    responses: {
      200: {
        description: "Punto predeterminado con su establecimiento, o null sin predeterminado.",
        schema: successEnvelope(defaultEmissionPointViewSchema),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "put",
    path: "/me/default-emission-point",
    summary: "Elegir o quitar el punto de emisión predeterminado propio; solo preselecciona",
    request: { body: setDefaultEmissionPointSchema },
    responses: {
      200: {
        description: "Punto predeterminado vigente, o null.",
        schema: successEnvelope(defaultEmissionPointViewSchema),
      },
      ...configErrors,
      404: { description: "El punto no existe en la empresa.", schema: errorEnvelopeSchema },
      409: {
        description: "El punto o su establecimiento están inactivos (EMISSION_POINT_UNAVAILABLE).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/company/status",
    summary: "Consultar el ambiente y la preparación para emitir de la empresa",
    responses: {
      200: {
        description: "Ambiente, nombre visible y requisitos de la preparación para emitir.",
        schema: successEnvelope(companyStatusSchema),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/fiscal-sequences",
    summary:
      "Consultar los secuenciales de un ambiente: siguiente y último reservado por punto y tipo de comprobante",
    request: { query: sequencesQuerySchema },
    responses: {
      200: {
        description:
          "Contadores de cada punto de la empresa por tipo; un contador agotado tiene nextNumber nulo.",
        schema: successEnvelope(z.array(fiscalSequenceViewSchema)),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "put",
    path: "/establishments/:establishmentId/emission-points/:emissionPointId/sequences/:environment/:documentType",
    summary:
      "Ajustar el siguiente secuencial de un contador; retroceder exige un motivo y nunca vuelve a un número reservado",
    request: { params: sequenceParamsSchema, body: adjustSequenceSchema },
    responses: {
      200: {
        description: "Contador con el ajuste aplicado.",
        schema: successEnvelope(fiscalSequenceViewSchema),
      },
      ...configErrors,
      404: {
        description: "El punto de emisión no existe en la empresa.",
        schema: errorEnvelopeSchema,
      },
      409: {
        description:
          "El contador cambió (SEQUENCE_CHANGED), el valor no supera al último reservado (SEQUENCE_NUMBER_RESERVED) o la numeración está agotada (SEQUENCE_EXHAUSTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
];
