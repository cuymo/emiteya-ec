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
import {
  initializeStockSchema,
  listStockItemsQuerySchema,
  listStockMovementsQuerySchema,
  stockAdjustmentSchema,
  stockEntrySchema,
  stockItemDetailViewSchema,
  stockItemListMetaSchema,
  stockItemParamsSchema,
  stockItemViewSchema,
  stockMovementHeadersSchema,
  stockMovementListMetaSchema,
  stockMovementViewSchema,
  stockTrackingSchema,
} from "../inventory.ts";
import {
  requestReconciliationSchema as creditNoteReconciliationSchema,
  requestReconciliationSchema as debitNoteReconciliationSchema,
} from "../invoices.ts";
import {
  createCreditNoteDraftSchema,
  creditNoteDraftIdParamsSchema,
  creditNoteDraftSummaryViewSchema,
  creditNoteDraftViewSchema,
  creditInvoiceIdParamsSchema,
  creditNoteIdParamsSchema,
  creditNoteListMetaSchema,
  creditNoteSummaryViewSchema,
  creditNoteTransmissionViewSchema,
  creditNoteViewSchema,
  invoiceCreditViewSchema,
  listCreditNotesQuerySchema,
  eligibleInvoiceViewSchema,
  emitCreditNoteHeadersSchema,
  emitCreditNoteSchema,
  listCreditNoteDraftsQuerySchema,
  listEligibleInvoicesQuerySchema,
  updateCreditNoteDraftSchema,
} from "../credit-notes.ts";
import {
  createDebitNoteDraftSchema,
  debitEligibleInvoiceViewSchema,
  debitNoteDraftIdParamsSchema,
  debitNoteIdParamsSchema,
  debitNoteSummaryViewSchema,
  debitNoteTransmissionViewSchema,
  debitNoteViewSchema,
  listDebitNotesQuerySchema,
  emitDebitNoteHeadersSchema,
  emitDebitNoteSchema,
  debitNoteDraftSummaryViewSchema,
  debitNoteDraftViewSchema,
  debitNoteListMetaSchema,
  listDebitEligibleInvoicesQuerySchema,
  listDebitNoteDraftsQuerySchema,
  updateDebitNoteDraftSchema,
} from "../debit-notes.ts";
import {
  listWithholdingReceiptsQuerySchema,
  withholdingReceiptSummaryViewSchema,
  withholdingTransmissionViewSchema,
  emitWithholdingHeadersSchema,
  emitWithholdingReceiptSchema,
  withholdingReceiptIdParamsSchema,
  withholdingReceiptViewSchema,
  createWithholdingDraftSchema,
  listWithholdingDraftsQuerySchema,
  listWithholdingSuppliersQuerySchema,
  updateWithholdingDraftSchema,
  withholdingDraftIdParamsSchema,
  withholdingDraftSummaryViewSchema,
  withholdingDraftViewSchema,
  withholdingListMetaSchema,
  withholdingOptionsViewSchema,
  withholdingSupplierViewSchema,
} from "../withholding-receipts.ts";
import {
  emitShippingGuideHeadersSchema,
  emitShippingGuideSchema,
  listShippingGuidesQuerySchema,
  shippingGuideIdParamsSchema,
  shippingGuideSummaryViewSchema,
  shippingGuideTransmissionViewSchema,
  shippingGuideViewSchema,
  createShippingGuideDraftSchema,
  listShippingGuideDraftsQuerySchema,
  listShippingLookupQuerySchema,
  shippingCarrierViewSchema,
  shippingEligibleInvoiceViewSchema,
  shippingGuideDraftIdParamsSchema,
  shippingGuideDraftSummaryViewSchema,
  shippingGuideDraftViewSchema,
  shippingGuideListMetaSchema,
  shippingGuideOptionsViewSchema,
  shippingInvoiceGoodsViewSchema,
  shippingInvoiceIdParamsSchema,
  shippingRecipientPartyViewSchema,
  updateShippingGuideDraftSchema,
} from "../shipping-guides.ts";
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

const stockProductNotFound = {
  description: "El producto no existe en la empresa (PRODUCT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const stockMovementBadRequest = {
  description: "Datos inválidos o falta la cabecera Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED).",
  schema: errorEnvelopeSchema,
};
const stockMovementConflict = {
  description:
    "El inventario no está inicializado (INVENTORY_NOT_INITIALIZED), el control está desactivado (STOCK_TRACKING_DISABLED) o la clave ya se usó con otra solicitud (IDEMPOTENCY_KEY_REUSED).",
  schema: errorEnvelopeSchema,
};
const stockMovementResponses = (created: string) => ({
  200: {
    description:
      "Repetición con la misma Idempotency-Key y la misma solicitud: el mismo movimiento.",
    schema: successEnvelope(stockMovementViewSchema),
  },
  201: { description: created, schema: successEnvelope(stockMovementViewSchema) },
});
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

