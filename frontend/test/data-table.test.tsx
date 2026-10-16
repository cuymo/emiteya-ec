// Base de tabla compartida (productize-invoice-list-and-shared-table-foundation, design D5, D11 y
// D14; tareas 4.1 a 4.3): la tabla con sus estados en la superficie y su pie, la búsqueda y el menú
// de acciones de una fila. Los filtros y el pie numerado tienen su prueba en `data-table-card`.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText, Search } from "lucide-react";
import Link from "next/link";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableSearch } from "@/components/data-table/data-table-search";
import { DataTableEmpty, DataTableError } from "@/components/data-table/data-table-state";
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
    expect(screen.getByRole("button", { name: "Página 2" }).getAttribute("aria-current")).toBe(
      "page",
    );
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole("combobox", { name: "Filas por página" }));
    await user.click(await screen.findByRole("option", { name: "50" }));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("en los límites deshabilita los botones que no llevan a ninguna página", () => {
    table({ page: 1, rowCount: 10 });
    for (const name of ["Página anterior", "Página siguiente"]) {
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
