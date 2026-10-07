// Contratos de las guías de remisión (add-shipping-guides, design D3 a D9, D12, D14, D22 y D23). Los
// cuerpos son estrictos: un `companyId`, un precio, un impuesto, `detallesAdicionales`, un documento
// aduanero, varias placas, un número o una autorización de sustento escritos a mano, o un dato
// derivado (la partida con un origen elegido, la dirección y el código de la propia empresa, los
// códigos de un producto) se rechazan. El usuario elige el punto, la partida, el transportista, la
// placa, las fechas y los destinatarios con su sustento tipado y su detalle; el servidor resuelve las
// identidades, la partida derivada y los datos de cada factura. Las cantidades son decimales exactos.
import { z } from "zod";
import { DECIMAL_SPECS, compareDecimalStrings, decimalString } from "./decimal.ts";
import { documentTypeSchema } from "./fiscal-numbering.ts";
import {
  emitInvoiceHeadersSchema,
  invoiceAmountSchema,
  invoiceStateSchema,
  invoiceTransmissionSummarySchema,
  signingDiagnosticViewSchema,
  SIGNING_ATTEMPT_CODE_LIST,
  transmissionEventViewSchema,
  type SigningAttemptCode,
} from "./invoices.ts";
import { listMetaSchema, pageParams, searchParam } from "./pagination.ts";
import { environmentSchema, rimpeCategorySchema, strictBody } from "./taxpayer.ts";

/**
 * Máximos absolutos de los límites de recursos (design D23, P9): el contrato nunca admite más. El
 * límite efectivo es configurable por entorno, con estos valores por defecto, y los tres se aplican
 * juntos. Son defensas de recursos del sistema, nunca límites del SRI ni del XSD, ni una
 * interpretación del límite de tamaño del envío (Q-47).
 */
export const SHIPPING_GUIDE_LIMITS_MAX = {
  recipients: 50,
  detailsPerRecipient: 100,
  details: 300,
} as const;
export const SHIPPING_GUIDE_LIMITS_DEFAULT = {
  recipients: 10,
  detailsPerRecipient: 50,
  details: 100,
} as const;
export type ShippingGuideLimits = { [K in keyof typeof SHIPPING_GUIDE_LIMITS_MAX]: number };

const DEFENSE = "Es una defensa de recursos del sistema, no un límite del SRI.";

/** Origen del transportista (design D3, P4): transporte propio o un tercero transportista. */
export const TRANSPORTER_SOURCES = ["SELF", "PARTY"] as const;
export const transporterSourceSchema = z.enum(TRANSPORTER_SOURCES, {
  error: "El transporte debe ser propio (SELF) o de un tercero transportista (PARTY).",
});
export type TransporterSource = z.infer<typeof transporterSourceSchema>;

/** Clase del destinatario (design D7, P2 y P3): un tercero o la propia empresa. */
export const SHIPPING_RECIPIENT_KINDS = ["PARTY", "OWN_COMPANY"] as const;
export const shippingRecipientKindSchema = z.enum(SHIPPING_RECIPIENT_KINDS);
export type ShippingRecipientKind = z.infer<typeof shippingRecipientKindSchema>;

/** Clase del sustento de un destinatario (design D8, P1). */
export const SHIPPING_SUPPORT_KINDS = ["INTERNAL_INVOICE", "DECLARED_EXCEPTION"] as const;
export const shippingSupportKindSchema = z.enum(SHIPPING_SUPPORT_KINDS);
export type ShippingSupportKind = z.infer<typeof shippingSupportKindSchema>;

/**
 * Excepciones del art. 30, numeral 8, del Reglamento de Comprobantes de Venta que admite el MVP
 * (design D8, P1): la venta itinerante (literal a) no tiene código y queda fuera.
 */
export const SHIPPING_EXCEPTION_CASES = [
  "QUANTITY_OR_PRICE_AFTER_TRANSFER",
  "CONSIGNMENT",
  "OWN_ESTABLISHMENT_TRANSFER",
  "EXHIBITION_OR_DEMONSTRATION",
] as const;
export const shippingExceptionCaseSchema = z.enum(SHIPPING_EXCEPTION_CASES, {
  error:
    "La excepción no es una de las admitidas: cantidad o precio después del traslado, consignación, traslado entre establecimientos propios o exhibición o demostración. La venta itinerante está fuera del alcance actual.",
});
export type ShippingExceptionCase = z.infer<typeof shippingExceptionCaseSchema>;

