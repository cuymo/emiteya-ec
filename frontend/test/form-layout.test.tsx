// Primitivos de composición de formularios (productize-invoice-editor-and-composition-foundation,
// design D5 a D8, tareas 5.1 a 5.4). jsdom no aplica container queries: aquí se comprueban la
// estructura, el orden de lectura y la accesibilidad; las anchuras y la alineación se miden en el
// navegador (`visual/shell/editor.spec.ts` y la revisión visual).
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormField, fieldAria } from "@/components/form-dialog";
import { FormFieldRow, FormGrid } from "@/components/layout/form-grid";
import { FormLayout, StickyFormActions, StickySummaryPanel } from "@/components/layout/form-layout";
import { FormSection } from "@/components/layout/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const classes = (element: Element) => element.className.split(/\s+/);

describe("FormLayout (D5)", () => {
  it("lee el formulario, el panel y las acciones en ese orden, con el panel al lado solo desde 55rem", () => {
    const { container } = render(
      <FormLayout
        panel={<StickySummaryPanel title="Resumen">totales</StickySummaryPanel>}
        actions={<StickyFormActions>{<Button>Guardar borrador</Button>}</StickyFormActions>}
      >
        <FormSection title="Comprador">campos</FormSection>
      </FormLayout>,
    );
    const layout = container.querySelector("[data-slot=form-layout]")!;
    expect(classes(layout)).toContain("@container");
    const grid = layout.firstElementChild!;
    expect(classes(grid)).toEqual(
      expect.arrayContaining(["grid", "@form-rail:grid-cols-form-rail", "@form-rail:items-start"]),
    );
    // Orden del documento: formulario, panel y acciones.
    const order = [...container.querySelectorAll("[data-slot]")]
      .map((element) => element.getAttribute("data-slot"))
      .filter((slot) =>
        ["form-layout-main", "sticky-summary-panel", "sticky-form-actions"].includes(slot!),
      );
    expect(order).toEqual(["form-layout-main", "sticky-summary-panel", "sticky-form-actions"]);
    // Apilado, el carril se disuelve para que la barra de acciones abarque el formulario entero.
    const rail = container.querySelector("[data-slot=form-layout-rail]")!;
    expect(classes(rail)).toEqual(
      expect.arrayContaining(["contents", "@form-rail:sticky", "@form-rail:flex"]),
    );
  });

  it("sin panel ni acciones no deja un carril vacío", () => {
    const { container } = render(
      <FormLayout>
        <p>campos</p>
      </FormLayout>,
    );
    expect(container.querySelector("[data-slot=form-layout-rail]")).toBeNull();
  });
});

