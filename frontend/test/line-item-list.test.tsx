// Líneas de un comprobante en su detalle: enteras con pocas líneas; con muchas, un buscador sin
// mayúsculas ni tildes y una paginación discreta de 10 en 10, todo en el navegador.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LineItemList } from "@/features/documents/line-item-list";

type Line = { position: number; description: string; mainCode: string | null };
const lines = (count: number): Line[] =>
  Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    description: index === 13 ? "Cerámica de piso 60 x 60" : `Producto ${index + 1}`,
    mainCode: index === 20 ? "TAL-18V" : `P-${index + 1}`,
  }));

function List({ items }: { items: Line[] }) {
  return (
    <LineItemList
      items={items}
      getKey={(line) => line.position}
      getSearchText={(line) => `${line.description} ${line.mainCode ?? ""}`}
      noun={{ one: "producto", many: "productos" }}
      renderItem={(line) => <li>{line.description}</li>}
    />
  );
}

const rows = () => within(screen.getByRole("list")).getAllByRole("listitem");

describe("líneas del detalle", () => {
  it("con 10 líneas o menos, van enteras y sin buscador ni páginas", () => {
    render(<List items={lines(10)} />);
    expect(rows()).toHaveLength(10);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Página siguiente" })).toBeNull();
  });

  it("con muchas, pagina de 10 en 10 con una línea discreta al pie", async () => {
    render(<List items={lines(25)} />);
    expect(rows()).toHaveLength(10);
    expect(screen.getByRole("status").textContent).toBe("1–10 de 25 productos");
    const previous = screen.getByRole("button", { name: "Página anterior" });
    expect(previous).toHaveProperty("disabled", true);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(rows()).toHaveLength(5);
    expect(screen.getByRole("status").textContent).toBe("21–25 de 25 productos");
    expect(screen.getByRole("button", { name: "Página siguiente" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("busca en el nombre y el código sin tildes ni mayúsculas, y vuelve a la primera página", async () => {
    render(<List items={lines(25)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    const search = screen.getByRole("searchbox", { name: "Buscar productos" });
    await user.type(search, "CERAMICA");
    expect(rows().map((row) => row.textContent)).toEqual(["Cerámica de piso 60 x 60"]);
    expect(screen.getByRole("status").textContent).toBe("1 de 25 productos");
    await user.clear(search);
    await user.type(search, "tal-18");
    expect(rows().map((row) => row.textContent)).toEqual(["Producto 21"]);
  });

  it("sin coincidencias lo dice, y limpiar la búsqueda vuelve a la lista", async () => {
    render(<List items={lines(25)} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Buscar productos" }), "nada");
    expect(screen.getByText("Ningún producto coincide con «nada».")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("0 de 25 productos");
    await user.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(rows()).toHaveLength(10);
  });
});
