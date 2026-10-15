// Sin permiso para emitir (spec invoices, «Acción siguiente en el editor de facturas»;
// productize-invoice-editor-and-composition-foundation, D14). Hoy los dos roles emiten, así que el
// permiso se simula: el editor no debe depender de que ningún rol llegue a este caso.
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftEditorScreen } from "@/features/invoices/draft-editor";
import { navigation } from "./harness";
import { draft, ok, render } from "./invoice-draft-fixtures";

vi.mock("@/lib/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...real,
    canSee: (role: Parameters<typeof real.canSee>[0], permission: string) =>
      permission === "invoices.emit"
        ? false
        : real.canSee(role, permission as Parameters<typeof real.canSee>[1]),
  };
});

beforeEach(() => {
  navigation.pathname = "/borradores/draft-1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sin permiso para emitir", () => {
  it("con un borrador listo no aparece emitir, ni su aviso, y guardar es la principal", async () => {
    render(<DraftEditorScreen draftId="draft-1" />, {
      "GET /api/v1/invoices/drafts/draft-1": ok(draft()),
    });
    const save = await screen.findByRole("button", { name: "Guardar borrador" });
    expect(save.getAttribute("data-variant")).toBe("primary");
    expect(screen.queryByRole("button", { name: "Emitir factura" })).toBeNull();
    expect(document.querySelector("[data-slot=emission-environment-notice]")).toBeNull();
  });
});