/** Versión vigente de la política de excepciones declaradas (design D14). */
export const SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION = 1;

/** Fuente de la política de excepciones: el texto oficial de cada caso. */
export const SHIPPING_EXCEPTION_SOURCE =
  "Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios, art. 30, numeral 8";

/**
 * Cada excepción con su literal, su denominación, el texto oficial que el usuario declara y la clase
 * de destinatario que admite. Versión 1 de la política.
 */
export const SHIPPING_EXCEPTION_POLICY: Record<
  ShippingExceptionCase,
  {
    literal: "b" | "c" | "d" | "e";
    label: string;
    statement: string;
    recipientKind: ShippingRecipientKind;
  }
> = {
  QUANTITY_OR_PRICE_AFTER_TRANSFER: {
    literal: "b",
    label: "Cantidad o precio determinado después del traslado",
    statement:
      "Cuando el volumen o cantidad de la mercadería trasladada y el precio de la transacción pueda ser determinado solo cuando los bienes han sido efectivamente transferidos al adquirente.",
    recipientKind: "PARTY",
  },
  CONSIGNMENT: {
    literal: "c",
    label: "Consignación",
    statement:
      "Traslado para ventas en consignación, excepto de productos gravados con el impuesto a los consumos especiales, cuando la transferencia la haga el sujeto pasivo del mismo.",
    recipientKind: "PARTY",
  },
  OWN_ESTABLISHMENT_TRANSFER: {
    literal: "d",
    label: "Traslado entre establecimientos propios",
    statement: "Traslado entre establecimientos de un mismo contribuyente.",
    recipientKind: "OWN_COMPANY",
  },
  EXHIBITION_OR_DEMONSTRATION: {
    literal: "e",
    label: "Exhibición o demostración",
    statement: "Traslado para exhibiciones o demostraciones.",
    recipientKind: "PARTY",
  },
};

/** Tipos de identificación de un tercero transportista o destinatario (design D3 y D7). */
export const SHIPPING_IDENTIFICATION_TYPES = ["04", "05", "06"] as const;
/** Identificación máxima del transportista en el XML (ficha v2.34, anexo 3, página 70). */
export const CARRIER_IDENTIFICATION_MAX = 13;
export const CARRIER_IDENTIFICATION_SOURCE = "Ficha técnica v2.34, anexo 3, página 70";
/** Placa de 1 a 20 caracteres (XSD `placa`), sin formato vehicular (design D4, P5). */
export const PLATE_MAX = 20;
/** Código del establecimiento de destino: tres dígitos (XSD `codEstabDestino`). */
export const DESTINATION_CODE_PATTERN = /^[0-9]{3}$/;

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const idSchema = (message: string) => z.string({ error: message }).min(1, message);
const isoDate = z.iso.date();
const NO_LINE_BREAK = /^[^\r\n]*$/;

/**
 * Texto fiscal de 1 a `max` caracteres sin saltos de línea. Los extremos se recortan antes de medir
 * la longitud: unos espacios al inicio o al final no cuentan.
 */
const fiscalText = (max: number, label: string) =>
  z
    .string({ error: `${label} no es válido.` })
    .trim()
    .max(max, `${label} admite como máximo ${max} caracteres.`)
    .regex(NO_LINE_BREAK, `${label} no admite saltos de línea.`);

/** Cantidad del detalle: dominio `cantidad` (18/6) y mayor que cero (política del proyecto, P7). */
export const shippingQuantitySchema = decimalString(DECIMAL_SPECS.cantidad).refine(
  (value) => compareDecimalStrings(value, "0") > 0,
  "La cantidad debe ser mayor que cero: es una política del sistema, aunque el XSD admita cero.",
);

const transporterSchema = z.discriminatedUnion(
  "source",
  [
    strictBody({ source: z.literal("SELF") }),
    strictBody({ source: z.literal("PARTY"), partyId: idSchema("El transportista no es válido.") }),
  ],
  { error: "El transportista no es válido." },
);

