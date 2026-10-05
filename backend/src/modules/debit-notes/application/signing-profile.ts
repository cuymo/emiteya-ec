// Perfil de la nota de débito en la firma compartida (add-debit-notes, design D2 y D16): su XML
// desde el snapshot con el builder `notaDebito` 1.0.0 y la auditoría `debit_note.signed`. El
// procedimiento, el firmador con el tipo `05` y la validación XSD antes y después de firmar son los
// de `fiscal`.
import type { SigningProfile } from "../../fiscal/application/signing-pipeline.ts";
import { XmlBuildFailure } from "../../fiscal/application/signing-pipeline.ts";
import { DebitNoteXmlError, type DebitNoteXmlBuilder } from "../../sri-engine/application/ports.ts";
import type { DebitNoteSnapshot } from "../domain/snapshot.ts";
import { toDebitNoteXmlSnapshot } from "./xml-snapshot.ts";

export function debitNoteSigningProfile(builder: DebitNoteXmlBuilder): SigningProfile {
  return {
    documentType: "05",
    xml: {
      version: builder.version,
      build(snapshot) {
        try {
          return builder.build(toDebitNoteXmlSnapshot(snapshot as DebitNoteSnapshot));
        } catch (error) {
          if (error instanceof DebitNoteXmlError) {
            throw new XmlBuildFailure(
              error.code === "UNSUPPORTED_SCHEMA_VERSION" ? "SCHEMA_UNAVAILABLE" : error.code,
            );
          }
          throw error;
        }
      },
    },
    signedAudit: {
      action: "debit_note.signed",
      changes: (document, artifactSha256) => ({
        debitNoteId: document.id,
        documentNumber: document.documentNumber,
        artifactSha256,
      }),
    },
  };
}
