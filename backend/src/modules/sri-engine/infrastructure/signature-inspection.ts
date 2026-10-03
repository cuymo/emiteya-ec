// Lectura y verificación de la firma XAdES-BES que produce el firmador (design D3, paso 7), sin
// otra dependencia XML: el firmador firma la forma canónica de <ds:SignedInfo> con el namespace
// `ds` heredado e inserta ese mismo texto en el documento. Las pruebas de contrato del adaptador
// detectan cualquier cambio de esa plantilla al actualizar la librería (ADR 0018).
import { X509Certificate, createVerify } from "node:crypto";

const DS_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";

export type EnvelopedSignature = Readonly<{
  algorithm: string;
  certificate: X509Certificate;
  canonicalSignedInfo: string;
  signatureValue: Buffer;
}>;

export class SignatureFormatError extends Error {
  constructor() {
    super("La firma no tiene la estructura XAdES-BES esperada.");
    this.name = "SignatureFormatError";
  }
}

function single(xml: string, pattern: RegExp): string {
  const matches = [...xml.matchAll(pattern)];
  if (matches.length !== 1 || matches[0]![1] === undefined) throw new SignatureFormatError();
  return matches[0]![1];
}

/**
 * Forma canónica (C14N inclusiva) de <ds:SignedInfo> tal como la firma el firmador: con el
 * namespace `ds` heredado declarado primero y los elementos vacíos con etiqueta de cierre. La
 * plantilla del firmador no lleva texto ni atributos que cambien con otras reglas de C14N.
 */
function canonicalize(signedInfo: string): string {
  return signedInfo
    .replace("<ds:SignedInfo", `<ds:SignedInfo xmlns:ds="${DS_NAMESPACE}"`)
    .replace(/<(ds:[A-Za-z]+)((?:\s+[A-Za-z:]+="[^"]*")*)\s*\/>/g, "<$1$2></$1>");
}

export function readEnvelopedSignature(signedXml: string): EnvelopedSignature {
  const signedInfo = single(signedXml, /(<ds:SignedInfo\b[\s\S]*?<\/ds:SignedInfo>)/g);
  if (signedInfo.includes("xmlns:ds=")) throw new SignatureFormatError();
  const algorithm = single(signedInfo, /<ds:SignatureMethod Algorithm="([^"]+)"/g);
  const certificateBase64 = single(signedXml, /<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/g);
  const signatureValue = single(
    signedXml,
    /<ds:SignatureValue\b[^>]*>([^<]+)<\/ds:SignatureValue>/g,
  );
  return {
    algorithm,
    certificate: new X509Certificate(Buffer.from(certificateBase64.replace(/\s+/g, ""), "base64")),
    canonicalSignedInfo: canonicalize(signedInfo),
    signatureValue: Buffer.from(signatureValue.replace(/\s+/g, ""), "base64"),
  };
}

/** true si la firma es RSA-SHA1 y verifica con la clave pública del certificado dado. */
export function verifyEnvelopedSignature(
  signature: EnvelopedSignature,
  publicKeyPem: string,
): boolean {
  if (signature.algorithm !== `${DS_NAMESPACE}rsa-sha1`) return false;
  return createVerify("RSA-SHA1")
    .update(signature.canonicalSignedInfo, "utf8")
    .verify(publicKeyPem, signature.signatureValue);
}