const recipientSchema = z.discriminatedUnion(
  "kind",
  [
    strictBody({ kind: z.literal("PARTY"), partyId: idSchema("El destinatario no es válido.") }),
    strictBody({
      kind: z.literal("OWN_COMPANY"),
      destinationEstablishmentId: idSchema("El establecimiento de destino no es válido."),
    }),
  ],
  { error: "El destinatario no es válido." },
);

const supportSchema = z.discriminatedUnion(
  "kind",
  [
    strictBody({
      kind: z.literal("INTERNAL_INVOICE"),
      invoiceId: idSchema("La factura sustento no es válida."),
    }),
    strictBody({ kind: z.literal("DECLARED_EXCEPTION"), case: shippingExceptionCaseSchema }),
  ],
  { error: "El sustento no es válido." },
);

/** Detalle (design D9): producto opcional o línea libre; sin precio, impuesto ni detalles adicionales. */
export const shippingDetailSchema = strictBody({
  productId: nullable(idSchema("El producto no es válido.")),
  mainCode: nullable(fiscalText(25, "El código principal")),
  auxiliaryCode: nullable(fiscalText(25, "El código auxiliar")),
  description: nullable(fiscalText(300, "La descripción")),
  // En el borrador basta el formato: una cantidad cero se guarda y la vista previa la informa junto a
  // su destinatario y su detalle; la emisión la rechaza (política del proyecto).
  quantity: nullable(decimalString(DECIMAL_SPECS.cantidad)),
}).refine(
  (value) => value.productId === null || (value.mainCode === null && value.auxiliaryCode === null),
  {
    message: "Los códigos de un producto salen del producto: no se envían.",
    path: ["mainCode"],
  },
);
export type ShippingDetailInput = z.input<typeof shippingDetailSchema>;

/** Destinatario del borrador (design D7 y D8): su clase, sus textos, su sustento y su detalle. */
export const shippingRecipientSchema = strictBody({
  recipient: nullable(recipientSchema),
  address: nullable(fiscalText(300, "La dirección de destino")),
  motive: nullable(fiscalText(300, "El motivo del traslado")),
  route: nullable(fiscalText(300, "La ruta")),
  destinationEstablishmentCode: nullable(
    z
      .string({ error: "El código del establecimiento de destino no es válido." })
      .regex(DESTINATION_CODE_PATTERN, "El código del establecimiento de destino tiene 3 dígitos."),
  ),
  support: nullable(supportSchema),
  details: z
    .array(shippingDetailSchema, { error: "El detalle no es válido." })
    .max(
      SHIPPING_GUIDE_LIMITS_MAX.detailsPerRecipient,
      `Un destinatario admite como máximo ${SHIPPING_GUIDE_LIMITS_MAX.detailsPerRecipient} detalles. ${DEFENSE}`,
    )
    .default([]),
}).refine(
  (value) =>
    value.recipient?.kind !== "OWN_COMPANY" ||
    (value.address === null && value.destinationEstablishmentCode === null),
  {
    message:
      "La dirección y el código de la propia empresa salen del establecimiento de destino: no se envían.",
    path: ["address"],
  },
);
export type ShippingRecipientInput = z.input<typeof shippingRecipientSchema>;
export type ShippingRecipientData = z.output<typeof shippingRecipientSchema>;

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

/** Un borrador puede guardarse incompleto: cada campo puede faltar y la vista previa lo informa. */
const draftShape = {
  emissionPointId: nullable(idSchema("El punto de emisión no es válido.")),
  originEstablishmentId: nullable(idSchema("El establecimiento de origen no es válido.")),
  departureAddress: nullable(fiscalText(300, "La dirección de partida")),
  transporter: nullable(transporterSchema),
  plate: nullable(fiscalText(PLATE_MAX, "La placa")),
  transportStart: nullable(isoDate),
  transportEnd: nullable(isoDate),
  recipients: z
    .array(shippingRecipientSchema, { error: "Los destinatarios no son válidos." })
    .max(
      SHIPPING_GUIDE_LIMITS_MAX.recipients,
      `La guía admite como máximo ${SHIPPING_GUIDE_LIMITS_MAX.recipients} destinatarios. ${DEFENSE}`,
    )
    .default([]),
};

type DraftCore = Readonly<{
  originEstablishmentId: string | null;
  departureAddress: string | null;
  recipients: readonly Readonly<{ details: readonly unknown[] }>[];
}>;

