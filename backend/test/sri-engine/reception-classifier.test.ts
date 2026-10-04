// Clasificación de la recepción (add-sri-transmission, tarea 6.1, design D11 y D13) sobre
// respuestas SINTÉTICAS con la estructura oficial (test/support/sri-responses.ts).
import { describe, expect, it } from "vitest";
import { classifyReception } from "../../src/modules/sri-engine/infrastructure/reception-classifier.ts";
import { failure, receptionResponse, response, soapFault } from "../support/sri-responses.ts";

const KEY = "0410202601179001234500110010010000000011234567813";
const OTHER = "0410202601179001234500110010010000000021234567810";
const devuelta = (
  ...messages: {
    identifier: string;
    message: string;
    additionalInformation?: string;
    type?: string;
  }[]
) => response(receptionResponse("DEVUELTA", [{ accessKey: KEY, messages }]));

describe("clasificación de la recepción", () => {
  it("RECIBIDA es la recepción", () => {
    expect(classifyReception(response(receptionResponse("RECIBIDA")), KEY)).toMatchObject({
      outcome: "RECEIVED",
      messages: [],
    });
  });

  it("un DEVUELTA concluyente conserva todos sus mensajes, en orden, con los códigos desconocidos", () => {
    const result = classifyReception(
      devuelta(
        {
          identifier: "35",
          message: "DOCUMENTO INVÁLIDO",
          additionalInformation: "Se encontró el siguiente error en la estructura del comprobante",
        },
        { identifier: "999", message: "CÓDIGO NUEVO", type: "ADVERTENCIA" },
      ),
      KEY,
    );
    expect(result.outcome).toBe("RETURNED");
    expect(result.messages).toEqual([
      {
        identifier: "35",
        message: "DOCUMENTO INVÁLIDO",
        additionalInformation: "Se encontró el siguiente error en la estructura del comprobante",
        type: "ERROR",
      },
      {
        identifier: "999",
        message: "CÓDIGO NUEVO",
        additionalInformation: null,
        type: "ADVERTENCIA",
      },
    ]);
  });

  it("los errores 70, 43 y 45 no son una devolución concluyente", () => {
    const of = (identifier: string) =>
      classifyReception(devuelta({ identifier, message: "x" }), KEY).outcome;
    expect(of("70")).toBe("KEY_IN_PROCESS");
    expect(of("43")).toBe("KEY_REGISTERED");
    expect(of("45")).toBe("SEQUENTIAL_REGISTERED");
    expect(
      classifyReception(
        devuelta({ identifier: "45", message: "x" }, { identifier: "70", message: "y" }),
        KEY,
      ).outcome,
    ).toBe("KEY_IN_PROCESS");
    expect(classifyReception(devuelta({ identifier: " 43 ", message: "z" }), KEY).outcome).toBe(
      "KEY_REGISTERED",
    );
  });

  it("sin estado, con un estado desconocido o un DEVUELTA sin mensajes no se concluye", () => {
    expect(classifyReception(response(receptionResponse(null)), KEY)).toMatchObject({
      outcome: "UNKNOWN",
      parsed: { reason: "MISSING_STATE" },
    });
    expect(classifyReception(response(receptionResponse("EN COLA")), KEY)).toMatchObject({
      outcome: "UNKNOWN",
      parsed: { reason: "UNKNOWN_STATE" },
    });
    expect(classifyReception(response(receptionResponse("DEVUELTA")), KEY)).toMatchObject({
      outcome: "UNKNOWN",
      parsed: { reason: "RETURNED_WITHOUT_MESSAGES" },
    });
  });

  it("Fault, HTML, cuerpo vacío, XML ilegible, DTD, HTTP sin éxito y respuesta cortada son inciertos", () => {
    const reason = (outcome: Parameters<typeof classifyReception>[0]) => {
      const result = classifyReception(outcome, KEY);
      expect(result.outcome).toBe("UNKNOWN");
      return result.parsed.reason;
    };
    expect(reason(response(soapFault(), 500))).toBe("HTTP_STATUS");
    expect(reason(response(soapFault()))).toBe("SOAP_FAULT");
    expect(reason(response("<html><body>Servicio no disponible</body></html>"))).toBe("NOT_SOAP");
    expect(reason(response(""))).toBe("EMPTY");
    expect(reason(response("<soap:Envelope><soap:Body>"))).toBe("MALFORMED");
    expect(
      reason(response('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "RECIBIDA">]><x>&a;</x>')),
    ).toBe("DTD");
    expect(reason(response(receptionResponse("RECIBIDA"), 200, true))).toBe("TRUNCATED");
    expect(reason(response(receptionResponse("RECIBIDA"), 503))).toBe("HTTP_STATUS");
  });

  it("una clave distinta de la del comprobante es una inconsistencia", () => {
    const result = classifyReception(
      response(
        receptionResponse("DEVUELTA", [
          { accessKey: OTHER, messages: [{ identifier: "35", message: "x" }] },
        ]),
      ),
      KEY,
    );
    expect(result).toMatchObject({
      outcome: "INCONSISTENT",
      parsed: { reason: "ACCESS_KEY_MISMATCH" },
    });
  });

  it("NOT_SENT no salió; los demás fallos de transporte son inciertos sin pasar por el parser", () => {
    expect(classifyReception(failure("NOT_SENT"), KEY)).toEqual({
      outcome: "NOT_SENT",
      messages: [],
      parsed: { errorCode: "ECONNREFUSED" },
    });
    for (const kind of ["REQUEST_TIMEOUT", "BODY_TIMEOUT", "CONNECTION_LOST"] as const) {
      expect(classifyReception(failure(kind), KEY)).toMatchObject({
        outcome: "UNKNOWN",
        parsed: { reason: kind },
      });
    }
  });
});
