// Clasificación de la consulta de validez (add-sri-transmission, tarea 6.3, design D15) sobre
// respuestas SINTÉTICAS con la estructura del WSDL oficial y de los ejemplos de la ficha v2.34,
// §8.2.3. Un estado informado muestra la clave conocida; el error 99 y lo demás no aportan evidencia.
import { describe, expect, it } from "vitest";
import { classifyValidity } from "../../src/modules/sri-engine/infrastructure/validity-classifier.ts";
import { failure, response, soapFault, validityResponse } from "../support/sri-responses.ts";

const KEY = "2111202405176001321000110010010000001241234567810";

describe("clasificación de la consulta de validez", () => {
  it("cada estado informado para la clave la muestra conocida", () => {
    for (const estado of ["AUTORIZADO", "NO AUTORIZADO", "PENDIENTE DE ANULAR", "ANULADO"]) {
      expect(
        classifyValidity(
          response(validityResponse({ accessKey: KEY, estadoAutorizacion: estado })),
          KEY,
        ),
      ).toMatchObject({ outcome: "KEY_KNOWN", state: estado });
    }
  });

  it("fuera de rango o sin datos (estadoConsulta RECHAZADA, error 99) no aporta evidencia", () => {
    for (const additionalInformation of [
      "No es posible validar la clave de acceso ya que la fecha de emisión está fuera del rango permitido.",
      "No existen datos para los parámetros ingresados",
    ]) {
      const result = classifyValidity(
        response(
          validityResponse({
            accessKey: KEY,
            estadoConsulta: "RECHAZADA",
            messages: [
              {
                identifier: "99",
                message: "ERROR AL CONSULTAR DATOS DEL SERVICIO WEB",
                additionalInformation,
              },
            ],
          }),
        ),
        KEY,
      );
      expect(result).toMatchObject({
        outcome: "NO_EVIDENCE",
        state: null,
        parsed: { reason: "QUERY_REJECTED" },
      });
      expect(result.messages[0]).toMatchObject({ identifier: "99", additionalInformation });
    }
    // El texto de la ficha nombra estadoAutorizacion para el mismo caso.
    expect(
      classifyValidity(
        response(validityResponse({ accessKey: KEY, estadoAutorizacion: "RECHAZADA" })),
        KEY,
      ).outcome,
    ).toBe("NO_EVIDENCE");
    expect(
      classifyValidity(
        response(
          validityResponse({ accessKey: KEY, messages: [{ identifier: "99", message: "x" }] }),
        ),
        KEY,
      ).parsed.reason,
    ).toBe("ERROR_99");
  });

  it("un estado desconocido, otra clave o una respuesta técnica no aportan evidencia", () => {
    const reason = (outcome: Parameters<typeof classifyValidity>[0]) => {
      const result = classifyValidity(outcome, KEY);
      expect(result.outcome).toBe("NO_EVIDENCE");
      return result.parsed.reason;
    };
    expect(
      reason(response(validityResponse({ accessKey: KEY, estadoAutorizacion: "EN TRÁMITE" }))),
    ).toBe("UNKNOWN_STATE");
    expect(
      reason(
        response(
          validityResponse({
            accessKey: KEY.replace("21112024", "21112025"),
            estadoAutorizacion: "AUTORIZADO",
          }),
        ),
      ),
    ).toBe("ACCESS_KEY_MISMATCH");
    expect(reason(response(soapFault()))).toBe("SOAP_FAULT");
    expect(reason(response("<html/>"))).toBe("NOT_SOAP");
    expect(reason(failure("CONNECTION_LOST"))).toBe("CONNECTION_LOST");
    expect(reason(failure("NOT_SENT"))).toBe("NOT_SENT");
  });
});
