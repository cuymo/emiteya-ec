// Nombre visible del producto (spec web-application-shell, «Nombre visible del producto»;
// adopt-premium-design-foundation-and-shell, design D20): EmiteYa en el título de cada pantalla, en
// el inicio de sesión y en el shell, y nunca «Facturador SRI» como nombre del producto.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "@/features/auth/login-screen";
import { mockApi, navigation, renderApp } from "./harness";

const SRC = join(__dirname, "..", "src");

function files(directory: string, match: (name: string) => boolean): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path, match);
    return match(name) ? [path] : [];
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nombre del producto", () => {
  it("el título de cada una de las 42 pantallas termina en «· EmiteYa»", () => {
    const pages = files(join(SRC, "app"), (name) => name === "page.tsx");
    expect(pages).toHaveLength(42);
    for (const page of pages) {
      const title = /title:\s*"([^"]+)"/.exec(readFileSync(page, "utf8"))?.[1];
      expect(title, page).toMatch(/ · EmiteYa$/);
    }
  });

  it("el título raíz es EmiteYa", () => {
    expect(readFileSync(join(SRC, "app", "layout.tsx"), "utf8")).toContain('title: "EmiteYa"');
  });

  it("ningún archivo del frontend usa «Facturador SRI» como nombre del producto", () => {
    for (const file of files(SRC, (name) => /\.(ts|tsx)$/.test(name))) {
      expect(readFileSync(file, "utf8"), file).not.toContain("Facturador SRI");
    }
  });

  it("el inicio de sesión muestra EmiteYa", () => {
    mockApi({});
    navigation.search = new URLSearchParams();
    renderApp(<LoginScreen />);
    expect(screen.getByText("EmiteYa")).toBeDefined();
    expect(document.body.textContent).not.toContain("Facturador SRI");
  });
});
