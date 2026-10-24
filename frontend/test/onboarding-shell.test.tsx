// Recorrido de bienvenida en el shell (add-onboarding-tour, design D3): se abre solo la primera vez
// que el usuario llega a Inicio, cuando el tablero ya cargó; se recuerda al cerrarlo y se repite
// desde el menú de la cuenta. Un enlace directo a otra pantalla no lo abre.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ME, navigation } from "./harness";
import { api, renderShell } from "./shell-harness";

const KEY = `emiteya.recorrido.v1:${ADMIN_ME.email}`;
const WELCOME = "Te damos la bienvenida a EmiteYa";
const dashboard = <div data-tour="inicio-indicadores">indicadores</div>;
const popoverTitle = () => document.querySelector(".driver-popover-title")?.textContent ?? null;

beforeEach(() => {
  window.localStorage.clear();
  navigation.pathname = "/";
});

afterEach(() => {
  document.querySelector(".driver-popover")?.remove();
  vi.unstubAllGlobals();
});

describe("recorrido de bienvenida en el shell", () => {
  it("se abre solo en el primer ingreso a Inicio y se recuerda al cerrarlo", async () => {
    api();
    const user = userEvent.setup();
    renderShell({ children: dashboard });
    await waitFor(() => expect(popoverTitle()).toBe(WELCOME));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cerrar el recorrido" }));
    await waitFor(() => expect(document.querySelector(".driver-popover")).toBeNull());
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it("ya visto, no se abre solo", async () => {
    window.localStorage.setItem(KEY, "2026-10-24T12:00:00.000Z");
    api();
    renderShell({ children: dashboard });
    await screen.findByText("indicadores");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector(".driver-popover")).toBeNull();
  });

  it("un enlace directo a otra pantalla no lo abre", async () => {
    navigation.pathname = "/facturas";
    api();
    renderShell({ children: dashboard });
    await screen.findByText("indicadores");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector(".driver-popover")).toBeNull();
  });

  it("«Ver recorrido» en el menú de la cuenta lo repite desde la bienvenida", async () => {
    window.localStorage.setItem(KEY, "2026-10-24T12:00:00.000Z");
    api();
    const user = userEvent.setup();
    renderShell({ children: dashboard });
    await screen.findByText("indicadores");
    await user.click(screen.getByRole("button", { name: /Ana Admin/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Ver recorrido" }));
    await waitFor(() => expect(popoverTitle()).toBe(WELCOME));
  });
});
