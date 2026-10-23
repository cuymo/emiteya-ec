// DatePickerField (component-system.md; add-document-archive, tarea 10.1; decisión del propietario,
// 2026-10-22): la fecha con el calendario de shadcn en un popover, con etiqueta, limpieza y error
// asociados, los días fuera del rango deshabilitados, y operable con teclado.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DatePickerField } from "@/components/date-picker-field";
import { calendarDay, chooseDate, openCalendar } from "./harness";

function Harness({ initial = "", error, min }: { initial?: string; error?: string; min?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <DatePickerField
      label="Desde"
      value={value}
      onChange={setValue}
      error={error ?? null}
      {...(min ? { min } : {})}
    />
  );
}

describe("DatePickerField", () => {
  it("muestra la fecha como dd/mm/aaaa y la limpia", async () => {
    const onChange = vi.fn();
    render(<DatePickerField label="Desde" value="2026-10-01" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Desde 01/10/2026" });
    expect(screen.getByLabelText("Desde")).toBe(trigger);
    await userEvent.setup().click(screen.getByRole("button", { name: "Limpiar desde" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("elige la fecha en el calendario y lo cierra", async () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Desde Elige una fecha" })).toBeDefined();
    const user = userEvent.setup();
    await chooseDate(user, "Desde", "2026-03-14");
    expect(screen.getByRole("button", { name: "Desde 14/03/2026" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("abre en la fecha elegida, en español y con la semana desde el lunes", async () => {
    render(<Harness initial="2026-10-15" />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Desde"));
    const calendar = await screen.findByRole("dialog");
    const day = within(calendar).getByRole("button", { name: calendarDay("2026-10-15") });
    expect(day.getAttribute("data-selected-single")).toBe("true");
    expect(
      within(calendar)
        .getAllByRole("columnheader", { hidden: true })
        .map((header) => header.getAttribute("aria-label")),
    ).toEqual(["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]);
    // Escape cierra el calendario y devuelve el foco al campo.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Desde"));
  });

  it("deshabilita los días fuera del rango", async () => {
    render(<Harness min="2026-10-10" />);
    const calendar = await openCalendar(userEvent.setup(), "Desde", "2026-10-10");
    expect(
      within(calendar).getByRole("button", { name: calendarDay("2026-10-09") }),
    ).toHaveProperty("disabled", true);
    expect(
      within(calendar).getByRole("button", { name: calendarDay("2026-10-10") }),
    ).toHaveProperty("disabled", false);
  });

  it("sin fecha no ofrece limpiar", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Limpiar desde" })).toBeNull();
  });

  it("asocia el error al campo", () => {
    render(
      <Harness initial="2026-10-15" error="La fecha final no puede ser anterior a la inicial." />,
    );
    const trigger = screen.getByLabelText("Desde");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(trigger.getAttribute("aria-describedby")!);
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
    expect(screen.getByRole("button", { name: "Desde Elige una fecha" })).toBeDefined();
  });
});
