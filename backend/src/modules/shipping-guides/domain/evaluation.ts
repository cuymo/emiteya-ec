// Evaluación de una guía de remisión antes de reservar (add-shipping-guides, design D3 a D9, D12 y
// D23): una función pura de los datos ya leídos. Devuelve todos los problemas en el orden de D12
// (transportista, placa, fechas, partida con su origen, límites de recursos y, por destinatario, el
// destinatario, el sustento y el detalle), con el campo de la guía o la posición del destinatario y
// del detalle. La vista previa muestra todos; la emisión rechaza con el primero. No lee base de
// datos ni reloj, y no compara el establecimiento del punto con el origen ni con el destino.
import {
  CARRIER_IDENTIFICATION_MAX,
  CARRIER_IDENTIFICATION_SOURCE,
  DECIMAL_SPECS,
  PLATE_MAX,
  SHIPPING_EXCEPTION_POLICY,
  canonicalDecimal,
  compareDecimalStrings,
  decimalSpecViolation,
  type ShippingExceptionCase,
  type ShippingGuideErrorCode,
  type ShippingGuideIssue,
  type ShippingGuideLimits,
} from "@facturador/contracts";
import type { DraftRecipient, ShippingGuideDraftContent } from "./draft.ts";

/** Un tercero leído por `(company_id, id)`: transportista o destinatario. */
export type GuideParty = Readonly<{
  id: string;
  status: string;
  identificationType: string;
  identification: string;
  legalName: string;
  address: string | null;
  roles: readonly string[];
  consumerFinal: boolean;
}>;

/** Un establecimiento propio leído por `(company_id, id)`. */
export type GuideEstablishment = Readonly<{
  id: string;
  code: string;
  address: string;
  active: boolean;
}>;

/** Un producto leído por `(company_id, id)`. */
export type GuideProduct = Readonly<{
  id: string;
  status: string;
  kind: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  name: string;
}>;

/** La factura sustento tal como la lee la guía: su documento inmutable con su integridad. */
export type GuideInvoice = Readonly<{
  id: string;
  documentType: string;
  documentNumber: string;
  issueDate: string;
  accessKey: string;
  environment: "TEST" | "PRODUCTION";
  state: string;
  authorization: Readonly<{ number: string; date: Date; environment: string }> | null;
  intact: boolean;
}>;

export type ShippingGuideEvaluationInput = Readonly<{
  /** Fecha de emisión: la de hoy en la vista previa y la de la reserva al emitir (design D5). */
  issueDate: string;
  /** Ambiente en que se emite la guía; la factura sustento debe ser del mismo (P1). */
  environment: "TEST" | "PRODUCTION";
  draft: Omit<ShippingGuideDraftContent, "emissionPointId">;
  /** Identidad tributaria de la empresa: el transporte propio y la propia empresa como destinataria. */
  company: Readonly<{ ruc: string; legalName: string }> | null;
  /** Lecturas por identificador; un identificador ausente es un recurso que no existe en la empresa. */
  parties: ReadonlyMap<string, GuideParty>;
  establishments: ReadonlyMap<string, GuideEstablishment>;
  products: ReadonlyMap<string, GuideProduct>;
  invoices: ReadonlyMap<string, GuideInvoice>;
  /** Límites efectivos de recursos (design D23): defensas del sistema. */
  limits: ShippingGuideLimits;
  /** Problemas de la preparación de la empresa, del punto, de la firma y del esquema. */
  readiness?: readonly ShippingGuideIssue[];
}>;

export type ResolvedCarrier = Readonly<{
  source: "SELF" | "PARTY";
  partyId: string | null;
  identificationType: string;
  identification: string;
  legalName: string;
}>;

export type ResolvedDeparture =
  | Readonly<{
      source: "ESTABLISHMENT";
      establishment: Readonly<{ id: string; code: string; address: string }>;
      address: string;
    }>
  | Readonly<{ source: "FREE_TEXT"; establishment: null; address: string }>;

export type ResolvedSupport =
  | Readonly<{ kind: "INTERNAL_INVOICE"; invoice: GuideInvoice }>
  | Readonly<{ kind: "DECLARED_EXCEPTION"; case: ShippingExceptionCase }>;

