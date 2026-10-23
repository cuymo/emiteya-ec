import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  composeMessage,
  messageIdOf,
  verifiedBytes,
  type MessageDocument,
} from "../../src/modules/email/domain/message.ts";

// Contenido del correo (add-email-delivery, design D4; spec email-delivery, «Contenido del correo»).
const ACCESS_KEY = "2310202601179001234500110010010000001231234567811";
const invoice: MessageDocument = {
  documentType: "01",
  documentNumber: "001-001-000000123",
  issueDate: "2026-10-23",
  accessKey: ACCESS_KEY,
  authorizationNumber: ACCESS_KEY,
  environment: "PRODUCTION",
  issuerName: "Ferretería Andina",
  receiverName: "Comercial Andina S.A.",
  total: "115.00",
};

describe("mensaje del comprobante", () => {
  it("el asunto lleva el tipo, el número y la razón social; los adjuntos, la clave de acceso", () => {
    const message = composeMessage(invoice);
    expect(message.subject).toBe("Factura 001-001-000000123 de Ferretería Andina");
    expect(message.attachments).toEqual([
      { filename: `${ACCESS_KEY}.xml`, contentType: "application/xml" },
      { filename: `${ACCESS_KEY}.pdf`, contentType: "application/pdf" },
    ]);
  });

  it("el cuerpo resume el comprobante y dice que es su entrega", () => {
    const { text } = composeMessage(invoice);
    for (const fragment of [
      "Ferretería Andina le envía su factura electrónica.",
      "Número: 001-001-000000123",
      "Fecha de emisión: 23/10/2026",
      "Receptor: Comercial Andina S.A.",
      "Importe total: USD 115.00",
      `Número de autorización: ${ACCESS_KEY}`,
      "artículo 6 de la Resolución NAC-DGERCGC18-00000233",
    ]) {
      expect(text).toContain(fragment);
    }
    expect(text).not.toContain("Pruebas");
  });

  it("la guía de remisión no tiene total ni un receptor único", () => {
    const guide = composeMessage({
      ...invoice,
      documentType: "06",
      receiverName: null,
      total: null,
    });
    expect(guide.subject).toBe("Guía de remisión 001-001-000000123 de Ferretería Andina");
    expect(guide.text).not.toContain("Importe total");
    expect(guide.text).not.toContain("Receptor:");
  });

  it("cada tipo con su nombre", () => {
    const names = (["03", "04", "05", "07"] as const).map(
      (documentType) => composeMessage({ ...invoice, documentType }).subject.split(" 001")[0],
    );
    expect(names).toEqual([
      "Liquidación de compra",
      "Nota de crédito",
      "Nota de débito",
      "Comprobante de retención",
    ]);
  });

  it("en Pruebas, el asunto y el cuerpo llevan la marca sin validez tributaria", () => {
    const message = composeMessage({ ...invoice, environment: "TEST" });
    expect(message.subject).toBe(
      "PRUEBAS – sin validez tributaria · Factura 001-001-000000123 de Ferretería Andina",
    );
    expect(message.text.startsWith("Comprobante del ambiente de Pruebas del SRI")).toBe(true);
    expect(message.html).toContain("no tiene validez tributaria");
  });

  it("escapa el HTML y no deja saltos de línea en el asunto", () => {
    const message = composeMessage({
      ...invoice,
      issuerName: "Andina <script>alert(1)</script>\r\nBcc: x@y.ec",
      receiverName: 'Tom & "Jerry"',
    });
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("Tom &amp; &quot;Jerry&quot;");
  });

  it("el Message-ID es el mismo para cada intento del mismo envío", () => {
    expect(messageIdOf("d-1", "facturas@andina.ec")).toBe("<envio-d-1@andina.ec>");
    expect(messageIdOf("d-1", "facturas@andina.ec")).toBe(messageIdOf("d-1", "facturas@andina.ec"));
  });

  it("un adjunto que falta o no coincide con su tamaño o su hash impide el envío", () => {
    const content = Buffer.from("<factura/>");
    const artifact = {
      content: new Uint8Array(content),
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    expect(verifiedBytes(artifact)?.equals(content)).toBe(true);
    expect(verifiedBytes(null)).toBeNull();
    expect(verifiedBytes({ ...artifact, sizeBytes: 3 })).toBeNull();
    expect(verifiedBytes({ ...artifact, sha256: "0".repeat(64) })).toBeNull();
    const altered = new Uint8Array(content);
    altered[0] = 0x21;
    expect(verifiedBytes({ ...artifact, content: altered })).toBeNull();
  });
});
