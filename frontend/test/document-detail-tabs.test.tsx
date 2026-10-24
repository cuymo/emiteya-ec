// Pestañas del detalle de un comprobante: la primera por defecto, la de la dirección si existe, el
// cambio de pestaña en la dirección sin desplazar la página, el teclado y el aviso de atención.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DocumentDetailTabs,
  transmissionNeedsAttention,
  type DetailTab,
} from "@/features/documents/document-detail-tabs";
import { navigation } from "./navigation";

const TABS: DetailTab[] = [
  { id: "detalle", label: "Detalle", content: <p>Comprador y productos</p> },
  {
    id: "transmision",
    label: "Transmisión al SRI",
    content: <p>Estado del SRI</p>,
    attention: true,
  },
  { id: "documentos", label: "RIDE y XML", content: <p>Descargas</p> },
];

beforeEach(() => {
  navigation.pathname = "/facturas/inv-1";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

describe("pestañas del detalle", () => {
  it("en la rejilla del detalle se encogen, así sus pestañas se desplazan y no ensanchan la página", () => {
    render(<DocumentDetailTabs label="Secciones" tabs={TABS} />);
    const root = document.querySelector("[data-slot=document-detail-tabs]")!;
    expect(root.className.split(/\s+/)).toContain("min-w-0");
    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");
  });

  it("abre la primera, muestra solo su contenido y marca la que requiere atención", () => {
    render(<DocumentDetailTabs label="Secciones de la factura" tabs={TABS} />);
    expect(screen.getByRole("tablist", { name: "Secciones de la factura" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Detalle" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Comprador y productos")).toBeDefined();
    expect(screen.queryByText("Estado del SRI")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Transmisión al SRI, requiere atención" }),
    ).toBeDefined();
  });

  it("abre la pestaña de la dirección y, al cambiar, la escribe sin desplazar la página", async () => {
    navigation.search = new URLSearchParams("seccion=documentos");
    render(<DocumentDetailTabs label="Secciones" tabs={TABS} />);
    expect(screen.getByText("Descargas")).toBeDefined();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^Transmisión al SRI/ }));
    expect(screen.getByText("Estado del SRI")).toBeDefined();
    expect(navigation.replace).toHaveBeenLastCalledWith("/facturas/inv-1?seccion=transmision", {
      scroll: false,
    });
    // Volver a la primera quita el parámetro.
    await user.click(screen.getByRole("tab", { name: "Detalle" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/facturas/inv-1", { scroll: false });
  });

  it("una pestaña desconocida en la dirección abre la primera; las flechas recorren las pestañas", async () => {
    navigation.search = new URLSearchParams("seccion=otra");
    render(<DocumentDetailTabs label="Secciones" tabs={TABS} />);
    const first = screen.getByRole("tab", { name: "Detalle" });
    expect(first.getAttribute("aria-selected")).toBe("true");
    const user = userEvent.setup();
    await user.click(first);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /^Transmisión al SRI/ }));
  });

  it("la transmisión requiere atención si está detenida, incierta, en revisión o rechazada", () => {
    expect(transmissionNeedsAttention("AUTHORIZED", false)).toBe(false);
    expect(transmissionNeedsAttention("SIGNED", true)).toBe(true);
    for (const state of ["SEND_UNKNOWN", "MANUAL_REVIEW", "RETURNED", "NOT_AUTHORIZED"] as const) {
      expect(transmissionNeedsAttention(state, false), state).toBe(true);
    }
  });
});
