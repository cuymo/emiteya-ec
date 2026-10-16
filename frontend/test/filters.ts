// Elige una opción en un filtro desplegable de lista (`DataTableSelectFilter`): abre el selector por
// su nombre y pulsa la opción, como lo haría el usuario.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export async function chooseFilter(label: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}
