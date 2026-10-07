// Contrato del firmador para la liquidación de compra (add-purchase-settlements, tarea 1.1, design
// D16, ADR 0018): `ec-sri-invoice-signer@1.8.2` no exporta una función pública para el tipo 03, y
// `facturacion-electronica-ec@1.0.1` la toma de un módulo privado (`dist/src/signature/signature`)
// con la raíz `liquidacionCompra`. Esta prueba fija ese camino antes de construir sobre él: un XML
// sintético 1.1.0 válido se firma con un P12 de fixtures por el adaptador vigente (`createXmlSigner`,
// sin la API de alto nivel de la librería), la firma XAdES verifica con el certificado del titular,
// el XML firmado sigue validando contra el XSD y la clave y el `codDoc` no cambian. Si falla, el
// mapeo privado no sirve al pipeline: es un bloqueo del cambio, no algo que se rodea.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../src/modules/sri-engine/infrastructure/signature-inspection.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "../support/p12-fixtures.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const registry = (
  JSON.parse(
    readFileSync(path("../../src/modules/catalogs/datasets/schema-registry/2.json"), "utf8"),
  ) as {
    entries: (Omit<SchemaRegistryEntry, "documentType" | "version"> & {
      documentType?: string;
      version?: string;
    })[];
  }
).entries.map((entry) => ({
  ...entry,
  documentType: entry.documentType ?? null,
  version: entry.version ?? null,
  imports: entry.imports ?? [],
}));
const liquidacionCompra = registeredSchema(registry, "03", "1.1.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const dir = inject("p12FixturesDir");
const certificate = new X509Certificate(readFileSync(join(dir, "sd-utf8.crt")));
const signer = createXmlSigner();

const ACCESS_KEY = createAccessKeys().compose({
  issueDate: "2026-10-07",
  documentType: "03",
  ruc: "1790012345001",
  environment: "1",
  establishment: "001",
  emissionPoint: "001",
  sequential: "000000001",
  numericCode: "12345678",
});

/**
 * Liquidación de compra 1.1.0 sintética, escrita a mano en el orden del XSD: un proveedor con cédula
 * y dirección, una línea con IVA del 15 % y otra al 0 %, descuento siempre presente y dos pagos con
 * plazo y unidad de tiempo. Datos ficticios; nunca se envía al SRI.
 */
const SYNTHETIC = `<?xml version="1.0" encoding="UTF-8"?>
<liquidacionCompra id="comprobante" version="1.1.0">
<infoTributaria><ambiente>1</ambiente><tipoEmision>1</tipoEmision><razonSocial>DISTRIBUIDORA NACIONAL S.A.</razonSocial><ruc>1790012345001</ruc><claveAcceso>${ACCESS_KEY}</claveAcceso><codDoc>03</codDoc><estab>001</estab><ptoEmi>001</ptoEmi><secuencial>000000001</secuencial><dirMatriz>Av. Amazonas N24-03, Quito</dirMatriz></infoTributaria>
<infoLiquidacionCompra><fechaEmision>07/10/2026</fechaEmision><dirEstablecimiento>Av. 6 de Diciembre N33-55, Quito</dirEstablecimiento><obligadoContabilidad>SI</obligadoContabilidad><tipoIdentificacionProveedor>05</tipoIdentificacionProveedor><razonSocialProveedor>María Quishpe</razonSocialProveedor><identificacionProveedor>0102030405</identificacionProveedor><direccionProveedor>Comunidad San Pablo, Cayambe</direccionProveedor><totalSinImpuestos>100.00</totalSinImpuestos><totalDescuento>5.00</totalDescuento><totalConImpuestos><totalImpuesto><codigo>2</codigo><codigoPorcentaje>0</codigoPorcentaje><baseImponible>60.00</baseImponible><tarifa>0</tarifa><valor>0.00</valor></totalImpuesto><totalImpuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><baseImponible>40.00</baseImponible><tarifa>15</tarifa><valor>6.00</valor></totalImpuesto></totalConImpuestos><importeTotal>106.00</importeTotal><moneda>DOLAR</moneda><pagos><pago><formaPago>01</formaPago><total>50.00</total><plazo>0</plazo><unidadTiempo>dias</unidadTiempo></pago><pago><formaPago>20</formaPago><total>56.00</total><plazo>30</plazo><unidadTiempo>dias</unidadTiempo></pago></pagos></infoLiquidacionCompra>
<detalles><detalle><descripcion>Saco de cacao en grano, 45 kg</descripcion><unidadMedida>saco</unidadMedida><cantidad>10</cantidad><precioUnitario>4.5</precioUnitario><descuento>5.00</descuento><precioTotalSinImpuesto>40.00</precioTotalSinImpuesto><impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa><baseImponible>40.00</baseImponible><valor>6.00</valor></impuesto></impuestos></detalle><detalle><codigoPrincipal>JOR-01</codigoPrincipal><descripcion>Jornal de cosecha</descripcion><cantidad>2</cantidad><precioUnitario>30</precioUnitario><descuento>0.00</descuento><precioTotalSinImpuesto>60.00</precioTotalSinImpuesto><impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>0</codigoPorcentaje><tarifa>0</tarifa><baseImponible>60.00</baseImponible><valor>0.00</valor></impuesto></impuestos></detalle></detalles>
</liquidacionCompra>`;

const sign = (xml: string) =>
  signer.sign({
    xml,
    documentType: "03",
    p12: readFixture(dir, "sd-utf8.modern.p12"),
    password: FIXTURE_PASSWORD,
  });

describe("contrato del firmador para la liquidación de compra 03 (ADR 0018, design D16)", () => {
  it("el XML sintético es una liquidación de compra 1.1.0 válida antes de firmar", async () => {
    expect(liquidacionCompra.path).toBe("sri-xsd/LiquidacionCompra_V1.1.0.xsd");
    expect(await xsd.validate(SYNTHETIC, liquidacionCompra)).toEqual({ valid: true });
  });

  it("firma con el tipo 03: XAdES verificable con el certificado del titular, XSD válido y la clave intacta", async () => {
    const signed = await sign(SYNTHETIC);
    // La firma va dentro de la raíz `liquidacionCompra`, referida al elemento `comprobante`.
    expect(signed).toContain("SignedProperties");
    expect(signed).toContain('URI="#comprobante"');
    expect(signed.trimEnd().endsWith("</liquidacionCompra>")).toBe(true);
    const signature = readEnvelopedSignature(signed);
    expect(signature.algorithm).toBe("http://www.w3.org/2000/09/xmldsig#rsa-sha1");
    expect(signature.certificate.fingerprint256).toBe(certificate.fingerprint256);
    expect(
      verifyEnvelopedSignature(
        signature,
        certificate.publicKey.export({ type: "spki", format: "pem" }) as string,
      ),
    ).toBe(true);
    // El documento firmado sigue validando contra el XSD oficial.
    expect(await xsd.validate(signed, liquidacionCompra)).toEqual({ valid: true });
    // La clave, el tipo y los datos del comprobante no cambian al firmar.
    expect(signed).toContain(`<claveAcceso>${ACCESS_KEY}</claveAcceso>`);
    expect(signed).toContain("<codDoc>03</codDoc>");
    expect(ACCESS_KEY.slice(8, 10)).toBe("03");
    const body = (xml: string) =>
      xml.slice(xml.indexOf("<infoTributaria>"), xml.indexOf("</detalles>"));
    expect(body(signed)).toBe(body(SYNTHETIC));
  });

  it("el adaptador firma sin la API de alto nivel de la librería", () => {
    const adapter = readFileSync(
      path("../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts"),
      "utf8",
    );
    // Del paquete solo se importan el firmador, el mapeo de tipos y las utilidades de la clave y del
    // documento de la firma de prueba: ni el cliente de emisión (`emitir*`), ni el del SRI, ni su
    // secuencia.
    const imported = /import \{([^}]*)\} from "facturacion-electronica-ec";/.exec(adapter)?.[1];
    expect(
      imported
        ?.split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .sort(),
    ).toEqual([
      "COD_DOC_TO_DOCUMENT_TYPE",
      "EcSriSigner",
      "buildDocumentXml",
      "generateClaveAcceso",
      "schemaRegistry",
    ]);
    expect(adapter).toContain("new EcSriSigner()");
    expect(adapter).toContain("COD_DOC_TO_DOCUMENT_TYPE[documentType]");
  });
});
