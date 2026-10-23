// Formulario del borrador de guía de remisión (add-shipping-guides, design D25): sus valores, la
// validación de lo que el usuario escribió y la conversión al contrato. El borrador se guarda
// incompleto: lo que falta lo informa la vista previa del servidor junto a su destinatario y su
// detalle. Los datos derivados (la partida de un origen, la dirección y el código de un
// establecimiento propio, los códigos de un producto) nunca se envían: los pone el servidor.
import {
  DESTINATION_CODE_PATTERN,
  PLATE_MAX,
  shippingQuantitySchema,
  type ShippingExceptionCase,
  type ShippingGuideDraftView,
  type UpdateShippingGuideDraftInput,
} from "@facturador/contracts";
import { z } from "zod";

export const DESCRIPTION_MAX = 300;
export const CODE_MAX = 25;

export type DetailValues = {
  /** Presentación: un producto del catálogo o una línea libre. */
  mode: "PRODUCT" | "FREE";
  productId: string;
  /** Presentación: el nombre y los códigos del producto elegido, de solo lectura. */
  productName: string;
  productMainCode: string;
  productAuxiliaryCode: string;
  /** Solo en una línea libre. */
  mainCode: string;
  auxiliaryCode: string;
  description: string;
  quantity: string;
};
export type RecipientValues = {
  kind: "PARTY" | "OWN_COMPANY" | "";
  partyId: string;
  /** Presentación: la razón social y la identificación del tercero elegido. */
  partyName: string;
  partyIdentification: string;
  destinationEstablishmentId: string;
  address: string;
  motive: string;
  route: string;
  destinationEstablishmentCode: string;
  supportKind: "INTERNAL_INVOICE" | "DECLARED_EXCEPTION" | "";
  invoiceId: string;
  /** Presentación: el número de la factura elegida. */
  invoiceNumber: string;
  exceptionCase: ShippingExceptionCase | "";
  details: DetailValues[];
};
export type FormValues = {
  emissionPointId: string;
  /** Sin selección inicial: el origen del transporte se elige. */
  transporterSource: "SELF" | "PARTY" | "";
  carrierId: string;
  carrierName: string;
  carrierIdentification: string;
  plate: string;
  transportStart: string;
  transportEnd: string;
  departureMode: "ESTABLISHMENT" | "FREE_TEXT";
  /** Sin valor por defecto: el establecimiento de origen se elige (design D6). */
  originEstablishmentId: string;
  departureAddress: string;
  recipients: RecipientValues[];
};

export const blankDetail = (): DetailValues => ({
  mode: "PRODUCT",
  productId: "",
  productName: "",
  productMainCode: "",
  productAuxiliaryCode: "",
  mainCode: "",
  auxiliaryCode: "",
  description: "",
  quantity: "",
});
export const blankRecipient = (): RecipientValues => ({
  kind: "",
  partyId: "",
  partyName: "",
  partyIdentification: "",
  destinationEstablishmentId: "",
  address: "",
  motive: "",
  route: "",
  destinationEstablishmentCode: "",
  // Un destinatario nuevo empieza con la factura como comprobante de venta (decisión del
  // propietario, 2026-10-22); sin factura elegida, el sustento no se envía.
  supportKind: "INTERNAL_INVOICE",
  invoiceId: "",
  invoiceNumber: "",
  exceptionCase: "",
  details: [blankDetail()],
});

const NO_LINE_BREAK = /^[^\r\n]*$/;

