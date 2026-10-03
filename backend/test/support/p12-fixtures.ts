// Fixtures PKCS#12 sintéticos (design D15 y D16): el script de OpenSSL y, para lo que OpenSSL no
// permite exportar (clave que no corresponde, cadena con la CA primero), node-forge.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";

export const FIXTURE_PASSWORD = "Clave-Prueba-2026";
export const FIXTURE_NONASCII_PASSWORD = "contraseña-ñ-€-Ü";
export const FIXTURE_RUC = "1790012345001";
export const FIXTURE_OTHER_RUC = "0992877878001";

export function generateP12Fixtures(dir: string): void {
  const script = new URL("./generate-p12-fixtures.sh", import.meta.url).pathname;
  const result = spawnSync("bash", [script, dir], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`No se pudieron generar los P12 de prueba:\n${result.stderr}`);
  }
  const pem = (file: string) => readFileSync(join(dir, file), "utf8");
  const certificate = (file: string) => forge.pki.certificateFromPem(pem(file));
  const key = (file: string) => forge.pki.privateKeyFromPem(pem(file));
  const write = (
    name: string,
    privateKey: forge.pki.rsa.PrivateKey,
    certs: forge.pki.Certificate[],
  ) => {
    const asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, certs, FIXTURE_PASSWORD, {
      algorithm: "3des",
    });
    writeFileSync(join(dir, name), Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary"));
  };
  write("mismatch.p12", key("noruc.key"), [certificate("sd-utf8.crt"), certificate("ca.crt")]);
  // Vencido y todavía no vigente: OpenSSL 3.0 no fija fechas arbitrarias de vigencia.
  const ca = certificate("ca.crt");
  const caKey = key("ca.key");
  const holderKey = key("sd-utf8.key");
  for (const [name, from, to] of [
    ["expired", "2023-01-01T00:00:00Z", "2024-01-01T00:00:00Z"],
    ["future", "2030-01-01T00:00:00Z", "2031-01-01T00:00:00Z"],
  ] as const) {
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.setRsaPublicKey(holderKey.n, holderKey.e);
    cert.serialNumber = forge.util
      .bytesToHex(forge.random.getBytesSync(8))
      .replace(/^[89a-f]/, "1");
    cert.validity.notBefore = new Date(from);
    cert.validity.notAfter = new Date(to);
    cert.setSubject([
      { shortName: "C", value: "EC" },
      { shortName: "CN", value: `TITULAR DE PRUEBA ${name}` },
    ]);
    cert.setIssuer(ca.subject.attributes);
    const ruc = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.UTF8,
      false,
      FIXTURE_RUC,
    );
    cert.setExtensions([
      { name: "basicConstraints", cA: false, critical: true },
      { id: "1.3.6.1.4.1.37746.3.11", critical: false, value: forge.asn1.toDer(ruc).getBytes() },
    ]);
    cert.sign(caKey, forge.md.sha256.create());
    write(`${name}.modern.p12`, holderKey, [cert, ca]);
  }
  write("ca-first.p12", key("sd-utf8.key"), [certificate("ca.crt"), certificate("sd-utf8.crt")]);
}

/** Bytes de un fixture del directorio generado. */
export const readFixture = (dir: string, name: string): Buffer => readFileSync(join(dir, name));
