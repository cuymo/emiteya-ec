// Perfil de la liquidación de compra en la firma compartida (add-purchase-settlements, design D2 y
// D16): su XML desde el snapshot con el builder `liquidacionCompra` 1.1.0 y la auditoría
// `purchase_settlement.signed`. El procedimiento, el firmador con el tipo `03` y la validación XSD
// antes y después de firmar son los de `fiscal`.
import type { SigningProfile } from "../../fiscal/application/signing-pipeline.ts";
import { XmlBuildFailure } from "../../fiscal/application/signing-pipeline.ts";
import {
  PurchaseSettlementXmlError,
  type PurchaseSettlementXmlBuilder,
} from "../../sri-engine/application/ports.ts";
import type { PurchaseSettlementSnapshot } from "../domain/snapshot.ts";
import { toPurchaseSettlementXmlSnapshot } from "./xml-snapshot.ts";

export function purchaseSettlementSigningProfile(
  builder: PurchaseSettlementXmlBuilder,
): SigningProfile {
  return {
    documentType: "03",
    xml: {
      version: builder.version,
      build(snapshot) {
        try {
          return builder.build(
            toPurchaseSettlementXmlSnapshot(snapshot as PurchaseSettlementSnapshot),
          );
        } catch (error) {
          if (error instanceof PurchaseSettlementXmlError) {
            throw new XmlBuildFailure(
              error.code === "UNSUPPORTED_SCHEMA_VERSION" ? "SCHEMA_UNAVAILABLE" : error.code,
            );
          }
          throw error;
        }
      },
    },
    signedAudit: {
      action: "purchase_settlement.signed",
      changes: (document, artifactSha256) => ({
        purchaseSettlementId: document.id,
        documentNumber: document.documentNumber,
        artifactSha256,
      }),
    },
  };
}
