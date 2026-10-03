// Worker del pool criptográfico para la firma electrónica (design D3 y D18). Tarea
// `inspect-and-test-sign`: inspecciona el PKCS#12 con node-forge, firma un XML de prueba con el
// adaptador de sri-engine, verifica esa firma con la clave pública inspeccionada y comprueba que
// el certificado embebido es el inspeccionado. Los bytes del P12 se ponen a cero al terminar.
import { createPublicKey } from "node:crypto";
import { X509Certificate } from "node:crypto";
import { CryptoTaskError, serveCryptoTasks } from "../../../platform/workers/serve-crypto-tasks.ts";
import { XmlSignerError } from "../../sri-engine/application/ports.ts";
import { createXmlSigner } from "../../sri-engine/infrastructure/ec-sri-signer.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../sri-engine/infrastructure/signature-inspection.ts";
import type { InspectedCertificate } from "../application/ports.ts";
import { CertificateInspectionError, inspectPkcs12 } from "./pkcs12/pkcs12-reader.ts";

export const INSPECT_AND_TEST_SIGN = "inspect-and-test-sign";
const signer = createXmlSigner();

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
      if (error instanceof CertificateInspectionError) throw new CryptoTaskError(error.code);
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
      const code =
        error instanceof XmlSignerError && error.code === "PASSWORD_INVALID"
          ? "CERTIFICATE_PASSWORD_INVALID"
          : "CERTIFICATE_INCOMPATIBLE";
      throw new CryptoTaskError(code);
    }
    try {
      const signature = readEnvelopedSignature(signed);
      const embedded: X509Certificate = signature.certificate;
      const publicKey = createPublicKey(
        embedded.publicKey.export({ type: "spki", format: "pem" }),
      ).export({ type: "spki", format: "pem" }) as string;
      if (
        hex(embedded.fingerprint256) !== certificate.fingerprint ||
        !verifyEnvelopedSignature(signature, publicKey)
      ) {
        throw new CryptoTaskError("CERTIFICATE_INCOMPATIBLE");
      }
    } catch (error) {
      if (error instanceof CryptoTaskError) throw error;
      throw new CryptoTaskError("CERTIFICATE_INCOMPATIBLE");
    }
    return certificate;
  } finally {
    bytes.fill(0);
  }
}

serveCryptoTasks({ [INSPECT_AND_TEST_SIGN]: inspectAndTestSign });
