import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";

function renderShell() {
  return render(
    <ThemeProvider>
      <AppShell>
        <p>contenido</p>
      </AppShell>
    </ThemeProvider>,
  );
}

describe("shell de la aplicación", () => {
  it("muestra cabecera, navegación principal vacía, contenido y enlace para saltar al contenido", () => {
    renderShell();
    expect(screen.getByText("Facturador SRI")).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeDefined();
    expect(screen.getByRole("main").textContent).toContain("contenido");
    expect(screen.getByRole("link", { name: "Saltar al contenido" }).getAttribute("href")).toBe(
      "#contenido",
    );
  });

  it("el selector cambia entre tema oscuro y claro", async () => {
    renderShell();
    const dark = screen.getByRole("radio", { name: "Oscuro" });
    await act(async () => {
      fireEvent.click(dark);
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(dark.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Claro" }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByRole("radio", { name: "Claro" }).getAttribute("aria-checked")).toBe("true");
  });

  it("el selector se opera con las flechas del teclado", async () => {
    renderShell();
    const group = screen.getByRole("radiogroup", { name: "Tema" });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Claro" }));
    });
    await act(async () => {
      fireEvent.keyDown(group, { key: "ArrowRight" });
    });
    const dark = screen.getByRole("radio", { name: "Oscuro" });
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(dark);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
