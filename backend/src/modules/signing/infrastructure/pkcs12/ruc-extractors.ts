// Registro de extractores del RUC del certificado (design D4, Q-17): por estructura u OID
// documentado públicamente, nunca por el emisor ni por texto libre del sujeto. Añadir una
// estrategia exige su documentación pública, un fixture que la reproduzca y su prueba.
import { rucSchema } from "@facturador/contracts";
import forge from "node-forge";

export type RucExtractor = Readonly<{
  id: string;
  /** Fuente pública que documenta la estructura. */
  documentation: string;
  extract(certificate: forge.pki.Certificate): string | null;
}>;

const STRING_TYPES: ReadonlySet<number> = new Set([
  forge.asn1.Type.UTF8,
  forge.asn1.Type.PRINTABLESTRING,
  forge.asn1.Type.IA5STRING,
]);

/** Valor de una extensión que es una cadena ASN.1 (UTF8String, PrintableString o IA5String). */
function stringExtension(certificate: forge.pki.Certificate, oid: string): string | null {
  const extension = (certificate.extensions as { id: string; value: string }[]).find(
    (ext) => ext.id === oid,
  );
  if (!extension) return null;
  try {
    const node = forge.asn1.fromDer(extension.value);
    if (node.tagClass !== forge.asn1.Class.UNIVERSAL || !STRING_TYPES.has(node.type)) return null;
    if (typeof node.value !== "string") return null;
    return forge.util.decodeUtf8(node.value);
  } catch {
    return null;
  }
}

export const RUC_EXTRACTORS: readonly RucExtractor[] = [
  {
    id: "extension-oid:1.3.6.1.4.1.37746.3.11",
    documentation:
      "Security Data: perfil de certificado publicado, OID 1.3.6.1.4.1.37746.3.11 = RUC",
    extract: (certificate) => stringExtension(certificate, "1.3.6.1.4.1.37746.3.11"),
  },
];

/** El primer extractor que devuelve un RUC fiable: el valor completo cumple el patrón del RUC. */
export function detectRuc(
  certificate: forge.pki.Certificate,
  extractors: readonly RucExtractor[] = RUC_EXTRACTORS,
): { ruc: string; extractor: string } | null {
  for (const extractor of extractors) {
    const raw = extractor.extract(certificate);
    if (raw === null) continue;
    const parsed = rucSchema.safeParse(raw);
    if (parsed.success && parsed.data === raw) return { ruc: raw, extractor: extractor.id };
  }
  return null;
}
