// La ayuda de un campo junto a su etiqueta (decisión del propietario, 2026-10-22): un ícono que
// muestra el texto en un tooltip, en lugar del texto pequeño debajo del campo; el control la sigue
// nombrando en `aria-describedby`; una cuenta de caracteres se ve siempre; y al abrir un diálogo el
// foco va al primer control, no a la ayuda de su etiqueta.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fieldAria, FormDialog, FormField } from "@/components/form-dialog";
import { Input } from "@/components/ui/input";

const HINT = "Con punto decimal y hasta 6 decimales, por ejemplo 8.75.";

describe("ayuda de un campo", () => {
  it("va en un ícono junto a la etiqueta, y el control la sigue nombrando", () => {
    render(
      <FormField id="precio" label="Precio" hint={HINT}>
        <Input {...fieldAria("precio", undefined, "hint")} />
      </FormField>,
    );
    const button = screen.getByRole("button", { name: "Ayuda: Precio" });
    // En la fila de la etiqueta, no debajo del control.
    expect(button.parentElement?.querySelector("label")?.textContent).toBe("Precio");
    const input = screen.getByLabelText("Precio");
    const described = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(described?.textContent).toBe(HINT);
    expect(described?.className).toContain("sr-only");
  });

  it("muestra el texto en un tooltip al pasar el ratón y al tocarlo", async () => {
    render(
      <FormField id="precio" label="Precio" hint={HINT}>
        <Input {...fieldAria("precio", undefined, "hint")} />
      </FormField>,
    );
    const user = userEvent.setup();
    await user.hover(screen.getByRole("button", { name: "Ayuda: Precio" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain(HINT);
    // Escape lo cierra; un toque, como en un teléfono, lo vuelve a abrir.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Ayuda: Precio" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain(HINT);
  });

  it("una cuenta de caracteres se ve siempre debajo del control", () => {
    render(
      <FormField id="motivo" label="Motivo" hint="En una sola línea." counter="12/300">
        <Input {...fieldAria("motivo", undefined, "hint")} />
      </FormField>,
    );
    expect(screen.getByText("12/300").className).not.toContain("sr-only");
  });

  it("al abrir un diálogo, el foco va al primer control y no a la ayuda", async () => {
    render(
      <FormDialog
        open
        onOpenChange={vi.fn()}
        title="Nuevo establecimiento"
        submitLabel="Crear"
        pending={false}
        onSubmit={(event) => event.preventDefault()}
      >
        <FormField id="codigo" label="Código" hint="Tres dígitos, como en el SRI.">
          <Input {...fieldAria("codigo", undefined, "hint")} />
        </FormField>
      </FormDialog>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Código")));
  });
});
