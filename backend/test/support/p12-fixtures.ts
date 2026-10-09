// Fixtures PKCS#12 sintéticos (design D15 y D16): el script de OpenSSL y, para lo que OpenSSL no
// permite exportar (clave que no corresponde, cadena con la CA primero, un MAC con otras
// iteraciones que los cifrados, contenidos repetidos), node-forge.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";
import { CERTIFICATE_MAX_BYTES_DEFAULT } from "@facturador/contracts";
import {
  MAX_PKCS12_ITERATIONS,
  iterationCounts,
} from "../../src/modules/signing/infrastructure/pkcs12/pkcs12-reader.ts";

export const FIXTURE_PASSWORD = "Clave-Prueba-2026";
export const FIXTURE_NONASCII_PASSWORD = "contraseña-ñ-€-Ü";
export const FIXTURE_RUC = "1790012345001";
export const FIXTURE_OTHER_RUC = "0992877878001";

const { asn1 } = forge;
const children = (node: forge.asn1.Asn1) => node.value as forge.asn1.Asn1[];
const fromDer = (der: Buffer) => asn1.fromDer(forge.util.createBuffer(der.toString("binary")));
const toDer = (node: forge.asn1.Asn1) => Buffer.from(asn1.toDer(node).getBytes(), "binary");
const integer = (value: number) =>
  asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(value).getBytes());
const ENCRYPTED_DATA = "1.2.840.113549.1.7.6";

/** Contadores de iteraciones de un P12 tal como los lee la inspección, sin la contraseña. */
export const iterationCountsOf = (der: Buffer): number[] => iterationCounts(fromDer(der));

/** Cambia el contador del MAC sin recalcularlo: el MAC queda inválido. */
export function withMacIterationCount(der: Buffer, count: number): Buffer {
  const pfx = fromDer(der);
  children(children(pfx)[2]!)[2] = integer(count);
  return toDer(pfx);
}

/** Recalcula el MAC del PFX (KDF de PKCS#12 con HMAC-SHA1) con las iteraciones indicadas. */
export function withMacIterations(der: Buffer, iterations: number, password = FIXTURE_PASSWORD) {
  const pfx = fromDer(der);
  const [, authSafeInfo, macData] = children(pfx);
  const content = children(children(authSafeInfo!)[1]!)[0]!;
  const fields = children(macData!);
  const salt = forge.util.createBuffer(fields[1]!.value as string);
  const key = forge.pkcs12.generateKey(password, salt, 3, iterations, 20, forge.md.sha1.create());
  const hmac = forge.hmac.create();
  hmac.start(forge.md.sha1.create(), key);
  hmac.update(content.value as string);
  children(fields[0]!)[1]!.value = hmac.digest().getBytes();
  fields[2] = integer(iterations);
  return toDer(pfx);
}

/**
 * Repite el contenido cifrado de los certificados hasta el tamaño máximo de subida por defecto, con
 * el MAC recalculado. Cada contador sigue igual, así que el techo por contador no lo detiene: el
 * coste de abrirlo crece con las copias y solo lo acota el timeout del pool.
 */
export function withRepeatedContainers(der: Buffer, macIterations: number): Buffer {
  const pfx = fromDer(der);
  const octets = children(children(children(pfx)[1]!)[1]!)[0]!;
  const authSafe = asn1.fromDer(octets.value as string);
  const encrypted = children(authSafe).find(
    (info) => asn1.derToOid(children(info)[0]!.value as string) === ENCRYPTED_DATA,
  )!;
  const copies = Math.floor(
    (CERTIFICATE_MAX_BYTES_DEFAULT - der.length - 64) / asn1.toDer(encrypted).length(),
  );
  for (let i = 0; i < copies; i++) children(authSafe).push(encrypted);
  octets.value = asn1.toDer(authSafe).getBytes();
  const repeated = withMacIterations(toDer(pfx), macIterations);
  if (repeated.length > CERTIFICATE_MAX_BYTES_DEFAULT) throw new Error("supera la subida");
  return repeated;
}

/**
 * P12 legado como el de Security Data (MAC SHA-1, clave 3DES y certificados RC2-40), con las
 * iteraciones indicadas para el MAC y para cada cifrado. OpenSSL lo exporta y node-forge recalcula
 * el MAC.
 */
export function legacyP12(dir: string, cert: string, mac: number, encryption: number): Buffer {
  const out = join(dir, `${cert}.legacy-${mac}-${encryption}.tmp.p12`);
  const result = spawnSync(
    "openssl",
    [
      "pkcs12",
      "-export",
      "-legacy",
      "-macalg",
      "sha1",
      "-iter",
      String(encryption),
      "-inkey",
      join(dir, `${cert}.key`),
      "-in",
      join(dir, `${cert}.crt`),
      "-certfile",
      join(dir, "ca.crt"),
      "-name",
      cert,
      "-passout",
      `pass:${FIXTURE_PASSWORD}`,
      "-out",
      out,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`No se pudo exportar ${out}:\n${result.stderr}`);
  return withMacIterations(readFileSync(out), mac);
}

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

  // Techo de iteraciones (support-security-data-pkcs12-iteration-profile): la forma observada en
  // Security Data, con otro titular para poder reemplazar la firma, los bordes del techo en el MAC y
  // en un cifrado, un contador absurdo y un archivo que repite contenidos cifrados.
  const save = (name: string, der: Buffer) => writeFileSync(join(dir, name), der);
  save("sd-profile.p12", legacyP12(dir, "sd-printable", 102_400, 51_200));
  save("iter-limit.p12", legacyP12(dir, "sd-utf8", MAX_PKCS12_ITERATIONS, 2048));
  save("iter-over-mac.p12", legacyP12(dir, "sd-utf8", MAX_PKCS12_ITERATIONS + 1, 2048));
  save("iter-over-container.p12", legacyP12(dir, "sd-utf8", 2048, MAX_PKCS12_ITERATIONS + 1));
  save(
    "iter-absurd.p12",
    withMacIterationCount(legacyP12(dir, "sd-utf8", 2048, 2048), 2 ** 31 - 1),
  );
  save(
    "many-containers.p12",
    withRepeatedContainers(legacyP12(dir, "sd-utf8", 2048, 51_200), 2048),
  );
}

/** Bytes de un fixture del directorio generado. */
export const readFixture = (dir: string, name: string): Buffer => readFileSync(join(dir, name));
