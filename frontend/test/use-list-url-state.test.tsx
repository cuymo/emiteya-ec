// Estado de una lista en la dirección (productize-invoice-list-and-shared-table-foundation, design
// D9, tarea 3.1): cambios rápidos acumulados, vuelta a la primera página al filtrar, alias de enlaces
// antiguos y página fuera de rango.
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useListUrlState, type ListUrlState } from "@/hooks/use-list-url-state";
import { navigation } from "./navigation";

/** El estado que expone el hook en la última representación de la sonda. */
const probe: { state?: ListUrlState } = {};

function Probe({ normalize }: { normalize?: (params: URLSearchParams) => boolean }) {
  const list = useListUrlState({ normalize });
  useEffect(() => {
    probe.state = list;
  });
  return (
    <p>
      vista={list.get("vista")} página={list.page} filas={list.pageSize}
    </p>
  );
}

const state = () => probe.state!;

/** La última dirección pedida con `replace`. */
const lastReplace = () => navigation.replace.mock.calls.at(-1)?.[0] as string | undefined;

beforeEach(() => {
  navigation.pathname = "/facturas";
  navigation.search = new URLSearchParams();
  navigation.replace.mockReset();
});

afterEach(() => {
  navigation.search = new URLSearchParams();
});

describe("useListUrlState (design D9)", () => {
  it("lee los valores de la dirección, con la página y las filas por defecto", () => {
    navigation.search = new URLSearchParams("vista=atencion&pagina=3&filas=50");
    render(<Probe />);
    expect(screen.getByText("vista=atencion página=3 filas=50")).toBeDefined();
    navigation.search = new URLSearchParams("pagina=-2&filas=1000");
    render(<Probe />);
    expect(screen.getByText("vista= página=1 filas=25")).toBeDefined();
  });

  it("dos cambios rápidos seguidos se aplican los dos", () => {
    render(<Probe />);
    act(() => {
      state().update({ vista: "atencion" });
      state().update({ estado: "devueltas" });
    });
    // El segundo cambio parte del primero, aunque la dirección todavía no lo refleja.
    expect(lastReplace()).toBe("/facturas?vista=atencion&estado=devueltas");
  });

  it("cambiar un filtro vuelve a la primera página; cambiar de página la conserva", () => {
    navigation.search = new URLSearchParams("q=perno&pagina=4");
    render(<Probe />);
    act(() => state().update({ estado: "autorizadas" }));
    expect(lastReplace()).toBe("/facturas?q=perno&estado=autorizadas");
    act(() => state().setPage(2));
    expect(lastReplace()).toBe("/facturas?q=perno&estado=autorizadas&pagina=2");
  });

  it("quitar un filtro con null o vacío lo borra de la dirección", () => {
    navigation.search = new URLSearchParams("q=perno&estado=devueltas");
    render(<Probe />);
    act(() => state().update({ q: null, estado: "" }));
    expect(lastReplace()).toBe("/facturas");
  });

  it("normaliza una vez los alias de enlaces antiguos", () => {
    navigation.search = new URLSearchParams("estado=atencion");
    const normalize = (params: URLSearchParams) => {
      if (params.get("estado") !== "atencion") return false;
      params.delete("estado");
      params.set("vista", "atencion");
      return true;
    };
    render(<Probe normalize={normalize} />);
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(lastReplace()).toBe("/facturas?vista=atencion");
  });

  it("una página posterior a la última pasa a la última con datos, sin bucles", () => {
    navigation.search = new URLSearchParams("pagina=9");
    render(<Probe />);
    act(() => state().clampPage(60));
    expect(lastReplace()).toBe("/facturas?pagina=3");
    navigation.replace.mockReset();
    navigation.search = new URLSearchParams("pagina=3");
    render(<Probe />);
    act(() => state().clampPage(60));
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("sin resultados, una página posterior vuelve a la primera", () => {
    navigation.search = new URLSearchParams("estado=revision&pagina=2");
    render(<Probe />);
    act(() => state().clampPage(0));
    expect(lastReplace()).toBe("/facturas?estado=revision");
  });
});
