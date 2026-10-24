// Recorrido de bienvenida (add-onboarding-tour): los tramos que ve cada rol, el estado guardado en el
// navegador y la ejecución con driver.js, que cambia de pantalla, omite lo que no está a la vista y
// recuerda el cierre.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsOf } from "@/lib/navigation/routes";
import { createTour, type Tour } from "@/features/onboarding/tour-runner";
import { tourSegments, type TourSegment } from "@/features/onboarding/tour-steps";
import { markTourSeen, tourKey, tourSeen } from "@/features/onboarding/tour-storage";

const ids = (segments: readonly TourSegment[]) => segments.map((segment) => segment.id);

describe("tramos del recorrido", () => {
  it("el administrador recorre Inicio, Configuración y la primera factura", () => {
    expect(ids(tourSegments(permissionsOf("ADMIN")))).toEqual([
      "inicio",
      "configuracion",
      "factura",
    ]);
  });

  it("el operador no recorre Configuración", () => {
    expect(ids(tourSegments(permissionsOf("OPERATOR")))).toEqual(["inicio", "factura"]);
  });

  it("los textos son fijos, sin marcado", () => {
    for (const segment of tourSegments(permissionsOf("ADMIN"))) {
      for (const step of segment.steps) {
        expect(`${step.title}${step.description}`).not.toMatch(/[<>]/);
      }
    }
  });
});

describe("recorrido visto", () => {
  beforeEach(() => window.localStorage.clear());

  it("se recuerda por usuario, sin distinguir mayúsculas", () => {
    expect(tourSeen("ana@empresa.ec")).toBe(false);
    markTourSeen("Ana@Empresa.ec");
    expect(tourSeen("ana@empresa.ec")).toBe(true);
    expect(tourSeen("oscar@empresa.ec")).toBe(false);
    expect(tourKey(" Ana@Empresa.ec ")).toBe("emiteya.recorrido.v1:ana@empresa.ec");
  });

  it("sin almacenamiento disponible, se vuelve a ofrecer sin fallar", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => markTourSeen("ana@empresa.ec")).not.toThrow();
    expect(tourSeen("ana@empresa.ec")).toBe(false);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("ejecución del recorrido", () => {
  const SEGMENTS: TourSegment[] = [
    {
      id: "a",
      label: "Inicio",
      path: "/",
      permission: "invoices.read",
      steps: [
        { title: "Bienvenida", description: "Hola." },
        { selector: '[data-tour="falta"]', title: "Oculto", description: "No está." },
        { selector: '[data-tour="uno"]', title: "Uno", description: "El primero." },
      ],
    },
    {
      id: "b",
      label: "Segunda",
      path: "/otra",
      permission: "invoices.read",
      steps: [{ selector: '[data-tour="dos"]', title: "Dos", description: "El segundo." }],
    },
  ];
  let path = "/";
  let tour: Tour | null = null;

  const popoverTitle = () => document.querySelector(".driver-popover-title")?.textContent;
  const button = (name: string) => screen.getByRole("button", { name });
  function mount(name: string) {
    const element = document.createElement("div");
    element.dataset.tour = name;
    element.textContent = name;
    document.body.append(element);
    return element;
  }

  beforeEach(() => {
    path = "/";
    document.body.innerHTML = "";
    mount("uno");
  });
  afterEach(() => {
    tour?.stop();
    tour = null;
    document.body.innerHTML = "";
  });

  function start(onFinish = vi.fn(), navigate = vi.fn()) {
    tour = createTour({
      segments: SEGMENTS,
      currentPath: () => path,
      navigate: (target) => {
        navigate(target);
        path = target;
        // La pantalla siguiente aparece después de navegar.
        setTimeout(() => mount("dos"), 20);
      },
      onFinish,
      reducedMotion: true,
    });
    tour.start();
    return { onFinish, navigate };
  }

  it("omite lo que no está, cambia de pantalla y termina recordándolo", async () => {
    const user = userEvent.setup();
    const { onFinish, navigate } = start();
    await waitFor(() => expect(popoverTitle()).toBe("Bienvenida"));
    expect(document.querySelector(".driver-popover-progress-text")?.textContent).toBe(
      "Inicio · 1 de 2",
    );
    expect(document.querySelector(".driver-popover")?.getAttribute("role")).toBe("dialog");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Siguiente"));
    await user.click(button("Siguiente"));
    await waitFor(() => expect(popoverTitle()).toBe("Uno"));
    // El último paso de un tramo que no es el final sigue al próximo.
    await user.click(button("Siguiente"));
    await waitFor(() => expect(popoverTitle()).toBe("Dos"));
    expect(navigate).toHaveBeenCalledWith("/otra");
    expect(document.querySelector(".driver-popover-progress-text")?.textContent).toBe(
      "Segunda · 1 de 1",
    );
    // «Anterior» desde el primer paso de un tramo vuelve al último del anterior.
    await user.click(button("Anterior"));
    await waitFor(() => expect(popoverTitle()).toBe("Uno"));
    expect(navigate).toHaveBeenLastCalledWith("/");
    await user.click(button("Siguiente"));
    await waitFor(() => expect(popoverTitle()).toBe("Dos"));
    expect(onFinish).not.toHaveBeenCalled();
    await user.click(button("Terminar"));
    await waitFor(() => expect(document.querySelector(".driver-popover")).toBeNull());
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("cerrarlo lo termina y se recuerda", async () => {
    const user = userEvent.setup();
    const { onFinish } = start();
    await waitFor(() => expect(popoverTitle()).toBe("Bienvenida"));
    await user.click(button("Cerrar el recorrido"));
    await waitFor(() => expect(document.querySelector(".driver-popover")).toBeNull());
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
