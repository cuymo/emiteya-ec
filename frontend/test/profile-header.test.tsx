// Cabecera del perfil en Mi cuenta (redesign-account-profile, tareas 6.2 y 7.2, design D8): sin foto
// con las iniciales, con foto, cargarla, quitarla, el formato rechazado en el cliente y el tamaño
// rechazado por el servidor junto al control, las insignias de la cuenta y el teclado.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "@/components/session";
import { AccountScreen } from "@/features/account/account-screen";
import { OPERATOR_ME, errorBody, mockApi, navigation, renderApp, type Route } from "./harness";

const PROFILE = {
  name: OPERATOR_ME.name,
  email: OPERATOR_ME.email,
  role: "OPERATOR",
  membershipStatus: "ACTIVE",
  memberSince: "2026-10-01T15:00:00.000Z",
  avatar: null as { version: string } | null,
  avatarMaxBytes: 524288,
};
const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });

function render(routes: Record<string, Route>) {
  const calls = mockApi({
    "GET /api/v1/me": ok(OPERATOR_ME),
    "GET /api/v1/me/default-emission-point": ok({
      establishment: null,
      emissionPoint: null,
      available: true,
    }),
    "GET /api/v1/establishments": ok([]),
    ...routes,
  });
  renderApp(
    <SessionGate fallback={<p>cargando</p>}>
      <AccountScreen />
    </SessionGate>,
  );
  return calls;
}
const section = async () => {
  await screen.findByRole("button", { name: /Subir foto|Cambiar foto/ });
  return document.querySelector<HTMLElement>("[data-slot=profile-header]")!;
};
const fileInput = () => document.getElementById("foto-archivo") as HTMLInputElement;

beforeEach(() => {
  navigation.pathname = "/mi-cuenta";
  vi.stubGlobal("createImageBitmap", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("foto de perfil", () => {
  it("sin foto muestra las iniciales y ofrece subirla, con el formato y el límite", async () => {
    render({ "GET /api/v1/me/profile": ok(PROFILE) });
    const area = await section();
    expect(await within(area).findByText("ÓO")).toBeDefined();
    expect(within(area).getByRole("button", { name: "Subir foto" })).toBeDefined();
    expect(within(area).queryByRole("button", { name: "Quitar foto" })).toBeNull();
    expect(within(area).getByText(/PNG o JPEG, hasta 512 KB\. Solo la ves tú/)).toBeDefined();
  });

  it("con foto la marca y ofrece cambiarla o quitarla", async () => {
    render({ "GET /api/v1/me/profile": ok({ ...PROFILE, avatar: { version: "abc123" } }) });
    const area = await section();
    expect(await within(area).findByRole("button", { name: "Cambiar foto" })).toBeDefined();
    expect(area.querySelector("[data-has-photo=true]")).not.toBeNull();
  });

  it("sube la foto elegida y la quita, con sus avisos", async () => {
    const user = userEvent.setup();
    let current = PROFILE;
    const calls = render({
      "GET /api/v1/me/profile": () => ({ status: 200, body: { data: current } }),
      "PUT /api/v1/me/avatar": () => {
        current = { ...PROFILE, avatar: { version: "nueva" } };
        return { status: 200, body: { data: current } };
      },
      "DELETE /api/v1/me/avatar": () => {
        current = PROFILE;
        return { status: 200, body: { data: current } };
      },
    });
    const area = await section();
    await within(area).findByRole("button", { name: "Subir foto" });
    await user.upload(fileInput(), new File(["png"], "yo.png", { type: "image/png" }));
    expect(await screen.findByText("Actualizaste tu foto de perfil.")).toBeDefined();
    expect(calls.some((call) => call.key === "PUT /api/v1/me/avatar")).toBe(true);
    await user.click(await within(area).findByRole("button", { name: "Quitar foto" }));
    expect(await screen.findByText("Quitaste tu foto de perfil.")).toBeDefined();
    await waitFor(() =>
      expect(within(area).getByRole("button", { name: "Subir foto" })).toBeDefined(),
    );
  });

  it("un formato no admitido se explica junto al control, sin enviarlo", async () => {
    const calls = render({ "GET /api/v1/me/profile": ok(PROFILE) });
    const area = await section();
    await within(area).findByRole("button", { name: "Subir foto" });
    await userEvent
      .setup({ applyAccept: false })
      .upload(fileInput(), new File(["gif"], "yo.gif", { type: "image/gif" }));
    expect(await within(area).findByRole("alert")).toBeDefined();
    expect(within(area).getByRole("alert").textContent).toBe("El archivo debe ser PNG o JPEG.");
    expect(calls.some((call) => call.key === "PUT /api/v1/me/avatar")).toBe(false);
  });

  it("el rechazo del servidor por tamaño se muestra junto al control", async () => {
    const user = userEvent.setup();
    render({
      "GET /api/v1/me/profile": ok(PROFILE),
      "PUT /api/v1/me/avatar": () => ({
        status: 413,
        body: errorBody("AVATAR_TOO_LARGE", "La foto supera el límite de 512 KB."),
      }),
    });
    const area = await section();
    await within(area).findByRole("button", { name: "Subir foto" });
    await user.upload(fileInput(), new File(["png"], "yo.png", { type: "image/png" }));
    expect((await within(area).findByRole("alert")).textContent).toBe(
      "La foto supera el límite de 512 KB.",
    );
    expect(
      within(area).getByRole("button", { name: "Subir foto" }).getAttribute("aria-describedby"),
    ).toBe("foto-error");
  });

  it("los controles se alcanzan con el teclado y el selector de archivos queda fuera del recorrido", async () => {
    const user = userEvent.setup();
    render({ "GET /api/v1/me/profile": ok({ ...PROFILE, avatar: { version: "abc" } }) });
    const area = await section();
    const change = await within(area).findByRole("button", { name: "Cambiar foto" });
    change.focus();
    await user.tab();
    expect(document.activeElement).toBe(within(area).getByRole("button", { name: "Quitar foto" }));
    expect(fileInput().tabIndex).toBe(-1);
  });
});
