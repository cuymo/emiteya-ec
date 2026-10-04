// Clasificación de la autorización (add-sri-transmission, tarea 6.2, design D12 y D16) sobre
// respuestas SINTÉTICAS con la estructura oficial (test/support/sri-responses.ts).
import { describe, expect, it } from "vitest";
import {
  classifyAuthorization,
  parseAuthorizationDate,
  type AuthorizationExpectation,
} from "../../src/modules/sri-engine/infrastructure/authorization-classifier.ts";
import {
  authorizationResponse,
  failure,
  response,
  soapFault,
  type SyntheticAuthorization,
} from "../support/sri-responses.ts";

const KEY = "0410202601179001234500110010010000000011234567813";
const OTHER = "0410202601179001234500110010010000000021234567810";
const SIGNED = `<?xml version="1.0" encoding="UTF-8"?>\n<factura id="comprobante" version="1.1.0"><infoTributaria><claveAcceso>${KEY}</claveAcceso><razonSocial>Peña &amp; Cía</razonSocial></infoTributaria></factura>`;
const TEST: AuthorizationExpectation = { accessKey: KEY, environment: "TEST" };
const authorized = (overrides: Partial<SyntheticAuthorization> = {}): SyntheticAuthorization => ({
  estado: "AUTORIZADO",
  numeroAutorizacion: KEY,
  fechaAutorizacion: "2026-10-04T10:15:30.123-05:00",
  ambiente: "PRUEBAS",
  comprobante: `<![CDATA[${SIGNED}]]>`,
  messages: [
    {
      identifier: "60",
      message: "ESTE PROCESO FUE REALIZADO EN EL AMBIENTE DE PRUEBAS",
      type: "ADVERTENCIA",
    },
  ],
  ...overrides,
});
const classify = (
  authorizations: SyntheticAuthorization[],
  queried: string | null = KEY,
  expected = TEST,
) => classifyAuthorization(response(authorizationResponse(queried, authorizations)), expected);

