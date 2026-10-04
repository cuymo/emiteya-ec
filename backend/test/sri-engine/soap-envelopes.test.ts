// Sobres SOAP del SRI byte a byte (add-sri-transmission, tarea 5.3, design D10): los espacios de
// nombres y elementos de los WSDL oficiales y de la ficha v2.34 (§7.2.3 y §8.2.3).
import { describe, expect, it } from "vitest";
import {
  authorizationEnvelope,
  receptionEnvelope,
  validityEnvelope,
} from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";

const KEY = "0211202401050306179800120010020000000677300995216";
const HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"';
const withoutWhitespaceBetweenTags = (xml: string) => xml.replace(/>\s+</g, "><").trim();

describe("sobres SOAP del SRI", () => {
  it("validarComprobante lleva el base64 de los bytes firmados exactos", () => {
    const signed = Buffer.concat([
      Buffer.from('<?xml version="1.0" encoding="UTF-8"?><factura>Peña & Cía</factura>'),
      Buffer.from([0x00, 0xff, 0xfe, 0x0a]),
    ]);
    const envelope = receptionEnvelope(signed);
    expect(envelope.toString("utf8")).toBe(
      `${HEAD} xmlns:ec="http://ec.gob.sri.ws.recepcion"><soapenv:Header/><soapenv:Body>` +
        `<ec:validarComprobante><xml>${signed.toString("base64")}</xml></ec:validarComprobante>` +
        "</soapenv:Body></soapenv:Envelope>",
    );
    const base64 = /<xml>([^<]+)<\/xml>/.exec(envelope.toString("utf8"))![1]!;
    expect(Buffer.from(base64, "base64").equals(signed)).toBe(true);
  });

  it("autorizacionComprobante lleva la clave en claveAccesoComprobante", () => {
    expect(authorizationEnvelope(KEY).toString("utf8")).toBe(
      `${HEAD} xmlns:ec="http://ec.gob.sri.ws.autorizacion"><soapenv:Header/><soapenv:Body>` +
        `<ec:autorizacionComprobante><claveAccesoComprobante>${KEY}</claveAccesoComprobante></ec:autorizacionComprobante>` +
        "</soapenv:Body></soapenv:Envelope>",
    );
  });

  it("consultarEstadoAutorizacionComprobante es el ejemplo oficial de la ficha v2.34, §8.2.3", () => {
    // Transcripción literal del ejemplo de la ficha (página 21), con la clave del ejemplo.
    const official = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
      xmlns:ec="http://ec.gob.sri.ws.consultas">
       <soapenv:Header/>
       <soapenv:Body>
         <ec:consultarEstadoAutorizacionComprobante>
      <claveAcceso>0211202401050306179800120010020000000677300995216</claveAcceso>
         </ec:consultarEstadoAutorizacionComprobante>
       </soapenv:Body>
      </soapenv:Envelope>`;
    const built = validityEnvelope(KEY).toString("utf8");
    expect(built.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(built.split("\n")[1]).toBe(
      withoutWhitespaceBetweenTags(official).replace(/"\s+xmlns:ec/, '" xmlns:ec'),
    );
  });

  it("una clave que no son 49 dígitos no entra en ningún sobre", () => {
    for (const key of [
      "",
      "123",
      `${KEY}0`,
      "<claveAcceso>x</claveAcceso>",
      KEY.replace("0", "a"),
    ]) {
      expect(() => authorizationEnvelope(key)).toThrow(/49 dígitos/);
      expect(() => validityEnvelope(key)).toThrow(/49 dígitos/);
    }
  });
});