// Notas de crédito (add-credit-notes, design D16).
const creditDraftNotFound = {
  description:
    "El borrador no existe en la empresa (CREDIT_NOTE_DRAFT_NOT_FOUND) o su factura no existe (CREDIT_NOTE_INVOICE_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const creditNoteNotFound = {
  description: "La nota de crédito no existe en la empresa (CREDIT_NOTE_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const creditDraftReferenceErrors = {
  description:
    "Datos inválidos o una referencia que no existe (EMISSION_POINT_NOT_FOUND, CREDIT_NOTE_LINE_INVALID) o un retorno físico mayor que la línea (CREDIT_NOTE_PHYSICAL_RETURN_INVALID).",
  schema: errorEnvelopeSchema,
};
const creditDraftInvoiceConflict = {
  description:
    "La factura no admite nota de crédito: no está autorizada (CREDIT_NOTE_INVOICE_NOT_ELIGIBLE) o se emitió a consumidor final (CREDIT_NOTE_CONSUMER_FINAL); o el borrador cambió (CREDIT_NOTE_DRAFT_CHANGED) o ya se emitió (CREDIT_NOTE_DRAFT_ALREADY_EMITTED).",
  schema: errorEnvelopeSchema,
};
// Notas de débito (add-debit-notes, design D20).
const debitDraftNotFound = {
  description:
    "El borrador no existe en la empresa (DEBIT_NOTE_DRAFT_NOT_FOUND) o su factura no existe (DEBIT_NOTE_INVOICE_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const debitDraftReferenceErrors = {
  description:
    "Datos inválidos (una causa, una descripción, un importe, un tratamiento o una forma de pago con formato inválido, o un campo no permitido) o un punto de emisión que no existe en la empresa (EMISSION_POINT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const debitDraftInvoiceConflict = {
  description:
    "La factura no admite nota de débito: no está autorizada (DEBIT_NOTE_INVOICE_NOT_ELIGIBLE) o se emitió a consumidor final (DEBIT_NOTE_CONSUMER_FINAL, política del proyecto); o el borrador cambió (DEBIT_NOTE_DRAFT_CHANGED) o ya se emitió (DEBIT_NOTE_DRAFT_ALREADY_EMITTED).",
  schema: errorEnvelopeSchema,
};

// Comprobantes de retención (add-withholding-receipts, design D21).
const withholdingDraftNotFound = {
  description:
    "El borrador no existe en la empresa (WITHHOLDING_DRAFT_NOT_FOUND) o su proveedor no existe en la empresa (WITHHOLDING_SUBJECT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const withholdingDraftReferenceErrors = {
  description:
    "Datos inválidos (un período fuera de MM/AAAA, un documento sustento con su tipo, su número o su autorización fuera de formato, un impuesto o una retención fuera de los admitidos, una tarifa enviada para el IVA, una base que no es mayor que cero, un porcentaje, una denominación o un valor retenido en el cuerpo, o más elementos que los máximos absolutos) o un punto de emisión que no existe en la empresa (EMISSION_POINT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const withholdingDraftConflict = {
  description:
    "El borrador excede un límite de recursos del sistema (WITHHOLDING_RESOURCE_LIMIT, una defensa del sistema, no un límite del SRI), cambió (WITHHOLDING_DRAFT_CHANGED) o ya se emitió (WITHHOLDING_DRAFT_ALREADY_EMITTED).",
  schema: errorEnvelopeSchema,
};

const withholdingNotFound = {
  description:
    "El comprobante de retención no existe en la empresa (WITHHOLDING_RECEIPT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const withholdingResponse = (description: string) => ({
  description,
  schema: successEnvelope(withholdingReceiptViewSchema),
});

// Guías de remisión (add-shipping-guides, design D22).
const shippingDraftNotFound = {
  description:
    "El borrador no existe en la empresa (SHIPPING_GUIDE_DRAFT_NOT_FOUND), o su transportista, un destinatario, un establecimiento, un producto o una factura no existe en la empresa (SHIPPING_GUIDE_CARRIER_NOT_FOUND, SHIPPING_GUIDE_RECIPIENT_NOT_FOUND, SHIPPING_GUIDE_ESTABLISHMENT_NOT_FOUND, SHIPPING_GUIDE_PRODUCT_NOT_FOUND o SHIPPING_GUIDE_INVOICE_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const shippingDraftReferenceErrors = {
  description:
    "Datos inválidos (una fecha, una placa, un código de destino o una cantidad fuera de formato, un sustento escrito a mano, un dato derivado enviado, un campo no permitido o más elementos que los máximos absolutos) o un punto de emisión que no existe en la empresa (EMISSION_POINT_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const shippingDraftConflict = {
  description:
    "El borrador excede un límite de recursos del sistema (SHIPPING_GUIDE_RESOURCE_LIMIT, una defensa del sistema, no un límite del SRI), cambió (SHIPPING_GUIDE_DRAFT_CHANGED) o ya se emitió (SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED).",
  schema: errorEnvelopeSchema,
};
const shippingGuideNotFound = {
  description: "La guía de remisión no existe en la empresa (SHIPPING_GUIDE_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const shippingGuideResponse = (description: string) => ({
  description,
  schema: successEnvelope(shippingGuideViewSchema),
});
const shippingLookup = <T extends z.ZodType>(description: string, item: T) => ({
  description,
  schema: z.strictObject({ data: z.array(item), meta: shippingGuideListMetaSchema }),
});

const debitNoteNotFound = {
  description: "La nota de débito no existe en la empresa (DEBIT_NOTE_NOT_FOUND).",
  schema: errorEnvelopeSchema,
};
const debitNoteResponse = (description: string) => ({
  description,
  schema: successEnvelope(debitNoteViewSchema),
});

