// Factura de origen de una nota de crédito (add-credit-notes, design D3): la lectura interna que usa
// `credit-notes`, sobre el cliente de su transacción. Devuelve solo lo inmutable del snapshot y de
// la autorización, y la integridad del snapshot y de sus artefactos fiscales comprobada con el
// almacén de `fiscal`: el SHA-256 y el tamaño del `SIGNED_XML` y, si existe, del `AUTHORIZED_XML`,
// la clave en el XML firmado y la forma del snapshot. Una diferencia se informa; nunca se repara con
// el producto, el tercero o el catálogo vigentes, que esta lectura no consulta.
import { createHash } from "node:crypto";
import { compareDecimalStrings, isDecimalString } from "@facturador/contracts";
import { sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import {
  createArtifactStore,
  createDocumentRepository,
  type StoredArtifact,
} from "../../fiscal/infrastructure/index.ts";
import { INVOICE_DOCUMENT_TYPE } from "../application/evaluation.ts";
import {
  lineAffectsInventory,
  type InvoiceSnapshot,
  type SnapshotLine,
  type SnapshotTax,
} from "../domain/snapshot.ts";
import { documentBuyer } from "../../fiscal/application/ports.ts";

export type InvoiceIntegrityProblem =
  | "SNAPSHOT_SHAPE"
  | "SNAPSHOT_KEY"
  | "SNAPSHOT_TOTALS"
  | "SIGNED_XML_MISSING"
  | "SIGNED_XML_ALTERED"
  | "AUTHORIZED_XML_ALTERED";

export type InvoiceCreditTax = Readonly<{
  taxCode: string;
  rateCode: string;
  catalogType: string;
  entryKey: string;
  versionId: string;
  officialLabel: string;
  percentage: string;
  base: string;
  amount: string;
}>;

export type InvoiceCreditLine = Readonly<{
  position: number;
  productId: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  subtotal: string;
  taxableBase: string;
  taxes: readonly InvoiceCreditTax[];
  inventoryAffectsStock: boolean;
}>;

export type InvoiceCreditSource = Readonly<{
  id: string;
  documentType: "01";
  documentNumber: string;
  issueDate: string;
  accessKey: string;
  environment: "TEST" | "PRODUCTION";
  state: string;
  authorization: Readonly<{ number: string; date: Date; environment: string }> | null;
  snapshotVersion: number;
  consumerFinal: boolean;
  buyer: Readonly<{
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
  }>;
  lines: readonly InvoiceCreditLine[];
  totals: InvoiceSnapshot["totals"];
  integrity: Readonly<{ intact: boolean; problems: readonly InvoiceIntegrityProblem[] }>;
}>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const isText = (value: unknown): value is string => typeof value === "string";
const isDecimal = (value: unknown): value is string => isText(value) && isDecimalString(value);

function wellFormedLine(line: SnapshotLine): boolean {
  return (
    Number.isInteger(line.position) &&
    isText(line.productId) &&
    isText(line.description) &&
    [line.quantity, line.unitPrice, line.discount, line.subtotal, line.taxableBase].every(
      isDecimal,
    ) &&
    Array.isArray(line.taxes) &&
    (line.taxes as readonly SnapshotTax[]).every(
      (tax) =>
        isText(tax.taxCode) &&
        isText(tax.rateCode) &&
        isDecimal(tax.percentage) &&
        isDecimal(tax.base) &&
        isDecimal(tax.amount),
    )
  );
}

/** Forma del snapshot de una factura de las versiones que el sistema escribe. */
function wellFormed(snapshot: InvoiceSnapshot): boolean {
  return (
    (snapshot.snapshotVersion === 1 || snapshot.snapshotVersion === 2) &&
    snapshot.schema?.documentType === INVOICE_DOCUMENT_TYPE &&
    typeof snapshot.buyer?.consumerFinal === "boolean" &&
    isText(snapshot.buyer.identification) &&
    isText(snapshot.buyer.legalName) &&
    Array.isArray(snapshot.lines) &&
    snapshot.lines.length > 0 &&
    snapshot.lines.every(wellFormedLine) &&
    Array.isArray(snapshot.totals?.taxes) &&
    [snapshot.totals.withoutTaxes, snapshot.totals.discount, snapshot.totals.total].every(isDecimal)
  );
}

/** Los totales son la suma de sus líneas: base, impuestos y total. */
function consistentTotals(snapshot: InvoiceSnapshot, documentTotal: string): boolean {
  const same = (a: string, b: string) => compareDecimalStrings(a, b) === 0;
  const lineTaxes = sumExact(snapshot.lines.flatMap((line) => line.taxes.map((tax) => tax.amount)));
  const totalTaxes = sumExact(snapshot.totals.taxes.map((tax) => tax.amount));
  return (
    same(sumExact(snapshot.lines.map((line) => line.taxableBase)), snapshot.totals.withoutTaxes) &&
    same(lineTaxes, totalTaxes) &&
    same(sumExact([snapshot.totals.withoutTaxes, totalTaxes]), snapshot.totals.total) &&
    same(snapshot.totals.total, documentTotal)
  );
}

const unaltered = (artifact: StoredArtifact) =>
  artifact.sizeBytes === artifact.content.length && artifact.sha256 === sha256(artifact.content);

export function invoiceCreditSource(db: DbClient) {
  const documents = createDocumentRepository(db);
  const artifacts = createArtifactStore(db);
  return {
    /** La factura con su integridad; null si no existe en la empresa o no es una factura. */
    async find(companyId: string, invoiceId: string): Promise<InvoiceCreditSource | null> {
      const document = await documents.find(companyId, invoiceId);
      if (!document || document.documentType !== INVOICE_DOCUMENT_TYPE) return null;
      const snapshot = document.snapshot as InvoiceSnapshot;
      const problems: InvoiceIntegrityProblem[] = [];
      const shaped = wellFormed(snapshot);
      if (!shaped) problems.push("SNAPSHOT_SHAPE");
      if (
        snapshot.key?.accessKey !== document.accessKey ||
        snapshot.key.documentNumber !== document.documentNumber
      ) {
        problems.push("SNAPSHOT_KEY");
      }
      if (shaped && !consistentTotals(snapshot, documentBuyer(document).total)) {
        problems.push("SNAPSHOT_TOTALS");
      }
      if (document.state !== "RESERVED") {
        const signed = await artifacts.read(companyId, document.id, "SIGNED_XML");
        if (!signed) {
          problems.push("SIGNED_XML_MISSING");
        } else if (
          !unaltered(signed) ||
          !signed.content
            .toString("utf8")
            .includes(`<claveAcceso>${document.accessKey}</claveAcceso>`)
        ) {
          problems.push("SIGNED_XML_ALTERED");
        }
        const authorized = await artifacts.read(companyId, document.id, "AUTHORIZED_XML");
        if (authorized && !unaltered(authorized)) problems.push("AUTHORIZED_XML_ALTERED");
      }
      const lines = shaped ? snapshot.lines : [];
      return {
        id: document.id,
        documentType: INVOICE_DOCUMENT_TYPE,
        documentNumber: document.documentNumber,
        issueDate: document.issueDate,
        accessKey: document.accessKey,
        environment: document.environment,
        state: document.state,
        authorization: document.authorization,
        snapshotVersion: snapshot.snapshotVersion,
        consumerFinal: snapshot.buyer?.consumerFinal ?? false,
        buyer: {
          identificationType: snapshot.buyer?.identificationType ?? "",
          identification: snapshot.buyer?.identification ?? "",
          legalName: snapshot.buyer?.legalName ?? "",
          address: snapshot.buyer?.address ?? null,
        },
        lines: lines.map((line) => ({
          position: line.position,
          productId: line.productId,
          mainCode: line.mainCode,
          auxiliaryCode: line.auxiliaryCode,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          subtotal: line.subtotal,
          taxableBase: line.taxableBase,
          taxes: line.taxes.map((tax) => ({
            taxCode: tax.taxCode,
            rateCode: tax.rateCode,
            catalogType: tax.catalogType,
            entryKey: tax.entryKey,
            versionId: tax.versionId,
            officialLabel: tax.officialLabel,
            percentage: tax.percentage,
            base: tax.base,
            amount: tax.amount,
          })),
          inventoryAffectsStock: lineAffectsInventory(snapshot, line),
        })),
        totals: snapshot.totals,
        integrity: { intact: problems.length === 0, problems },
      };
    },
  };
}
