// Medición OFFLINE de los siete documentos de la certificación en Pruebas
// (`docs/quality/sri-certification.md`, sección 7): sin red, sin SRI y sin base de datos.
//
//   corepack pnpm --filter @facturador/backend measure:certification-payloads
//
// Cada documento se construye con el builder real, se valida contra el XSD registrado y se firma con
// los P12 SINTÉTICOS del generador del repositorio (RSA 2048 y 4096). Para cada uno mide los bytes
// UTF-8 del XML firmado, los del base64 que lleva `validarComprobante` y los del sobre SOAP completo
// de la recepción (`receptionEnvelope`, el cuerpo de la petición HTTP, sin sus cabeceras). Mide dos
// perfiles de datos: el típico y el de textos largos (razón social y direcciones cerca de su máximo).
// El certificado real puede ser mayor que el sintético: la cifra exacta se ve en el ensayo offline
// con el P12 real (sección 5 del runbook). La comparación es con la política conservadora de tamaño
// de EmiteYa, PRODUCT_CONSERVATIVE_POLICY_V1, de 40 000 bytes. No es el límite oficial del SRI (Q-47
// resuelta por política de producto).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocumentType } from "@facturador/contracts";
import { TRANSMISSION_SIZE_POLICY } from "../../src/modules/fiscal/domain/transmission-size-policy.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createCreditNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/credit-note-xml-builder.ts";
import { createDebitNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/debit-note-xml-builder.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createInvoiceXmlBuilder } from "../../src/modules/sri-engine/infrastructure/invoice-xml-builder.ts";
import { createPurchaseSettlementXmlBuilder } from "../../src/modules/sri-engine/infrastructure/purchase-settlement-xml-builder.ts";
import { createShippingGuideXmlBuilder } from "../../src/modules/sri-engine/infrastructure/shipping-guide-xml-builder.ts";
import { receptionEnvelope } from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import { createWithholdingReceiptXmlBuilder } from "../../src/modules/sri-engine/infrastructure/withholding-receipt-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, generateP12Fixtures, readFixture } from "../support/p12-fixtures.ts";
import { creditNoteSnapshot } from "../support/ride-credit-notes.ts";
import { debitNoteSnapshot } from "../support/ride-debit-notes.ts";
import {
  BASE_ISSUER,
  COMPANY_BUYER,
  CONSUMER_FINAL,
  LONG_ADDRESS,
  LONG_NAME,
  snapshotOf,
} from "../support/ride-invoices.ts";
import { iva, settlementSnapshot, SUPPLIER } from "../support/ride-purchase-settlements.ts";
import { detail, guideSnapshot } from "../support/ride-shipping-guides.ts";
import { supportTax, withheld, withholdingSnapshot } from "../support/ride-withholdings.ts";

const LIMIT = TRANSMISSION_SIZE_POLICY.limitBytes;

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const validator = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const entries = (
  JSON.parse(
    readFileSync(path("../../src/modules/catalogs/datasets/schema-registry/2.json"), "utf8"),
  ) as { entries: (SchemaRegistryEntry & { documentType?: string; version?: string })[] }
).entries.map((entry) => ({
  ...entry,
  documentType: entry.documentType ?? null,
  version: entry.version ?? null,
  imports: entry.imports ?? [],
}));
const signer = createXmlSigner();
const builders = {
  invoice: createInvoiceXmlBuilder(),
  creditNote: createCreditNoteXmlBuilder(),
  debitNote: createDebitNoteXmlBuilder(),
  guide: createShippingGuideXmlBuilder(),
  withholding: createWithholdingReceiptXmlBuilder(),
  settlement: createPurchaseSettlementXmlBuilder(),
};

type Profile = "típico" | "textos largos";
type Built = { name: string; documentType: DocumentType; version: string; xml: string };

