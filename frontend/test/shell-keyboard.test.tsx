// Teclado del shell (spec web-application-shell; adopt-premium-design-foundation-and-shell, design D18):
// Ctrl+B alterna la barra lateral y el menú de cuenta se recorre y se cierra sin perder el foco. La
// paleta, la creación rápida, el panel móvil y el tema tienen sus pruebas de teclado en sus archivos.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigation } from "./harness";
import { api, renderShell } from "./shell-harness";
import { resetViewport, setViewportWidth } from "./viewport";

beforeEach(() => {
  navigation.pathname = "/facturas";
  navigation.search = new URLSearchParams();
  setViewportWidth(1280);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetViewport();
  document.cookie = "sidebar_state=; max-age=0; path=/";
});

describe("teclado del shell", () => {
  it("Ctrl+B colapsa y expande la barra lateral", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    await screen.findByText("contenido");
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "Expandir barra lateral" })).toBeDefined();
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "Contraer barra lateral" })).toBeDefined();
  });

  it("el menú de cuenta se abre con Enter, se recorre con flechas y Escape devuelve el foco", async () => {
    const user = userEvent.setup();
    api();
    renderShell();
    const account = await screen.findByRole("button", { name: "Cuenta de Ana Admin" });
    account.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    // Al abrir con el teclado, el foco va al primer ítem.
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Mi cuenta"));
    // El grupo «Tema» vive en el menú a todas las anchuras (spec «Tema accesible»).
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Claro");
    await user.keyboard("{End}");
    expect(document.activeElement?.textContent).toContain("Cerrar sesión");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(account);
  });
});
