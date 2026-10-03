// Adaptador AccessKeys sobre generateClaveAcceso de facturacion-electronica-ec (ADR 0018,
// add-invoice-emission design D12). El código numérico lo genera la aplicación con
// crypto.randomInt: generateCodigoNumerico de la librería cae a Math.random si no encuentra
// `crypto` (spike S-3). Los datos se validan aquí antes de llamar a la librería, cuyo mensaje de
// error repite los valores y no sale de este archivo.
import { randomInt } from "node:crypto";
import { generateClaveAcceso } from "facturacion-electronica-ec";
import { AccessKeyInputError, type AccessKeyInput, type AccessKeys } from "../application/ports.ts";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELDS: Record<Exclude<keyof AccessKeyInput, "issueDate">, RegExp> = {
  documentType: /^\d{2}$/,
  ruc: /^\d{13}$/,
  environment: /^[12]$/,
  establishment: /^\d{3}$/,
  emissionPoint: /^\d{3}$/,
  sequential: /^\d{9}$/,
  numericCode: /^\d{8}$/,
};

export function createAccessKeys(): AccessKeys {
  return {
    numericCode: () => String(randomInt(0, 100_000_000)).padStart(8, "0"),

    compose(input: AccessKeyInput): string {
      const date = ISO_DATE.exec(input.issueDate);
      const valid =
        date !== null &&
        (Object.keys(FIELDS) as (keyof typeof FIELDS)[]).every((field) =>
          FIELDS[field].test(input[field]),
        );
      if (!valid) throw new AccessKeyInputError();
      let key: string;
      try {
        key = generateClaveAcceso({
          fechaEmision: `${date[3]}/${date[2]}/${date[1]}`,
          tipoComprobante: input.documentType,
          ruc: input.ruc,
          ambiente: input.environment,
          establecimiento: input.establishment,
          puntoEmision: input.emissionPoint,
          secuencial: input.sequential,
          codigoNumerico: input.numericCode,
          // Fuera de línea, el tipo de emisión es siempre normal (CTX §8.2).
          tipoEmision: "1",
        });
      } catch {
        throw new AccessKeyInputError();
      }
      if (!/^\d{49}$/.test(key)) throw new AccessKeyInputError();
      return key;
    },
  };
}