const checkDraft = (value: DraftCore, ctx: z.RefinementCtx) => {
  if (value.originEstablishmentId !== null && value.departureAddress !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["departureAddress"],
      message: "Con un establecimiento de origen, la partida sale de su dirección: no se envía.",
    });
  }
  const details = value.recipients.reduce((sum, recipient) => sum + recipient.details.length, 0);
  if (details > SHIPPING_GUIDE_LIMITS_MAX.details) {
    ctx.addIssue({
      code: "custom",
      path: ["recipients"],
      message: `La guía admite como máximo ${SHIPPING_GUIDE_LIMITS_MAX.details} detalles. ${DEFENSE}`,
    });
  }
};

/**
 * Alta de un borrador. Con `fromInvoiceId` el servidor propone un destinatario desde una factura
 * autorizada (design D12): el comprador, la factura como sustento y las mercancías sugeridas.
 */
export const createShippingGuideDraftSchema = strictBody({
  ...draftShape,
  fromInvoiceId: nullable(idSchema("La factura no es válida.")),
}).superRefine((value, ctx) => {
  checkDraft(value, ctx);
  if (value.fromInvoiceId !== null && value.recipients.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["recipients"],
      message:
        "Desde una factura, el servidor propone el destinatario: no se envían destinatarios.",
    });
  }
});
export type CreateShippingGuideDraftInput = z.input<typeof createShippingGuideDraftSchema>;

export const updateShippingGuideDraftSchema = strictBody({
  ...draftShape,
  expectedVersion: expectedVersionSchema,
}).superRefine(checkDraft);
export type UpdateShippingGuideDraftInput = z.input<typeof updateShippingGuideDraftSchema>;
export type ShippingGuideDraftData = Omit<
  z.output<typeof updateShippingGuideDraftSchema>,
  "expectedVersion"
>;

export const shippingGuideDraftIdParamsSchema = z.strictObject({ draftId: z.string().min(1) });
export const shippingGuideIdParamsSchema = z.strictObject({ shippingGuideId: z.string().min(1) });
export const shippingInvoiceIdParamsSchema = z.strictObject({ invoiceId: z.string().min(1) });

/** Cabecera obligatoria de la emisión, la misma de la factura: `Idempotency-Key`. */
export const emitShippingGuideHeadersSchema = emitInvoiceHeadersSchema;

/**
 * Emisión (design D14 y D15): la confirmación de las excepciones declaradas cita la versión vigente
 * de la política y forma parte de la huella, porque cambia el documento emitido.
 */
export const emitShippingGuideSchema = strictBody({
  draftId: idSchema("El borrador es obligatorio."),
  expectedVersion: expectedVersionSchema,
  exceptionDeclaration: nullable(
    strictBody({
      policyVersion: z
        .number({ error: "La versión de la política es obligatoria." })
        .int("La versión de la política no es válida."),
    }),
  ),
});
export type EmitShippingGuideInput = z.input<typeof emitShippingGuideSchema>;

/** Consultas: no son estrictas, de modo que un `companyId` se ignora. */
export const listShippingGuideDraftsQuerySchema = z.object({ ...pageParams });
export type ListShippingGuideDraftsQuery = z.output<typeof listShippingGuideDraftsQuerySchema>;

export const listShippingGuidesQuerySchema = z.object({
  search: searchParam,
  state: invoiceStateSchema.optional(),
  ...pageParams,
});
export type ListShippingGuidesQuery = z.output<typeof listShippingGuidesQuerySchema>;

/** Transportistas, destinatarios y facturas elegibles, por identificación, nombre o número. */
export const listShippingLookupQuerySchema = z.object({ search: searchParam, ...pageParams });
export type ListShippingLookupQuery = z.output<typeof listShippingLookupQuerySchema>;

/**
 * Rechazos de las guías de remisión (design D22). Cada uno es un `409`, salvo los de recurso
 * inexistente (`404`). La emisión informa el primero; la vista previa muestra todos.
 */
