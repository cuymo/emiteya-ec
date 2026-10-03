// Lector de PKCS#12 con node-forge (ADR 0019, design D3): la misma familia de parser que el
// firmador, que acepta y rechaza los mismos P12, sin el proveedor legado de OpenSSL. Solo se
// ejecuta dentro del pool criptográfico. Los mensajes de node-forge nunca salen de aquí: se
// traducen a un código.
import { createHash } from "node:crypto";
import forge from "node-forge";
import type {
  CertificateRejection,
  IncompatibleReason,
  InspectedCertificate,
} from "../../application/ports.ts";
import { detectRuc } from "./ruc-extractors.ts";

/** Límite de iteraciones del MAC y de cada cifrado: defensa de recursos (S-6, ADR 0019). */
export const MAX_PKCS12_ITERATIONS = 100_000;
export const MIN_RSA_BITS = 2048;

export class CertificateInspectionError extends Error {
  readonly code: CertificateRejection;
  readonly reason: IncompatibleReason | undefined;
  constructor(code: CertificateRejection, reason?: IncompatibleReason) {
    super(reason ? `${code}:${reason}` : code);
    this.name = "CertificateInspectionError";
    this.code = code;
    this.reason = reason;
  }
}

const { asn1 } = forge;
const BAG = {
  key: "1.2.840.113549.1.12.10.1.1",
  shroudedKey: "1.2.840.113549.1.12.10.1.2",
  cert: "1.2.840.113549.1.12.10.1.3",
};
const OID = {
  data: "1.2.840.113549.1.7.1",
  encryptedData: "1.2.840.113549.1.7.6",
  pbes2: "1.2.840.113549.1.5.13",
  shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
};
const integer = (node: forge.asn1.Asn1) =>
  parseInt(forge.util.bytesToHex(node.value as string), 16);
const children = (node: forge.asn1.Asn1) => node.value as forge.asn1.Asn1[];
const inner = (octets: forge.asn1.Asn1) => asn1.fromDer(octets.value as string);

/** Iteraciones de un AlgorithmIdentifier de PBE: PKCS#12 (salt, iter) o PBES2 (PBKDF2). */
function pbeIterations(algorithm: forge.asn1.Asn1): number {
  const [oid, params] = children(algorithm);
  if (asn1.derToOid(oid!.value as string) === OID.pbes2) {
    const kdf = children(params!)[0]!;
    return integer(children(children(kdf)[1]!)[1]!);
  }
  return integer(children(params!)[1]!);
}

/** Contadores de iteraciones leídos sin la contraseña, antes de descifrar nada. */
export function iterationCounts(pfx: forge.asn1.Asn1): number[] {
  const counts: number[] = [];
  const [, authSafeInfo, macData] = children(pfx);
  if (macData) counts.push(children(macData)[2] ? integer(children(macData)[2]!) : 1);
  const authSafe = inner(children(children(authSafeInfo!)[1]!)[0]!);
  for (const contentInfo of children(authSafe)) {
    const [type, content] = children(contentInfo);
    const oid = asn1.derToOid(type!.value as string);
    if (oid === OID.encryptedData) {
      const encryptedContentInfo = children(children(content!)[0]!)[1]!;
      counts.push(pbeIterations(children(encryptedContentInfo)[1]!));
    }
    if (oid === OID.data) {
      for (const bag of children(inner(children(content!)[0]!))) {
        if (asn1.derToOid(children(bag)[0]!.value as string) === OID.shroudedKeyBag) {
          counts.push(pbeIterations(children(children(children(bag)[1]!)[0]!)[0]!));
        }
      }
    }
  }
  return counts;
}

const distinguishedName = (attributes: forge.pki.CertificateField[]) =>
  attributes.map((a) => `${a.shortName ?? a.name ?? a.type}=${String(a.value)}`).join(", ");

export function inspectPkcs12(p12: Buffer, password: string): InspectedCertificate {
  let pfx: forge.asn1.Asn1;
  try {
    pfx = asn1.fromDer(p12.toString("binary"));
    if (iterationCounts(pfx).some((count) => count > MAX_PKCS12_ITERATIONS)) {
      throw new CertificateInspectionError("CERTIFICATE_INCOMPATIBLE", "ITERATIONS");
    }
  } catch (error) {
    if (error instanceof CertificateInspectionError) throw error;
    throw new CertificateInspectionError("CERTIFICATE_UNREADABLE");
  }

  let store: forge.pkcs12.Pkcs12Pfx;
  try {
    store = forge.pkcs12.pkcs12FromAsn1(pfx, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("MAC could not be verified")) {
      throw new CertificateInspectionError("CERTIFICATE_PASSWORD_INVALID");
    }
    // La estructura exterior ya se leyó y el MAC verificó: el contenido no se descifra con esta
    // contraseña. Es la limitación de S-6 (PBES2 con contraseña no ASCII). El descifrado da bytes
    // basura que unas veces fallan el relleno y otras el ASN.1, así que no se decide por el mensaje.
    throw new CertificateInspectionError("CERTIFICATE_INCOMPATIBLE", "PASSWORD_ENCODING");
  }

  const bags = (bagType: string): forge.pkcs12.Bag[] => store.getBags({ bagType })[bagType] ?? [];
  const certificates = bags(BAG.cert)
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => cert !== undefined);
  const keyBags = [...bags(BAG.shroudedKey), ...bags(BAG.key)];
  // El firmador usa la primera clave: debe ser RSA de 2048 bits o más y corresponder a un certificado.
  const key = keyBags[0]?.key;
  if (!key?.n) throw new CertificateInspectionError("CERTIFICATE_KEY_UNSUPPORTED");
  const holder = certificates.find((cert) => {
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey | undefined;
    return publicKey?.n !== undefined && publicKey.n.equals(key.n) && publicKey.e.equals(key.e);
  });
  if (!holder) throw new CertificateInspectionError("CERTIFICATE_KEY_UNSUPPORTED");
  const keyBits = key.n.bitLength();
  if (keyBits < MIN_RSA_BITS) throw new CertificateInspectionError("CERTIFICATE_KEY_UNSUPPORTED");
  // El firmador embebe el primer certificado del P12: debe ser el del titular.
  if (certificates[0] !== holder)
    throw new CertificateInspectionError("CERTIFICATE_INCOMPATIBLE", "CHAIN_ORDER");

  const der = Buffer.from(asn1.toDer(forge.pki.certificateToAsn1(holder)).getBytes(), "binary");
  const ruc = detectRuc(holder);
  return {
    subject: distinguishedName(holder.subject.attributes),
    issuer: distinguishedName(holder.issuer.attributes),
    serialNumber: holder.serialNumber,
    fingerprint: createHash("sha256").update(der).digest("hex"),
    notBefore: holder.validity.notBefore.toISOString(),
    notAfter: holder.validity.notAfter.toISOString(),
    keyAlgorithm: "RSA",
    keyBits,
    detectedRuc: ruc?.ruc ?? null,
    rucExtractor: ruc?.extractor ?? null,
    chainLength: certificates.length,
  };
}
