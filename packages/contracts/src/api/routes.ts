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
import {
  certificateValidityViewSchema,
  expiryAlertResultSchema,
  expiryAlertSchema,
  signingCertificateResponseSchema,
  signingCertificateUploadResultSchema,
  uploadSigningCertificateSchema,
} from "../signing-certificate.ts";
import {
  catalogEntriesQuerySchema,
  catalogEntriesViewSchema,
  catalogEntryParamsSchema,
  catalogEntryViewSchema,
  catalogTypeParamsSchema,
  consumerFinalPolicyViewSchema,
  sriTransmissionPolicyViewSchema,
  fiscalCatalogSummaryViewSchema,
  schemaRegistryEntryViewSchema,
  setEnablementSchema,
  specialCaseViewSchema,
} from "../fiscal-catalogs.ts";
import {
  changePartyStatusSchema,
  createPartySchema,
  listPartiesQuerySchema,
  partyIdParamsSchema,
  partyListMetaSchema,
  partyViewSchema,
  updatePartySchema,
} from "../parties.ts";
import {
  changeProductStatusSchema,
  createProductSchema,
  listProductsQuerySchema,
  productIdParamsSchema,
  productListMetaSchema,
  productTaxSummaryViewSchema,
  productViewSchema,
  updateProductSchema,
} from "../products.ts";
import {
  createDraftSchema,
  draftIdParamsSchema,
  draftListMetaSchema,
  draftSummaryViewSchema,
  draftViewSchema,
  emitInvoiceHeadersSchema,
  emitInvoiceSchema,
  invoiceIdParamsSchema,
  invoiceTransmissionViewSchema,
  requestReconciliationSchema,
  invoiceListMetaSchema,
  invoiceSummaryViewSchema,
  invoiceViewSchema,
  listDraftsQuerySchema,
  listInvoicesQuerySchema,
  updateDraftSchema,
} from "../invoices.ts";
import {
  RIDE_CONTENT_TYPES,
  XML_CONTENT_TYPES,
  documentDeliveriesViewSchema,
  documentIdParamsSchema,
  documentListItemSchema,
  documentListMetaSchema,
  documentSummaryViewSchema,
  listDocumentsQuerySchema,
  printRequestViewSchema,
} from "../archive.ts";
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

// Borradores y facturas (add-invoice-emission, design D13).
const draftNotFound = {
  description: "El borrador no existe en la empresa (INVOICE_DRAFT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const invoiceNotFound = {
  description: "La factura no existe en la empresa (INVOICE_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const draftReferenceErrors = {
  description:
    "Datos inválidos, más líneas que el límite de la aplicación (INVOICE_TOO_MANY_LINES) o una referencia que no existe en la empresa (EMISSION_POINT_NOT_FOUND, BUYER_NOT_FOUND, PRODUCT_NOT_FOUND, PAYMENT_METHOD_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const invoiceResponse = (description: string) => ({
  description,
  schema: successEnvelope(invoiceViewSchema),
});

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