describe("FormSection (D6)", () => {
  it("se nombra por su título y lleva su acción local en la cabecera", () => {
    render(
      <FormSection title="Productos" action={<Button variant="outline">Agregar producto</Button>}>
        <p>sin líneas</p>
      </FormSection>,
    );
    const section = screen.getByRole("region", { name: "Productos" });
    expect(within(section).getByRole("heading", { level: 2, name: "Productos" })).toBeDefined();
    const action = within(section).getByRole("button", { name: "Agregar producto" });
    // La acción va en la cabecera, antes del contenido.
    expect(
      action.compareDocumentPosition(within(section).getByText("sin líneas")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("FormGrid y FormFieldRow (D7)", () => {
  it("una forma de pago es un grupo con su leyenda, y quitar queda dentro de su fila", () => {
    render(
      <FormFieldRow legend="Forma de pago 1" layout="payment">
        <FormField id="metodo-1" label="Forma de pago">
          <Input {...fieldAria("metodo-1", undefined)} />
        </FormField>
        <FormField
          id="importe-1"
          label="Importe"
          hint="Déjalo vacío para usar el total de la factura"
          action={<Button aria-label="Quitar la forma de pago 1">x</Button>}
        >
          <Input {...fieldAria("importe-1", undefined)} />
        </FormField>
      </FormFieldRow>,
    );
    const group = screen.getByRole("group", { name: "Forma de pago 1" });
    expect(within(group).getByRole("button", { name: "Quitar la forma de pago 1" })).toBeDefined();
    expect(within(group).getByLabelText("Importe")).toBeDefined();
    // La acción está en la fila del control, no bajo la ayuda.
    const amount = within(group).getByLabelText("Importe");
    const remove = within(group).getByRole("button", { name: "Quitar la forma de pago 1" });
    expect(amount.closest("[data-slot=form-field] > div")).toBe(remove.parentElement);
  });

  it("dentro de una fila, cada campo ocupa tres filas de la subgrid; fuera, se apila", () => {
    const { container } = render(
      <>
        <FormGrid>
          <FormField id="punto" label="Punto de emisión">
            <Input id="punto" />
          </FormField>
        </FormGrid>
        <FormField id="suelto" label="Motivo">
          <Input id="suelto" />
        </FormField>
      </>,
    );
    const [inGrid, alone] = container.querySelectorAll("[data-slot=form-field]");
    expect(classes(inGrid!)).toEqual(
      expect.arrayContaining([
        "@form-wide:row-span-3",
        "@form-wide:grid",
        "@form-wide:grid-rows-subgrid",
      ]),
    );
    expect(classes(alone!).some((token) => token.includes("subgrid"))).toBe(false);
    const grid = container.querySelector("[data-slot=form-grid]")!;
    expect(classes(grid)).toContain("@container");
    expect(classes(grid.firstElementChild!)).toContain("@form-wide:grid-cols-2");
  });
});

describe("StickySummaryPanel y StickyFormActions (D8)", () => {
  it("el panel se nombra por su título; el motivo de la acción no disponible está asociado", () => {
    render(
      <>
        <StickySummaryPanel title="Resumen">
          <p>Guarda el borrador para obtener los totales calculados por el servidor.</p>
        </StickySummaryPanel>
        <StickyFormActions
          notice={<p>Pruebas · esta factura no tendrá validez tributaria.</p>}
          reason="Guarda el borrador para emitirlo."
          reasonId="motivo-emitir"
        >
          <Button>Guardar borrador</Button>
          <Button disabled aria-describedby="motivo-emitir">
            Emitir factura
          </Button>
        </StickyFormActions>
      </>,
    );
    expect(screen.getByRole("complementary", { name: "Resumen" })).toBeDefined();
    const emit = screen.getByRole("button", { name: "Emitir factura" });
    expect(emit).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Emitir factura" }).getAttribute("aria-describedby"),
    ).toBe("motivo-emitir");
    expect(document.getElementById("motivo-emitir")?.textContent).toBe(
      "Guarda el borrador para emitirlo.",
    );
    // El aviso va inmediatamente encima de las acciones.
    const actions = document.querySelector("[data-slot=sticky-form-actions]")!;
    expect(actions.firstElementChild?.textContent).toContain("no tendrá validez tributaria");
    // Apilado, una barra fija al pie; al lado, estática al pie del panel.
    expect(classes(actions)).toEqual(
      expect.arrayContaining(["sticky", "bottom-0", "border-t", "@form-rail:static"]),
    );
  });

  it("sin motivo no deja un párrafo vacío", () => {
    render(
      <StickyFormActions>
        <Button>Emitir factura</Button>
      </StickyFormActions>,
    );
    expect(document.querySelector("[data-slot=sticky-form-actions] p")).toBeNull();
  });
});

describe("título dentro de la columna del formulario (decisión del propietario, 2026-10-22)", () => {
  it("el encabezado va arriba de la columna del formulario y el motivo, centrado bajo las acciones", () => {
    const { container } = render(
      <FormLayout
        header={<h1>Factura</h1>}
        panel={<StickySummaryPanel title="Resumen">Total</StickySummaryPanel>}
        actions={
          <StickyFormActions reason="Guarda los cambios antes de emitir." reasonId="motivo">
            <Button>Guardar borrador</Button>
          </StickyFormActions>
        }
      >
        <FormSection title="Productos">contenido</FormSection>
      </FormLayout>,
    );
    const main = container.querySelector("[data-slot=form-layout-main]")!;
    // El título es lo primero de la columna del formulario, no una fila sobre el panel.
    expect(main.firstElementChild?.querySelector("h1")?.textContent).toBe("Factura");
    expect(container.querySelector("[data-slot=form-layout-rail] h1")).toBeNull();
    expect(screen.getByText("Guarda los cambios antes de emitir.").className).toContain(
      "text-center",
    );
  });
});