export type ResolvedDetail = Readonly<{
  position: number;
  productId: string | null;
  productName: string | null;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  /** Cantidad en su forma canónica, mayor que cero. */
  quantity: string;
}>;

export type ResolvedRecipient = Readonly<{
  position: number;
  kind: "PARTY" | "OWN_COMPANY";
  partyId: string | null;
  destination: Readonly<{ id: string; code: string; address: string }> | null;
  /** Informativo: el XML no lleva el tipo de identificación del destinatario. */
  identificationType: string;
  identification: string;
  legalName: string;
  address: string;
  motive: string;
  route: string | null;
  destinationEstablishmentCode: string | null;
  support: ResolvedSupport;
  details: readonly ResolvedDetail[];
}>;

export type ResolvedShippingGuide = Readonly<{
  departure: ResolvedDeparture;
  carrier: ResolvedCarrier;
  plate: string;
  transportStart: string;
  transportEnd: string;
  recipients: readonly ResolvedRecipient[];
  counts: Readonly<{ recipients: number; details: number }>;
}>;

/** Lo que la vista previa puede mostrar de un destinatario aunque tenga problemas. */
export type PartialRecipient = Readonly<{
  position: number;
  identification: string | null;
  legalName: string | null;
  address: string | null;
  destinationEstablishmentCode: string | null;
  support: ResolvedSupport | null;
  details: readonly Readonly<{
    position: number;
    mainCode: string | null;
    auxiliaryCode: string | null;
    description: string | null;
    quantity: string | null;
  }>[];
}>;

export type ShippingGuideEvaluation = Readonly<{
  issues: readonly ShippingGuideIssue[];
  departureAddress: string | null;
  carrier: ResolvedCarrier | null;
  recipients: readonly PartialRecipient[];
  counts: Readonly<{ recipients: number; details: number }>;
  /** Hay al menos una excepción declarada: la emisión pide confirmar la declaración (D14). */
  exceptionDeclarationRequired: boolean;
  /** La guía completa y válida; la emisión solo la usa si no hay ningún problema. */
  guide: ResolvedShippingGuide | null;
}>;

type Position = Partial<Pick<ShippingGuideIssue, "field" | "recipient" | "detail">>;

const issue = (
  code: ShippingGuideErrorCode,
  message: string,
  position: Position = {},
): ShippingGuideIssue => ({
  code,
  message,
  field: position.field ?? null,
  recipient: position.recipient ?? null,
  detail: position.detail ?? null,
});

/** RUC, cédula y pasaporte: los tipos de identificación de un tercero de la guía (design D3 y D7). */
export const GUIDE_IDENTIFICATION_TYPES: ReadonlySet<string> = new Set(["04", "05", "06"]);
const DEFENSE = "Es una defensa de recursos del sistema, no un límite del SRI.";

/** Texto recortado; vacío equivale a ausente. */
export const trimmed = (text: string | null): string | null => {
  const value = text?.trim() ?? "";
  return value === "" ? null : value;
};

