// Snapshot de la guía de remisión (add-shipping-guides, design D11): un JSON versionado y
// autosuficiente que se congela al reservar. Desde ese momento es la verdad fiscal de la guía: el
// XML, el RIDE y la consulta salen solo de él, sin releer terceros, establecimientos, productos,
// facturas ni la configuración.
import type { ShippingExceptionCase } from "@facturador/contracts";

export const SHIPPING_GUIDE_SNAPSHOT_VERSION = 1;

export type ShippingGuideSnapshotEstablishment = Readonly<{
  id: string;
  code: string;
  address: string;
}>;

/** Sustento de un destinatario: la factura con sus datos, o la declaración del usuario (D8, D14). */
export type ShippingGuideSnapshotSupport =
  | Readonly<{
      kind: "INTERNAL_INVOICE";
      invoice: Readonly<{
        id: string;
        documentType: "01";
        documentNumber: string;
        issueDate: string;
        accessKey: string;
        authorization: Readonly<{ number: string; date: string; environment: string }>;
      }>;
    }>
  | Readonly<{
      kind: "DECLARED_EXCEPTION";
      declaration: Readonly<{
        case: ShippingExceptionCase;
        literal: string;
        label: string;
        policyVersion: number;
        basis: "USER_DECLARED";
        declaredBy: string;
        declaredByName: string | null;
        declaredAt: string;
      }>;
    }>;

export type ShippingGuideSnapshotDetail = Readonly<{
  position: number;
  productId: string | null;
  /** Informativo, no va al XML: el nombre del producto al reservar. */
  productName: string | null;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  /** Forma canónica, mayor que cero. */
  quantity: string;
}>;

export type ShippingGuideSnapshotRecipient = Readonly<{
  position: number;
  kind: "PARTY" | "OWN_COMPANY";
  partyId: string | null;
  /** El establecimiento de destino de un traslado propio, con su identidad al reservar. */
  destination: ShippingGuideSnapshotEstablishment | null;
  /** Informativo: el XML no lleva el tipo de identificación del destinatario. */
  identificationType: string;
  identification: string;
  legalName: string;
  address: string;
  motive: string;
  route: string | null;
  destinationEstablishmentCode: string | null;
  support: ShippingGuideSnapshotSupport;
  details: readonly ShippingGuideSnapshotDetail[];
}>;

export type ShippingGuideSnapshot = Readonly<{
  snapshotVersion: typeof SHIPPING_GUIDE_SNAPSHOT_VERSION;
  schema: Readonly<{
    documentType: "06";
    version: string;
    path: string;
    sha256: string;
    imports: readonly Readonly<{ path: string; sha256: string }>[];
  }>;
  builderVersion: string;
  /** Última versión aplicada de cada catálogo usado al reservar. */
  catalogDatasets: Readonly<Record<string, number>>;
  /** Configuración tributaria vigente al reservar. */
  taxpayerConfig: Readonly<{ versionId: string; version: number }>;
  issueDate: string;
  environment: "TEST" | "PRODUCTION";
  environmentCode: "1" | "2";
  issuer: Readonly<{
    ruc: string;
    legalName: string;
    tradeName: string | null;
    headOfficeAddress: string;
    establishment: ShippingGuideSnapshotEstablishment;
    emissionPoint: Readonly<{ id: string; code: string }>;
    accountingRequired: boolean;
    specialTaxpayerNumber: string | null;
    withholdingAgentResolution: string | null;
    rimpeCategory: "EMPRENDEDOR" | "NEGOCIO_POPULAR" | null;
  }>;
  /** La partida: la del establecimiento de origen elegido, o el texto del usuario (design D6). */
  departure: Readonly<{
    source: "ESTABLISHMENT" | "FREE_TEXT";
    establishment: ShippingGuideSnapshotEstablishment | null;
    address: string;
  }>;
  /** El transportista con su origen, tal como estaba al reservar (design D3). */
  transporter: Readonly<{
    source: "SELF" | "PARTY";
    partyId: string | null;
    identificationType: string;
    identification: string;
    legalName: string;
  }>;
  plate: string;
  transportStart: string;
  transportEnd: string;
  recipients: readonly ShippingGuideSnapshotRecipient[];
  counts: Readonly<{ recipients: number; details: number }>;
  key: Readonly<{
    documentNumber: string;
    sequential: string;
    numericCode: string;
    emissionType: "1";
    accessKey: string;
  }>;
}>;

/** Snapshot completo salvo los datos de la reserva, que se añaden con `withShippingGuideKey`. */
export type ShippingGuideSnapshotDraft = Omit<ShippingGuideSnapshot, "key">;

export const withShippingGuideKey = (
  draft: ShippingGuideSnapshotDraft,
  key: ShippingGuideSnapshot["key"],
): ShippingGuideSnapshot => ({ ...draft, key });
