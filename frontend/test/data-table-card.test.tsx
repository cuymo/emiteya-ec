// Superficie de lista de la plantilla (data-tables.md): la tarjeta con su cabecera, el filtro como
// desplegable con prefijo, el pie con la paginación numerada y las tablas sin marco propio.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableFooter, pageWindow } from "@/components/data-table/data-table-footer";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";

type Row = { id: string; name: string };
const ROWS: Row[] = [
  { id: "a", name: "Cemento" },
  { id: "b", name: "Varilla" },
];
const COLUMNS: ColumnDef<Row, unknown>[] = [
  { id: "nombre", header: "Nombre", cell: ({ row }) => row.original.name },
];

describe("DataTableCard", () => {
  it("pone el título como encabezado de la pantalla, con descripción, búsqueda, acciones y filtros", () => {
    render(
      <DataTableCard
        title="Productos"
        titleId="productos-titulo"
        description="Lo que vendes."
        search={<input aria-label="Buscar" />}
        actions={<button type="button">Nuevo producto</button>}
        filters={<button type="button">Estado: Activos</button>}
        filtersEnd={<button type="button">Limpiar filtros</button>}
      >
        <p>tabla</p>
      </DataTableCard>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Productos" });
    expect(heading.id).toBe("productos-titulo");
    expect(screen.getByText("Lo que vendes.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Buscar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nuevo producto" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeTruthy();
  });

  it("en una sección de una página mayor, el título es de nivel 2", () => {
    render(
      <DataTableCard title="Historial" titleId="historial" titleAs="h2">
        <p>tabla</p>
      </DataTableCard>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Historial" })).toBeTruthy();
  });
});

describe("DataTableSelectFilter", () => {
  it("el disparador se llama como el filtro, muestra su valor y «Todos» lo quita", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataTableSelectFilter
        label="Estado"
        value="devuelto"
        allLabel="Todos"
        options={[
          { value: "autorizado", label: "Autorizado" },
          { value: "devuelto", label: "Devuelto" },
        ]}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Estado" });
    expect(trigger.textContent).toContain("Devuelto");
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Todos" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("muestra el número de una opción que viene del servidor", async () => {
    const user = userEvent.setup();
    render(
      <DataTableSelectFilter
        label="Vista"
        value="todas"
        options={[
          { value: "todas", label: "Todas" },
          { value: "atencion", label: "Requiere atención", count: 3 },
        ]}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Vista" }));
    expect(await screen.findByRole("option", { name: "Requiere atención 3" })).toBeTruthy();
  });
});

describe("DataTableFooter", () => {
  it("la ventana de páginas tiene hasta tres números centrados en la actual", () => {
    expect(pageWindow(1, 2)).toEqual([1, 2]);
    expect(pageWindow(1, 10)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([4, 5, 6]);
    expect(pageWindow(10, 10)).toEqual([8, 9, 10]);
  });

  it("dice el intervalo, marca la página actual y deshabilita los extremos", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <DataTableFooter
        total={52}
        page={1}
        pageSize={25}
        pageSizeOptions={[10, 25, 50]}
        onPageChange={onPageChange}
        onPageSizeChange={() => {}}
      />,
    );
    expect(screen.getByText("Mostrando 1-25 de 52")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(within(nav).getByRole("button", { name: "Página 1" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("button", { name: "Página anterior" }).matches(":disabled")).toBe(
      true,
    );
    await user.click(within(nav).getByRole("button", { name: "Página 3" }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    expect(screen.getByRole("combobox", { name: "Filas por página" })).toBeTruthy();
  });
});

describe("tablas sin marco dentro de la tarjeta", () => {
  const paging = {
    page: 1,
    pageSize: 25,
    onPageChange: () => {},
    onPageSizeChange: () => {},
    loading: false,
  };

  it("DataTable muestra las filas y el pie numerado, sin el pie anterior", () => {
    render(
      <DataTable
        bare
        label="Productos"
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        rowCount={2}
        {...paging}
      />,
    );
    expect(screen.getByRole("cell", { name: "Cemento" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Página 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Primera página" })).toBeNull();
  });

  it("AppDataTable no pinta la barra propia y usa el pie numerado", () => {
    render(
      <AppDataTable
        bare
        label="Productos"
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        total={2}
        columnVisibility={{}}
        toolbar={<p>barra antigua</p>}
        renderCard={(row) => row.name}
        {...paging}
      />,
    );
    expect(screen.queryByText("barra antigua")).toBeNull();
    expect(screen.getByRole("button", { name: "Página 1" })).toBeTruthy();
  });
});