const documentNotFound = {
  description: "El comprobante no existe en la empresa (DOCUMENT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const documentNotAvailable = {
  description:
    "El comprobante no existe en la empresa (DOCUMENT_NOT_FOUND), o el documento no está disponible para él (DOCUMENT_NOT_AVAILABLE).",
  schema: errorEnvelopeSchema,
};
const artifactIntegrity = {
  description:
    "Los bytes guardados no coinciden con su hash o su tamaño (ARTIFACT_INTEGRITY_FAILED): no se sirve nada.",
  schema: errorEnvelopeSchema,
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
  defineRoute({
    method: "get",
    path: "/signing-certificate",
    summary: "Consultar la firma electrónica vigente: metadatos, vigencia y coincidencia del RUC",
    responses: {
      200: {
        description:
          "Firma vigente, o null si la empresa no tiene, y la anticipación del aviso de vencimiento. Nunca incluye el archivo, la contraseña ni la clave privada.",
        schema: successEnvelope(signingCertificateResponseSchema),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/signing-certificate/validity",
    summary: "Consultar solo la vigencia de la firma electrónica (administradores y operadores)",
    responses: {
      200: {
        description: "Estado de la firma, si es utilizable y su vencimiento.",
        schema: successEnvelope(certificateValidityViewSchema),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "put",
    path: "/signing-certificate",
    summary:
      "Cargar o reemplazar la firma electrónica: PKCS#12 en base64, su contraseña y la firma vigente esperada",
    request: { body: uploadSigningCertificateSchema },
    responses: {
      200: {
        description:
          "Firma vigente tras la carga; unchanged es true si el certificado ya era el vigente.",
        schema: successEnvelope(signingCertificateUploadResultSchema),
      },
      400: {
        description:
          "Datos inválidos o firma rechazada: CERTIFICATE_TOO_LARGE, CERTIFICATE_UNREADABLE, CERTIFICATE_PASSWORD_INVALID, CERTIFICATE_KEY_UNSUPPORTED, CERTIFICATE_INCOMPATIBLE, CERTIFICATE_NOT_VALID_NOW o CERTIFICATE_RUC_NOT_FOUND.",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      409: {
        description:
          "La firma vigente cambió (CERTIFICATE_CHANGED) o la instalación no tiene custodia de firmas (CERTIFICATE_CUSTODY_DISABLED).",
        schema: errorEnvelopeSchema,
      },
      503: {
        description: "El procesamiento criptográfico está saturado (CRYPTO_BUSY).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/signing-certificate/expiry-alert",
    summary: "Fijar con cuántos días de anticipación se avisa del vencimiento de la firma",
    request: { body: expiryAlertSchema },
    responses: {
      200: {
        description: "Anticipación vigente.",
        schema: successEnvelope(expiryAlertResultSchema),
      },
      ...configErrors,
    },
  }),
  defineRoute({
    method: "get",
    path: "/fiscal-catalogs",
    summary:
      "Consultar los catálogos fiscales oficiales: versión del dataset, fuente y habilitación",
    responses: {
      200: {
        description:
          "Catálogos fiscales con la versión aplicada de su dataset y su fuente oficial.",
        schema: successEnvelope(z.array(fiscalCatalogSummaryViewSchema)),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/fiscal-catalogs/consumer-final-policy",
    summary: "Consultar la política de consumidor final: monto máximo, identidad canónica y fuente",
    request: { query: catalogEntriesQuerySchema.pick({ at: true }) },
    responses: {
      200: {
        description:
          "Versiones de la política y la aplicable en la fecha `at` (hoy en Ecuador por defecto).",
        schema: successEnvelope(consumerFinalPolicyViewSchema),
      },
      ...configErrors,
    },
  }),
  defineRoute({
    method: "get",
    path: "/fiscal-catalogs/sri-transmission-policy",
    summary:
      "Consultar el límite de tamaño del comprobante firmado para su envío al SRI: bytes, cita y unidad",
    request: { query: catalogEntriesQuerySchema.pick({ at: true }) },
    responses: {
      200: {
        description:
          "Versiones de la política y la aplicable en la fecha `at` (hoy en Ecuador por defecto). Sin una fuente oficial verificada no hay política publicada: `source` es null y no hay versiones (Q-47).",
        schema: successEnvelope(sriTransmissionPolicyViewSchema),
      },
      ...configErrors,
    },
  }),
  defineRoute({
    method: "get",
    path: "/fiscal-catalogs/schemas",
    summary: "Consultar el registro de esquemas XSD oficiales",
    responses: {
      200: {
        description: "Esquemas registrados con su hash, su fuente y si la aplicación los soporta.",
        schema: successEnvelope(z.array(schemaRegistryEntryViewSchema)),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/fiscal-catalogs/special-cases",
    summary: "Consultar la matriz de casos especiales: categoría de soporte de cada anexo",
    responses: {
      200: {
        description: "Los anexos de la ficha técnica con su tema y su categoría (ADR 0014).",
        schema: successEnvelope(z.array(specialCaseViewSchema)),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/fiscal-catalogs/:catalogType/entries",
    summary:
      "Consultar las entradas de un catálogo fiscal: versiones, versión aplicable en una fecha y habilitación de la empresa",
    request: { params: catalogTypeParamsSchema, query: catalogEntriesQuerySchema },
    responses: {
      200: {
        description:
          "Entradas con sus versiones, la aplicable en la fecha `at` (hoy en Ecuador por defecto), su habilitación y si son utilizables.",
        schema: successEnvelope(catalogEntriesViewSchema),
      },
      ...configErrors,
      404: {
        description: "El catálogo no existe (FISCAL_CATALOG_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/fiscal-catalogs/:catalogType/entries/:entryKey/enablement",
    summary: "Habilitar o deshabilitar una entrada del catálogo fiscal para la empresa",
    request: { params: catalogEntryParamsSchema, body: setEnablementSchema },
    responses: {
      200: {
        description: "Entrada con la habilitación vigente de la empresa.",
        schema: successEnvelope(catalogEntryViewSchema),
      },
      400: {
        description:
          "Datos inválidos, catálogo sin habilitación por empresa (FISCAL_CATALOG_NOT_ENABLEABLE) o entrada sin vigencia actual ni futura (FISCAL_CATALOG_ENTRY_NOT_IN_FORCE).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: {
        description:
          "El catálogo (FISCAL_CATALOG_NOT_FOUND) o la entrada (FISCAL_CATALOG_ENTRY_NOT_FOUND) no existen.",
        schema: errorEnvelopeSchema,
      },
    },
  }),

  // Terceros (add-parties-and-products, design D11).
  defineRoute({
    method: "get",
    path: "/parties",
    summary: "Buscar terceros por identificación o razón social, con filtros y paginación",
    request: { query: listPartiesQuerySchema },
    responses: {
      200: {
        description: "Página de terceros en orden estable, con el total en `meta`.",
        schema: z.strictObject({ data: z.array(partyViewSchema), meta: partyListMetaSchema }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/parties",
    summary: "Registrar un tercero",
    request: { body: createPartySchema },
    responses: {
      201: { description: "Tercero registrado.", schema: successEnvelope(partyViewSchema) },
      400: {
        description:
          "Datos inválidos, identificación que no cumple la regla de su tipo (PARTY_IDENTIFICATION_INVALID), tipo reservado al consumidor final (PARTY_IDENTIFICATION_RESERVED) o tipo sin versión vigente (PARTY_IDENTIFICATION_TYPE_UNAVAILABLE).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      409: {
        description:
          "Ya existe un tercero de la empresa con esa identificación (PARTY_IDENTIFICATION_TAKEN).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/parties/:partyId",
    summary: "Consultar un tercero",
    request: { params: partyIdParamsSchema },
    responses: {
      200: { description: "Tercero.", schema: successEnvelope(partyViewSchema) },
      401: errors[401],
      403: errors[403],
      404: {
        description: "El tercero no existe en la empresa (PARTY_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/parties/:partyId",
    summary: "Corregir un tercero a partir de la versión consultada",
    request: { params: partyIdParamsSchema, body: updatePartySchema },
    responses: {
      200: {
        description: "Tercero corregido, o sin cambios.",
        schema: successEnvelope(partyViewSchema),
      },
      400: {
        description: "Datos inválidos o identificación que no cumple la regla de su tipo.",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: {
        description: "El tercero no existe en la empresa (PARTY_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
      409: {
        description:
          "El tercero cambió después de la consulta (PARTY_CHANGED), es el consumidor final (PARTY_SYSTEM_RECORD) o la identificación ya existe (PARTY_IDENTIFICATION_TAKEN).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/parties/:partyId/status",
    summary: "Desactivar o reactivar un tercero (estado deseado)",
    request: { params: partyIdParamsSchema, body: changePartyStatusSchema },
    responses: {
      200: { description: "Tercero con su estado.", schema: successEnvelope(partyViewSchema) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: {
        description: "El tercero no existe en la empresa (PARTY_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
      409: {
        description: "El consumidor final no se desactiva (PARTY_SYSTEM_RECORD).",
        schema: errorEnvelopeSchema,
      },
    },
  }),

  // Productos y servicios (add-parties-and-products, design D11).
  defineRoute({
    method: "get",
    path: "/products",
    summary:
      "Buscar productos por código o nombre, con filtros (incluido el estado tributario) y paginación",
    request: { query: listProductsQuerySchema },
    responses: {
      200: {
        description:
          "Página de productos en orden estable, con su estado tributario evaluado hoy en Ecuador y el total en `meta`.",
        schema: z.strictObject({ data: z.array(productViewSchema), meta: productListMetaSchema }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/products",
    summary: "Registrar un producto o servicio con su precio sin impuestos y sus impuestos",
    request: { body: createProductSchema },
    responses: {
      201: { description: "Producto registrado.", schema: successEnvelope(productViewSchema) },
      400: {
        description:
          "Datos inválidos, impuesto no disponible para la empresa (PRODUCT_TAX_UNAVAILABLE) o servicio con IRBPNR o control de stock (PRODUCT_GOODS_ONLY).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      409: {
        description: "El código principal ya está en uso en la empresa (PRODUCT_MAIN_CODE_TAKEN).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/products/tax-summary",
    summary: "Recuentos de productos activos por estado tributario y por entrada fiscal referida",
    responses: {
      200: {
        description: "Recuentos de la empresa, evaluados hoy en Ecuador.",
        schema: successEnvelope(productTaxSummaryViewSchema),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/products/:productId",
    summary: "Consultar un producto con su estado tributario",
    request: { params: productIdParamsSchema },
    responses: {
      200: { description: "Producto.", schema: successEnvelope(productViewSchema) },
      401: errors[401],
      403: errors[403],
      404: {
        description: "El producto no existe en la empresa (PRODUCT_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/products/:productId",
    summary: "Corregir un producto a partir de la versión consultada",
    request: { params: productIdParamsSchema, body: updateProductSchema },
    responses: {
      200: {
        description: "Producto corregido, o sin cambios.",
        schema: successEnvelope(productViewSchema),
      },
      400: {
        description:
          "Datos inválidos, impuesto nuevo no disponible (PRODUCT_TAX_UNAVAILABLE) o servicio con IRBPNR o control de stock (PRODUCT_GOODS_ONLY).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: {
        description: "El producto no existe en la empresa (PRODUCT_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
      409: {
        description:
          "El producto cambió después de la consulta (PRODUCT_CHANGED) o el código principal está en uso (PRODUCT_MAIN_CODE_TAKEN).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/products/:productId/status",
    summary: "Desactivar o reactivar un producto (estado deseado)",
    request: { params: productIdParamsSchema, body: changeProductStatusSchema },
    responses: {
      200: { description: "Producto con su estado.", schema: successEnvelope(productViewSchema) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: {
        description: "El producto no existe en la empresa (PRODUCT_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
    },
  }),

  // Borradores y facturas (add-invoice-emission, design D13).
  defineRoute({
    method: "get",
    path: "/invoices/drafts",
    summary: "Listar los borradores de factura pendientes, por última actualización",
    request: { query: listDraftsQuerySchema },
    responses: {
      200: {
        description: "Página de borradores `DRAFT` con su total previo y el total en `meta`.",
        schema: z.strictObject({
          data: z.array(draftSummaryViewSchema),
          meta: draftListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/invoices/drafts",
    summary:
      "Guardar un borrador de factura; las líneas llevan producto, cantidad y descuento, sin precio",
    request: { body: createDraftSchema },
    responses: {
      201: {
        description: "Borrador guardado, con su vista previa no fiscal.",
        schema: successEnvelope(draftViewSchema),
      },
      400: draftReferenceErrors,
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/invoices/drafts/:draftId",
    summary: "Consultar un borrador con su vista previa y sus problemas",
    request: { params: draftIdParamsSchema },
    responses: {
      200: {
        description:
          "Borrador con la vista previa calculada hoy en Ecuador con los precios vigentes de los productos y los problemas que impedirían emitirlo.",
        schema: successEnvelope(draftViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: draftNotFound,
      409: {
        description:
          "El borrador ya se emitió (INVOICE_DRAFT_ALREADY_EMITTED); el mensaje nombra la factura.",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/invoices/drafts/:draftId",
    summary: "Corregir un borrador a partir de la versión consultada",
    request: { params: draftIdParamsSchema, body: updateDraftSchema },
    responses: {
      200: { description: "Borrador corregido.", schema: successEnvelope(draftViewSchema) },
      400: draftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: draftNotFound,
      409: {
        description:
          "El borrador cambió después de la consulta (INVOICE_DRAFT_CHANGED) o ya se emitió (INVOICE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "delete",
    path: "/invoices/drafts/:draftId",
    summary: "Eliminar un borrador sin emitir",
    request: { params: draftIdParamsSchema },
    responses: {
      204: { description: "Borrador eliminado, sin rastro fiscal." },
      401: errors[401],
      403: errors[403],
      404: draftNotFound,
      409: {
        description: "El borrador ya se emitió (INVOICE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/invoices",
    summary:
      "Emitir un borrador: valida, reserva el número y la clave, y firma localmente (sin el SRI)",
    request: { headers: emitInvoiceHeadersSchema, body: emitInvoiceSchema },
    responses: {
      200: invoiceResponse(
        "Repetición con la misma Idempotency-Key y la misma solicitud: la misma factura. Si seguía `RESERVED`, se intenta firmar otra vez.",
      ),
      201: invoiceResponse(
        "Factura emitida: `SIGNED` con su artefacto, o `RESERVED` con el diagnóstico del intento.",
      ),
      400: {
        description:
          "Datos inválidos o falta la cabecera Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: draftNotFound,
      409: {
        description:
          "La emisión se rechazó antes de reservar el número, con el código del primer problema (por ejemplo INVOICE_DRAFT_CHANGED, INVOICE_DRAFT_INCOMPLETE, DISCOUNT_EXCEEDS_SUBTOTAL, CONSUMER_FINAL_LIMIT_EXCEEDED, SPECIAL_CASE_UNSUPPORTED o SEQUENCE_EXHAUSTED), o la clave ya se usó con otra solicitud (IDEMPOTENCY_KEY_REUSED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/invoices",
    summary:
      "Listar facturas por estado y buscar por número o comprador, las más recientes primero",
    request: { query: listInvoicesQuerySchema },
    responses: {
      200: {
        description: "Página de facturas con el total en `meta`.",
        schema: z.strictObject({
          data: z.array(invoiceSummaryViewSchema),
          meta: invoiceListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/invoices/:invoiceId",
    summary:
      "Consultar una factura desde su snapshot, con el diagnóstico del último intento y el resumen de su transmisión al SRI",
    request: { params: invoiceIdParamsSchema },
    responses: {
      200: invoiceResponse("Factura."),
      401: errors[401],
      403: errors[403],
      404: invoiceNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/invoices/:invoiceId/transmission",
    summary:
      "Consultar el historial de la transmisión al SRI: transiciones e intentos resumidos, sin respuestas originales ni XML",
    request: { params: invoiceIdParamsSchema },
    responses: {
      200: {
        description: "Las 100 entradas más recientes del historial y el total.",
        schema: successEnvelope(invoiceTransmissionViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: invoiceNotFound,
    },
  }),
  defineRoute({
    method: "post",
    path: "/invoices/:invoiceId/reconciliations",
    summary:
      "Pedir la reconciliación de una factura con el SRI, con motivo (solo el administrador)",
    request: { params: invoiceIdParamsSchema, body: requestReconciliationSchema },
    responses: {
      202: invoiceResponse(
        "Reconciliación programada: un job consulta al SRI por la clave y aplica las reglas de la transmisión. La factura con su estado actual.",
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: invoiceNotFound,
      409: {
        description:
          "Hay una interacción con el SRI en curso (SRI_INTERACTION_IN_PROGRESS) o el estado no admite una reconciliación (INVOICE_NOT_RECONCILABLE).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/invoices/:invoiceId/signing-attempts",
    summary: "Reintentar la firma de una factura reservada, con el mismo número y la misma clave",
    request: { params: invoiceIdParamsSchema },
    responses: {
      200: invoiceResponse(
        "Factura tras el intento: `SIGNED`, o `RESERVED` con el diagnóstico. Una factura ya firmada se devuelve sin cambios.",
      ),
      401: errors[401],
      403: errors[403],
      404: invoiceNotFound,
    },
  }),
  // Bandeja de comprobantes y sus documentos (add-document-archive, design D2 y D10).
  defineRoute({
    method: "get",
    path: "/documents",
    summary:
      "Listar los comprobantes fiscales de la empresa desde que se reservan, con filtros y los documentos disponibles, los más recientes primero",
    request: { query: listDocumentsQuerySchema },
    responses: {
      200: {
        description: "Página de comprobantes con el total en `meta`.",
        schema: z.strictObject({
          data: z.array(documentListItemSchema),
          meta: documentListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/documents/:documentId",
    summary:
      "Consultar los documentos de un comprobante: disponibilidad, artefactos y generación del RIDE",
    request: { params: documentIdParamsSchema },
    responses: {
      200: {
        description: "Resumen de los documentos del comprobante.",
        schema: successEnvelope(documentSummaryViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: documentNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/documents/:documentId/ride",
    summary: "Descargar el RIDE guardado, con sus bytes exactos verificados; registra la descarga",
    request: { params: documentIdParamsSchema },
    responses: {
      200: { description: "El RIDE en PDF.", binaryContentTypes: RIDE_CONTENT_TYPES },
      401: errors[401],
      403: errors[403],
      404: documentNotAvailable,
      500: artifactIntegrity,
    },
  }),
  defineRoute({
    method: "get",
    path: "/documents/:documentId/authorized-xml",
    summary:
      "Descargar el XML autorizado que devolvió el SRI, con sus bytes exactos verificados; registra la descarga",
    request: { params: documentIdParamsSchema },
    responses: {
      200: { description: "El XML autorizado.", binaryContentTypes: XML_CONTENT_TYPES },
      401: errors[401],
      403: errors[403],
      404: documentNotAvailable,
      500: artifactIntegrity,
    },
  }),
  defineRoute({
    method: "get",
    path: "/documents/:documentId/signed-xml",
    summary:
      "Descargar el XML firmado transmitido, con sus bytes exactos verificados; registra la descarga",
    request: { params: documentIdParamsSchema },
    responses: {
      200: { description: "El XML firmado.", binaryContentTypes: XML_CONTENT_TYPES },
      401: errors[401],
      403: errors[403],
      404: documentNotAvailable,
      500: artifactIntegrity,
    },
  }),
  defineRoute({
    method: "post",
    path: "/documents/:documentId/print-requests",
    summary:
      "Solicitar la impresión del RIDE guardado: comprueba su integridad y registra la solicitud, sin bytes",
    request: { params: documentIdParamsSchema },
    responses: {
      201: {
        description:
          "Solicitud registrada. La interfaz pide después el mismo RIDE para imprimirlo.",
        schema: successEnvelope(printRequestViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: documentNotAvailable,
      500: artifactIntegrity,
    },
  }),
  defineRoute({
    method: "get",
    path: "/documents/:documentId/deliveries",
    summary:
      "Consultar el historial de entregas observables: descargas servidas y solicitudes de impresión",
    request: { params: documentIdParamsSchema },
    responses: {
      200: {
        description: "Las 100 entregas más recientes y el total.",
        schema: successEnvelope(documentDeliveriesViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: documentNotFound,
    },
  }),
];
