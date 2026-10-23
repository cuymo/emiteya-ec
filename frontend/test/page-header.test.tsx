// Encabezado de página compartido (productize-invoice-list-and-shared-table-foundation, design D4,
// tarea 5.1): un solo `h1`, como mucho una acción principal, las secundarias aparte y sin migas en la
// lista. Variante de editor y ritmo fijo: productize-invoice-editor-and-composition-foundation, D3.
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { FormStateBadge } from "@/components/form-state-badge";
import { EditorTitle } from "@/components/layout/editor-title";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

describe("PageHeader (D4)", () => {
  it("tiene un solo h1 y la acción principal enlaza a su destino", () => {
    render(
      <PageHeader
        title="Facturas"
        titleId="facturas-titulo"
        primaryAction={
          <Button asChild size="default">
            <Link href="/borradores/nuevo">Nueva factura</Link>
          </Button>
        }
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]!.id).toBe("facturas-titulo");
    expect(screen.getByRole("link", { name: "Nueva factura" }).getAttribute("href")).toBe(
      "/borradores/nuevo",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("como mucho hay una acción principal, aunque haya secundarias", () => {
    const { container } = render(
      <PageHeader
        title="Facturas"
        description="Facturas emitidas de la empresa."
        primaryAction={<Button size="default">Nueva factura</Button>}
        secondaryActions={
          <Button variant="outline" size="default">
            Exportar
          </Button>
        }
      />,
    );
    expect(container.querySelectorAll("[data-variant=primary]")).toHaveLength(1);
    expect(screen.getByText("Facturas emitidas de la empresa.")).toBeDefined();
  });

  it("sin acciones no deja un contenedor vacío", () => {
    const { container } = render(<PageHeader title="Facturas" />);
    const header = container.querySelector("header")!;
    expect(header.children).toHaveLength(1);
    expect(header.children[0]!.children).toHaveLength(1);
  });

  it("el bloque del título mide al menos 40 px y centra el título, con acción o sin ella", () => {
    for (const ui of [
      <PageHeader key="sin" title="Facturas" />,
      <PageHeader key="con" title="Facturas" primaryAction={<Button>Nueva factura</Button>} />,
    ]) {
      const { container, unmount } = render(ui);
      const block = container.querySelector("[data-slot=page-header-title]")!;
      expect(block.className.split(/\s+/)).toEqual(
        expect.arrayContaining(["min-h-10", "items-center"]),
      );
      unmount();
    }
  });
});

describe("PageHeader de editor (productize-invoice-editor-and-composition-foundation, D3)", () => {
  it("pinta el título, el contexto y ninguna acción; las migas van en la barra superior", () => {
    const { container } = render(
      <PageHeader variant="editor" title="Nueva factura" context={<span>Sin guardar</span>} />,
    );
    const header = container.querySelector("header")!;
    expect(header.getAttribute("data-variant")).toBe("editor");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Sin guardar")).toBeDefined();
    expect(header.querySelectorAll("button, [data-slot=button]")).toHaveLength(0);
  });
});

describe("título de un formulario (decisión del propietario, 2026-10-22)", () => {
  it("nombra solo la entidad, con su estado en un badge dentro del h1", () => {
    render(<EditorTitle entity="Nota de crédito" feminine state="new" />);
    const title = screen.getByRole("heading", { level: 1, name: "Nota de crédito Nueva" });
    expect(title.id).toBe("editor-titulo");
    // El badge, al final de la fila del título.
    expect(title.className).toContain("justify-between");
    const badge = title.querySelector("[data-form-state]");
    expect(badge?.getAttribute("data-form-state")).toBe("new");
    expect(badge?.getAttribute("data-variant")).toBe("info");
  });

  it("«Borrador» es el badge neutro de las listas, y «Corrección» al corregir", () => {
    render(
      <>
        <PageHeader title="Factura" badge={<FormStateBadge state="draft" />} />
        <FormStateBadge state="edit" />
        <FormStateBadge state="new" />
      </>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Factura Borrador" })).toBeDefined();
    expect(screen.getByText("Borrador").getAttribute("data-variant")).toBe("neutral");
    expect(screen.getByText("Corrección")).toBeDefined();
    expect(screen.getByText("Nuevo")).toBeDefined();
  });
});