export const SHIPPING_GUIDE_ERROR_CODES = [
  "SHIPPING_GUIDE_NOT_FOUND",
  "SHIPPING_GUIDE_DRAFT_NOT_FOUND",
  "SHIPPING_GUIDE_INVOICE_NOT_FOUND",
  "SHIPPING_GUIDE_CARRIER_REQUIRED",
  "SHIPPING_GUIDE_CARRIER_NOT_FOUND",
  "SHIPPING_GUIDE_CARRIER_INACTIVE",
  "SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED",
  "SHIPPING_GUIDE_CARRIER_IDENTIFICATION_TOO_LONG",
  "SHIPPING_GUIDE_CARRIER_CONSUMER_FINAL",
  "SHIPPING_GUIDE_CARRIER_FOREIGN_OUT_OF_SCOPE",
  "SHIPPING_GUIDE_PLATE_INVALID",
  "SHIPPING_GUIDE_DATE_INVALID",
  "SHIPPING_GUIDE_START_BEFORE_ISSUE",
  "SHIPPING_GUIDE_END_BEFORE_START",
  "SHIPPING_GUIDE_DEPARTURE_ADDRESS_INVALID",
  "SHIPPING_GUIDE_RECIPIENTS_REQUIRED",
  "SHIPPING_GUIDE_RECIPIENT_INVALID",
  "SHIPPING_GUIDE_RECIPIENT_NOT_FOUND",
  "SHIPPING_GUIDE_RECIPIENT_INACTIVE",
  "SHIPPING_GUIDE_RECIPIENT_CONSUMER_FINAL",
  "SHIPPING_GUIDE_RECIPIENT_FOREIGN_OUT_OF_SCOPE",
  "SHIPPING_GUIDE_ORIGIN_ESTABLISHMENT_REQUIRED",
  "SHIPPING_GUIDE_SAME_ESTABLISHMENT",
  "SHIPPING_GUIDE_ESTABLISHMENT_NOT_FOUND",
  "SHIPPING_GUIDE_ESTABLISHMENT_INACTIVE",
  "SHIPPING_GUIDE_MOTIVE_REQUIRED",
  "SHIPPING_GUIDE_ADDRESS_REQUIRED",
  "SHIPPING_GUIDE_DESTINATION_CODE_INVALID",
  "SHIPPING_GUIDE_SUPPORT_REQUIRED",
  "SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED",
  "SHIPPING_GUIDE_INVOICE_ENVIRONMENT_MISMATCH",
  "SHIPPING_GUIDE_INVOICE_NOT_INTACT",
  "SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH",
  "SHIPPING_GUIDE_DECLARATION_REQUIRED",
  "SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH",
  "SHIPPING_GUIDE_DECLARATION_NOT_APPLICABLE",
  "SHIPPING_GUIDE_DETAILS_REQUIRED",
  "SHIPPING_GUIDE_DESCRIPTION_INVALID",
  "SHIPPING_GUIDE_CODE_INVALID",
  "SHIPPING_GUIDE_PRODUCT_NOT_FOUND",
  "SHIPPING_GUIDE_PRODUCT_NOT_GOOD",
  "SHIPPING_GUIDE_PRODUCT_INACTIVE",
  "SHIPPING_GUIDE_QUANTITY_INVALID",
  "SHIPPING_GUIDE_RESOURCE_LIMIT",
  "SHIPPING_GUIDE_DRAFT_INCOMPLETE",
  "SHIPPING_GUIDE_DRAFT_CHANGED",
  "SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED",
  "SHIPPING_GUIDE_NOT_RECONCILABLE",
  // Los de la emisión compartidos con la factura.
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "TAXPAYER_NOT_CONFIGURED",
  "EMISSION_POINT_NOT_FOUND",
  "EMISSION_POINT_UNAVAILABLE",
  "SIGNING_CERTIFICATE_NOT_USABLE",
  "SCHEMA_NOT_AVAILABLE",
  "SEQUENCE_EXHAUSTED",
  "SRI_INTERACTION_IN_PROGRESS",
] as const;
export type ShippingGuideErrorCode = (typeof SHIPPING_GUIDE_ERROR_CODES)[number];

/**
 * Problema del borrador o de la emisión, con el campo de la guía, la posición del destinatario y,
 * dentro de él, la del detalle (desde 1), o null.
 */
export const shippingGuideIssueSchema = z.strictObject({
  code: z.enum(SHIPPING_GUIDE_ERROR_CODES),
  message: z.string(),
  field: z.string().nullable(),
  recipient: z.number().int().nullable(),
  detail: z.number().int().nullable(),
});
export type ShippingGuideIssue = z.infer<typeof shippingGuideIssueSchema>;