/** Los siete documentos de la sección 7 del runbook, con los datos del perfil. */
function certificationDocuments(profile: Profile): Built[] {
  const long = profile === "textos largos";
  const issuer = long
    ? {
        ...BASE_ISSUER,
        legalName: LONG_NAME,
        tradeName: LONG_NAME.slice(0, 300),
        headOfficeAddress: LONG_ADDRESS,
        establishmentAddress: LONG_ADDRESS,
      }
    : BASE_ISSUER;
  const party = long
    ? { ...COMPANY_BUYER, legalName: LONG_NAME, address: LONG_ADDRESS }
    : COMPANY_BUYER;
  const good = { code: "PRUEBA-BIEN", description: "Bien de PRUEBA, saco de 50 kg" };
  const service = { code: "PRUEBA-SERV", description: "Servicio de PRUEBA, transporte local" };

  const invoiceCf = snapshotOf({
    name: "01-consumidor-final",
    issueDate: "2026-10-09",
    sequential: "000000001",
    environment: "1",
    issuer,
    buyer: CONSUMER_FINAL,
    lines: [{ ...good, quantity: "1", unitPrice: "8.50", discount: "0.00", rateCode: "4" }],
  });
  const invoiceBase = snapshotOf({
    name: "01-comprador-identificado",
    issueDate: "2026-10-09",
    sequential: "000000002",
    environment: "1",
    issuer,
    buyer: party,
    lines: [
      { ...good, quantity: "5", unitPrice: "8.50", discount: "0.00", rateCode: "4" },
      { ...service, quantity: "1", unitPrice: "35.00", discount: "0.00", rateCode: "4" },
    ],
    paymentMethods: ["20"],
  });
  const modified = {
    documentType: "01",
    documentNumber: "001-001-000000002",
    issueDate: "2026-10-09",
  } as const;
  const buyer = {
    identificationType: party.identificationType,
    identification: party.identification,
    legalName: party.legalName,
  };
  const creditNote = {
    ...creditNoteSnapshot({ name: "04", issueDate: "2026-10-09", sequential: "000000001" }),
    issuer,
    buyer,
    modified,
    lines: [
      {
        mainCode: good.code,
        auxiliaryCode: null,
        description: good.description,
        quantity: "2",
        unitPrice: "8.50",
        discount: "0.00",
        taxableBase: "17.00",
        taxes: [{ taxCode: "2", rateCode: "4", rate: "15", base: "17.00", amount: "2.55" }],
      },
    ],
    totals: {
      withoutTaxes: "17.00",
      taxes: [{ taxCode: "2", rateCode: "4", base: "17.00", amount: "2.55" }],
      total: "19.55",
    },
    reason: "Devolución de PRUEBA de dos unidades del bien",
  };
  const debitNote = {
    ...debitNoteSnapshot({ name: "05", issueDate: "2026-10-09", sequential: "000000001" }),
    issuer,
    buyer,
    modified,
    withoutTaxes: "5.00",
    taxes: [{ taxCode: "2", rateCode: "4", rate: "15", base: "5.00", amount: "0.75" }],
    total: "5.75",
    payment: { method: "20", total: "5.75" },
    reasons: [{ reason: "Intereses de mora de PRUEBA", value: "5.00" }],
  };
  const guide = {
    ...guideSnapshot({
      name: "06",
      issueDate: "2026-10-09",
      sequential: "000000001",
      recipients: [
        {
          identification: party.identification,
          legalName: party.legalName,
          address: long ? LONG_ADDRESS : "Av. del Comprador de PRUEBA 45, Quito",
          motive: "Venta",
          destinationEstablishmentCode: null,
          route: null,
          support: {
            documentType: "01",
            documentNumber: modified.documentNumber,
            authorizationNumber: invoiceBase.accessKey,
            issueDate: modified.issueDate,
          },
          details: [detail(good.description, "5", good.code)],
        },
      ],
    }),
    issuer,
    departureAddress: issuer.establishmentAddress ?? issuer.headOfficeAddress,
    carrier: {
      identificationType: "04",
      identification: issuer.ruc,
      legalName: issuer.legalName,
    },
    transportEnd: "2026-10-10",
  };
  const withholding = {
    ...withholdingSnapshot({
      name: "07",
      issueDate: "2026-10-09",
      sequential: "000000001",
      supports: [
        {
          supportCode: "01",
          documentType: "01",
          number: "001002000000123",
          issueDate: "2026-10-05",
          authorizationNumber: "1112223334",
          totalWithoutTaxes: "100.00",
          importTotal: "115.00",
          taxes: [supportTax("2", "4", "15", "100.00", "15.00")],
          withholdings: [
            withheld("1", "312", "100.00", "2", "2.00"),
            withheld("2", "1", "15.00", "30", "4.50"),
          ],
          payments: [{ method: "01", total: "115.00" }],
        },
      ],
    }),
    issuer,
    subject: {
      identificationType: "04",
      identification: party.identification,
      legalName: party.legalName,
    },
  };
  const settlement = settlementSnapshot({
    name: "03",
    issueDate: "2026-10-09",
    sequential: "000000001",
    supplier: long ? { ...SUPPLIER, legalName: LONG_NAME, address: LONG_ADDRESS } : SUPPLIER,
    lines: [
      {
        mainCode: null,
        auxiliaryCode: null,
        description: "Producto agrícola de PRUEBA",
        unit: "quintal",
        quantity: "4",
        unitPrice: "12.50",
        discount: "0.00",
        taxableBase: "50.00",
        tax: iva("4", "15", "50.00", "7.50"),
      },
    ],
    totals: {
      withoutTaxes: "50.00",
      discount: "0.00",
      taxes: [iva("4", "15", "50.00", "7.50")],
      total: "57.50",
    },
    payments: [{ method: "01", total: "57.50", term: "0", timeUnit: "dias" }],
  });

  return [
    {
      name: "01 consumidor final",
      documentType: "01",
      version: "1.1.0",
      xml: builders.invoice.build(invoiceCf),
    },
    {
      name: "01 comprador identificado",
      documentType: "01",
      version: "1.1.0",
      xml: builders.invoice.build(invoiceBase),
    },
    {
      name: "04 nota de crédito",
      documentType: "04",
      version: "1.1.0",
      xml: builders.creditNote.build({ ...creditNote, issuer: { ...creditNote.issuer } }),
    },
    {
      name: "05 nota de débito",
      documentType: "05",
      version: "1.0.0",
      xml: builders.debitNote.build(debitNote),
    },
    {
      name: "06 guía de remisión",
      documentType: "06",
      version: "1.1.0",
      xml: builders.guide.build(guide),
    },
    {
      name: "07 retención",
      documentType: "07",
      version: "2.0.0",
      xml: builders.withholding.build(withholding),
    },
    {
      name: "03 liquidación de compra",
      documentType: "03",
      version: "1.1.0",
      xml: builders.settlement.build({ ...settlement, issuer }),
    },
  ];
}

