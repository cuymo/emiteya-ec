// Perfil de la nota de crédito en la firma compartida (add-credit-notes, design D2 y D12): su XML
// desde el snapshot con el builder `notaCredito` 1.1.0 y la auditoría `credit_note.signed`. El
// procedimiento, el firmador con el tipo `04` y la validación XSD antes y después de firmar son los
// de `fiscal`.
import type { SigningProfile } from "../../fiscal/application/signing-pipeline.ts";
import { XmlBuildFailure } from "../../fiscal/application/signing-pipeline.ts";
import {
  CreditNoteXmlError,
  type CreditNoteXmlBuilder,
} from "../../sri-engine/application/ports.ts";
import type { CreditNoteSnapshot } from "../domain/snapshot.ts";
import { toCreditNoteXmlSnapshot } from "./xml-snapshot.ts";

export function creditNoteSigningProfile(builder: CreditNoteXmlBuilder): SigningProfile {
  return {
    documentType: "04",
    xml: {
      version: builder.version,
      build(snapshot) {
        try {
          return builder.build(toCreditNoteXmlSnapshot(snapshot as CreditNoteSnapshot));
        } catch (error) {
          if (error instanceof CreditNoteXmlError) {
            throw new XmlBuildFailure(
              error.code === "UNSUPPORTED_SCHEMA_VERSION" ? "SCHEMA_UNAVAILABLE" : error.code,
            );
          }
          throw error;
        }
      },
    },
    signedAudit: {
      action: "credit_note.signed",
      changes: (document, artifactSha256) => ({
        creditNoteId: document.id,
        documentNumber: document.documentNumber,
        artifactSha256,
      }),
    },
  };
}