const quantity = decimalString(DECIMAL_SPECS.cantidad);

const establishmentRefSchema = z.strictObject({
  id: z.string(),
  code: z.string(),
  address: z.string(),
});

const partyIdentitySchema = z.strictObject({
  identificationType: z.string(),
  identification: z.string(),
  legalName: z.string(),
});

/** Tercero transportista (design D3): elegible o no, con el motivo cuando no lo es. */
export const shippingCarrierViewSchema = z.strictObject({
  id: z.string(),
  identificationType: z.string(),
  identification: z.string(),
  legalName: z.string(),
  selectable: z.boolean(),
  /** Por qué no se puede elegir (identificación de más de 13 caracteres), o null. */
  reason: z.string().nullable(),
});
export type ShippingCarrierView = z.infer<typeof shippingCarrierViewSchema>;

/** Tercero que puede ser destinatario (design D7): activo, 04, 05 o 06, con cualquier rol. */
export const shippingRecipientPartyViewSchema = z.strictObject({
  id: z.string(),
  identificationType: z.string(),
  identification: z.string(),
  legalName: z.string(),
  address: z.string().nullable(),
});
export type ShippingRecipientPartyView = z.infer<typeof shippingRecipientPartyViewSchema>;

/** Factura autorizada de la empresa en su ambiente vigente, para elegirla como sustento. */
export const shippingEligibleInvoiceViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  issueDate: isoDate,
  buyerIdentification: z.string(),
  buyerName: z.string(),
  total: invoiceAmountSchema,
});
export type ShippingEligibleInvoiceView = z.infer<typeof shippingEligibleInvoiceViewSchema>;

/**
 * Líneas de una factura como sugerencia no autoritativa (design D9): `PRODUCT` cuando el producto de
 * la línea es hoy un bien activo; `FREE_LINE` cuando ya no se resuelve así. El tipo vigente del
 * producto no describe la línea facturada ni decide la elegibilidad.
 */
export const SHIPPING_GOODS_SUGGESTIONS = ["PRODUCT", "FREE_LINE"] as const;
export const shippingInvoiceGoodsViewSchema = z.strictObject({
  invoiceId: z.string(),
  documentNumber: z.string(),
  lines: z.array(
    z.strictObject({
      position: z.number().int(),
      suggestion: z.enum(SHIPPING_GOODS_SUGGESTIONS),
      /** Solo en `PRODUCT`: el producto que se propone. */
      productId: z.string().nullable(),
      mainCode: z.string().nullable(),
      auxiliaryCode: z.string().nullable(),
      description: z.string(),
      quantity,
    }),
  ),
});
export type ShippingInvoiceGoodsView = z.infer<typeof shippingInvoiceGoodsViewSchema>;

/** Opciones del borrador (design D22). */
export const shippingGuideOptionsViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  /** Límites efectivos de recursos: defensas del sistema, no límites del SRI (design D23). */
  limits: z.strictObject({
    recipients: z.number().int(),
    detailsPerRecipient: z.number().int(),
    details: z.number().int(),
  }),
  exceptionPolicy: z.strictObject({
    version: z.number().int(),
    source: z.string(),
    cases: z.array(
      z.strictObject({
        case: shippingExceptionCaseSchema,
        literal: z.string(),
        label: z.string(),
        statement: z.string(),
        recipientKind: shippingRecipientKindSchema,
      }),
    ),
  }),
  /** Establecimientos propios activos: origen y destino de un traslado propio. */
  establishments: z.array(establishmentRefSchema),
  /** Identidad tributaria del transporte propio, o null si la empresa no está configurada. */
  issuerIdentity: z.strictObject({ ruc: z.string(), legalName: z.string() }).nullable(),
});
export type ShippingGuideOptionsView = z.infer<typeof shippingGuideOptionsViewSchema>;

const previewSupportSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("INTERNAL_INVOICE"),
    invoice: z
      .strictObject({
        id: z.string(),
        documentNumber: z.string(),
        issueDate: isoDate,
        authorizationNumber: z.string().nullable(),
      })
      .nullable(),
  }),
  z.strictObject({
    kind: z.literal("DECLARED_EXCEPTION"),
    case: shippingExceptionCaseSchema,
    label: z.string(),
  }),
]);