const creditNoteResponse = (description: string) => ({
  description,
  schema: successEnvelope(creditNoteViewSchema),
});

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
          "El producto cambió después de la consulta (PRODUCT_CHANGED), el código principal está en uso (PRODUCT_MAIN_CODE_TAKEN) o la marca de control de stock de un producto con inventario inicializado se cambia desde el inventario (STOCK_TRACKING_MANAGED_BY_INVENTORY).",
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
  defineRoute({
    method: "post",
    path: "/documents/:documentId/ride-attempts",
    summary: "Reintentar la generación detenida del RIDE de un comprobante autorizado sin RIDE",
    request: { params: documentIdParamsSchema },
    responses: {
      202: {
        description: "Generación programada. El resumen de los documentos del comprobante.",
        schema: successEnvelope(documentSummaryViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: documentNotFound,
      409: {
        description:
          "El RIDE ya existe (RIDE_ALREADY_AVAILABLE), su generación está programada o en curso (RIDE_GENERATION_IN_PROGRESS) o el comprobante no está autorizado (DOCUMENT_NOT_AUTHORIZED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  // Inventario contabilizado por hechos fiscales autorizados (add-minimal-inventory, design D10).
  // Sin rutas para recalcular ni fijar el saldo: solo cambia con movimientos.
  defineRoute({
    method: "get",
    path: "/inventory/items",
    summary:
      "Listar los productos marcados como controlados y los que tienen inventario, con su estado y su saldo",
    request: { query: listStockItemsQuerySchema },
    responses: {
      200: {
        description:
          "Página de productos con el total en `meta`. Sin inicializar, `balance` es null.",
        schema: z.strictObject({
          data: z.array(stockItemViewSchema),
          meta: stockItemListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/inventory/items/:productId",
    summary: "Consultar el estado, el saldo y la inicialización del inventario de un producto",
    request: { params: stockItemParamsSchema },
    responses: {
      200: {
        description: "Inventario del producto.",
        schema: successEnvelope(stockItemDetailViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: stockProductNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/inventory/items/:productId/movements",
    summary:
      "Consultar el kárdex de un producto por rango de fechas, del más reciente al más antiguo, con el saldo después de cada movimiento",
    request: { params: stockItemParamsSchema, query: listStockMovementsQuerySchema },
    responses: {
      200: {
        description: "Página de movimientos con el total en `meta`.",
        schema: z.strictObject({
          data: z.array(stockMovementViewSchema),
          meta: stockMovementListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: stockProductNotFound,
    },
  }),
  defineRoute({
    method: "post",
    path: "/inventory/items/:productId/initialization",
    summary:
      "Inicializar el inventario de un producto marcado como controlado con su movimiento INICIAL, una sola vez",
    request: { params: stockItemParamsSchema, body: initializeStockSchema },
    responses: {
      201: {
        description: "Inventario inicializado. El detalle del inventario.",
        schema: successEnvelope(stockItemDetailViewSchema),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: stockProductNotFound,
      409: {
        description:
          "El inventario ya está inicializado (INVENTORY_ALREADY_INITIALIZED) o el producto no está marcado como controlado (STOCK_TRACKING_REQUIRED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/inventory/items/:productId/entries",
    summary: "Registrar una entrada manual de existencias, con su clave de idempotencia",
    request: {
      params: stockItemParamsSchema,
      headers: stockMovementHeadersSchema,
      body: stockEntrySchema,
    },
    responses: {
      ...stockMovementResponses("Entrada registrada."),
      400: stockMovementBadRequest,
      401: errors[401],
      403: errors[403],
      404: stockProductNotFound,
      409: stockMovementConflict,
    },
  }),
  defineRoute({
    method: "post",
    path: "/inventory/items/:productId/adjustments",
    summary:
      "Registrar un ajuste de existencias, positivo o negativo y con motivo, con su clave de idempotencia",
    request: {
      params: stockItemParamsSchema,
      headers: stockMovementHeadersSchema,
      body: stockAdjustmentSchema,
    },
    responses: {
      ...stockMovementResponses("Ajuste registrado."),
      400: stockMovementBadRequest,
      401: errors[401],
      403: errors[403],
      404: stockProductNotFound,
      409: stockMovementConflict,
    },
  }),
  defineRoute({
    method: "put",
    path: "/inventory/items/:productId/tracking",
    summary:
      "Activar o desactivar el control de stock de un producto con inventario inicializado; desactivar exige saldo cero",
    request: { params: stockItemParamsSchema, body: stockTrackingSchema },
    responses: {
      200: {
        description:
          "Control fijado. Desactivar no cancela las salidas de facturas ya emitidas. El detalle del inventario.",
        schema: successEnvelope(stockItemDetailViewSchema),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: stockProductNotFound,
      409: {
        description:
          "El inventario no está inicializado (INVENTORY_NOT_INITIALIZED), el saldo no es cero (STOCK_TRACKING_HAS_BALANCE) o el producto es un servicio (STOCK_TRACKING_REQUIRED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  // Notas de crédito (add-credit-notes, design D16).
  defineRoute({
    method: "get",
    path: "/credit-notes/eligible-invoices",
    summary:
      "Buscar facturas que admiten nota de crédito: autorizadas, sin consumidor final y con crédito disponible",
    request: { query: listEligibleInvoicesQuerySchema },
    responses: {
      200: {
        description: "Página de facturas elegibles con su crédito disponible y el total en `meta`.",
        schema: z.strictObject({
          data: z.array(eligibleInvoiceViewSchema),
          meta: creditNoteListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/credit-notes/drafts",
    summary: "Listar los borradores de nota de crédito pendientes, por última actualización",
    request: { query: listCreditNoteDraftsQuerySchema },
    responses: {
      200: {
        description: "Página de borradores `DRAFT` con el valor de su vista previa.",
        schema: z.strictObject({
          data: z.array(creditNoteDraftSummaryViewSchema),
          meta: creditNoteListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/credit-notes/drafts",
    summary:
      "Guardar un borrador de nota de crédito sobre una factura autorizada: causa, motivo, punto, líneas y retorno físico",
    request: { body: createCreditNoteDraftSchema },
    responses: {
      201: {
        description:
          "Borrador guardado, con la vista previa del servidor: importes, lo acreditable que queda y los problemas por línea. No reserva nada.",
        schema: successEnvelope(creditNoteDraftViewSchema),
      },
      400: creditDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: creditDraftNotFound,
      409: creditDraftInvoiceConflict,
    },
  }),
  defineRoute({
    method: "get",
    path: "/credit-notes/drafts/:draftId",
    summary: "Consultar un borrador de nota de crédito con su vista previa recalculada",
    request: { params: creditNoteDraftIdParamsSchema },
    responses: {
      200: {
        description:
          "Borrador con la vista previa calculada con la capacidad vigente de la factura.",
        schema: successEnvelope(creditNoteDraftViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: creditDraftNotFound,
      409: {
        description: "El borrador ya se emitió (CREDIT_NOTE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/credit-notes/drafts/:draftId",
    summary: "Corregir un borrador de nota de crédito a partir de la versión consultada",
    request: { params: creditNoteDraftIdParamsSchema, body: updateCreditNoteDraftSchema },
    responses: {
      200: {
        description: "Borrador corregido.",
        schema: successEnvelope(creditNoteDraftViewSchema),
      },
      400: creditDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: creditDraftNotFound,
      409: creditDraftInvoiceConflict,
    },
  }),
  defineRoute({
    method: "delete",
    path: "/credit-notes/drafts/:draftId",
    summary: "Eliminar un borrador de nota de crédito sin emitir",
    request: { params: creditNoteDraftIdParamsSchema },
    responses: {
      204: { description: "Borrador eliminado, sin rastro fiscal ni capacidad reservada." },
      401: errors[401],
      403: errors[403],
      404: creditDraftNotFound,
      409: {
        description: "El borrador ya se emitió (CREDIT_NOTE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/credit-notes",
    summary:
      "Emitir un borrador de nota de crédito con las declaraciones del usuario: reserva la capacidad, el número y la clave, y firma localmente (sin el SRI)",
    request: { headers: emitCreditNoteHeadersSchema, body: emitCreditNoteSchema },
    responses: {
      200: creditNoteResponse(
        "Repetición con la misma Idempotency-Key y la misma solicitud: la misma nota, sin otra capacidad. Si seguía `RESERVED`, se intenta firmar otra vez.",
      ),
      201: creditNoteResponse(
        "Nota emitida: `SIGNED` con su artefacto, o `RESERVED` con el diagnóstico del intento, y su capacidad reservada.",
      ),
      400: {
        description:
          "Datos inválidos, declaraciones faltantes o de otra versión, o falta la cabecera Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: creditDraftNotFound,
      409: {
        description:
          "La emisión se rechazó antes de reservar el número, con el código del primer problema (por ejemplo CREDIT_NOTE_QUANTITY_EXCEEDED, CREDIT_NOTE_AMOUNT_EXCEEDED, CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE, CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED, CREDIT_NOTE_CONSUMER_FINAL o CREDIT_NOTE_INVOICE_INTEGRITY), o la clave ya se usó con otra solicitud (IDEMPOTENCY_KEY_REUSED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/credit-notes",
    summary:
      "Listar notas de crédito por estado y causa y buscar por número o comprador, las más recientes primero",
    request: { query: listCreditNotesQuerySchema },
    responses: {
      200: {
        description: "Página de notas de crédito con su factura, su causa y el total en `meta`.",
        schema: z.strictObject({
          data: z.array(creditNoteSummaryViewSchema),
          meta: creditNoteListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/credit-notes/invoices/:invoiceId/credit",
    summary:
      "Consultar el crédito de una factura: aplicado, reservado y disponible, por línea y con el retorno físico posible",
    request: { params: creditInvoiceIdParamsSchema },
    responses: {
      200: {
        description: "Crédito de la factura.",
        schema: successEnvelope(invoiceCreditViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: {
        description: "La factura no existe en la empresa (CREDIT_NOTE_INVOICE_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/credit-notes/:creditNoteId",
    summary:
      "Consultar una nota de crédito desde su snapshot: factura modificada, causa, líneas con su retorno físico, declaraciones del usuario, diagnóstico y transmisión",
    request: { params: creditNoteIdParamsSchema },
    responses: {
      200: creditNoteResponse("Nota de crédito."),
      401: errors[401],
      403: errors[403],
      404: creditNoteNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/credit-notes/:creditNoteId/transmission",
    summary:
      "Consultar el historial de la transmisión al SRI de una nota de crédito, sin respuestas originales ni XML",
    request: { params: creditNoteIdParamsSchema },
    responses: {
      200: {
        description: "Las 100 entradas más recientes del historial y el total.",
        schema: successEnvelope(creditNoteTransmissionViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: creditNoteNotFound,
    },
  }),
  defineRoute({
    method: "post",
    path: "/credit-notes/:creditNoteId/reconciliations",
    summary:
      "Pedir la reconciliación de una nota de crédito con el SRI, con motivo (solo el administrador)",
    request: { params: creditNoteIdParamsSchema, body: creditNoteReconciliationSchema },
    responses: {
      202: creditNoteResponse(
        "Reconciliación programada con las reglas de la transmisión; la nota con su estado actual.",
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: creditNoteNotFound,
      409: {
        description:
          "Hay una interacción con el SRI en curso (SRI_INTERACTION_IN_PROGRESS) o el estado no admite una reconciliación (CREDIT_NOTE_NOT_RECONCILABLE).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/credit-notes/:creditNoteId/signing-attempts",
    summary:
      "Reintentar la firma de una nota de crédito reservada, con el mismo número, la misma clave y su capacidad reservada",
    request: { params: creditNoteIdParamsSchema },
    responses: {
      200: creditNoteResponse(
        "Nota tras el intento: `SIGNED`, o `RESERVED` con el diagnóstico. Una nota ya firmada se devuelve sin cambios.",
      ),
      401: errors[401],
      403: errors[403],
      404: creditNoteNotFound,
    },
  }),
  // Notas de débito (add-debit-notes, design D20).
  defineRoute({
    method: "get",
    path: "/debit-notes/eligible-invoices",
    summary:
      "Buscar facturas que admiten nota de débito: autorizadas, sin consumidor final y del ambiente en que la empresa emite",
    request: { query: listDebitEligibleInvoicesQuerySchema },
    responses: {
      200: {
        description: "Página de facturas elegibles y el total en `meta`.",
        schema: z.strictObject({
          data: z.array(debitEligibleInvoiceViewSchema),
          meta: debitNoteListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/debit-notes/drafts",
    summary: "Listar los borradores de nota de débito pendientes, por última actualización",
    request: { query: listDebitNoteDraftsQuerySchema },
    responses: {
      200: {
        description: "Página de borradores `DRAFT` con el valor total de su vista previa.",
        schema: z.strictObject({
          data: z.array(debitNoteDraftSummaryViewSchema),
          meta: debitNoteListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/debit-notes/drafts",
    summary:
      "Guardar un borrador de nota de débito sobre una factura autorizada: conceptos, forma de pago y punto",
    request: { body: createDebitNoteDraftSchema },
    responses: {
      201: {
        description:
          "Borrador guardado, con la vista previa del servidor: los tratamientos de IVA de la factura, las bases e impuestos por tratamiento, el valor total, la forma de pago y los problemas por concepto. No reserva nada.",
        schema: successEnvelope(debitNoteDraftViewSchema),
      },
      400: debitDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: debitDraftNotFound,
      409: debitDraftInvoiceConflict,
    },
  }),
  defineRoute({
    method: "get",
    path: "/debit-notes/drafts/:draftId",
    summary: "Consultar un borrador de nota de débito con su vista previa recalculada",
    request: { params: debitNoteDraftIdParamsSchema },
    responses: {
      200: {
        description:
          "Borrador con la vista previa calculada con la fecha del día y el catálogo vigente.",
        schema: successEnvelope(debitNoteDraftViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: debitDraftNotFound,
      409: {
        description: "El borrador ya se emitió (DEBIT_NOTE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/debit-notes/drafts/:draftId",
    summary: "Corregir un borrador de nota de débito a partir de la versión consultada",
    request: { params: debitNoteDraftIdParamsSchema, body: updateDebitNoteDraftSchema },
    responses: {
      200: {
        description: "Borrador corregido.",
        schema: successEnvelope(debitNoteDraftViewSchema),
      },
      400: debitDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: debitDraftNotFound,
      409: debitDraftInvoiceConflict,
    },
  }),
  defineRoute({
    method: "delete",
    path: "/debit-notes/drafts/:draftId",
    summary: "Eliminar un borrador de nota de débito sin emitir",
    request: { params: debitNoteDraftIdParamsSchema },
    responses: {
      204: { description: "Borrador eliminado, sin rastro fiscal." },
      401: errors[401],
      403: errors[403],
      404: debitDraftNotFound,
      409: {
        description: "El borrador ya se emitió (DEBIT_NOTE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/debit-notes",
    summary:
      "Emitir un borrador de nota de débito con la declaración del usuario: reserva el número y la clave, y firma localmente (sin el SRI)",
    request: { headers: emitDebitNoteHeadersSchema, body: emitDebitNoteSchema },
    responses: {
      200: debitNoteResponse(
        "Repetición con la misma Idempotency-Key y la misma solicitud: la misma nota. Si seguía `RESERVED`, se intenta firmar otra vez.",
      ),
      201: debitNoteResponse(
        "Nota emitida: `SIGNED` con su artefacto, o `RESERVED` con el diagnóstico del intento.",
      ),
      400: {
        description:
          "Datos inválidos, declaración faltante o de otra versión, o falta la cabecera Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: debitDraftNotFound,
      409: {
        description:
          "La emisión se rechazó antes de reservar el número, con el código del primer problema (por ejemplo DEBIT_NOTE_CONSUMER_FINAL, DEBIT_NOTE_INVOICE_INTEGRITY, DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE, DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE o DEBIT_NOTE_DECLARATION_REQUIRED), o la clave ya se usó con otra solicitud (IDEMPOTENCY_KEY_REUSED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/debit-notes",
    summary:
      "Listar notas de débito por estado y causa y buscar por número o comprador, las más recientes primero",
    request: { query: listDebitNotesQuerySchema },
    responses: {
      200: {
        description: "Página de notas de débito con su factura, sus causas y el total en `meta`.",
        schema: z.strictObject({
          data: z.array(debitNoteSummaryViewSchema),
          meta: debitNoteListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/debit-notes/:debitNoteId",
    summary:
      "Consultar una nota de débito desde su snapshot: factura modificada, conceptos con su causa y su tratamiento, impuestos por tratamiento, forma de pago, declaración del usuario, diagnóstico y transmisión",
    request: { params: debitNoteIdParamsSchema },
    responses: {
      200: debitNoteResponse("Nota de débito."),
      401: errors[401],
      403: errors[403],
      404: debitNoteNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/debit-notes/:debitNoteId/transmission",
    summary:
      "Consultar el historial de la transmisión al SRI de una nota de débito, sin respuestas originales ni XML",
    request: { params: debitNoteIdParamsSchema },
    responses: {
      200: {
        description: "Las 100 entradas más recientes del historial y el total.",
        schema: successEnvelope(debitNoteTransmissionViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: debitNoteNotFound,
    },
  }),
  defineRoute({
    method: "post",
    path: "/debit-notes/:debitNoteId/reconciliations",
    summary:
      "Pedir la reconciliación de una nota de débito con el SRI, con motivo (solo el administrador)",
    request: { params: debitNoteIdParamsSchema, body: debitNoteReconciliationSchema },
    responses: {
      202: debitNoteResponse(
        "Reconciliación programada con las reglas de la transmisión; la nota con su estado actual.",
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: debitNoteNotFound,
      409: {
        description:
          "Hay una interacción con el SRI en curso (SRI_INTERACTION_IN_PROGRESS) o el estado no admite una reconciliación (DEBIT_NOTE_NOT_RECONCILABLE).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/debit-notes/:debitNoteId/signing-attempts",
    summary:
      "Reintentar la firma de una nota de débito reservada, con el mismo número y la misma clave",
    request: { params: debitNoteIdParamsSchema },
    responses: {
      200: debitNoteResponse(
        "Nota tras el intento: `SIGNED`, o `RESERVED` con el diagnóstico. Una nota ya firmada se devuelve sin cambios.",
      ),
      401: errors[401],
      403: errors[403],
      404: debitNoteNotFound,
    },
  }),
  // Comprobantes de retención (add-withholding-receipts, design D21).
  defineRoute({
    method: "get",
    path: "/withholding-receipts/suppliers",
    summary:
      "Buscar proveedores que pueden ser sujeto retenido: activos, con RUC, cédula o pasaporte, por identificación o razón social",
    request: { query: listWithholdingSuppliersQuerySchema },
    responses: {
      200: {
        description: "Página de proveedores y el total en `meta`; nunca el consumidor final.",
        schema: z.strictObject({
          data: z.array(withholdingSupplierViewSchema),
          meta: withholdingListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/withholding-receipts/options",
    summary:
      "Consultar las opciones del borrador de retención: conceptos de renta y códigos del IVA utilizables, tipos de documento y sustentos compatibles, códigos de porcentaje de los impuestos del documento, formas de pago y límites de recursos",
    responses: {
      200: {
        description:
          "Opciones resueltas con la fecha de hoy para la empresa: solo entradas soportadas, vigentes y habilitadas. Los códigos de porcentaje llevan sus vigencias, porque se resuelven con la fecha del documento sustento.",
        schema: successEnvelope(withholdingOptionsViewSchema),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/withholding-receipts/drafts",
    summary: "Listar los borradores de retención pendientes, por última actualización",
    request: { query: listWithholdingDraftsQuerySchema },
    responses: {
      200: {
        description: "Página de borradores `DRAFT` con el total retenido de su vista previa.",
        schema: z.strictObject({
          data: z.array(withholdingDraftSummaryViewSchema),
          meta: withholdingListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/withholding-receipts/drafts",
    summary:
      "Guardar un borrador de retención: proveedor, parte relacionada, período, punto y documentos sustento con sus impuestos, pagos y retenciones",
    request: { body: createWithholdingDraftSchema },
    responses: {
      201: {
        description:
          "Borrador guardado (sin período, el del mes de hoy), con la vista previa del servidor: el código, la denominación, el porcentaje y el valor de cada retención, el total retenido, el aviso del período y los problemas por documento y por retención. No reserva nada.",
        schema: successEnvelope(withholdingDraftViewSchema),
      },
      400: withholdingDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: withholdingDraftNotFound,
      409: withholdingDraftConflict,
    },
  }),
  defineRoute({
    method: "get",
    path: "/withholding-receipts/drafts/:draftId",
    summary: "Consultar un borrador de retención con su vista previa recalculada",
    request: { params: withholdingDraftIdParamsSchema },
    responses: {
      200: {
        description:
          "Borrador con la vista previa calculada con la fecha del día y el catálogo vigente.",
        schema: successEnvelope(withholdingDraftViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: withholdingDraftNotFound,
      409: {
        description: "El borrador ya se emitió (WITHHOLDING_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/withholding-receipts/drafts/:draftId",
    summary: "Corregir un borrador de retención a partir de la versión consultada",
    request: { params: withholdingDraftIdParamsSchema, body: updateWithholdingDraftSchema },
    responses: {
      200: {
        description: "Borrador corregido.",
        schema: successEnvelope(withholdingDraftViewSchema),
      },
      400: withholdingDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: withholdingDraftNotFound,
      409: withholdingDraftConflict,
    },
  }),
  defineRoute({
    method: "delete",
    path: "/withholding-receipts/drafts/:draftId",
    summary: "Eliminar un borrador de retención sin emitir",
    request: { params: withholdingDraftIdParamsSchema },
    responses: {
      204: { description: "Borrador eliminado, sin rastro fiscal." },
      401: errors[401],
      403: errors[403],
      404: withholdingDraftNotFound,
      409: {
        description: "El borrador ya se emitió (WITHHOLDING_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/withholding-receipts",
    summary:
      "Emitir un borrador de retención: reserva el número y la clave, congela el snapshot con los valores retenidos del servidor y firma localmente (sin el SRI)",
    request: { headers: emitWithholdingHeadersSchema, body: emitWithholdingReceiptSchema },
    responses: {
      200: withholdingResponse(
        "Repetición con la misma Idempotency-Key y la misma solicitud: la misma retención. Si seguía `RESERVED`, se intenta firmar otra vez.",
      ),
      201: withholdingResponse(
        "Retención emitida: `SIGNED` con su artefacto, o `RESERVED` con el diagnóstico del intento.",
      ),
      400: {
        description:
          "Datos inválidos o falta la cabecera Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: withholdingDraftNotFound,
      409: {
        description:
          "La emisión se rechazó antes de reservar el número, con el código del primer problema (por ejemplo WITHHOLDING_SUBJECT_CONSUMER_FINAL, WITHHOLDING_RELATED_PARTY_REQUIRED, WITHHOLDING_SUPPORTS_REQUIRED, WITHHOLDING_CONCEPT_NOT_SUPPORTED, WITHHOLDING_IVA_CODE_NOT_SUPPORTED o WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE); el borrador cambió (WITHHOLDING_DRAFT_CHANGED) o ya se emitió con otra clave (WITHHOLDING_DRAFT_ALREADY_EMITTED); o la clave ya se usó con otra solicitud (IDEMPOTENCY_KEY_REUSED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/withholding-receipts/:withholdingReceiptId/signing-attempts",
    summary: "Reintentar la firma de una retención reservada, con el mismo número y la misma clave",
    request: { params: withholdingReceiptIdParamsSchema },
    responses: {
      200: withholdingResponse(
        "Retención tras el intento: `SIGNED`, o `RESERVED` con el diagnóstico. Una retención ya firmada se devuelve sin cambios.",
      ),
      401: errors[401],
      403: errors[403],
      404: withholdingNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/withholding-receipts",
    summary:
      "Listar comprobantes de retención por estado y período fiscal y buscar por número o proveedor, los más recientes primero",
    request: { query: listWithholdingReceiptsQuerySchema },
    responses: {
      200: {
        description:
          "Página de retenciones con su proveedor, su período, su total retenido y el total en `meta`.",
        schema: z.strictObject({
          data: z.array(withholdingReceiptSummaryViewSchema),
          meta: withholdingListMetaSchema,
        }),
      },
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/withholding-receipts/:withholdingReceiptId",
    summary:
      "Consultar un comprobante de retención desde su snapshot: sujeto, parte relacionada declarada por el usuario, período, documentos sustento con sus impuestos, pagos y retenciones, total retenido, diagnóstico y transmisión",
    request: { params: withholdingReceiptIdParamsSchema },
    responses: {
      200: withholdingResponse("Comprobante de retención."),
      401: errors[401],
      403: errors[403],
      404: withholdingNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/withholding-receipts/:withholdingReceiptId/transmission",
    summary:
      "Consultar el historial de la transmisión al SRI de un comprobante de retención, sin respuestas originales ni XML",
    request: { params: withholdingReceiptIdParamsSchema },
    responses: {
      200: {
        description: "Las 100 entradas más recientes del historial y el total.",
        schema: successEnvelope(withholdingTransmissionViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: withholdingNotFound,
    },
  }),
  defineRoute({
    method: "post",
    path: "/withholding-receipts/:withholdingReceiptId/reconciliations",
    summary:
      "Pedir la reconciliación de un comprobante de retención con el SRI, con motivo (solo el administrador)",
    request: { params: withholdingReceiptIdParamsSchema, body: requestReconciliationSchema },
    responses: {
      202: withholdingResponse(
        "Reconciliación programada con las reglas de la transmisión; la retención con su estado actual.",
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: withholdingNotFound,
      409: {
        description:
          "Hay una interacción con el SRI en curso (SRI_INTERACTION_IN_PROGRESS) o el estado no admite una reconciliación (WITHHOLDING_NOT_RECONCILABLE).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  // Guías de remisión (add-shipping-guides, design D22).
  defineRoute({
    method: "get",
    path: "/shipping-guides/carriers",
    summary:
      "Buscar transportistas: terceros activos con el rol de transportista y RUC, cédula o pasaporte, por identificación o razón social",
    request: { query: listShippingLookupQuerySchema },
    responses: {
      200: shippingLookup(
        "Página de transportistas y el total en `meta`. Uno cuya identificación no cabe en la guía viene no seleccionable, con su motivo.",
        shippingCarrierViewSchema,
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/recipients",
    summary:
      "Buscar destinatarios: terceros activos con RUC, cédula o pasaporte y cualquier rol, por identificación o razón social",
    request: { query: listShippingLookupQuerySchema },
    responses: {
      200: shippingLookup(
        "Página de terceros y el total en `meta`; nunca el consumidor final.",
        shippingRecipientPartyViewSchema,
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/eligible-invoices",
    summary:
      "Buscar facturas que pueden sustentar una guía: autorizadas, de la empresa y del ambiente vigente, por número o comprador",
    request: { query: listShippingLookupQuerySchema },
    responses: {
      200: shippingLookup(
        "Página de facturas y el total en `meta`, también las emitidas a consumidor final.",
        shippingEligibleInvoiceViewSchema,
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/eligible-invoices/:invoiceId/goods",
    summary:
      "Consultar las mercancías sugeridas de una factura: una sugerencia de la interfaz, no una autoridad",
    request: { params: shippingInvoiceIdParamsSchema },
    responses: {
      200: {
        description:
          "Cada línea de la factura con sus datos históricos: `PRODUCT` si su producto sigue activo y es un bien, `FREE_LINE` en otro caso, para agregarla como línea libre. El snapshot de la guía es la autoridad.",
        schema: successEnvelope(shippingInvoiceGoodsViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: {
        description: "La factura no existe en la empresa (SHIPPING_GUIDE_INVOICE_NOT_FOUND).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/options",
    summary:
      "Consultar las opciones del borrador de guía: la política de excepciones con su versión, los establecimientos propios activos, la identidad del transporte propio y los límites de recursos",
    responses: {
      200: {
        description: "Opciones resueltas con la fecha de hoy para la empresa.",
        schema: successEnvelope(shippingGuideOptionsViewSchema),
      },
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/drafts",
    summary: "Listar los borradores de guía pendientes, por última actualización",
    request: { query: listShippingGuideDraftsQuerySchema },
    responses: {
      200: shippingLookup(
        "Página de borradores `DRAFT` con su transportista y sus cantidades de destinatarios y detalles.",
        shippingGuideDraftSummaryViewSchema,
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "post",
    path: "/shipping-guides/drafts",
    summary:
      "Guardar un borrador de guía: punto, partida, transportista, placa, fechas y destinatarios con su sustento y sus detalles, o proponerlo desde una factura",
    request: { body: createShippingGuideDraftSchema },
    responses: {
      201: {
        description:
          "Borrador guardado con la vista previa del servidor y sus problemas por destinatario y por detalle. Sin partida, propone la dirección del establecimiento del punto; desde una factura, su comprador, la factura como sustento y las mercancías sugeridas `PRODUCT`. No reserva nada.",
        schema: successEnvelope(shippingGuideDraftViewSchema),
      },
      400: shippingDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: shippingDraftNotFound,
      409: shippingDraftConflict,
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/drafts/:draftId",
    summary: "Consultar un borrador de guía con su vista previa recalculada",
    request: { params: shippingGuideDraftIdParamsSchema },
    responses: {
      200: {
        description: "Borrador con la vista previa calculada con la fecha del día.",
        schema: successEnvelope(shippingGuideDraftViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: shippingDraftNotFound,
      409: {
        description: "El borrador ya se emitió (SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "put",
    path: "/shipping-guides/drafts/:draftId",
    summary: "Corregir un borrador de guía a partir de la versión consultada",
    request: { params: shippingGuideDraftIdParamsSchema, body: updateShippingGuideDraftSchema },
    responses: {
      200: {
        description: "Borrador corregido.",
        schema: successEnvelope(shippingGuideDraftViewSchema),
      },
      400: shippingDraftReferenceErrors,
      401: errors[401],
      403: errors[403],
      404: shippingDraftNotFound,
      409: shippingDraftConflict,
    },
  }),
  defineRoute({
    method: "delete",
    path: "/shipping-guides/drafts/:draftId",
    summary: "Eliminar un borrador de guía sin emitir",
    request: { params: shippingGuideDraftIdParamsSchema },
    responses: {
      204: { description: "Borrador eliminado, sin rastro fiscal." },
      401: errors[401],
      403: errors[403],
      404: shippingDraftNotFound,
      409: {
        description: "El borrador ya se emitió (SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/shipping-guides",
    summary:
      "Emitir un borrador de guía de remisión: reserva el número y la clave, congela el snapshot con la declaración de las excepciones y firma localmente (sin el SRI)",
    request: { headers: emitShippingGuideHeadersSchema, body: emitShippingGuideSchema },
    responses: {
      200: shippingGuideResponse(
        "Repetición con la misma Idempotency-Key y la misma solicitud: la misma guía. Si seguía `RESERVED`, se intenta firmar otra vez.",
      ),
      201: shippingGuideResponse(
        "Guía emitida: `SIGNED` con su artefacto, o `RESERVED` con el diagnóstico del intento.",
      ),
      400: {
        description:
          "Datos inválidos o falta la cabecera Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED).",
        schema: errorEnvelopeSchema,
      },
      401: errors[401],
      403: errors[403],
      404: shippingDraftNotFound,
      409: {
        description:
          "La emisión se rechazó antes de reservar el número, con el código del primer problema (por ejemplo SHIPPING_GUIDE_START_BEFORE_ISSUE, SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED, SHIPPING_GUIDE_ORIGIN_ESTABLISHMENT_REQUIRED, SHIPPING_GUIDE_SAME_ESTABLISHMENT, SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED, SHIPPING_GUIDE_DECLARATION_REQUIRED o SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH); el borrador cambió (SHIPPING_GUIDE_DRAFT_CHANGED) o ya se emitió con otra clave (SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED); o la clave ya se usó con otra solicitud (IDEMPOTENCY_KEY_REUSED).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
  defineRoute({
    method: "post",
    path: "/shipping-guides/:shippingGuideId/signing-attempts",
    summary:
      "Reintentar la firma de una guía de remisión reservada, con el mismo número, la misma clave y la misma fecha de emisión",
    request: { params: shippingGuideIdParamsSchema },
    responses: {
      200: shippingGuideResponse(
        "Guía tras el intento: `SIGNED`, o `RESERVED` con el diagnóstico. Una guía ya firmada se devuelve sin cambios.",
      ),
      401: errors[401],
      403: errors[403],
      404: shippingGuideNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/:shippingGuideId",
    summary:
      "Consultar una guía de remisión desde su snapshot: transportista, placa, fechas, partida y cada destinatario con su sustento (la excepción declarada por el usuario) y su detalle, diagnóstico y transmisión",
    request: { params: shippingGuideIdParamsSchema },
    responses: {
      200: shippingGuideResponse("Guía de remisión."),
      401: errors[401],
      403: errors[403],
      404: shippingGuideNotFound,
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides",
    summary:
      "Listar guías de remisión por estado y buscar por número, transportista o identificación de cualquier destinatario, las más recientes primero",
    request: { query: listShippingGuidesQuerySchema },
    responses: {
      200: shippingLookup(
        'Página de guías con su transportista, "N destinatarios" o el nombre del único, las fechas del transporte y el total en `meta`; sin importes.',
        shippingGuideSummaryViewSchema,
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
    },
  }),
  defineRoute({
    method: "get",
    path: "/shipping-guides/:shippingGuideId/transmission",
    summary:
      "Consultar el historial de la transmisión al SRI de una guía de remisión, sin respuestas originales ni XML",
    request: { params: shippingGuideIdParamsSchema },
    responses: {
      200: {
        description: "Las 100 entradas más recientes del historial y el total.",
        schema: successEnvelope(shippingGuideTransmissionViewSchema),
      },
      401: errors[401],
      403: errors[403],
      404: shippingGuideNotFound,
    },
  }),
  defineRoute({
    method: "post",
    path: "/shipping-guides/:shippingGuideId/reconciliations",
    summary:
      "Pedir la reconciliación de una guía de remisión con el SRI, con motivo (solo el administrador)",
    request: { params: shippingGuideIdParamsSchema, body: requestReconciliationSchema },
    responses: {
      202: shippingGuideResponse(
        "Reconciliación programada con las reglas de la transmisión; la guía con su estado actual.",
      ),
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: shippingGuideNotFound,
      409: {
        description:
          "Hay una interacción con el SRI en curso (SRI_INTERACTION_IN_PROGRESS) o el estado no admite una reconciliación (SHIPPING_GUIDE_NOT_RECONCILABLE).",
        schema: errorEnvelopeSchema,
      },
    },
  }),
];
