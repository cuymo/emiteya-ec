// Perfil de la factura en la firma compartida (add-credit-notes, design D2): su XML desde el snapshot
// con el builder de la factura y la auditoría `invoice.signed`. El procedimiento es el de `fiscal`.
import type { SigningProfile } from "../../fiscal/application/signing-pipeline.ts";
import { XmlBuildFailure } from "../../fiscal/application/signing-pipeline.ts";
import { InvoiceXmlError, type InvoiceXmlBuilder } from "../../sri-engine/application/ports.ts";
import type { InvoiceSnapshot } from "../domain/snapshot.ts";
import { toXmlSnapshot } from "./xml-snapshot.ts";

export function invoiceSigningProfile(builder: InvoiceXmlBuilder): SigningProfile {
  return {
    documentType: "01",
    xml: {
      version: builder.version,
      build(snapshot) {
        try {
          return builder.build(toXmlSnapshot(snapshot as InvoiceSnapshot));
        } catch (error) {
          if (error instanceof InvoiceXmlError) {
            throw new XmlBuildFailure(
              error.code === "UNSUPPORTED_SCHEMA_VERSION" ? "SCHEMA_UNAVAILABLE" : error.code,
            );
          }
          throw error;
        }
      },
    },
    signedAudit: {
      action: "invoice.signed",
      changes: (document, artifactSha256) => ({
        invoiceId: document.id,
        documentNumber: document.documentNumber,
        artifactSha256,
      }),
    },
  };
}