const work = mkdtempSync(join(tmpdir(), "facturador-cert-payloads-"));
try {
  generateP12Fixtures(work);
  const keys = [
    ["RSA 2048", "sd-utf8.modern.p12"],
    ["RSA 4096", "rsa4096.modern.p12"],
  ] as const;
  const rows: Record<string, string | number>[] = [];
  for (const profile of ["típico", "textos largos"] as const) {
    for (const document of certificationDocuments(profile)) {
      const schema = registeredSchema(entries, document.documentType, document.version);
      if (!schema)
        throw new Error(`sin XSD registrado para ${document.documentType} ${document.version}`);
      const result = await validator.validate(document.xml, schema);
      if (!("valid" in result) || result.valid !== true)
        throw new Error(`${document.name} (${profile}) no valida: ${JSON.stringify(result)}`);
      for (const [key, file] of keys) {
        const signed = Buffer.from(
          await signer.sign({
            xml: document.xml,
            documentType: document.documentType,
            p12: readFixture(work, file),
            password: FIXTURE_PASSWORD,
          }),
          "utf8",
        );
        const base64 = signed.toString("base64").length;
        const certificate =
          /<(?:ds:)?X509Certificate>([^<]+)</.exec(signed.toString("utf8"))?.[1] ?? "";
        const soap = receptionEnvelope(signed).length;
        rows.push({
          documento: document.name,
          perfil: profile,
          clave: key,
          signedXmlUtf8Bytes: signed.length,
          base64PayloadBytes: base64,
          completeSoapRequestBytes: soap,
          margenAlLimite: LIMIT - Math.max(signed.length, base64, soap),
          certificadoDerBytes: Buffer.from(certificate.replace(/\s+/g, ""), "base64").length,
        });
      }
    }
  }
  console.table(rows);
  const max = Math.max(...rows.map((r) => Number(r.completeSoapRequestBytes)));
  // Un byte más del certificado embebido suma 4/3 en el XML (base64) y 16/9 en el SOAP: hasta dónde
  // puede crecer el certificado real respecto del sintético antes de alcanzar el límite.
  const tolerance = Math.floor(((LIMIT - 1 - max) * 9) / 16);
  console.log(
    JSON.stringify({
      sizePolicy: TRANSMISSION_SIZE_POLICY.id,
      limitBytes: LIMIT,
      maxObservedBytes: max,
      margin: LIMIT - max,
      extraCertificateDerBytesTolerated: tolerance,
      allBelow: rows.every((r) => Number(r.margenAlLimite) > 0),
      rows,
    }),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
