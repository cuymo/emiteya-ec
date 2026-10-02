import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FileField } from "@/components/file-field";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";

describe("SegmentedControl", () => {
  it("empieza sin selección, se opera con teclado y no deselecciona", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<"SI" | "NO" | undefined>(undefined);
      return (
        <>
          <span id="etiqueta">Obligada</span>
          <SegmentedControl
            options={[
              { value: "SI", label: "Sí" },
              { value: "NO", label: "No" },
            ]}
            value={value}
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            aria-labelledby="etiqueta"
          />
        </>
      );
    }
    render(<Harness />);
    const yes = screen.getByRole("radio", { name: "Sí" });
    expect(
      screen.getAllByRole("radio").every((item) => item.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    const user = userEvent.setup();
    await user.click(yes);
    expect(onChange).toHaveBeenLastCalledWith("SI");
    await user.click(yes);
    expect(yes.getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{ArrowRight}");
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith("NO");
  });
});

describe("ConfirmDialog", () => {
  function Harness({ typed, onConfirm }: { typed?: boolean; onConfirm: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Abrir</Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Cambiar a Producción"
          description="Escribe el RUC para confirmar."
          confirmLabel="Confirmar"
          pending={false}
          onConfirm={onConfirm}
          {...(typed
            ? { typedConfirmation: { label: "RUC de la empresa", expected: "1790012345001" } }
            : {})}
        />
      </>
    );
  }

  it("bloquea la confirmación hasta escribir el texto exacto", async () => {
    const onConfirm = vi.fn();
    render(<Harness typed onConfirm={onConfirm} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("RUC de la empresa"), "179001234500");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("RUC de la empresa"), "1");
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("de un paso, Escape cancela y el foco vuelve a quien lo abrió", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeDefined();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("FileField", () => {
  const props = {
    id: "logo",
    label: "Imagen del logo",
    accept: ["image/png", "image/jpeg"] as const,
    acceptLabel: "PNG o JPEG",
    maxBytes: 1024,
    pending: false,
  };

  it("muestra tipos y límite antes de elegir, y entrega un archivo válido", () => {
    const onSelect = vi.fn();
    render(<FileField {...props} current={null} onSelect={onSelect} />);
    expect(screen.getByText("PNG o JPEG, hasta 1 KB.")).toBeDefined();
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Imagen del logo"), { target: { files: [file] } });
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it("avisa antes de enviar un tipo o un tamaño no admitidos", () => {
    const onSelect = vi.fn();
    render(<FileField {...props} current={null} onSelect={onSelect} />);
    const input = screen.getByLabelText("Imagen del logo");
    fireEvent.change(input, {
      target: { files: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })] },
    });
    expect(screen.getByRole("alert").textContent).toBe("El archivo debe ser PNG o JPEG.");
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(2048)], "grande.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("alert").textContent).toBe("El archivo supera el límite de 1 KB.");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("muestra el archivo vigente con su tipo y tamaño, y ofrece reemplazar y eliminar", async () => {
    const onRemove = vi.fn();
    render(
      <FileField
        {...props}
        current={{ name: "Logo vigente", typeLabel: "PNG", sizeBytes: 2048 }}
        onSelect={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("Logo vigente")).toBeDefined();
    expect(screen.getByText("PNG · 2 KB")).toBeDefined();
    expect(screen.getByRole("button", { name: "Reemplazar" })).toBeDefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("sin disponibilidad explica por qué y no permite elegir", () => {
    render(
      <FileField
        {...props}
        current={null}
        onSelect={vi.fn()}
        disabledReason="Registra primero los datos."
      />,
    );
    expect(screen.getByText("Registra primero los datos.")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Elegir archivo" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
