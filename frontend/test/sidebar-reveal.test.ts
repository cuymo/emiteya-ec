// Destino actual a la vista en la barra lateral (adopt-premium-design-foundation-and-shell, design
// D23, tarea 14.4): se desplaza lo justo, solo la barra, y no se mueve si ya se ve entero.
import { describe, expect, it, vi } from "vitest";
import { revealWithin } from "@/lib/navigation/reveal";

function box(top: number, bottom: number) {
  return { getBoundingClientRect: () => ({ top, bottom }) } as unknown as HTMLElement;
}

function bar(top: number, bottom: number) {
  const scrollBy = vi.fn();
  const element = { ...box(top, bottom), scrollBy } as unknown as HTMLElement;
  return { element, scrollBy };
}

describe("revealWithin (design D23)", () => {
  it("no desplaza la barra si el destino ya se ve entero", () => {
    const { element, scrollBy } = bar(100, 700);
    expect(revealWithin(element, box(300, 332), "smooth")).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("baja lo justo, con un margen, si el destino queda por debajo", () => {
    const { element, scrollBy } = bar(100, 700);
    expect(revealWithin(element, box(1040, 1072), "instant")).toBe(380);
    expect(scrollBy).toHaveBeenCalledWith({ top: 380, behavior: "instant" });
  });

  it("sube lo justo si el destino queda por encima", () => {
    const { element, scrollBy } = bar(100, 700);
    expect(revealWithin(element, box(40, 72), "smooth")).toBe(-68);
    expect(scrollBy).toHaveBeenCalledWith({ top: -68, behavior: "smooth" });
  });

  it("un destino cortado por el borde inferior también se muestra entero", () => {
    const { element, scrollBy } = bar(100, 700);
    expect(revealWithin(element, box(690, 722), "instant")).toBe(30);
    expect(scrollBy).toHaveBeenCalledOnce();
  });
});
