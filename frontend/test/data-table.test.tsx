// Base de tabla compartida (productize-invoice-list-and-shared-table-foundation, design D5, D11 y
// D14; tareas 4.1 a 4.3): la tabla con sus estados en la superficie y su pie, la búsqueda, las
// vistas, el filtro de opción única, los filtros activos y el menú de acciones de una fila.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableActiveFilters } from "@/components/data-table/data-table-active-filters";
import { DataTableOptionFilter } from "@/components/data-table/data-table-option-filter";
import { DataTableSearch } from "@/components/data-table/data-table-search";
import { DataTableEmpty, DataTableError } from "@/components/data-table/data-table-state";
import { DataTableViews } from "@/components/data-table/data-table-views";
import { RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

type Row = { id: string; number: string; buyer: string };

const ROWS: Row[] = [
  { id: "a", number: "001-001-000000123", buyer: "EL PERNO CIA. LTDA." },
  { id: "b", number: "001-001-000000122", buyer: "Comercial Andina S.A." },
];

const COLUMNS: ColumnDef<Row, unknown>[] = [
  {
    id: "numero",
    header: "Factura",
    cell: ({ row }) => <Link href={`/facturas/${row.original.id}`}>{row.original.number}</Link>,
  },
  { id: "comprador", header: "Comprador", cell: ({ row }) => row.original.buyer },
  {
    id: "acciones",
    header: "Acciones",
    meta: { srOnlyHeader: true },
    cell: () => <button type="button">Acciones</button>,
  },
];

function table(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable<Row>
      label="Facturas emitidas"
      columns={COLUMNS}
      data={ROWS}
      getRowId={(row) => row.id}
      rowCount={60}
      page={2}
      pageSize={25}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
      loading={false}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DataTable (D5, D14)", () => {
  it("es una tabla con nombre, encabezados de columna y un encabezado de acciones solo para lectores", () => {
    table();
    const grid = screen.getByRole("table", { name: "Facturas emitidas" });
    const headers = within(grid).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Factura",
      "Comprador",
      "Acciones",
    ]);
    expect(headers[2]!.querySelector(".sr-only")).not.toBeNull();
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
  });

  it("con filas, el pie dice el intervalo, la página y ofrece las filas por página", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    table({ onPageChange, onPageSizeChange });
    expect(screen.getByText("Mostrando 26-50 de 60")).toBeDefined();
    expect(screen.getByText("Página 2 de 3")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.selectOptions(screen.getByLabelText("Filas por página"), "50");
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("en los límites deshabilita los botones que no llevan a ninguna página", () => {
    table({ page: 1, rowCount: 10 });
    for (const name of ["Primera página", "Página anterior", "Página siguiente", "Última página"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("al cargar muestra filas esqueleto y ninguna cifra de paginación", () => {
    const { container } = table({ loading: true, data: [], rowCount: 0 });
    expect(container.querySelector("[data-slot=data-table]")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.getAllByRole("row")).toHaveLength(1 + 8);
    expect(screen.queryByText(/Mostrando/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Paginación" })).toBeNull();
  });

  it("un estado ocupa la superficie, sin filas ni paginación", () => {
    table({
      data: [],
      rowCount: 0,
      state: <DataTableEmpty icon={FileText} title="Todavía no hay facturas" />,
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "Todavía no hay facturas" }),
    ).toBeDefined();
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });

  it("al recargar con datos previos solo se anuncia ocupada", () => {
    const { container } = table({ refreshing: true });
    expect(container.querySelector("[data-slot=data-table]")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.getByText("001-001-000000123")).toBeDefined();
  });

  it("abre la fila desde una zona no interactiva, y no desde el enlace, un botón, un modificador o una selección", () => {
    const onRowOpen = vi.fn();
    table({ onRowOpen });
    fireEvent.click(screen.getByText("EL PERNO CIA. LTDA."));
    expect(onRowOpen).toHaveBeenCalledWith(ROWS[0]);
    onRowOpen.mockClear();
    fireEvent.click(screen.getByText("001-001-000000123"));
    fireEvent.click(screen.getAllByRole("button", { name: "Acciones" })[0]!);
    fireEvent.click(screen.getByText("EL PERNO CIA. LTDA."), { ctrlKey: true });
    fireEvent.click(screen.getByText("EL PERNO CIA. LTDA."), { button: 1 });
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ toString: () => "PERNO" } as Selection);
    fireEvent.click(screen.getByText("EL PERNO CIA. LTDA."));
    selection.mockRestore();
    expect(onRowOpen).not.toHaveBeenCalled();
  });

  it("la fila no es una parada de teclado: solo lo es el enlace del registro", () => {
    table({ onRowOpen: vi.fn() });
    for (const row of screen.getAllByRole("row")) {
      expect(row.getAttribute("tabindex")).toBeNull();
      expect(row.getAttribute("role")).toBe(null);
    }
  });
});

describe("estados de la superficie", () => {
  it("el error explica que no pudo cargar y ofrece reintentar", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<DataTableError message="No pudimos cargar las facturas." onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("No pudimos cargar las facturas.");
    await user.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("DataTableSearch (D8)", () => {
  it("consulta el valor recortado tras la espera y limpia de inmediato", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(
      <DataTableSearch
        label="Buscar por número, comprador o identificación"
        placeholder="Número, comprador o identificación"
        value=""
        onChange={onChange}
        maxLength={100}
      />,
    );
    const input = screen.getByRole("searchbox", {
      name: "Buscar por número, comprador o identificación",
    });
    expect(input.getAttribute("maxlength")).toBe("100");
    await user.type(input, "  perno ");
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenLastCalledWith("perno");
    await user.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("sigue el valor cuando cambia desde fuera", () => {
    const { rerender } = render(
      <DataTableSearch label="Buscar" placeholder="Buscar" value="perno" onChange={vi.fn()} />,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("perno");
    rerender(<DataTableSearch label="Buscar" placeholder="Buscar" value="" onChange={vi.fn()} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });
});

function Views({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState<"todas" | "atencion">("todas");
  return (
    <DataTableViews
      label="Vista"
      value={value}
      views={[
        { value: "todas", label: "Todas" },
        { value: "atencion", label: "Requiere atención", count: 3 },
      ]}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("DataTableViews (D6)", () => {
  it("es un grupo de radio con el conteo de la vista y siempre una vista elegida", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Views onChange={onChange} />);
    screen.getByRole("radiogroup", { name: "Vista" });
    const attention = screen.getByRole("radio", { name: /Requiere atención/ });
    expect(attention.textContent).toContain("3");
    await user.click(attention);
    expect(onChange).toHaveBeenCalledWith("atencion");
    await user.click(attention);
    expect(attention.getAttribute("aria-checked")).toBe("true");
  });
});

describe("DataTableOptionFilter (D6)", () => {
  const OPTIONS = [
    { value: "devueltas", label: "Devuelto" },
    { value: "autorizadas", label: "Autorizado" },
  ] as const;

  it("elige una sola opción, dice el valor en el disparador y ofrece quitarlo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DataTableOptionFilter
        label="Estado"
        value={undefined}
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Estado" }));
    expect(screen.queryByRole("menuitem", { name: "Quitar filtro" })).toBeNull();
    await user.click(screen.getByRole("menuitemradio", { name: "Devuelto" }));
    expect(onChange).toHaveBeenCalledWith("devueltas");
    rerender(
      <DataTableOptionFilter
        label="Estado"
        value="devueltas"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Estado: Devuelto" }));
    await user.click(screen.getByRole("menuitem", { name: "Quitar filtro" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("DataTableActiveFilters (D5)", () => {
  it("no aparece sin filtros activos", () => {
    const { container } = render(
      <DataTableActiveFilters filters={[]} active={false} onClear={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("quita un filtro y limpia todos", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onClear = vi.fn();
    render(
      <DataTableActiveFilters
        filters={[{ key: "q", label: "Búsqueda: «perno»", onRemove }]}
        active
        onClear={onClear}
      />,
    );
    const group = screen.getByRole("group", { name: "Filtros activos" });
    await user.click(
      within(group).getByRole("button", { name: "Quitar filtro Búsqueda: «perno»" }),
    );
    expect(onRemove).toHaveBeenCalledOnce();
    await user.click(within(group).getByRole("button", { name: "Limpiar filtros" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe("RowActionsMenu (D11)", () => {
  it("tiene un nombre que identifica el registro, ofrece sus acciones y devuelve el foco", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <TooltipProvider>
        <RowActionsMenu
          label="Acciones de la factura 001-001-000000123"
          actions={[
            { key: "ver", label: "Ver factura", icon: FileText, href: "/facturas/a" },
            { key: "copiar", label: "Copiar número", icon: Search, onSelect: onCopy },
          ]}
        />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole("button", {
      name: "Acciones de la factura 001-001-000000123",
    });
    await user.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Ver factura" }).getAttribute("href")).toBe(
      "/facturas/a",
    );
    await user.click(within(menu).getByRole("menuitem", { name: "Copiar número" }));
    expect(onCopy).toHaveBeenCalledOnce();
    await user.click(trigger);
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