/** Vista previa del servidor (design D12); no reserva nada. */
export const shippingGuidePreviewViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  /** La partida tal como irá al XML: la del origen elegido o el texto, o null si falta. */
  departureAddress: z.string().nullable(),
  carrier: z
    .strictObject({ source: transporterSourceSchema, ...partyIdentitySchema.shape })
    .nullable(),
  recipients: z.array(
    z.strictObject({
      position: z.number().int(),
      identification: z.string().nullable(),
      legalName: z.string().nullable(),
      address: z.string().nullable(),
      destinationEstablishmentCode: z.string().nullable(),
      support: previewSupportSchema.nullable(),
      details: z.array(
        z.strictObject({
          position: z.number().int(),
          mainCode: z.string().nullable(),
          auxiliaryCode: z.string().nullable(),
          description: z.string().nullable(),
          quantity: quantity.nullable(),
        }),
      ),
    }),
  ),
  counts: z.strictObject({ recipients: z.number().int(), details: z.number().int() }),
  /** La emisión pide confirmar la declaración: hay al menos una excepción declarada. */
  exceptionDeclarationRequired: z.boolean(),
  issues: z.array(shippingGuideIssueSchema),
});
export type ShippingGuidePreviewView = z.infer<typeof shippingGuidePreviewViewSchema>;

const emissionPointViewSchema = z.strictObject({
  id: z.string(),
  establishmentCode: z.string(),
  code: z.string(),
  available: z.boolean(),
});

const draftRecipientViewSchema = z.strictObject({
  recipient: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("PARTY"),
        partyId: z.string(),
        party: shippingRecipientPartyViewSchema.nullable(),
      }),
      z.strictObject({
        kind: z.literal("OWN_COMPANY"),
        destinationEstablishmentId: z.string(),
        establishment: establishmentRefSchema.nullable(),
      }),
    ])
    .nullable(),
  address: z.string().nullable(),
  motive: z.string().nullable(),
  route: z.string().nullable(),
  destinationEstablishmentCode: z.string().nullable(),
  support: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("INTERNAL_INVOICE"),
        invoiceId: z.string(),
        documentNumber: z.string().nullable(),
      }),
      z.strictObject({ kind: z.literal("DECLARED_EXCEPTION"), case: shippingExceptionCaseSchema }),
    ])
    .nullable(),
  details: z.array(
    z.strictObject({
      productId: z.string().nullable(),
      productName: z.string().nullable(),
      mainCode: z.string().nullable(),
      auxiliaryCode: z.string().nullable(),
      description: z.string().nullable(),
      quantity: quantity.nullable(),
    }),
  ),
});

export const shippingGuideDraftViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  emissionPoint: emissionPointViewSchema.nullable(),
  originEstablishment: establishmentRefSchema.nullable(),
  departureAddress: z.string().nullable(),
  transporter: z
    .discriminatedUnion("source", [
      z.strictObject({ source: z.literal("SELF") }),
      z.strictObject({
        source: z.literal("PARTY"),
        partyId: z.string(),
        party: shippingCarrierViewSchema.nullable(),
      }),
    ])
    .nullable(),
  plate: z.string().nullable(),
  transportStart: isoDate.nullable(),
  transportEnd: isoDate.nullable(),
  recipients: z.array(draftRecipientViewSchema),
  preview: shippingGuidePreviewViewSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
});
export type ShippingGuideDraftView = z.infer<typeof shippingGuideDraftViewSchema>;

export const shippingGuideDraftSummaryViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  carrierName: z.string().nullable(),
  recipientCount: z.number().int(),
  detailCount: z.number().int(),
  transportStart: isoDate.nullable(),
  updatedAt: z.iso.datetime(),
});
export type ShippingGuideDraftSummaryView = z.infer<typeof shippingGuideDraftSummaryViewSchema>;

/** Declaración de una excepción tal como la congela la guía (design D14): del usuario, no verificada. */
export const shippingExceptionDeclarationViewSchema = z.strictObject({
  case: shippingExceptionCaseSchema,
  literal: z.string(),
  label: z.string(),
  policyVersion: z.number().int(),
  basis: z.literal("USER_DECLARED"),
  declaredBy: z.string(),
  declaredByName: z.string().nullable(),
  declaredAt: z.iso.datetime(),
});

