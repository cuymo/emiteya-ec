// Presentación canónica del estado de los comprobantes (productize-invoice-list-and-shared-table-
// foundation, design D12, tarea 6.1; decisión PO-1). Las aserciones son semánticas: la variante
// (`data-variant`), el texto del glosario y el nombre accesible, no clases de color.
import { INVOICE_STATE_LABELS, type InvoiceState } from "@facturador/contracts";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AttentionMarker,
  DOCUMENT_STATE_PRESENTATION,
  DocumentStatusBadge,
  SEND_UNKNOWN_HELP,
  StateCell,
  requiresAttention,
} from "@/features/documents/document-status-badge";
import { renderApp } from "./harness";

const variantOf = (state: InvoiceState) => {
  const { container, unmount } = renderApp(<DocumentStatusBadge state={state} />);
  const badge = container.querySelector(`[data-document-state=${state}]`);
  const result = { variant: badge?.getAttribute("data-variant"), text: badge?.textContent };
  unmount();
  return result;
};

describe("DocumentStatusBadge (D12, PO-1)", () => {
  it("presenta cada estado con la variante aprobada y el texto del glosario", () => {
    const expected: Record<InvoiceState, string> = {
      RESERVED: "info",
      SIGNED: "info",
      SEND_UNKNOWN: "info",
      RECEIVED: "info",
      AUTHORIZED: "success",
      RETURNED: "destructive",
      NOT_AUTHORIZED: "destructive",
      MANUAL_REVIEW: "warning",
    };
    for (const state of Object.keys(expected) as InvoiceState[]) {
      const { variant, text } = variantOf(state);
      expect(variant, state).toBe(expected[state]);
      expect(text, state).toBe(INVOICE_STATE_LABELS[state]);
    }
  });

  it("«Verificando con el SRI» nunca se presenta como rechazo", () => {
    const { variant, text } = variantOf("SEND_UNKNOWN");
    expect(variant).not.toBe("destructive");
    expect(text).toBe("Verificando con el SRI");
    expect(text).not.toMatch(/rechaz|error|fall/i);
  });

  it("«Requiere revisión» es advertencia y «Autorizado» es éxito", () => {
    expect(variantOf("MANUAL_REVIEW").variant).toBe("warning");
    expect(variantOf("AUTHORIZED").variant).toBe("success");
    expect(variantOf("RETURNED").variant).toBe("destructive");
    expect(variantOf("NOT_AUTHORIZED").variant).toBe("destructive");
  });

  it("cada estado lleva icono además del color", () => {
    for (const state of Object.keys(DOCUMENT_STATE_PRESENTATION) as InvoiceState[]) {
      const { container, unmount } = renderApp(<DocumentStatusBadge state={state} />);
      expect(container.querySelector(`[data-document-state=${state}] svg`), state).not.toBeNull();
      unmount();
    }
  });

  it("explica «Verificando con el SRI» con una ayuda accesible, sin un párrafo visible", () => {
    renderApp(<DocumentStatusBadge state="SEND_UNKNOWN" />);
    const help = screen.getByRole("button", { name: "Qué significa «Verificando con el SRI»" });
    expect(help.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(help.getAttribute("aria-describedby")!)?.textContent).toBe(
      SEND_UNKNOWN_HELP,
    );
    fireEvent.click(help);
    expect(screen.getAllByText(SEND_UNKNOWN_HELP).length).toBeGreaterThan(1);
  });

  it("los demás estados no tienen ayuda", () => {
    renderApp(<DocumentStatusBadge state="RETURNED" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("StateCell (fachada) e indicadores", () => {
  it("la transmisión detenida es un indicador aparte y no cambia el estado fiscal", () => {
    const { container } = renderApp(<StateCell state="SIGNED" stopped />);
    expect(
      container.querySelector("[data-document-state=SIGNED]")?.getAttribute("data-variant"),
    ).toBe("info");
    const stopped = screen.getByText("Transmisión detenida");
    expect(stopped.closest("[data-slot=badge]")?.getAttribute("data-variant")).toBe("warning");
  });

  it("sin transmisión detenida solo muestra el estado", () => {
    renderApp(<StateCell state="AUTHORIZED" />);
    expect(screen.queryByText("Transmisión detenida")).toBeNull();
  });

  it("«Requiere atención» sigue la regla del servidor sin ampliarla", () => {
    expect(requiresAttention({ state: "SEND_UNKNOWN", transmissionStopped: false })).toBe(true);
    expect(requiresAttention({ state: "MANUAL_REVIEW", transmissionStopped: false })).toBe(true);
    expect(requiresAttention({ state: "SIGNED", transmissionStopped: true })).toBe(true);
    expect(requiresAttention({ state: "RESERVED", transmissionStopped: false })).toBe(false);
    expect(requiresAttention({ state: "RETURNED", transmissionStopped: false })).toBe(false);
  });

  it("la marca de atención tiene nombre accesible", () => {
    renderApp(<AttentionMarker />);
    expect(screen.getByRole("img", { name: "Requiere atención" })).toBeDefined();
  });
});