/** Solo se valida lo escrito; un campo vacío lo informa la vista previa del servidor. */
// Objetos abiertos: el resolver devuelve los valores validados, y los campos que no se validan
// (la clase, los identificadores elegidos, el modo del detalle) deben llegar intactos.
export const formSchema = z
  .looseObject({
    plate: z.string(),
    departureAddress: z.string(),
    recipients: z.array(
      z.looseObject({
        address: z.string(),
        motive: z.string(),
        route: z.string(),
        destinationEstablishmentCode: z.string(),
        details: z.array(
          z.looseObject({
            mainCode: z.string(),
            auxiliaryCode: z.string(),
            description: z.string(),
            quantity: z.string(),
          }),
        ),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    const text = (path: (string | number)[], value: string, max: number, label: string) => {
      if (value.length > max) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `${label} admite como máximo ${max} caracteres.`,
        });
      } else if (!NO_LINE_BREAK.test(value)) {
        ctx.addIssue({ code: "custom", path, message: `${label} no admite saltos de línea.` });
      }
    };
    text(["plate"], values.plate.trim(), PLATE_MAX, "La placa");
    text(["departureAddress"], values.departureAddress, 300, "La dirección de partida");
    values.recipients.forEach((recipient, r) => {
      const at = (...rest: (string | number)[]) => ["recipients", r, ...rest];
      text(at("address"), recipient.address, 300, "La dirección de destino");
      text(at("motive"), recipient.motive, 300, "El motivo");
      text(at("route"), recipient.route, 300, "La ruta");
      const code = recipient.destinationEstablishmentCode.trim();
      if (code !== "" && !DESTINATION_CODE_PATTERN.test(code)) {
        ctx.addIssue({
          code: "custom",
          path: at("destinationEstablishmentCode"),
          message: "El código del establecimiento de destino tiene 3 dígitos.",
        });
      }
      recipient.details.forEach((detail, d) => {
        text(at("details", d, "mainCode"), detail.mainCode, CODE_MAX, "El código principal");
        text(
          at("details", d, "auxiliaryCode"),
          detail.auxiliaryCode,
          CODE_MAX,
          "El código auxiliar",
        );
        text(
          at("details", d, "description"),
          detail.description,
          DESCRIPTION_MAX,
          "La descripción",
        );
        const quantity = detail.quantity.trim();
        const problem =
          quantity === ""
            ? null
            : (shippingQuantitySchema.safeParse(quantity).error?.issues[0]?.message ?? null);
        if (problem)
          ctx.addIssue({ code: "custom", path: at("details", d, "quantity"), message: problem });
      });
    });
  });

export const toForm = (draft: ShippingGuideDraftView): FormValues => ({
  emissionPointId: draft.emissionPoint?.id ?? "",
  transporterSource: draft.transporter?.source ?? "",
  carrierId: draft.transporter?.source === "PARTY" ? draft.transporter.partyId : "",
  carrierName:
    draft.transporter?.source === "PARTY" ? (draft.transporter.party?.legalName ?? "") : "",
  carrierIdentification:
    draft.transporter?.source === "PARTY" ? (draft.transporter.party?.identification ?? "") : "",
  plate: draft.plate ?? "",
  transportStart: draft.transportStart ?? "",
  transportEnd: draft.transportEnd ?? "",
  departureMode: draft.originEstablishment ? "ESTABLISHMENT" : "FREE_TEXT",
  originEstablishmentId: draft.originEstablishment?.id ?? "",
  departureAddress: draft.departureAddress ?? "",
  recipients:
    draft.recipients.length > 0
      ? draft.recipients.map((recipient) => ({
          kind: recipient.recipient?.kind ?? "",
          partyId: recipient.recipient?.kind === "PARTY" ? recipient.recipient.partyId : "",
          partyName:
            recipient.recipient?.kind === "PARTY"
              ? (recipient.recipient.party?.legalName ?? "")
              : "",
          partyIdentification:
            recipient.recipient?.kind === "PARTY"
              ? (recipient.recipient.party?.identification ?? "")
              : "",
          destinationEstablishmentId:
            recipient.recipient?.kind === "OWN_COMPANY"
              ? recipient.recipient.destinationEstablishmentId
              : "",
          address: recipient.address ?? "",
          motive: recipient.motive ?? "",
          route: recipient.route ?? "",
          destinationEstablishmentCode: recipient.destinationEstablishmentCode ?? "",
          // Sin sustento guardado, «Factura» queda elegida, como en un destinatario nuevo: sin
          // factura elegida no se envía, así que el borrador sigue igual al guardado.
          supportKind: recipient.support?.kind ?? "INTERNAL_INVOICE",
          invoiceId:
            recipient.support?.kind === "INTERNAL_INVOICE" ? recipient.support.invoiceId : "",
          invoiceNumber:
            recipient.support?.kind === "INTERNAL_INVOICE"
              ? (recipient.support.documentNumber ?? "")
              : "",
          exceptionCase:
            recipient.support?.kind === "DECLARED_EXCEPTION" ? recipient.support.case : "",
          details:
            recipient.details.length > 0
              ? recipient.details.map((detail) => ({
                  mode: detail.productId ? ("PRODUCT" as const) : ("FREE" as const),
                  productId: detail.productId ?? "",
                  productName: detail.productName ?? "",
                  productMainCode: detail.productId ? (detail.mainCode ?? "") : "",
                  productAuxiliaryCode: detail.productId ? (detail.auxiliaryCode ?? "") : "",
                  mainCode: detail.productId ? "" : (detail.mainCode ?? ""),
                  auxiliaryCode: detail.productId ? "" : (detail.auxiliaryCode ?? ""),
                  description: detail.description ?? "",
                  quantity: detail.quantity ?? "",
                }))
              : [blankDetail()],
        }))
      : [blankRecipient()],
});

