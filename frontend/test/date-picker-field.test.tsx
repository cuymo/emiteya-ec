// DatePickerField (component-system.md; add-document-archive, tarea 10.1): el campo de fecha
// nativo con etiqueta, limpieza y error asociado, operable con teclado.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DatePickerField } from "@/components/date-picker-field";

function Harness({ initial = "", error }: { initial?: string; error?: string }) {
  const [value, setValue] = useState(initial);
  return <DatePickerField label="Desde" value={value} onChange={setValue} error={error ?? null} />;
}

describe("DatePickerField", () => {
  it("muestra la fecha, la cambia y la limpia", async () => {
    const onChange = vi.fn();
    render(<DatePickerField label="Desde" value="2026-10-01" onChange={onChange} />);
    const input = screen.getByLabelText("Desde");
    expect(input.getAttribute("type")).toBe("date");
    expect((input as HTMLInputElement).value).toBe("2026-10-01");
    await userEvent.setup().click(screen.getByRole("button", { name: "Limpiar desde" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("sin fecha no ofrece limpiar", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Limpiar desde" })).toBeNull();
  });

  it("asocia el error al campo", () => {
    render(
      <Harness initial="2026-10-15" error="La fecha final no puede ser anterior a la inicial." />,
    );
    const input = screen.getByLabelText("Desde");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(message?.textContent).toBe("La fecha final no puede ser anterior a la inicial.");
  });

  it("se opera con teclado: el campo y su limpieza reciben el foco", async () => {
    render(<Harness initial="2026-10-15" />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Desde"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Limpiar desde" }));
    await user.keyboard("{Enter}");
    expect((screen.getByLabelText("Desde") as HTMLInputElement).value).toBe("");
  });
});
