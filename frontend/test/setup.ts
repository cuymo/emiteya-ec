import { cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, vi } from "vitest";

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

afterEach(async () => {
  // Sonner retira cada toast cerrado con un temporizador que no se cancela al desmontar. Se cierran
  // todos y se espera a que salgan del DOM antes de desmontar, de modo que ningún temporizador
  // sobreviva a la prueba ni al entorno de jsdom del archivo.
  toast.dismiss();
  await waitFor(() => expect(document.querySelector("[data-sonner-toast]")).toBeNull());
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
});