describe("clasificación de la autorización", () => {
  it("un AUTORIZADO válido trae el número, la fecha, el ambiente y el XML autorizado exacto", () => {
    const result = classify([authorized()]);
    expect(result.outcome).toBe("AUTHORIZED");
    expect(result.authorization).toMatchObject({
      number: KEY,
      dateText: "2026-10-04T10:15:30.123-05:00",
      environment: "TEST",
    });
    expect(result.authorization!.date.toISOString()).toBe("2026-10-04T15:15:30.123Z");
    expect(result.authorization!.authorizedXml!.equals(Buffer.from(SIGNED, "utf8"))).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it("el XML autorizado escapado se decodifica; sin XML la autorización vale igual", () => {
    const escaped = SIGNED.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    expect(
      classify([authorized({ comprobante: escaped })]).authorization!.authorizedXml!.toString(),
    ).toBe(SIGNED);
    const withoutXml = classify([authorized({ comprobante: undefined })]);
    expect(withoutXml.outcome).toBe("AUTHORIZED");
    expect(withoutXml.authorization!.authorizedXml).toBeNull();
  });

  it("la fecha en dd/MM/yyyy es la hora de Ecuador; una ilegible es inconsistente", () => {
    expect(parseAuthorizationDate("04/10/2026 10:15:30")?.toISOString()).toBe(
      "2026-10-04T15:15:30.000Z",
    );
    expect(parseAuthorizationDate("31/02/2026 10:00:00")).toBeNull();
    expect(parseAuthorizationDate("2026-10-04 10:15")).toBeNull();
    expect(classify([authorized({ fechaAutorizacion: "ayer" })])).toMatchObject({
      outcome: "INCONSISTENT",
      parsed: { reason: "UNREADABLE_AUTHORIZATION_DATE" },
    });
  });

  it("el ambiente se normaliza sin tildes y debe ser el del comprobante", () => {
    expect(
      classify([authorized({ ambiente: "PRODUCCIÓN" })], KEY, {
        accessKey: KEY,
        environment: "PRODUCTION",
      }).outcome,
    ).toBe("AUTHORIZED");
    expect(classify([authorized({ ambiente: "PRODUCCIÓN" })])).toMatchObject({
      outcome: "INCONSISTENT",
      parsed: { reason: "ENVIRONMENT_MISMATCH" },
    });
  });

  it("un número ausente o distinto de la clave, o un XML de otra clave, es inconsistente", () => {
    expect(classify([authorized({ numeroAutorizacion: OTHER })]).parsed.reason).toBe(
      "AUTHORIZATION_NUMBER_MISMATCH",
    );
    expect(classify([authorized({ numeroAutorizacion: undefined })]).parsed.reason).toBe(
      "MISSING_AUTHORIZATION_NUMBER",
    );
    expect(
      classify([authorized({ comprobante: `<![CDATA[${SIGNED.replace(KEY, OTHER)}]]>` })]).parsed
        .reason,
    ).toBe("AUTHORIZED_XML_KEY_MISMATCH");
  });

  it("NO AUTORIZADO y RECHAZADO (el ejemplo oficial) son el estado no autorizado, con sus mensajes", () => {
    for (const estado of ["NO AUTORIZADO", "RECHAZADO"]) {
      const result = classify([
        {
          estado,
          fechaAutorizacion: "2026-10-04T10:00:00-05:00",
          ambiente: "PRUEBAS",
          messages: [{ identifier: "46", message: " RUC no existe " }],
        },
      ]);
      expect(result.outcome).toBe("NOT_AUTHORIZED");
      expect(result.messages).toEqual([
        {
          identifier: "46",
          message: " RUC no existe ",
          additionalInformation: null,
          type: "ERROR",
        },
      ]);
    }
    expect(classify([{ estado: "RECHAZADO", ambiente: "PRODUCCION" }])).toMatchObject({
      outcome: "INCONSISTENT",
      parsed: { reason: "ENVIRONMENT_MISMATCH" },
    });
  });

  it("un estado desconocido o en procesamiento no concluye", () => {
    for (const estado of ["EN PROCESO", "PPR", ""]) {
      expect(classify([{ estado, ambiente: "PRUEBAS" }])).toMatchObject({
        outcome: "NO_CONCLUSION",
        cause: "SRI",
      });
    }
  });

  it("una clave desconocida es KEY_UNKNOWN; una clave consultada distinta es inconsistente", () => {
    expect(classifyAuthorization(response(authorizationResponse(KEY, [], "0")), TEST).outcome).toBe(
      "KEY_UNKNOWN",
    );
    expect(classify([authorized()], OTHER)).toMatchObject({
      outcome: "INCONSISTENT",
      parsed: { reason: "QUERIED_KEY_MISMATCH" },
    });
    expect(
      classifyAuthorization(response(authorizationResponse(null, [], "0")), TEST),
    ).toMatchObject({
      outcome: "NO_CONCLUSION",
      cause: "SRI",
    });
  });

  it("varias autorizaciones: una sola AUTORIZADO válida concluye; cualquier otra combinación no", () => {
    const rejected = { estado: "RECHAZADO", ambiente: "PRUEBAS" };
    expect(classify([rejected, authorized()]).outcome).toBe("AUTHORIZED");
    expect(classify([authorized(), authorized()]).parsed.reason).toBe("SEVERAL_AUTHORIZED");
    expect(classify([rejected, { ...rejected, estado: "NO AUTORIZADO" }]).parsed.reason).toBe(
      "SEVERAL_WITHOUT_AUTHORIZED",
    );
    expect(classify([rejected, authorized({ ambiente: "PRODUCCION" })]).outcome).toBe(
      "INCONSISTENT",
    );
  });

  it("claves con los espacios y saltos del ejemplo de la ficha se comparan sin ellos", () => {
    const pretty = authorizationResponse(`\n   ${KEY}\n   `, [
      authorized({ numeroAutorizacion: `\n ${KEY}\n` }),
    ]);
    expect(classifyAuthorization(response(pretty), TEST).outcome).toBe("AUTHORIZED");
  });

  it("un fallo técnico no concluye y no cuenta como respuesta del SRI", () => {
    for (const outcome of [
      failure("NOT_SENT"),
      failure("REQUEST_TIMEOUT"),
      response("<html/>"),
      response(soapFault(), 500),
      response(""),
    ]) {
      expect(classifyAuthorization(outcome, TEST)).toMatchObject({
        outcome: "NO_CONCLUSION",
        cause: "TECHNICAL",
        authorization: null,
      });
    }
  });
});
