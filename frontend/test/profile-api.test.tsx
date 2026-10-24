// Perfil y avatar propios en el frontend (redesign-account-profile, tarea 6.1, design D7): la
// reducción a 512 px con el navegador y su respaldo, y las rutas de la consulta y de las mutaciones.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  avatarSrc,
  shrinkAvatar,
  useOwnProfile,
  useRemoveAvatar,
  useReplaceAvatar,
} from "@/features/account/profile-api";
import { mockApi, renderApp } from "./harness";

const PROFILE = {
  name: "Ana Admin",
  email: "ana@empresa.ec",
  role: "ADMIN",
  membershipStatus: "ACTIVE",
  memberSince: "2026-10-01T15:00:00.000Z",
  avatar: { version: "0123456789abcdef" },
  avatarMaxBytes: 524288,
};
const ok = (data: unknown) => () => ({ status: 200, body: { data } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reducción de la foto", () => {
  it("sin createImageBitmap sube el archivo tal cual", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const file = new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" });
    expect(await shrinkAvatar(file)).toBe(file);
  });

  it("con el navegador la reduce a 512 px por el lado mayor y conserva PNG", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob(["x"], { type })),
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2048, height: 1024, close: vi.fn() })),
    );
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : create(tag),
    );
    const result = await shrinkAvatar(new File(["png"], "foto.png", { type: "image/png" }));
    expect([canvas.width, canvas.height]).toEqual([512, 256]);
    expect(drawImage).toHaveBeenCalled();
    expect(result.type).toBe("image/png");
    const jpeg = await shrinkAvatar(new File(["jpg"], "foto.jpg", { type: "image/jpeg" }));
    expect(jpeg.type).toBe("image/jpeg");
  });

  it("si el navegador no puede leerla, sube el archivo tal cual", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => Promise.reject(new Error("no"))),
    );
    const file = new File(["?"], "foto.jpg", { type: "image/jpeg" });
    expect(await shrinkAvatar(file)).toBe(file);
  });
});

function Hooks() {
  const profile = useOwnProfile(true);
  const replace = useReplaceAvatar({ onError: () => false });
  const remove = useRemoveAvatar();
  return (
    <>
      <p>{profile.data?.avatar ? avatarSrc(profile.data.avatar.version) : "sin foto"}</p>
      <button onClick={() => replace.mutate(new Blob(["png"], { type: "image/png" }))}>
        Subir
      </button>
      <button onClick={() => remove.mutate()}>Quitar</button>
    </>
  );
}

describe("datos del perfil", () => {
  it("lee el perfil, sube la foto como binario y la quita, con sus avisos", async () => {
    const user = userEvent.setup();
    const types: string[] = [];
    const calls = mockApi({
      "GET /api/v1/me/profile": ok(PROFILE),
      "PUT /api/v1/me/avatar": (init) => {
        types.push(new Headers(init.headers).get("content-type") ?? "");
        return { status: 200, body: { data: PROFILE } };
      },
      "DELETE /api/v1/me/avatar": ok({ ...PROFILE, avatar: null }),
    });
    renderApp(<Hooks />);
    expect(await screen.findByText("/api/v1/me/avatar?v=0123456789abcdef")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Subir" }));
    expect(await screen.findByText("Actualizaste tu foto de perfil.")).toBeDefined();
    expect(types).toEqual(["application/octet-stream"]);
    await user.click(screen.getByRole("button", { name: "Quitar" }));
    expect(await screen.findByText("Quitaste tu foto de perfil.")).toBeDefined();
    await waitFor(() =>
      expect(calls.filter((call) => call.key === "GET /api/v1/me/profile").length).toBeGreaterThan(
        1,
      ),
    );
  });
});