const orNull = (text: string) => text.trim() || null;

export const toInput = (
  values: FormValues,
): Omit<UpdateShippingGuideDraftInput, "expectedVersion"> => {
  const fromOrigin = values.departureMode === "ESTABLISHMENT";
  return {
    emissionPointId: values.emissionPointId || null,
    originEstablishmentId: fromOrigin ? values.originEstablishmentId || null : null,
    // Con un origen, la partida sale de su dirección: no se envía.
    departureAddress: fromOrigin ? null : orNull(values.departureAddress),
    transporter:
      values.transporterSource === "SELF"
        ? { source: "SELF" }
        : values.transporterSource === "PARTY" && values.carrierId
          ? { source: "PARTY", partyId: values.carrierId }
          : null,
    plate: orNull(values.plate),
    transportStart: values.transportStart || null,
    transportEnd: values.transportEnd || null,
    recipients: values.recipients.map((recipient) => {
      const own = recipient.kind === "OWN_COMPANY";
      return {
        recipient:
          recipient.kind === "PARTY" && recipient.partyId
            ? { kind: "PARTY", partyId: recipient.partyId }
            : own && recipient.destinationEstablishmentId
              ? {
                  kind: "OWN_COMPANY",
                  destinationEstablishmentId: recipient.destinationEstablishmentId,
                }
              : null,
        // La dirección y el código de un establecimiento propio salen de él: no se envían.
        address: own ? null : orNull(recipient.address),
        motive: orNull(recipient.motive),
        route: orNull(recipient.route),
        destinationEstablishmentCode: own ? null : orNull(recipient.destinationEstablishmentCode),
        support: own
          ? { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" }
          : recipient.supportKind === "INTERNAL_INVOICE" && recipient.invoiceId
            ? { kind: "INTERNAL_INVOICE", invoiceId: recipient.invoiceId }
            : recipient.supportKind === "DECLARED_EXCEPTION" && recipient.exceptionCase
              ? { kind: "DECLARED_EXCEPTION", case: recipient.exceptionCase }
              : null,
        details: recipient.details.map((detail) => ({
          productId: detail.mode === "PRODUCT" ? detail.productId || null : null,
          // Los códigos de un producto salen del producto: no se envían.
          mainCode: detail.mode === "PRODUCT" ? null : orNull(detail.mainCode),
          auxiliaryCode: detail.mode === "PRODUCT" ? null : orNull(detail.auxiliaryCode),
          description: orNull(detail.description),
          quantity: orNull(detail.quantity),
        })),
      };
    }),
  };
};
