// Presentación del correo de los comprobantes (add-email-delivery, tarea 8.2, design D14): cada
// estado tiene texto, variante e icono propios, «Enviado» es la aceptación del servidor y una
// dirección sin resultado espera su intento.
import { EMAIL_DELIVERY_STATUSES } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import {
  EMAIL_ATTEMPT_OUTCOME_LABELS,
  EMAIL_SECURITY_DEFAULT_PORTS,
  EMAIL_STATUS_PRESENTATION,
  recipientOutcomeLabel,
} from "@/features/email/email-format";

describe("presentación del correo", () => {
  it("cada estado del contrato tiene su texto, su variante y su icono, sin repetir textos", () => {
    const labels = EMAIL_DELIVERY_STATUSES.map((status) => {
      const presentation = EMAIL_STATUS_PRESENTATION[status];
      expect(presentation.icon).toBeDefined();
      return presentation.label;
    });
    expect(new Set(labels).size).toBe(EMAIL_DELIVERY_STATUSES.length);
    expect(EMAIL_STATUS_PRESENTATION.SENT).toMatchObject({ label: "Enviado", variant: "success" });
    expect(EMAIL_STATUS_PRESENTATION.FAILED).toMatchObject({
      label: "No enviado",
      variant: "destructive",
    });
  });

  it("una dirección sin resultado está pendiente, y un intento aceptado lo dice del servidor", () => {
    expect(recipientOutcomeLabel("ACCEPTED")).toBe("Aceptada");
    expect(recipientOutcomeLabel("REJECTED")).toBe("Rechazada");
    expect(recipientOutcomeLabel(null)).toBe("Pendiente");
    expect(EMAIL_ATTEMPT_OUTCOME_LABELS.SENT).toBe("Aceptado por el servidor");
  });

  it("cada cifrado propone su puerto habitual", () => {
    expect(EMAIL_SECURITY_DEFAULT_PORTS).toEqual({ TLS: 465, STARTTLS: 587, NONE: 1025 });
  });
});