/** `AAAA-MM-DD` que es una fecha real de los años que admite el XSD (2000 a 2099). */
export function isGuideDate(text: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** `dd/mm/aaaa` de una fecha `AAAA-MM-DD`, como la escribe el XML y la lee el usuario. */
export const displayDate = (date: string) =>
  `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

function carrierIssues(input: ShippingGuideEvaluationInput): {
  issues: ShippingGuideIssue[];
  carrier: ResolvedCarrier | null;
} {
  const { transporter } = input.draft;
  const field = "transporter";
  if (transporter === null) {
    return {
      issues: [
        issue(
          "SHIPPING_GUIDE_CARRIER_REQUIRED",
          "Elige el transporte: propio o de un tercero transportista.",
          { field },
        ),
      ],
      carrier: null,
    };
  }
  if (transporter.source === "SELF") {
    // Sin configuración tributaria, la preparación de la empresa ya lo informa.
    if (input.company === null) return { issues: [], carrier: null };
    return {
      issues: [],
      carrier: {
        source: "SELF",
        partyId: null,
        identificationType: "04",
        identification: input.company.ruc,
        legalName: input.company.legalName,
      },
    };
  }
  const party = input.parties.get(transporter.partyId);
  const fail = (code: ShippingGuideErrorCode, message: string) => ({
    issues: [issue(code, message, { field })],
    carrier: null,
  });
  if (!party)
    return fail("SHIPPING_GUIDE_CARRIER_NOT_FOUND", "El transportista no existe en tu empresa.");
  if (party.status !== "ACTIVE") {
    return fail(
      "SHIPPING_GUIDE_CARRIER_INACTIVE",
      `El transportista ${party.legalName} está inactivo: actívalo en Clientes y proveedores o elige otro.`,
    );
  }
  if (party.consumerFinal || party.identificationType === "07") {
    return fail(
      "SHIPPING_GUIDE_CARRIER_CONSUMER_FINAL",
      "El transportista debe estar identificado: el consumidor final no transporta mercadería.",
    );
  }
  if (!GUIDE_IDENTIFICATION_TYPES.has(party.identificationType)) {
    return fail(
      "SHIPPING_GUIDE_CARRIER_FOREIGN_OUT_OF_SCOPE",
      "Un transportista con identificación del exterior está fuera del alcance del sistema: debe tener RUC, cédula o pasaporte.",
    );
  }
  if (!party.roles.includes("CARRIER")) {
    return fail(
      "SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED",
      `${party.legalName} no tiene el rol de transportista: configúralo como transportista en Clientes y proveedores antes de elegirlo.`,
    );
  }
  if (party.identification.length > CARRIER_IDENTIFICATION_MAX) {
    return fail(
      "SHIPPING_GUIDE_CARRIER_IDENTIFICATION_TOO_LONG",
      `La identificación del transportista tiene ${party.identification.length} caracteres, y la guía admite como máximo ${CARRIER_IDENTIFICATION_MAX} (${CARRIER_IDENTIFICATION_SOURCE}).`,
    );
  }
  return {
    issues: [],
    carrier: {
      source: "PARTY",
      partyId: party.id,
      identificationType: party.identificationType,
      identification: party.identification,
      legalName: party.legalName,
    },
  };
}

function plateIssues(plate: string | null): { issues: ShippingGuideIssue[]; plate: string | null } {
  const value = trimmed(plate);
  if (value === null) {
    return {
      issues: [
        issue("SHIPPING_GUIDE_PLATE_INVALID", "Escribe la placa del vehículo.", { field: "plate" }),
      ],
      plate: null,
    };
  }
  if (value.length > PLATE_MAX || /[\r\n]/.test(value)) {
    return {
      issues: [
        issue(
          "SHIPPING_GUIDE_PLATE_INVALID",
          `La placa tiene de 1 a ${PLATE_MAX} caracteres, sin saltos de línea.`,
          { field: "plate" },
        ),
      ],
      plate: null,
    };
  }
  return { issues: [], plate: value };
}

function dateIssues(input: ShippingGuideEvaluationInput): {
  issues: ShippingGuideIssue[];
  start: string | null;
  end: string | null;
} {
  const { transportStart, transportEnd } = input.draft;
  const issues: ShippingGuideIssue[] = [];
  let start: string | null = null;
  let end: string | null = null;
  if (transportStart === null) {
    issues.push(
      issue("SHIPPING_GUIDE_DRAFT_INCOMPLETE", "Indica la fecha de inicio del transporte.", {
        field: "transportStart",
      }),
    );
  } else if (!isGuideDate(transportStart)) {
    issues.push(
      issue("SHIPPING_GUIDE_DATE_INVALID", "La fecha de inicio del transporte no es válida.", {
        field: "transportStart",
      }),
    );
  } else if (transportStart < input.issueDate) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_START_BEFORE_ISSUE",
        `La fecha de inicio del transporte (${displayDate(transportStart)}) no puede ser anterior a la fecha de emisión de la guía (${displayDate(input.issueDate)}): el SRI la rechaza con el error 82 (ficha técnica v2.34, página 38).`,
        { field: "transportStart" },
      ),
    );
  } else {
    start = transportStart;
  }
  if (transportEnd === null) {
    issues.push(
      issue("SHIPPING_GUIDE_DRAFT_INCOMPLETE", "Indica la fecha de fin del transporte.", {
        field: "transportEnd",
      }),
    );
  } else if (!isGuideDate(transportEnd)) {
    issues.push(
      issue("SHIPPING_GUIDE_DATE_INVALID", "La fecha de fin del transporte no es válida.", {
        field: "transportEnd",
      }),
    );
  } else if (
    transportStart !== null &&
    isGuideDate(transportStart) &&
    transportEnd < transportStart
  ) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_END_BEFORE_START",
        "La fecha de fin del transporte no puede ser anterior a la de inicio (validación del sistema, no del SRI).",
        { field: "transportEnd" },
      ),
    );
  } else {
    end = transportEnd;
  }
  return { issues, start: start && end ? start : null, end: start && end ? end : null };
}

const ownTransfer = (recipient: DraftRecipient) =>
  recipient.recipient?.kind === "OWN_COMPANY" ||
  (recipient.support?.kind === "DECLARED_EXCEPTION" &&
    recipient.support.case === "OWN_ESTABLISHMENT_TRANSFER");

function departureIssues(input: ShippingGuideEvaluationInput): {
  issues: ShippingGuideIssue[];
  departure: ResolvedDeparture | null;
} {
  const { originEstablishmentId, departureAddress, recipients } = input.draft;
  const field = "originEstablishmentId";
  if (originEstablishmentId !== null) {
    const origin = input.establishments.get(originEstablishmentId);
    if (!origin) {
      return {
        issues: [
          issue(
            "SHIPPING_GUIDE_ESTABLISHMENT_NOT_FOUND",
            "El establecimiento de origen no existe en tu empresa.",
            { field },
          ),
        ],
        departure: null,
      };
    }
    if (!origin.active) {
      return {
        issues: [
          issue(
            "SHIPPING_GUIDE_ESTABLISHMENT_INACTIVE",
            `El establecimiento de origen ${origin.code} está inactivo.`,
            { field },
          ),
        ],
        departure: null,
      };
    }
    return {
      issues: [],
      departure: {
        source: "ESTABLISHMENT",
        establishment: { id: origin.id, code: origin.code, address: origin.address },
        address: origin.address,
      },
    };
  }
  const issues: ShippingGuideIssue[] = [];
  // Una dirección libre no prueba un traslado entre establecimientos del mismo contribuyente (D6).
  if (recipients.some(ownTransfer)) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_ORIGIN_ESTABLISHMENT_REQUIRED",
        "Un traslado entre establecimientos propios sale de un establecimiento registrado: elige el establecimiento de origen.",
        { field },
      ),
    );
  }
  const address = trimmed(departureAddress);
  if (address === null) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_DEPARTURE_ADDRESS_INVALID",
        "Escribe la dirección de partida o elige el establecimiento de origen.",
        { field: "departureAddress" },
      ),
    );
    return { issues, departure: null };
  }
  return {
    issues,
    departure: issues.length === 0 ? { source: "FREE_TEXT", establishment: null, address } : null,
  };
}

function limitIssues(input: ShippingGuideEvaluationInput): ShippingGuideIssue[] {
  const { draft, limits } = input;
  const issues: ShippingGuideIssue[] = [];
  if (draft.recipients.length > limits.recipients) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_RESOURCE_LIMIT",
        `El sistema admite como máximo ${limits.recipients} destinatarios por guía. ${DEFENSE}`,
        { field: "recipients" },
      ),
    );
  }
  draft.recipients.forEach((recipient, index) => {
    if (recipient.details.length > limits.detailsPerRecipient) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_RESOURCE_LIMIT",
          `El sistema admite como máximo ${limits.detailsPerRecipient} detalles por destinatario. ${DEFENSE}`,
          { recipient: index + 1 },
        ),
      );
    }
  });
  // Los tres límites se componen: el global rige aunque los individuales permitan más (P9).
  const details = draft.recipients.reduce((sum, recipient) => sum + recipient.details.length, 0);
  if (details > limits.details) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_RESOURCE_LIMIT",
        `El sistema admite como máximo ${limits.details} detalles por guía. ${DEFENSE}`,
        { field: "recipients" },
      ),
    );
  }
  return issues;
}

type RecipientResult = {
  issues: ShippingGuideIssue[];
  partial: PartialRecipient;
  resolved: ResolvedRecipient | null;
};

function recipientIssues(
  draft: DraftRecipient,
  position: number,
  input: ShippingGuideEvaluationInput,
): RecipientResult {
  const issues: ShippingGuideIssue[] = [];
  const at = { recipient: position };
  let kind: "PARTY" | "OWN_COMPANY" | null = null;
  let identity: {
    partyId: string | null;
    type: string;
    identification: string;
    name: string;
  } | null = null;
  let destination: { id: string; code: string; address: string } | null = null;
  let address = trimmed(draft.address);
  let code = draft.destinationEstablishmentCode;

  // El destinatario: un tercero identificado o la propia empresa con su establecimiento de destino.
  const ref = draft.recipient;
  if (ref === null) {
    issues.push(issue("SHIPPING_GUIDE_DRAFT_INCOMPLETE", "Elige el destinatario.", at));
  } else if (ref.kind === "PARTY") {
    kind = "PARTY";
    const party = input.parties.get(ref.partyId);
    if (!party) {
      issues.push(
        issue("SHIPPING_GUIDE_RECIPIENT_NOT_FOUND", "El destinatario no existe en tu empresa.", at),
      );
    } else if (party.status !== "ACTIVE") {
      issues.push(
        issue(
          "SHIPPING_GUIDE_RECIPIENT_INACTIVE",
          `El destinatario ${party.legalName} está inactivo: actívalo en Clientes y proveedores o elige otro.`,
          at,
        ),
      );
    } else if (party.consumerFinal || party.identificationType === "07") {
      issues.push(
        issue(
          "SHIPPING_GUIDE_RECIPIENT_CONSUMER_FINAL",
          "El destinatario de la mercadería debe estar identificado: el consumidor final no es destinatario de una guía (Reglamento de Comprobantes de Venta, art. 30).",
          at,
        ),
      );
    } else if (!GUIDE_IDENTIFICATION_TYPES.has(party.identificationType)) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_RECIPIENT_FOREIGN_OUT_OF_SCOPE",
          "Un destinatario con identificación del exterior está fuera del alcance del sistema: debe tener RUC, cédula o pasaporte.",
          at,
        ),
      );
    } else {
      identity = {
        partyId: party.id,
        type: party.identificationType,
        identification: party.identification,
        name: party.legalName,
      };
    }
    if (address === null) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_ADDRESS_REQUIRED",
          "Escribe la dirección de destino del destinatario.",
          at,
        ),
      );
    }
  } else {
    kind = "OWN_COMPANY";
    const establishment = input.establishments.get(ref.destinationEstablishmentId);
    const originId = input.draft.originEstablishmentId;
    if (!establishment) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_ESTABLISHMENT_NOT_FOUND",
          "El establecimiento de destino no existe en tu empresa.",
          at,
        ),
      );
    } else if (!establishment.active) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_ESTABLISHMENT_INACTIVE",
          `El establecimiento de destino ${establishment.code} está inactivo.`,
          at,
        ),
      );
    } else if (originId !== null && originId === establishment.id) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_SAME_ESTABLISHMENT",
          "El traslado es entre establecimientos distintos: el destino no puede ser el establecimiento de origen.",
          at,
        ),
      );
    } else {
      destination = {
        id: establishment.id,
        code: establishment.code,
        address: establishment.address,
      };
      address = establishment.address;
      code = establishment.code;
    }
    if (input.company) {
      identity = {
        partyId: null,
        type: "04",
        identification: input.company.ruc,
        name: input.company.legalName,
      };
    }
  }

  const motive = trimmed(draft.motive);
  if (motive === null) {
    issues.push(issue("SHIPPING_GUIDE_MOTIVE_REQUIRED", "Escribe el motivo del traslado.", at));
  }

  // El sustento tipado: la factura propia autorizada o la excepción declarada que admite el MVP.
  let support: ResolvedSupport | null = null;
  const source = draft.support;
  if (source === null) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_SUPPORT_REQUIRED",
        "Indica el sustento: una factura autorizada o una excepción declarada.",
        at,
      ),
    );
  } else if (source.kind === "INTERNAL_INVOICE") {
    const invoice = input.invoices.get(source.invoiceId);
    if (kind === "OWN_COMPANY") {
      issues.push(
        issue(
          "SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH",
          "La propia empresa solo recibe un traslado entre establecimientos propios, sin factura.",
          at,
        ),
      );
    } else if (!invoice || invoice.documentType !== "01") {
      issues.push(
        issue(
          "SHIPPING_GUIDE_INVOICE_NOT_FOUND",
          "La factura sustento no existe en tu empresa.",
          at,
        ),
      );
    } else if (invoice.state !== "AUTHORIZED" || invoice.authorization === null) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED",
          `La factura ${invoice.documentNumber} todavía no está autorizada por el SRI: solo una factura autorizada sustenta una guía.`,
          at,
        ),
      );
    } else if (invoice.environment !== input.environment) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_INVOICE_ENVIRONMENT_MISMATCH",
          `La factura ${invoice.documentNumber} es de otro ambiente: la guía y su factura son del mismo.`,
          at,
        ),
      );
    } else if (!invoice.intact) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_INVOICE_NOT_INTACT",
          `La factura ${invoice.documentNumber} no pasó la verificación de integridad de su snapshot o de sus artefactos.`,
          at,
        ),
      );
    } else {
      support = { kind: "INTERNAL_INVOICE", invoice };
    }
  } else {
    const policy = SHIPPING_EXCEPTION_POLICY[source.case];
    if (kind !== null && policy.recipientKind !== kind) {
      issues.push(
        issue(
          "SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH",
          policy.recipientKind === "OWN_COMPANY"
            ? "El traslado entre establecimientos propios es solo para la propia empresa como destinataria."
            : `La excepción "${policy.label}" es para un destinatario tercero, no para la propia empresa.`,
          at,
        ),
      );
    } else {
      support = { kind: "DECLARED_EXCEPTION", case: source.case };
    }
  }

  // El detalle: producto activo de tipo bien o línea libre, descripción y cantidad mayor que cero.
  if (draft.details.length === 0) {
    issues.push(
      issue(
        "SHIPPING_GUIDE_DETAILS_REQUIRED",
        "Agrega lo que se traslada a este destinatario.",
        at,
      ),
    );
  }
  const details: ResolvedDetail[] = [];
  const partialDetails: PartialRecipient["details"][number][] = [];
  draft.details.forEach((detail, index) => {
    const position = index + 1;
    const where = { recipient: at.recipient, detail: position };
    let ok = true;
    let mainCode = trimmed(detail.mainCode);
    let auxiliaryCode = trimmed(detail.auxiliaryCode);
    let productName: string | null = null;
    if (detail.productId !== null) {
      const product = input.products.get(detail.productId);
      if (!product) {
        ok = false;
        issues.push(
          issue("SHIPPING_GUIDE_PRODUCT_NOT_FOUND", "El producto no existe en tu empresa.", where),
        );
      } else if (product.status !== "ACTIVE") {
        ok = false;
        issues.push(
          issue(
            "SHIPPING_GUIDE_PRODUCT_INACTIVE",
            `El producto ${product.name} está inactivo.`,
            where,
          ),
        );
      } else if (product.kind !== "GOOD") {
        ok = false;
        issues.push(
          issue(
            "SHIPPING_GUIDE_PRODUCT_NOT_GOOD",
            `${product.name} es un servicio: una guía traslada bienes. Escríbelo como línea libre si se traslada algo.`,
            where,
          ),
        );
      } else {
        mainCode = product.mainCode;
        auxiliaryCode = product.auxiliaryCode;
        productName = product.name;
      }
    }
    for (const value of [mainCode, auxiliaryCode]) {
      if (value !== null && (value.length > 25 || /[\r\n]/.test(value))) {
        ok = false;
        issues.push(
          issue(
            "SHIPPING_GUIDE_CODE_INVALID",
            "Un código tiene de 1 a 25 caracteres, sin saltos de línea.",
            where,
          ),
        );
      }
    }
    const description = trimmed(detail.description);
    if (description === null || description.length > 300) {
      ok = false;
      issues.push(
        issue(
          "SHIPPING_GUIDE_DESCRIPTION_INVALID",
          "Describe lo que se traslada, con su unidad y sus características (hasta 300 caracteres).",
          where,
        ),
      );
    }
    let quantity: string | null = null;
    if (
      detail.quantity === null ||
      decimalSpecViolation(detail.quantity, DECIMAL_SPECS.cantidad) !== null ||
      compareDecimalStrings(detail.quantity, "0") <= 0
    ) {
      ok = false;
      issues.push(
        issue(
          "SHIPPING_GUIDE_QUANTITY_INVALID",
          "Indica la cantidad: un número mayor que cero, de hasta 6 decimales. El cero no se admite por política del sistema, aunque el XSD lo permita.",
          where,
        ),
      );
    } else {
      quantity = canonicalDecimal(detail.quantity);
    }
    partialDetails.push({ position, mainCode, auxiliaryCode, description, quantity });
    if (ok && description !== null && quantity !== null) {
      details.push({
        position,
        productId: detail.productId,
        productName,
        mainCode,
        auxiliaryCode,
        description,
        quantity,
      });
    }
  });

  const partial: PartialRecipient = {
    position,
    identification: identity?.identification ?? null,
    legalName: identity?.name ?? null,
    address,
    destinationEstablishmentCode: code,
    support,
    details: partialDetails,
  };
  if (
    issues.length > 0 ||
    kind === null ||
    identity === null ||
    address === null ||
    motive === null ||
    support === null ||
    details.length === 0 ||
    details.length !== draft.details.length
  ) {
    return { issues, partial, resolved: null };
  }
  return {
    issues,
    partial,
    resolved: {
      position,
      kind,
      partyId: identity.partyId,
      destination,
      identificationType: identity.type,
      identification: identity.identification,
      legalName: identity.name,
      address,
      motive,
      route: trimmed(draft.route),
      destinationEstablishmentCode: code,
      support,
      details,
    },
  };
}

export function evaluateShippingGuide(
  input: ShippingGuideEvaluationInput,
): ShippingGuideEvaluation {
  const { draft } = input;
  const issues: ShippingGuideIssue[] = [];
  // Transportista, placa y fechas.
  const carrier = carrierIssues(input);
  issues.push(...carrier.issues);
  const plate = plateIssues(draft.plate);
  issues.push(...plate.issues);
  const dates = dateIssues(input);
  issues.push(...dates.issues);
  // Partida con su origen.
  const departure = departureIssues(input);
  issues.push(...departure.issues);
  // Límites de recursos.
  issues.push(...limitIssues(input));
  // Destinatarios con su sustento y su detalle.
  if (draft.recipients.length === 0) {
    issues.push(
      issue("SHIPPING_GUIDE_RECIPIENTS_REQUIRED", "Agrega al menos un destinatario.", {
        field: "recipients",
      }),
    );
  }
  const results = draft.recipients.map((recipient, index) =>
    recipientIssues(recipient, index + 1, input),
  );
  for (const result of results) issues.push(...result.issues);
  // La preparación de la empresa, del punto, de la firma y del esquema.
  issues.push(...(input.readiness ?? []));

  const resolved = results
    .map((result) => result.resolved)
    .filter((recipient): recipient is ResolvedRecipient => recipient !== null);
  const counts = {
    recipients: draft.recipients.length,
    details: draft.recipients.reduce((sum, recipient) => sum + recipient.details.length, 0),
  };
  let guide: ResolvedShippingGuide | null = null;
  if (
    issues.length === 0 &&
    carrier.carrier !== null &&
    plate.plate !== null &&
    dates.start !== null &&
    dates.end !== null &&
    departure.departure !== null &&
    resolved.length > 0 &&
    resolved.length === results.length
  ) {
    guide = {
      departure: departure.departure,
      carrier: carrier.carrier,
      plate: plate.plate,
      transportStart: dates.start,
      transportEnd: dates.end,
      recipients: resolved,
      counts,
    };
  }
  return {
    issues,
    departureAddress: departure.departure?.address ?? null,
    carrier: carrier.carrier,
    recipients: results.map((result) => result.partial),
    counts,
    exceptionDeclarationRequired: draft.recipients.some(
      (recipient) => recipient.support?.kind === "DECLARED_EXCEPTION",
    ),
    guide,
  };
}
