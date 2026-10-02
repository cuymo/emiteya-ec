import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Navegación de Next.js simulada para todas las pruebas de componentes.
vi.mock("next/navigation", async () => (await import("./navigation")).nextNavigationMock());

// jsdom no implementa matchMedia; next-themes lo usa para el tema del sistema.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom no implementa ResizeObserver; Radix lo usa para medir controles.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Ni la captura de puntero ni scrollIntoView existen en jsdom; Radix y user-event los invocan.
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
});
