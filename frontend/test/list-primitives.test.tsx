// Primitivos derivados para las listas (productize-invoice-list-and-shared-table-foundation, D3,
// tareas 2.1 y 2.2): la tabla semántica con su contenedor desplazable y el grupo de opciones de
// selección única, sin el atributo `style` que la CSP bloquea.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChipGroup } from "@/components/data-table/table-controls";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function Facturas() {
  return (
    <Table>
      <TableCaption>Facturas emitidas</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Factura</TableHead>
          <TableHead>Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>001-001-000000123</TableCell>
          <TableCell>USD 28,75</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function Views() {
  const [value, setValue] = useState("todas");
  return (
    <ToggleGroup
      type="single"
      aria-label="Vista"
      value={value}
      onValueChange={(next) => next && setValue(next)}
    >
      <ToggleGroupItem value="todas">Todas</ToggleGroupItem>
      <ToggleGroupItem value="atencion">Requiere atención</ToggleGroupItem>
    </ToggleGroup>
  );
}

describe("Table", () => {
  it("es una tabla con nombre, encabezados de columna y un contenedor que desplaza a lo ancho", () => {
    render(<Facturas />);
    const table = screen.getByRole("table", { name: "Facturas emitidas" });
    expect(screen.getAllByRole("columnheader").map((th) => th.getAttribute("scope"))).toEqual([
      "col",
      "col",
    ]);
    expect(table.parentElement?.getAttribute("data-slot")).toBe("table-container");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });
});

describe("ToggleGroup", () => {
  it("es un grupo de radio de selección única que se recorre con las flechas", async () => {
    const user = userEvent.setup();
    render(<Views />);
    const group = screen.getByRole("radiogroup", { name: "Vista" });
    const [todas, atencion] = screen.getAllByRole("radio");
    expect(group).toBeDefined();
    expect(todas!.getAttribute("aria-checked")).toBe("true");
    todas!.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(atencion);
    await user.keyboard(" ");
    expect(atencion!.getAttribute("aria-checked")).toBe("true");
    expect(todas!.getAttribute("aria-checked")).toBe("false");
  });

  it("la selección es neutra, no el azul principal", () => {
    render(<Views />);
    const selected = screen.getByRole("radio", { name: "Todas" });
    expect(selected.className).toContain("data-[state=on]:bg-muted");
    expect(selected.className).not.toContain("bg-primary");
  });

  it("no escribe la separación en un atributo style, que la CSP bloquea", () => {
    // La tabla no lleva ningún `style`. El grupo no escribe `--gap` (la plantilla sí): el único
    // `style` es el `outline:none` que el foco itinerante de Radix pone en la raíz. Las pantallas
    // autenticadas pintan sus herramientas en el cliente, donde React lo aplica por CSSOM, que la
    // CSP permite; `check:web-security-policy` vigila que no haya violaciones.
    expect(renderToString(<Facturas />)).not.toMatch(/\sstyle=/);
    const group = renderToString(<Views />);
    expect(group).not.toContain("--gap");
    expect(group.match(/\sstyle="[^"]*"/g)).toEqual([' style="outline:none"']);
  });
});

describe("ChipGroup: selección neutra (productize-invoice-editor-and-composition-foundation, D10)", () => {
  it("la opción elegida se reconoce por el borde y el peso, sin el azul principal", async () => {
    function Harness() {
      const [value, setValue] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
      return (
        <ChipGroup
          label="Estado"
          value={value}
          options={[
            { value: "ACTIVE", label: "Activos" },
            { value: "INACTIVE", label: "Desactivados" },
          ]}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    const active = screen.getByRole("radio", { name: "Activos" });
    expect(active.getAttribute("data-state")).toBe("on");
    const classes = active.className.split(/\s+/);
    for (const token of [
      "data-[state=on]:border-foreground",
      "data-[state=on]:bg-muted",
      "data-[state=on]:font-medium",
      "data-[state=on]:text-foreground",
    ])
      expect(classes, token).toContain(token);
    expect(active.className).not.toContain("bg-primary");
    await userEvent.setup().click(screen.getByRole("radio", { name: "Desactivados" }));
    expect(screen.getByRole("radio", { name: "Desactivados" }).getAttribute("data-state")).toBe(
      "on",
    );
    expect(active.getAttribute("data-state")).toBe("off");
  });
});
