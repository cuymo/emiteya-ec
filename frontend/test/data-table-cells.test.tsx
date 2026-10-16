// Celdas de las tablas (decisión del propietario, 2026-10-16): el importe en verde con el signo de
// dólar, el registro como enlace en azul, el tercero con su identificación atenuada y los datos de
// contexto atenuados.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  MoneyCell,
  MutedCell,
  PartyCell,
  RecordLink,
  formatMoney,
} from "@/components/data-table/data-table-cells";

describe("celdas de las tablas", () => {
  it("el importe lleva el signo de dólar, dos decimales como mínimo y el formato local", () => {
    expect(formatMoney("17355.05")).toBe("$17.355,05");
    expect(formatMoney("8.5")).toBe("$8,50");
    expect(formatMoney("1.123456")).toBe("$1,123456");
  });

  it("el importe va en verde y seminegrita, alineado por sus cifras", () => {
    render(<MoneyCell amount="28.75" />);
    const amount = screen.getByText("$28,75");
    for (const token of ["text-money", "font-semibold", "tabular-nums"]) {
      expect(amount.className).toContain(token);
    }
  });

  it("el registro es un enlace azul y el tercero muestra su identificación atenuada", () => {
    render(
      <>
        <RecordLink href="/facturas/f-1">001-001-000000001</RecordLink>
        <PartyCell name="Ana Pérez" identification="0102030405" />
        <MutedCell>12/10/2026</MutedCell>
      </>,
    );
    const link = screen.getByRole("link", { name: "001-001-000000001" });
    expect(link.getAttribute("href")).toBe("/facturas/f-1");
    expect(link.className).toContain("text-primary");
    expect(screen.getByText("Ana Pérez").className).toContain("font-medium");
    expect(screen.getByText("0102030405").className).toContain("text-foreground-muted");
    expect(screen.getByText("12/10/2026").className).toContain("text-foreground-muted");
  });
});
