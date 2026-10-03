// EntityPickerDialog (add-invoice-emission, tarea 10.1, design D15): búsqueda, resultados paginados
// del servidor, selección por teclado y opción rápida configurable, por rol y nombre accesible.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityPickerDialog, type EntityPickerQuery } from "@/components/entity-picker-dialog";
import { renderApp } from "./harness";

type Item = { id: string; name: string; code: string };
const ITEMS: Item[] = Array.from({ length: 12 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Producto ${index + 1}`,
  code: `C-${index + 1}`,
}));

function Picker({
  fetchPage,
  onSelect,
  onQuick,
  quick = true,
}: {
  fetchPage: (query: EntityPickerQuery) => Promise<{ items: Item[]; total: number }>;
  onSelect: (item: Item) => void;
  onQuick?: () => void;
  quick?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <EntityPickerDialog<Item>
        open={open}
        onOpenChange={setOpen}
        title="Elegir producto"
        searchLabel="Buscar por código o nombre"
        queryKey={["prueba", quick]}
        fetchPage={fetchPage}
        pageSize={5}
        getKey={(item) => item.id}
        getLabel={(item) => `${item.name}, ${item.code}`}
        renderItem={(item) => (
          <span>
            {item.name} · {item.code}
          </span>
        )}
        onSelect={onSelect}
        {...(quick
          ? { quickOption: { label: "Consumidor final", onSelect: onQuick ?? (() => undefined) } }
          : {})}
        emptyTitle="Todavía no hay productos"
      />
    </>
  );
}

const serve = (items: Item[] = ITEMS) =>
  vi.fn(({ search, page, pageSize }: EntityPickerQuery) => {
    const matched = items.filter(
      (item) => item.name.includes(search) || item.code.includes(search),
    );
    return Promise.resolve({
      items: matched.slice((page - 1) * pageSize, page * pageSize),
      total: matched.length,
    });
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EntityPickerDialog", () => {
  it("muestra la opción rápida y la primera página de resultados por su nombre accesible", async () => {
    renderApp(<Picker fetchPage={serve()} onSelect={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Elegir producto" });
    const listbox = await within(dialog).findByRole("listbox", { name: "Elegir producto" });
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "Consumidor final",
      "Producto 1, C-1",
      "Producto 2, C-2",
      "Producto 3, C-3",
      "Producto 4, C-4",
      "Producto 5, C-5",
    ]);
    expect(within(dialog).getByText("Página 1 de 3 · 12 resultados")).toBeDefined();
  });

  it("busca en el servidor y oculta la opción rápida mientras hay búsqueda", async () => {
    const fetchPage = serve();
    renderApp(<Picker fetchPage={fetchPage} onSelect={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole("combobox", { name: "Buscar por código o nombre" }),
      "C-12",
    );
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual([
        "Producto 12, C-12",
      ]),
    );
    expect(fetchPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "C-12", page: 1, pageSize: 5 }),
    );
  });

  it("selecciona con el teclado: flechas, Inicio, Fin y Enter", async () => {
    const onSelect = vi.fn();
    renderApp(<Picker fetchPage={serve()} onSelect={onSelect} />);
    const user = userEvent.setup();
    const input = await screen.findByRole("combobox", { name: "Buscar por código o nombre" });
    await screen.findByRole("option", { name: "Producto 1, C-1" });
    input.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const active = document.getElementById(input.getAttribute("aria-activedescendant")!)!;
    expect(active.getAttribute("aria-label")).toBe("Producto 2, C-2");
    expect(active.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{End}");
    expect(
      document
        .getElementById(input.getAttribute("aria-activedescendant")!)!
        .getAttribute("aria-label"),
    ).toBe("Producto 5, C-5");
    await user.keyboard("{Home}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Enter con una búsqueda aún sin aplicar la aplica en lugar de elegir un resultado anterior", async () => {
    const onSelect = vi.fn();
    const onQuick = vi.fn();
    renderApp(<Picker fetchPage={serve()} onSelect={onSelect} onQuick={onQuick} />);
    const user = userEvent.setup();
    const input = await screen.findByRole("combobox", { name: "Buscar por código o nombre" });
    await screen.findByRole("option", { name: "Consumidor final" });
    await user.type(input, "C-12{Enter}");
    expect(onQuick).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    await screen.findByRole("option", { name: "Producto 12, C-12" });
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[11]);
  });

  it("la opción rápida se elige con un clic y cierra el diálogo", async () => {
    const onQuick = vi.fn();
    const onSelect = vi.fn();
    renderApp(<Picker fetchPage={serve()} onSelect={onSelect} onQuick={onQuick} />);
    await userEvent.setup().click(await screen.findByRole("option", { name: "Consumidor final" }));
    expect(onQuick).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("pagina en el servidor con anterior y siguiente", async () => {
    const fetchPage = serve();
    renderApp(<Picker fetchPage={fetchPage} onSelect={vi.fn()} quick={false} />);
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Producto 1, C-1" });
    const previous = screen.getByRole("button", { name: "Página anterior" });
    expect(previous).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByRole("option", { name: "Producto 6, C-6" })).toBeDefined();
    expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await screen.findByRole("option", { name: "Producto 11, C-11" });
    expect(screen.getByRole("button", { name: "Página siguiente" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("distingue el vacío, la búsqueda sin coincidencias y el error con reintento", async () => {
    let fail = true;
    const fetchPage = vi.fn((query: EntityPickerQuery) =>
      fail ? Promise.reject(new Error("caído")) : serve([])(query),
    );
    renderApp(<Picker fetchPage={fetchPage} onSelect={vi.fn()} quick={false} />);
    expect(
      await screen.findByText("No pudimos cargar los resultados.", undefined, { timeout: 5_000 }),
    ).toBeDefined();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await screen.findByText("Todavía no hay productos")).toBeDefined();
    await userEvent.setup().type(screen.getByRole("combobox"), "zzz");
    expect(await screen.findByText("No hay resultados que coincidan")).toBeDefined();
  }, 10_000);
});
