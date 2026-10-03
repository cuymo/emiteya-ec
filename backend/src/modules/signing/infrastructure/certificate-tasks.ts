// Worker del pool criptográfico para la firma electrónica (design D3 y D18). Tarea
// `inspect-and-test-sign`: inspecciona el PKCS#12 con node-forge, firma un XML de prueba con el
// adaptador de sri-engine, comprueba que el certificado embebido es el inspeccionado y verifica la
// firma con su clave pública. Tarea `sign-xml` (add-invoice-emission, design D9): firma un
// comprobante y comprueba que el certificado embebido tiene la huella de la firma vigente. Los
// bytes del P12 se ponen a cero al terminar. Los rechazos viajan como "CODIGO" o "CODIGO:CAUSA",
// nunca con mensajes.
import { CryptoTaskError, serveCryptoTasks } from "../../../platform/workers/serve-crypto-tasks.ts";
import type { DocumentType } from "@facturador/contracts";
import { XmlSignerError } from "../../sri-engine/application/ports.ts";
import { createXmlSigner } from "../../sri-engine/infrastructure/ec-sri-signer.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../sri-engine/infrastructure/signature-inspection.ts";
import type { InspectedCertificate } from "../application/ports.ts";
import { CertificateInspectionError, inspectPkcs12 } from "./pkcs12/pkcs12-reader.ts";
import { INSPECT_AND_TEST_SIGN, SIGN_XML } from "./certificate-task-names.ts";

const signer = createXmlSigner();
const TEST_SIGNATURE_FAILED = "CERTIFICATE_INCOMPATIBLE:TEST_SIGNATURE";
const hex = (fingerprint256: string) => fingerprint256.replaceAll(":", "").toLowerCase();

async function inspectAndTestSign(payload: {
  p12: ArrayBuffer;
  password: string;
}): Promise<InspectedCertificate> {
  const bytes = Buffer.from(payload.p12);
  try {
    let certificate: InspectedCertificate;
    try {
      certificate = inspectPkcs12(bytes, payload.password);
    } catch (error) {
      if (error instanceof CertificateInspectionError) throw new CryptoTaskError(error.message);
      throw new CryptoTaskError("CERTIFICATE_UNREADABLE");
    }
    let signed: string;
    try {
      signed = await signer.sign({
        xml: signer.testDocument(),
        documentType: "01",
        p12: bytes,
        password: payload.password,
      });
    } catch (error) {
      throw new CryptoTaskError(
        error instanceof XmlSignerError && error.code === "PASSWORD_INVALID"
          ? "CERTIFICATE_PASSWORD_INVALID"
          : TEST_SIGNATURE_FAILED,
      );
    }
    try {
      const signature = readEnvelopedSignature(signed);
      // Misma huella que la inspeccionada: su clave pública es la del certificado inspeccionado.
      const publicKey = signature.certificate.publicKey.export({
        type: "spki",
        format: "pem",
      }) as string;
      if (
        hex(signature.certificate.fingerprint256) !== certificate.fingerprint ||
        !verifyEnvelopedSignature(signature, publicKey)
      ) {
        throw new CryptoTaskError(TEST_SIGNATURE_FAILED);
      }
    } catch (error) {
      if (error instanceof CryptoTaskError) throw error;
      throw new CryptoTaskError(TEST_SIGNATURE_FAILED);
    }
    return certificate;
  } finally {
    bytes.fill(0);
  }
}

async function signXml(payload: {
  xml: string;
  documentType: DocumentType;
  p12: ArrayBuffer;
  password: string;
  /** Huella SHA-256 de la firma vigente, hexadecimal en minúsculas. */
  fingerprint: string;
}): Promise<string> {
  const bytes = Buffer.from(payload.p12);
  try {
    let signed: string;
    try {
      signed = await signer.sign({
        xml: payload.xml,
        documentType: payload.documentType,
        p12: bytes,
        password: payload.password,
      });
    } catch {
      throw new CryptoTaskError("SIGNER_FAILED");
    }
    let embedded: string;
    try {
      embedded = hex(readEnvelopedSignature(signed).certificate.fingerprint256);
    } catch {
      throw new CryptoTaskError("SIGNER_FAILED");
    }
    if (embedded !== payload.fingerprint) throw new CryptoTaskError("CERTIFICATE_MISMATCH");
    return signed;
  } finally {
    bytes.fill(0);
  }
}

serveCryptoTasks({ [INSPECT_AND_TEST_SIGN]: inspectAndTestSign, [SIGN_XML]: signXml });
