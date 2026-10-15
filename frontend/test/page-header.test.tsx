// Encabezado de página compartido (productize-invoice-list-and-shared-table-foundation, design D4,
// tarea 5.1): un solo `h1`, como mucho una acción principal, las secundarias aparte y sin migas.
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
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
    expect(container.querySelector("header")?.children).toHaveLength(1);
  });
});
