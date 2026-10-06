// Perfil del comprobante de retención en la firma compartida (add-withholding-receipts, design D2 y
// D17): su XML desde el snapshot con el builder `comprobanteRetencion` 2.0.0 y la auditoría
// `withholding_receipt.signed`. El procedimiento, el firmador con el tipo `07` y la validación XSD
// antes y después de firmar son los de `fiscal`.
import type { SigningProfile } from "../../fiscal/application/signing-pipeline.ts";
import { XmlBuildFailure } from "../../fiscal/application/signing-pipeline.ts";
import {
  WithholdingReceiptXmlError,
  type WithholdingReceiptXmlBuilder,
} from "../../sri-engine/application/ports.ts";
import type { WithholdingSnapshot } from "../domain/snapshot.ts";
import { toWithholdingReceiptXmlSnapshot } from "./xml-snapshot.ts";

export function withholdingReceiptSigningProfile(
  builder: WithholdingReceiptXmlBuilder,
): SigningProfile {
  return {
    documentType: "07",
    xml: {
      version: builder.version,
      build(snapshot) {
        try {
          return builder.build(toWithholdingReceiptXmlSnapshot(snapshot as WithholdingSnapshot));
        } catch (error) {
          if (error instanceof WithholdingReceiptXmlError) {
            throw new XmlBuildFailure(
              error.code === "UNSUPPORTED_SCHEMA_VERSION" ? "SCHEMA_UNAVAILABLE" : error.code,
            );
          }
          throw error;
        }
      },
    },
    signedAudit: {
      action: "withholding_receipt.signed",
      changes: (document, artifactSha256) => ({
        withholdingReceiptId: document.id,
        documentNumber: document.documentNumber,
        artifactSha256,
      }),
    },
  };
}
