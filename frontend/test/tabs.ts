// Pestañas del detalle de un comprobante en las pruebas: abre una por su nombre accesible. La de la
// transmisión puede llevar «, requiere atención»: búscala con una expresión.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export async function openTab(name: string | RegExp) {
  await userEvent.setup().click(await screen.findByRole("tab", { name }));
}

export const TRANSMISSION_TAB = /^Transmisión al SRI/;

/** Abre el menú «⋯» de más acciones del encabezado de un detalle y devuelve el menú. */
export async function openMoreActions() {
  await userEvent.setup().click(await screen.findByRole("button", { name: /^Más acciones/ }));
  return screen.findByRole("menu");
}
