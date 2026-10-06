// Perfil de la guía de remisión en la firma compartida (add-shipping-guides, design D2 y D16): su XML
// desde el snapshot con el builder `guiaRemision` 1.1.0 y la auditoría `shipping_guide.signed`. El
// procedimiento, el firmador con el tipo `06` y la validación XSD antes y después de firmar son los de
// `fiscal`.
import type { SigningProfile } from "../../fiscal/application/signing-pipeline.ts";
import { XmlBuildFailure } from "../../fiscal/application/signing-pipeline.ts";
import {
  ShippingGuideXmlError,
  type ShippingGuideXmlBuilder,
} from "../../sri-engine/application/ports.ts";
import type { ShippingGuideSnapshot } from "../domain/snapshot.ts";
import { toShippingGuideXmlSnapshot } from "./xml-snapshot.ts";

export function shippingGuideSigningProfile(builder: ShippingGuideXmlBuilder): SigningProfile {
  return {
    documentType: "06",
    xml: {
      version: builder.version,
      build(snapshot) {
        try {
          return builder.build(toShippingGuideXmlSnapshot(snapshot as ShippingGuideSnapshot));
        } catch (error) {
          if (error instanceof ShippingGuideXmlError) {
            throw new XmlBuildFailure(
              error.code === "UNSUPPORTED_SCHEMA_VERSION" ? "SCHEMA_UNAVAILABLE" : error.code,
            );
          }
          throw error;
        }
      },
    },
    signedAudit: {
      action: "shipping_guide.signed",
      changes: (document, artifactSha256) => ({
        shippingGuideId: document.id,
        documentNumber: document.documentNumber,
        artifactSha256,
      }),
    },
  };
}