/** Guía de remisión desde su snapshot: lo que se emitió, sin releer terceros, facturas ni productos. */
export const shippingGuideViewSchema = z.strictObject({
  id: z.string(),
  documentType: documentTypeSchema,
  environment: environmentSchema,
  documentNumber: z.string(),
  accessKey: z.string(),
  issueDate: isoDate,
  state: invoiceStateSchema,
  issuer: z.strictObject({
    ruc: z.string(),
    legalName: z.string(),
    tradeName: z.string().nullable(),
    headOfficeAddress: z.string(),
    establishmentAddress: z.string(),
    accountingRequired: z.boolean(),
    specialTaxpayerNumber: z.string().nullable(),
    withholdingAgentResolution: z.string().nullable(),
    rimpeCategory: rimpeCategorySchema.nullable(),
  }),
  departure: z.strictObject({
    source: z.enum(["ESTABLISHMENT", "FREE_TEXT"]),
    establishment: establishmentRefSchema.nullable(),
    address: z.string(),
  }),
  transporter: z.strictObject({
    source: transporterSourceSchema,
    partyId: z.string().nullable(),
    ...partyIdentitySchema.shape,
  }),
  plate: z.string(),
  transportStart: isoDate,
  transportEnd: isoDate,
  recipients: z.array(
    z.strictObject({
      position: z.number().int(),
      kind: shippingRecipientKindSchema,
      partyId: z.string().nullable(),
      destinationEstablishment: establishmentRefSchema.nullable(),
      identificationType: z.string(),
      identification: z.string(),
      legalName: z.string(),
      address: z.string(),
      motive: z.string(),
      route: z.string().nullable(),
      destinationEstablishmentCode: z.string().nullable(),
      support: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("INTERNAL_INVOICE"),
          invoice: z.strictObject({
            id: z.string(),
            documentType: z.literal("01"),
            documentNumber: z.string(),
            issueDate: isoDate,
            authorizationNumber: z.string(),
          }),
        }),
        z.strictObject({
          kind: z.literal("DECLARED_EXCEPTION"),
          declaration: shippingExceptionDeclarationViewSchema,
        }),
      ]),
      details: z.array(
        z.strictObject({
          position: z.number().int(),
          productId: z.string().nullable(),
          mainCode: z.string().nullable(),
          auxiliaryCode: z.string().nullable(),
          description: z.string(),
          quantity,
        }),
      ),
    }),
  ),
  counts: z.strictObject({ recipients: z.number().int(), details: z.number().int() }),
  diagnostic: signingDiagnosticViewSchema.nullable(),
  artifact: z.strictObject({ sha256: z.string(), sizeBytes: z.number().int() }).nullable(),
  authorizedArtifact: z
    .strictObject({ sha256: z.string(), sizeBytes: z.number().int() })
    .nullable(),
  transmission: invoiceTransmissionSummarySchema,
  createdAt: z.iso.datetime(),
  signedAt: z.iso.datetime().nullable(),
});
export type ShippingGuideView = z.infer<typeof shippingGuideViewSchema>;

export const shippingGuideSummaryViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  environment: environmentSchema,
  issueDate: isoDate,
  carrierName: z.string(),
  /** El nombre del único destinatario, o null si son varios (design D21). */
  recipients: z.strictObject({ count: z.number().int().min(1), name: z.string().nullable() }),
  transportStart: isoDate,
  transportEnd: isoDate,
  state: invoiceStateSchema,
  diagnosticCode: z
    .enum(SIGNING_ATTEMPT_CODE_LIST as [SigningAttemptCode, ...SigningAttemptCode[]])
    .nullable(),
  transmissionStopped: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type ShippingGuideSummaryView = z.infer<typeof shippingGuideSummaryViewSchema>;

/** Historial de la transmisión de una guía: las 100 entradas más recientes y el total. */
export const SHIPPING_GUIDE_TRANSMISSION_HISTORY_LIMIT = 100;
export const shippingGuideTransmissionViewSchema = z.strictObject({
  shippingGuideId: z.string(),
  state: invoiceStateSchema,
  events: z.array(transmissionEventViewSchema),
  total: z.number().int().nonnegative(),
});
export type ShippingGuideTransmissionView = z.infer<typeof shippingGuideTransmissionViewSchema>;

export const shippingGuideListMetaSchema = listMetaSchema;
