// Encabezado de página compartido (productize-invoice-list-and-shared-table-foundation, design D4,
// tarea 5.1): un solo `h1`, como mucho una acción principal, las secundarias aparte y sin migas en la
// lista. Variante de editor y ritmo fijo: productize-invoice-editor-and-composition-foundation, D3.
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "@/components/layout/page-header";
import { BreadcrumbLabelProvider, useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { Button } from "@/components/ui/button";
import { navigation } from "./navigation";

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
  afterEach(() => {
    navigation.pathname = "/";
  });

  function Record({ label }: { label: string }) {
    useBreadcrumbLabel(label);
    return null;
  }

  it("pinta las migas de la ruta encima del título, el contexto y ninguna acción", () => {
    navigation.pathname = "/borradores/nuevo";
    const { container } = render(
      <BreadcrumbLabelProvider>
        <PageHeader variant="editor" title="Nueva factura" context={<span>Sin guardar</span>} />
      </BreadcrumbLabelProvider>,
    );
    const header = container.querySelector("header")!;
    expect(header.getAttribute("data-variant")).toBe("editor");
    const crumbs = screen.getByRole("navigation", { name: "Ruta de navegación" });
    // Las migas van antes que el título, y el título es el único h1.
    expect(header.firstElementChild).toBe(crumbs);
    expect(screen.getByRole("link", { name: "Facturas" }).getAttribute("href")).toBe("/facturas");
    expect(screen.getByText("Nueva factura", { selector: "[aria-current=page]" })).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Sin guardar")).toBeDefined();
    expect(header.querySelectorAll("button, [data-slot=button]")).toHaveLength(0);
  });

  it("solo pinta migas donde la ruta se las da al encabezado", () => {
    navigation.pathname = "/notas-credito/borradores/d1";
    render(<PageHeader variant="editor" title="Borrador de nota de crédito" />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("la última miga toma la etiqueta del registro cuando la pantalla la da", () => {
    navigation.pathname = "/borradores/d-1";
    render(
      <BreadcrumbLabelProvider>
        <Record label="Borrador de EL PERNO" />
        <PageHeader variant="editor" title="Borrador de factura" />
      </BreadcrumbLabelProvider>,
    );
    expect(
      screen.getByText("Borrador de EL PERNO", { selector: "[aria-current=page]" }),
    ).toBeDefined();
  });
});
